<?php
declare(strict_types=1);

class Payment
{
    public const DIRECTIONS = ['in', 'out'];
    public const MODES = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Card'];

    public static function all(array $filters, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['direction']) && in_array($filters['direction'], self::DIRECTIONS, true)) {
            $where[] = 'p.direction = ?';
            $params[] = $filters['direction'];
        }
        if (!empty($filters['status']) && in_array($filters['status'], ['posted', 'void'], true)) {
            $where[] = 'p.status = ?';
            $params[] = $filters['status'];
        }
        if (!empty($filters['invoice_id'])) {
            $where[] = 'p.invoice_id = ?';
            $params[] = (int)$filters['invoice_id'];
        }
        if (!empty($filters['po_id'])) {
            $where[] = 'p.po_id = ?';
            $params[] = (int)$filters['po_id'];
        }
        if (!empty($filters['vendor_id'])) {
            $where[] = 'COALESCE(p.vendor_id, po.vendor_id) = ?';
            $params[] = (int)$filters['vendor_id'];
        }
        if (!empty($filters['user_id'])) {
            $where[] = 'COALESCE(p.user_id, o.user_id) = ?';
            $params[] = (int)$filters['user_id'];
        }
        if (!empty($filters['from'])) {
            $where[] = 'p.paid_on >= ?';
            $params[] = $filters['from'];
        }
        if (!empty($filters['to'])) {
            $where[] = 'p.paid_on <= ?';
            $params[] = $filters['to'];
        }
        if (!empty($filters['search'])) {
            $like = '%' . trim((string)$filters['search']) . '%';
            $where[] = '(p.payment_number LIKE ? OR p.reference_no LIKE ? OR i.invoice_number LIKE ? OR po.po_number LIKE ? OR direct_user.name LIKE ? OR order_user.name LIKE ? OR v.name LIKE ?)';
            array_push($params, $like, $like, $like, $like, $like, $like, $like);
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count(
            "SELECT COUNT(*) AS cnt
             FROM payments p
             LEFT JOIN invoices i ON i.invoice_id = p.invoice_id
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users direct_user ON direct_user.user_id = p.user_id
             LEFT JOIN users order_user ON order_user.user_id = o.user_id
             LEFT JOIN purchase_orders po ON po.po_id = p.po_id
             LEFT JOIN vendors v ON v.vendor_id = COALESCE(p.vendor_id, po.vendor_id)
             WHERE $whereClause",
            $params
        );

        $rows = Database::fetchAll(
            "SELECT p.*, i.invoice_number, i.total AS invoice_total, i.amount_paid AS invoice_amount_paid,
                    po.po_number, po.total AS po_total,
                    COALESCE(direct_user.name, order_user.name, i.customer_name) AS customer_name,
                    v.name AS vendor_name
             FROM payments p
             LEFT JOIN invoices i ON i.invoice_id = p.invoice_id
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users direct_user ON direct_user.user_id = p.user_id
             LEFT JOIN users order_user ON order_user.user_id = o.user_id
             LEFT JOIN purchase_orders po ON po.po_id = p.po_id
             LEFT JOIN vendors v ON v.vendor_id = COALESCE(p.vendor_id, po.vendor_id)
             WHERE $whereClause
             ORDER BY p.paid_on DESC, p.payment_id DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        return [
            'rows' => array_map([self::class, 'format'], $rows),
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => (int)ceil($total / $limit),
            ],
        ];
    }

    public static function findById(int $id): ?array
    {
        $row = Database::fetch(
            "SELECT p.*, i.invoice_number, i.total AS invoice_total, i.amount_paid AS invoice_amount_paid,
                    po.po_number, po.total AS po_total,
                    COALESCE(direct_user.name, order_user.name, i.customer_name) AS customer_name,
                    v.name AS vendor_name
             FROM payments p
             LEFT JOIN invoices i ON i.invoice_id = p.invoice_id
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users direct_user ON direct_user.user_id = p.user_id
             LEFT JOIN users order_user ON order_user.user_id = o.user_id
             LEFT JOIN purchase_orders po ON po.po_id = p.po_id
             LEFT JOIN vendors v ON v.vendor_id = COALESCE(p.vendor_id, po.vendor_id)
             WHERE p.payment_id = ?
             LIMIT 1",
            [$id]
        );

        return $row ? self::format($row) : null;
    }

    public static function create(array $data): int
    {
        return Database::insert(
            'INSERT INTO payments
                (payment_number, direction, invoice_id, po_id, user_id, vendor_id, amount,
                 payment_mode, reference_no, paid_on, notes, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $data['payment_number'],
                $data['direction'],
                $data['invoice_id'] ?: null,
                $data['po_id'] ?: null,
                $data['user_id'] ?: null,
                $data['vendor_id'] ?: null,
                $data['amount'],
                $data['payment_mode'],
                $data['reference_no'] ?: null,
                $data['paid_on'],
                $data['notes'] ?: null,
                $data['created_by'] ?? null,
            ]
        );
    }

    public static function void(int $id, int $actorId, string $reason): void
    {
        Database::execute(
            'UPDATE payments
             SET status = "void", voided_by = ?, voided_at = NOW(), void_reason = ?
             WHERE payment_id = ? AND status = "posted"',
            [$actorId, $reason, $id]
        );
    }

    public static function refreshRelated(?int $invoiceId, ?int $poId): void
    {
        if ($invoiceId) {
            self::refreshInvoice($invoiceId);
        }
        if ($poId) {
            self::refreshPurchaseOrder($poId);
        }
    }

    public static function refreshInvoice(int $invoiceId): array
    {
        $invoice = Database::fetch('SELECT invoice_id, order_id, total FROM invoices WHERE invoice_id = ? LIMIT 1', [$invoiceId]);
        if (!$invoice) {
            Response::error('Invoice not found', 404);
        }

        $row = Database::fetch(
            'SELECT COALESCE(SUM(CASE WHEN direction = "in" THEN amount ELSE -amount END), 0) AS paid,
                    MAX(CASE WHEN status = "posted" THEN created_at ELSE NULL END) AS last_payment_at
             FROM payments
             WHERE invoice_id = ? AND status = "posted"',
            [$invoiceId]
        );

        $total = round((float)$invoice['total'], 2);
        $paid = round(max(0.0, (float)($row['paid'] ?? 0)), 2);
        $balance = round(max(0.0, $total - $paid), 2);
        $paymentStatus = $paid <= 0.005 ? 'unpaid' : ($balance <= 0.005 ? 'paid' : 'partial');

        // `status` is the document lifecycle (Draft/Sent/Cancelled) and is NOT touched here —
        // recording a payment only moves the payment axis (`payment_status`).
        Database::execute(
            'UPDATE invoices
             SET amount_paid = ?, payment_status = ?, last_payment_at = ?, updated_at = NOW()
             WHERE invoice_id = ?',
            [$paid, $paymentStatus, $row['last_payment_at'] ?? null, $invoiceId]
        );

        if (!empty($invoice['order_id'])) {
            Database::execute(
                'UPDATE orders SET payment_status = ?, updated_at = NOW() WHERE order_id = ?',
                [$paymentStatus === 'paid' ? 'paid' : 'pending', (int)$invoice['order_id']]
            );
        }

        return [
            'invoice_id' => $invoiceId,
            'total' => $total,
            'amount_paid' => $paid,
            'balance_due' => $balance,
            'payment_status' => $paymentStatus,
        ];
    }

    public static function refreshPurchaseOrder(int $poId): array
    {
        $po = Database::fetch('SELECT po_id, total, status FROM purchase_orders WHERE po_id = ? LIMIT 1', [$poId]);
        if (!$po) {
            Response::error('Purchase order not found', 404);
        }

        $row = Database::fetch(
            'SELECT COALESCE(SUM(CASE WHEN direction = "out" THEN amount ELSE -amount END), 0) AS paid
             FROM payments
             WHERE po_id = ? AND status = "posted"',
            [$poId]
        );

        $total = round((float)$po['total'], 2);
        $paid = round(max(0.0, (float)($row['paid'] ?? 0)), 2);
        $balance = round(max(0.0, $total - $paid), 2);
        $paymentStatus = $paid <= 0.005 ? 'unpaid' : ($balance <= 0.005 ? 'paid' : 'partial');

        $sets = ['payment_status = ?', 'updated_at = NOW()'];
        $params = [$paymentStatus];
        if ($paymentStatus === 'paid' && (string)$po['status'] === 'billed') {
            $sets[] = 'status = "paid"';
        } elseif ($paymentStatus !== 'paid' && (string)$po['status'] === 'paid') {
            $sets[] = 'status = "billed"';
        }
        $params[] = $poId;

        Database::execute('UPDATE purchase_orders SET ' . implode(', ', $sets) . ' WHERE po_id = ?', $params);

        return [
            'po_id' => $poId,
            'total' => $total,
            'amount_paid' => $paid,
            'balance_due' => $balance,
            'payment_status' => $paymentStatus,
        ];
    }

    public static function receivablesAgeing(?string $asOf = null): array
    {
        $asOf = self::validDateOrDefault($asOf, date('Y-m-d'));
        $rows = Database::fetchAll(
            "SELECT i.invoice_id, i.invoice_number, i.order_id,
                    COALESCE(i.customer_name, u.name) AS customer_name,
                    COALESCE(i.customer_gstin, u.gst_number) AS customer_gstin,
                    COALESCE(i.customer_state, o.delivery_state, u.state) AS customer_state,
                    COALESCE(i.due_date, i.invoice_date, DATE(i.created_at)) AS due_on,
                    i.total, COALESCE(i.amount_paid, 0) AS amount_paid,
                    GREATEST(i.total - COALESCE(i.amount_paid, 0), 0) AS balance_due,
                    COALESCE(i.payment_status, LOWER(i.status), o.payment_status, 'unpaid') AS payment_status,
                    DATEDIFF(?, COALESCE(i.due_date, i.invoice_date, DATE(i.created_at))) AS days_overdue
             FROM invoices i
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users u ON u.user_id = o.user_id
             WHERE LOWER(COALESCE(i.payment_status, i.status, o.payment_status, 'unpaid')) NOT IN ('paid', 'cancelled', 'refunded')
               AND GREATEST(i.total - COALESCE(i.amount_paid, 0), 0) > 0.005
             ORDER BY due_on ASC, i.invoice_id ASC",
            [$asOf]
        );

        $summary = [
            'as_of' => $asOf,
            'current' => 0.0,
            'days_1_30' => 0.0,
            'days_31_60' => 0.0,
            'days_61_90' => 0.0,
            'days_over_90' => 0.0,
            'total_due' => 0.0,
        ];

        foreach ($rows as &$row) {
            $row = self::formatAgeingRow($row);
            $bucket = self::ageingBucket((int)$row['days_overdue']);
            $row['ageing_bucket'] = $bucket;
            $summary[$bucket] = round($summary[$bucket] + $row['balance_due'], 2);
            $summary['total_due'] = round($summary['total_due'] + $row['balance_due'], 2);
        }

        return ['summary' => $summary, 'rows' => $rows];
    }

    public static function invoicePayments(int $invoiceId): array
    {
        return Database::fetchAll(
            'SELECT * FROM payments WHERE invoice_id = ? ORDER BY paid_on DESC, payment_id DESC',
            [$invoiceId]
        );
    }

    public static function poPayments(int $poId): array
    {
        return Database::fetchAll(
            'SELECT * FROM payments WHERE po_id = ? ORDER BY paid_on DESC, payment_id DESC',
            [$poId]
        );
    }

    public static function format(array $row): array
    {
        return [
            'payment_id' => (int)$row['payment_id'],
            'id' => (string)$row['payment_id'],
            'payment_number' => $row['payment_number'],
            'direction' => $row['direction'],
            'invoice_id' => $row['invoice_id'] ? (int)$row['invoice_id'] : null,
            'invoice_number' => $row['invoice_number'] ?? null,
            'invoice_total' => isset($row['invoice_total']) && $row['invoice_total'] !== null ? (float)$row['invoice_total'] : null,
            'invoice_amount_paid' => isset($row['invoice_amount_paid']) && $row['invoice_amount_paid'] !== null ? (float)$row['invoice_amount_paid'] : null,
            'po_id' => $row['po_id'] ? (int)$row['po_id'] : null,
            'po_number' => $row['po_number'] ?? null,
            'po_total' => isset($row['po_total']) && $row['po_total'] !== null ? (float)$row['po_total'] : null,
            'user_id' => $row['user_id'] ? (int)$row['user_id'] : null,
            'customer_name' => $row['customer_name'] ?? null,
            'vendor_id' => $row['vendor_id'] ? (int)$row['vendor_id'] : null,
            'vendor_name' => $row['vendor_name'] ?? null,
            'amount' => (float)$row['amount'],
            'payment_mode' => $row['payment_mode'],
            'reference_no' => $row['reference_no'],
            'paid_on' => $row['paid_on'],
            'notes' => $row['notes'],
            'status' => $row['status'],
            'voided_by' => $row['voided_by'] ? (int)$row['voided_by'] : null,
            'voided_at' => $row['voided_at'],
            'void_reason' => $row['void_reason'],
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
    }

    public static function validDateOrDefault(?string $value, string $default): string
    {
        $value = trim((string)$value);
        if ($value === '') {
            return $default;
        }
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value)) {
            Response::error('Date must be YYYY-MM-DD', 422);
        }

        return $value;
    }

    private static function formatAgeingRow(array $row): array
    {
        $row['invoice_id'] = (int)$row['invoice_id'];
        $row['order_id'] = $row['order_id'] ? (int)$row['order_id'] : null;
        $row['total'] = (float)$row['total'];
        $row['amount_paid'] = (float)$row['amount_paid'];
        $row['balance_due'] = (float)$row['balance_due'];
        $row['days_overdue'] = (int)$row['days_overdue'];

        return $row;
    }

    private static function ageingBucket(int $daysOverdue): string
    {
        if ($daysOverdue <= 0) {
            return 'current';
        }
        if ($daysOverdue <= 30) {
            return 'days_1_30';
        }
        if ($daysOverdue <= 60) {
            return 'days_31_60';
        }
        if ($daysOverdue <= 90) {
            return 'days_61_90';
        }

        return 'days_over_90';
    }
}
