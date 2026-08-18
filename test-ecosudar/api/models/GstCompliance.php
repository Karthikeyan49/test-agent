<?php
declare(strict_types=1);

class GstCompliance
{
    public const STATUSES = ['draft', 'reviewed', 'filed', 'locked'];

    public static function all(int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $total = Database::count('SELECT COUNT(*) AS cnt FROM gst_compliance_periods');
        $rows = Database::fetchAll(
            'SELECT * FROM gst_compliance_periods ORDER BY period_key DESC LIMIT ? OFFSET ?',
            [$limit, ($page - 1) * $limit]
        );

        return [
            'rows' => array_map([self::class, 'formatPeriod'], $rows),
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => (int)ceil($total / $limit),
            ],
        ];
    }

    public static function find(string $periodKey): ?array
    {
        $row = Database::fetch('SELECT * FROM gst_compliance_periods WHERE period_key = ? LIMIT 1', [$periodKey]);

        return $row ? self::formatPeriod($row) : null;
    }

    public static function calculate(string $periodKey): array
    {
        [$from, $to] = self::dateRange($periodKey);

        $sales = Database::fetch(
            "SELECT COUNT(*) AS invoice_count,
                    COALESCE(SUM(GREATEST(subtotal - COALESCE(discount, 0), 0)), 0) AS taxable,
                    COALESCE(SUM(cgst_amount), 0) AS cgst,
                    COALESCE(SUM(sgst_amount), 0) AS sgst,
                    COALESCE(SUM(igst_amount), 0) AS igst,
                    COALESCE(SUM(total), 0) AS gross
             FROM invoices
             WHERE DATE(COALESCE(invoice_date, created_at)) BETWEEN ? AND ?
               AND LOWER(status) <> 'cancelled'",
            [$from, $to]
        ) ?: [];

        $input = Database::fetch(
            "SELECT COUNT(*) AS purchase_count,
                    COALESCE(SUM(tax_amount), 0) AS input_tax
             FROM purchase_orders
             WHERE order_date BETWEEN ? AND ?
               AND status NOT IN ('draft', 'cancelled')",
            [$from, $to]
        ) ?: [];

        $taxable = round((float)($sales['taxable'] ?? 0), 2);
        $cgst = round((float)($sales['cgst'] ?? 0), 2);
        $sgst = round((float)($sales['sgst'] ?? 0), 2);
        $igst = round((float)($sales['igst'] ?? 0), 2);
        $inputTax = round((float)($input['input_tax'] ?? 0), 2);
        $outputTax = round($cgst + $sgst + $igst, 2);

        return [
            'period_key' => $periodKey,
            'from_date' => $from,
            'to_date' => $to,
            'invoice_count' => (int)($sales['invoice_count'] ?? 0),
            'purchase_count' => (int)($input['purchase_count'] ?? 0),
            'sales_taxable' => $taxable,
            'sales_cgst' => $cgst,
            'sales_sgst' => $sgst,
            'sales_igst' => $igst,
            'output_tax' => $outputTax,
            'input_tax' => $inputTax,
            'net_payable' => round(max(0.0, $outputTax - $inputTax), 2),
            'credit_carried' => round(max(0.0, $inputTax - $outputTax), 2),
        ];
    }

    public static function saveSnapshot(string $periodKey, int $actorId): array
    {
        $calc = self::calculate($periodKey);
        Database::execute(
            'INSERT INTO gst_compliance_periods
                (period_key, from_date, to_date, sales_taxable, sales_cgst, sales_sgst,
                 sales_igst, input_tax, net_payable, status, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, "draft", ?, NOW())
             ON DUPLICATE KEY UPDATE
                sales_taxable = VALUES(sales_taxable),
                sales_cgst = VALUES(sales_cgst),
                sales_sgst = VALUES(sales_sgst),
                sales_igst = VALUES(sales_igst),
                input_tax = VALUES(input_tax),
                net_payable = VALUES(net_payable),
                updated_at = NOW()',
            [
                $calc['period_key'],
                $calc['from_date'],
                $calc['to_date'],
                $calc['sales_taxable'],
                $calc['sales_cgst'],
                $calc['sales_sgst'],
                $calc['sales_igst'],
                $calc['input_tax'],
                $calc['net_payable'],
                $actorId ?: null,
            ]
        );

        return self::find($periodKey) ?: $calc;
    }

    public static function updateStatus(string $periodKey, string $status, array $data, int $actorId): array
    {
        if (!in_array($status, self::STATUSES, true)) {
            Response::error('Invalid GST period status', 422);
        }
        if (!self::find($periodKey)) {
            self::saveSnapshot($periodKey, $actorId);
        }

        $sets = ['status = ?', 'updated_at = NOW()'];
        $params = [$status];
        if ($status === 'filed') {
            $sets[] = 'filed_on = ?';
            $params[] = $data['filed_on'] ?? date('Y-m-d');
            $sets[] = 'reference_no = ?';
            $params[] = $data['reference_no'] ?? null;
        }
        if ($status === 'locked') {
            $sets[] = 'locked_by = ?';
            $params[] = $actorId ?: null;
            $sets[] = 'locked_at = NOW()';
        }
        if (array_key_exists('notes', $data)) {
            $sets[] = 'notes = ?';
            $params[] = $data['notes'];
        }
        $params[] = $periodKey;

        Database::execute('UPDATE gst_compliance_periods SET ' . implode(', ', $sets) . ' WHERE period_key = ?', $params);

        return self::find($periodKey) ?: [];
    }

    public static function export(string $periodKey): array
    {
        [$from, $to] = self::dateRange($periodKey);
        $summary = self::calculate($periodKey);
        $b2b = Database::fetchAll(
            "SELECT i.invoice_id, i.invoice_number, i.invoice_date, i.created_at,
                    i.customer_name, i.customer_gstin, i.customer_state,
                    GREATEST(i.subtotal - COALESCE(i.discount, 0), 0) AS taxable,
                    i.cgst_amount, i.sgst_amount, i.igst_amount, i.total
             FROM invoices i
             WHERE DATE(COALESCE(i.invoice_date, i.created_at)) BETWEEN ? AND ?
               AND i.customer_gstin IS NOT NULL AND i.customer_gstin <> ''
               AND LOWER(i.status) <> 'cancelled'
             ORDER BY i.invoice_date ASC, i.invoice_id ASC",
            [$from, $to]
        );
        $hsn = Database::fetchAll(
            "SELECT COALESCE(NULLIF(ii.hsn_code, ''), 'UNSPECIFIED') AS hsn_code,
                    ii.gst_rate,
                    SUM(ii.quantity) AS quantity,
                    SUM(ii.line_total) AS taxable,
                    SUM(ROUND(ii.line_total * ii.gst_rate / 100, 2)) AS tax_amount
             FROM invoice_items ii
             JOIN invoices i ON i.invoice_id = ii.invoice_id
             WHERE DATE(COALESCE(i.invoice_date, i.created_at)) BETWEEN ? AND ?
               AND LOWER(i.status) <> 'cancelled'
             GROUP BY COALESCE(NULLIF(ii.hsn_code, ''), 'UNSPECIFIED'), ii.gst_rate
             ORDER BY hsn_code ASC, ii.gst_rate ASC",
            [$from, $to]
        );

        foreach ($b2b as &$row) {
            foreach (['taxable', 'cgst_amount', 'sgst_amount', 'igst_amount', 'total'] as $field) {
                $row[$field] = (float)$row[$field];
            }
        }
        foreach ($hsn as &$row) {
            $row['gst_rate'] = (float)$row['gst_rate'];
            $row['quantity'] = (float)$row['quantity'];
            $row['taxable'] = (float)$row['taxable'];
            $row['tax_amount'] = (float)$row['tax_amount'];
        }

        return [
            'period' => $summary,
            'gstr1_b2b' => $b2b,
            'hsn_summary' => $hsn,
        ];
    }

    public static function periodKey(string $value): string
    {
        $value = trim($value);
        if (!preg_match('/^\d{4}-\d{2}$/', $value)) {
            Response::error('period must be YYYY-MM', 422);
        }

        return $value;
    }

    private static function dateRange(string $periodKey): array
    {
        $periodKey = self::periodKey($periodKey);
        $from = $periodKey . '-01';
        $to = date('Y-m-t', strtotime($from));

        return [$from, $to];
    }

    private static function formatPeriod(array $row): array
    {
        return [
            'period_id' => (int)$row['period_id'],
            'id' => (string)$row['period_id'],
            'period_key' => $row['period_key'],
            'from_date' => $row['from_date'],
            'to_date' => $row['to_date'],
            'sales_taxable' => (float)$row['sales_taxable'],
            'sales_cgst' => (float)$row['sales_cgst'],
            'sales_sgst' => (float)$row['sales_sgst'],
            'sales_igst' => (float)$row['sales_igst'],
            'output_tax' => round((float)$row['sales_cgst'] + (float)$row['sales_sgst'] + (float)$row['sales_igst'], 2),
            'input_tax' => (float)$row['input_tax'],
            'net_payable' => (float)$row['net_payable'],
            'status' => $row['status'],
            'filed_on' => $row['filed_on'],
            'reference_no' => $row['reference_no'],
            'notes' => $row['notes'],
            'locked_by' => $row['locked_by'] ? (int)$row['locked_by'] : null,
            'locked_at' => $row['locked_at'],
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
    }
}
