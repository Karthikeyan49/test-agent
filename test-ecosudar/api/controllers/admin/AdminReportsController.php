<?php
declare(strict_types=1);

/**
 * Admin Reports Controller
 *
 * Endpoints
 * ─────────
 *   GET /admin/reports?module=<key>&from=YYYY-MM-DD&to=YYYY-MM-DD
 *
 * Modules: sales, orders, payments, expenses, production, forecast
 * Each returns a uniform row shape: { date, reference, category, party, amount, status }
 *
 * Smart Inventory interconnections
 *   GET /admin/reports/inventory/stock-summary       — current stock per product
 *   GET /admin/reports/inventory/movement-report     — movement ledger in a date range
 *   GET /admin/reports/inventory/valuation-report    — stock valuation by category
 *   GET /admin/reports/inventory/dealer-consumption  — dealer allocation totals
 *   GET /admin/reports/inventory/zone-analysis       — per-zone utilization
 */
class AdminReportsController
{
    private const MODULES = ['sales', 'orders', 'payments', 'expenses', 'production', 'forecast'];

    public function index(Request $request): void
    {
        $module = strtolower((string)$request->query('module', 'sales'));
        if (!in_array($module, self::MODULES, true)) {
            Response::error('Invalid module. Allowed: ' . implode(', ', self::MODULES), 422);
        }

        $to   = $request->query('to')   ?: date('Y-m-d');
        $from = $request->query('from') ?: date('Y-m-d', strtotime('-30 days', strtotime($to)));
        self::validateDate($from, 'from');
        self::validateDate($to, 'to');
        if ($from > $to) {
            Response::error('`from` must be earlier than or equal to `to`', 422);
        }

        $rows = match ($module) {
            'sales'      => $this->sales($from, $to),
            'orders'     => $this->orders($from, $to),
            'payments'   => $this->payments($from, $to),
            'expenses'   => $this->expenses($from, $to),
            'production' => [], // no production table yet
            'forecast'   => $this->forecast($from, $to),
        };

        Response::success([
            'module' => $module,
            'from'   => $from,
            'to'     => $to,
            'rows'   => $rows,
            'total'  => array_sum(array_column($rows, 'amount')),
            'count'  => count($rows),
        ]);
    }

    private function sales(string $from, string $to): array
    {
        $rows = Database::fetchAll(
            "SELECT DATE(i.created_at) AS date,
                    COALESCE(i.invoice_number, 'Unknown') AS reference,
                    'Invoice'          AS category,
                    COALESCE(i.customer_name, u.name, 'Unknown') AS party,
                    i.total            AS amount,
                    COALESCE(i.status, 'Unknown') AS status
             FROM invoices i
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users  u ON u.user_id  = o.user_id
             WHERE DATE(i.created_at) BETWEEN ? AND ?
             ORDER BY i.created_at DESC",
            [$from, $to]
        );
        return self::castAmount($rows);
    }

    private function orders(string $from, string $to): array
    {
        $rows = Database::fetchAll(
            "SELECT DATE(o.created_at) AS date,
                    COALESCE(o.order_number, 'Unknown') AS reference,
                    CASE u.user_type WHEN 'dealer' THEN 'Wholesale' ELSE 'Retail' END AS category,
                    COALESCE(u.name, 'Unknown') AS party,
                    o.total_amount     AS amount,
                    COALESCE(o.order_status, 'Unknown') AS status
             FROM orders o
             JOIN users u ON u.user_id = o.user_id
             WHERE DATE(o.created_at) BETWEEN ? AND ?
             ORDER BY o.created_at DESC",
            [$from, $to]
        );
        return self::castAmount($rows);
    }

    private function payments(string $from, string $to): array
    {
        // Inflows: paid invoices  |  Outflows: expenses
        $inflows = Database::fetchAll(
            "SELECT DATE(COALESCE(i.updated_at, i.created_at)) AS date,
                    COALESCE(i.invoice_number, 'Unknown') AS reference,
                    'Inflow'           AS category,
                    COALESCE(i.customer_name, u.name, 'Unknown') AS party,
                    i.total            AS amount,
                    'Cleared'          AS status
             FROM invoices i
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users  u ON u.user_id  = o.user_id
             WHERE LOWER(COALESCE(i.payment_status, o.payment_status)) = 'paid'
               AND DATE(COALESCE(i.updated_at, i.created_at)) BETWEEN ? AND ?",
            [$from, $to]
        );
        $outflows = Database::fetchAll(
            "SELECT COALESCE(expense_date, DATE(created_at)) AS date,
                    COALESCE(expense_code, 'Unknown') AS reference,
                    'Outflow'     AS category,
                    COALESCE(vendor, 'Unknown') AS party,
                    amount,
                    'Paid'        AS status
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?",
            [$from, $to]
        );
        $rows = array_merge($inflows, $outflows);
        usort($rows, fn($a, $b) => strcmp((string)$b['date'], (string)$a['date']));
        return self::castAmount($rows);
    }

    private function expenses(string $from, string $to): array
    {
        $rows = Database::fetchAll(
            "SELECT COALESCE(expense_date, DATE(created_at)) AS date,
                    COALESCE(expense_code, 'Unknown') AS reference,
                    COALESCE(category, 'Miscellaneous') AS category,
                    COALESCE(vendor, 'Unknown') AS party,
                    amount,
                    'Paid'       AS status
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?
             ORDER BY expense_date DESC",
            [$from, $to]
        );
        return self::castAmount($rows);
    }

    /**
     * Forecast = naive month-over-month projection based on last 3 months revenue average.
     * Returned as one synthetic row per upcoming month between `from` and `to`.
     */
    private function forecast(string $from, string $to): array
    {
        $hist = Database::fetchAll(
            "SELECT DATE_FORMAT(created_at, '%Y-%m') AS m,
                    COALESCE(SUM(total_amount - COALESCE(delivery_fee, 0)), 0) AS v
             FROM orders
             WHERE payment_status = 'paid'
               AND created_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
             GROUP BY m ORDER BY m ASC"
        );
        // Paid manual invoices (no linked order) added to the same monthly buckets
        $invHist = Database::fetchAll(
            "SELECT DATE_FORMAT(created_at, '%Y-%m') AS m,
                    COALESCE(SUM(total), 0) AS v
             FROM invoices
             WHERE payment_status = 'paid' AND order_id IS NULL
               AND created_at >= DATE_SUB(CURDATE(), INTERVAL 3 MONTH)
             GROUP BY m ORDER BY m ASC"
        );
        $byMonth = [];
        foreach ($hist as $r)    { $byMonth[$r['m']] = (float)$r['v']; }
        foreach ($invHist as $r) { $byMonth[$r['m']] = ($byMonth[$r['m']] ?? 0) + (float)$r['v']; }
        $avg = !empty($byMonth) ? array_sum($byMonth) / count($byMonth) : 0.0;

        $rows = [];
        $cursor = new DateTime(date('Y-m-01', strtotime($from)));
        $end    = new DateTime(date('Y-m-01', strtotime($to)));
        $i = 1;
        while ($cursor <= $end) {
            $rows[] = [
                'date'      => $cursor->format('Y-m-d'),
                'reference' => 'FCST-' . $cursor->format('Ym') . '-' . str_pad((string)$i, 2, '0', STR_PAD_LEFT),
                'category'  => 'Projected',
                'party'     => 'Revenue Forecast',
                'amount'    => round($avg, 2),
                'status'    => 'Projected',
            ];
            $cursor->modify('+1 month');
            $i++;
        }
        return $rows;
    }

    // ─── GET /admin/reports/customers?from=YYYY-MM-DD&to=YYYY-MM-DD ───────────
    // Customer-wise sales report: one aggregated row per customer (billing data
    // from the invoices table — both manual GST invoices and order-linked ones),
    // each carrying its own invoice breakdown for drill-down / per-customer export.
    // Cancelled invoices are still listed but excluded from the money totals.
    public function customers(Request $request): void
    {
        $to   = $request->query('to')   ?: date('Y-m-d');
        // Default window is "all time" so the report is complete unless narrowed.
        $from = $request->query('from') ?: '2000-01-01';
        self::validateDate($from, 'from');
        self::validateDate($to, 'to');
        if ($from > $to) {
            Response::error('`from` must be earlier than or equal to `to`', 422);
        }

        $invoices = Database::fetchAll(
            "SELECT i.invoice_number,
                    COALESCE(NULLIF(TRIM(i.customer_name), ''), NULLIF(TRIM(u.name), ''), 'Unknown') AS customer_name,
                    COALESCE(NULLIF(TRIM(i.customer_gstin), ''), NULLIF(TRIM(u.gst_number), ''), '') AS customer_gstin,
                    COALESCE(NULLIF(TRIM(i.customer_state), ''), NULLIF(TRIM(o.delivery_state), ''), NULLIF(TRIM(u.state), ''), '') AS customer_state,
                    COALESCE(i.status, 'Unknown') AS status,
                    COALESCE(i.total, 0)          AS total,
                    COALESCE(i.amount_paid, 0)    AS amount_paid,
                    COALESCE(i.invoice_date, DATE(i.created_at)) AS inv_date
             FROM invoices i
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users  u ON u.user_id  = o.user_id
             WHERE COALESCE(i.invoice_date, DATE(i.created_at)) BETWEEN ? AND ?
             ORDER BY inv_date DESC",
            [$from, $to]
        );

        $groups = [];
        foreach ($invoices as $inv) {
            $name = trim((string)$inv['customer_name']) ?: 'Unknown';
            $key  = strtolower($name);
            $cancelled = strtolower((string)$inv['status']) === 'cancelled';
            $total = (float)$inv['total'];
            $paid  = (float)$inv['amount_paid'];

            if (!isset($groups[$key])) {
                $groups[$key] = [
                    'customer'       => $name,
                    'gstin'          => (string)$inv['customer_gstin'],
                    'state'          => (string)$inv['customer_state'],
                    'invoice_count'  => 0,
                    'total_invoiced' => 0.0,
                    'total_paid'     => 0.0,
                    'outstanding'    => 0.0,
                    'first_invoice'  => (string)$inv['inv_date'],
                    'last_invoice'   => (string)$inv['inv_date'],
                    'invoices'       => [],
                ];
            }
            $g = &$groups[$key];
            if ($g['gstin'] === '' && $inv['customer_gstin'] !== '') { $g['gstin'] = (string)$inv['customer_gstin']; }
            if ($g['state'] === '' && $inv['customer_state'] !== '') { $g['state'] = (string)$inv['customer_state']; }
            $g['invoice_count']++;
            if (!$cancelled) {
                $g['total_invoiced'] += $total;
                $g['total_paid']     += $paid;
            }
            $date = (string)$inv['inv_date'];
            if ($date < $g['first_invoice']) { $g['first_invoice'] = $date; }
            if ($date > $g['last_invoice'])  { $g['last_invoice']  = $date; }
            $g['invoices'][] = [
                'invoice_number' => (string)$inv['invoice_number'],
                'date'           => $date,
                'total'          => $total,
                'paid'           => $paid,
                'balance'        => $cancelled ? 0.0 : max($total - $paid, 0.0),
                'status'         => (string)$inv['status'],
            ];
            unset($g);
        }

        $rows = [];
        foreach ($groups as $g) {
            $g['outstanding'] = max($g['total_invoiced'] - $g['total_paid'], 0.0);
            $g['total_invoiced'] = round($g['total_invoiced'], 2);
            $g['total_paid']     = round($g['total_paid'], 2);
            $g['outstanding']    = round($g['outstanding'], 2);
            $rows[] = $g;
        }
        // Highest-value customers first.
        usort($rows, fn($a, $b) => $b['total_invoiced'] <=> $a['total_invoiced']);

        Response::success([
            'from'  => $from,
            'to'    => $to,
            'rows'  => $rows,
            'count' => count($rows),
            'totals' => [
                'customers'      => count($rows),
                'total_invoiced' => round(array_sum(array_column($rows, 'total_invoiced')), 2),
                'total_paid'     => round(array_sum(array_column($rows, 'total_paid')), 2),
                'outstanding'    => round(array_sum(array_column($rows, 'outstanding')), 2),
            ],
        ]);
    }

    // ─── GET /admin/reports/monthly?from=YYYY-MM-DD&to=YYYY-MM-DD ─────────────
    // Month-by-month company report: invoiced sales, collections (payments in),
    // expenses and net — one row per calendar month across the range. Defaults to
    // the last 12 months. Cancelled invoices are excluded from invoiced totals.
    public function monthly(Request $request): void
    {
        $to   = $request->query('to')   ?: date('Y-m-d');
        $from = $request->query('from') ?: date('Y-m-01', strtotime('-11 months', strtotime($to)));
        self::validateDate($from, 'from');
        self::validateDate($to, 'to');
        if ($from > $to) {
            Response::error('`from` must be earlier than or equal to `to`', 422);
        }

        $invoiced = Database::fetchAll(
            "SELECT DATE_FORMAT(COALESCE(i.invoice_date, DATE(i.created_at)), '%Y-%m') AS ym,
                    COUNT(*) AS cnt,
                    COALESCE(SUM(CASE WHEN LOWER(i.status) = 'cancelled' THEN 0 ELSE i.total END), 0) AS invoiced
             FROM invoices i
             WHERE COALESCE(i.invoice_date, DATE(i.created_at)) BETWEEN ? AND ?
             GROUP BY ym",
            [$from, $to]
        );
        $collected = Database::fetchAll(
            "SELECT DATE_FORMAT(paid_on, '%Y-%m') AS ym, COALESCE(SUM(amount), 0) AS collected
             FROM payments
             WHERE direction = 'in' AND (status IS NULL OR status <> 'void')
               AND paid_on BETWEEN ? AND ?
             GROUP BY ym",
            [$from, $to]
        );
        $expenses = Database::fetchAll(
            "SELECT DATE_FORMAT(COALESCE(expense_date, DATE(created_at)), '%Y-%m') AS ym, COALESCE(SUM(amount), 0) AS expenses
             FROM expenses
             WHERE COALESCE(expense_date, DATE(created_at)) BETWEEN ? AND ?
             GROUP BY ym",
            [$from, $to]
        );

        $map = [];
        $seed = function (string $ym) use (&$map): void {
            if (!isset($map[$ym])) {
                $map[$ym] = ['month' => $ym, 'invoices' => 0, 'invoiced' => 0.0, 'collected' => 0.0, 'expenses' => 0.0, 'net' => 0.0];
            }
        };
        // Pre-seed every month in the range so gaps show as zero rows.
        $cursor = new DateTime(date('Y-m-01', strtotime($from)));
        $end    = new DateTime(date('Y-m-01', strtotime($to)));
        while ($cursor <= $end) { $seed($cursor->format('Y-m')); $cursor->modify('+1 month'); }

        foreach ($invoiced as $r)  { $seed($r['ym']); $map[$r['ym']]['invoices'] = (int)$r['cnt']; $map[$r['ym']]['invoiced'] = (float)$r['invoiced']; }
        foreach ($collected as $r) { $seed($r['ym']); $map[$r['ym']]['collected'] = (float)$r['collected']; }
        foreach ($expenses as $r)  { $seed($r['ym']); $map[$r['ym']]['expenses'] = (float)$r['expenses']; }

        $rows = [];
        foreach ($map as $m) {
            $m['net'] = round($m['invoiced'] - $m['expenses'], 2);
            $m['invoiced']  = round($m['invoiced'], 2);
            $m['collected'] = round($m['collected'], 2);
            $m['expenses']  = round($m['expenses'], 2);
            $m['label'] = date('M Y', strtotime($m['month'] . '-01'));
            $rows[] = $m;
        }
        // Most recent month first.
        usort($rows, fn($a, $b) => strcmp($b['month'], $a['month']));

        Response::success([
            'from'  => $from,
            'to'    => $to,
            'rows'  => $rows,
            'count' => count($rows),
            'totals' => [
                'invoiced'  => round(array_sum(array_column($rows, 'invoiced')), 2),
                'collected' => round(array_sum(array_column($rows, 'collected')), 2),
                'expenses'  => round(array_sum(array_column($rows, 'expenses')), 2),
                'net'       => round(array_sum(array_column($rows, 'net')), 2),
                'invoices'  => array_sum(array_column($rows, 'invoices')),
            ],
        ]);
    }

    // ─── GET /admin/reports/customer-ledger?customer=<name>&from=&to= ─────────
    // Running-balance ledger for one customer: invoices are debits (amount owed),
    // received payments are credits. `opening_balance` folds in everything before
    // `from`; rows carry a running balance. Matching is by resolved customer NAME
    // (case-insensitive) since invoices store the name denormalised.
    public function customerLedger(Request $request): void
    {
        $customer = trim((string)$request->query('customer', ''));
        if ($customer === '') {
            Response::error('`customer` is required', 422);
        }
        $key  = strtolower($customer);
        $to   = $request->query('to')   ?: date('Y-m-d');
        $from = $request->query('from') ?: '2000-01-01';
        self::validateDate($from, 'from');
        self::validateDate($to, 'to');
        if ($from > $to) {
            Response::error('`from` must be earlier than or equal to `to`', 422);
        }

        // Debits — invoices (exclude cancelled from the money movement).
        $invoices = Database::fetchAll(
            "SELECT i.invoice_number AS ref,
                    COALESCE(i.invoice_date, DATE(i.created_at)) AS dt,
                    COALESCE(i.total, 0) AS amt,
                    COALESCE(i.status, '') AS status,
                    COALESCE(NULLIF(TRIM(i.customer_name), ''), NULLIF(TRIM(u.name), ''), 'Unknown') AS cust
             FROM invoices i
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users  u ON u.user_id  = o.user_id"
        );
        // Credits — received payments.
        $payments = Database::fetchAll(
            "SELECT p.payment_number AS ref, p.paid_on AS dt, COALESCE(p.amount, 0) AS amt,
                    COALESCE(p.payment_mode, '') AS mode,
                    COALESCE(NULLIF(TRIM(du.name), ''), NULLIF(TRIM(ou.name), ''), NULLIF(TRIM(i.customer_name), ''), 'Unknown') AS cust
             FROM payments p
             LEFT JOIN invoices i ON i.invoice_id = p.invoice_id
             LEFT JOIN orders   o ON o.order_id   = i.order_id
             LEFT JOIN users   du ON du.user_id   = p.user_id
             LEFT JOIN users   ou ON ou.user_id   = o.user_id
             WHERE p.direction = 'in' AND (p.status IS NULL OR p.status <> 'void')"
        );

        $tx = [];
        foreach ($invoices as $r) {
            if (strtolower(trim((string)$r['cust'])) !== $key) continue;
            if (strtolower((string)$r['status']) === 'cancelled') continue;
            $tx[] = ['date' => (string)$r['dt'], 'type' => 'Invoice', 'reference' => (string)$r['ref'],
                     'debit' => (float)$r['amt'], 'credit' => 0.0, 'detail' => (string)$r['status']];
        }
        foreach ($payments as $r) {
            if (strtolower(trim((string)$r['cust'])) !== $key) continue;
            $tx[] = ['date' => (string)$r['dt'], 'type' => 'Payment', 'reference' => (string)$r['ref'],
                     'debit' => 0.0, 'credit' => (float)$r['amt'], 'detail' => (string)$r['mode']];
        }

        // Chronological; on a tie, invoices (debits) before payments (credits).
        usort($tx, function ($a, $b) {
            if ($a['date'] !== $b['date']) return strcmp($a['date'], $b['date']);
            return ($b['debit'] <=> 0) <=> ($a['debit'] <=> 0);
        });

        $opening = 0.0;
        $rows = [];
        $balance = 0.0;
        foreach ($tx as $t) {
            $delta = $t['debit'] - $t['credit'];
            if ($t['date'] < $from) { $opening += $delta; continue; }
            if ($t['date'] > $to)   { continue; }
            $balance += $delta;
            $t['balance'] = round($opening + $balance, 2);
            $rows[] = $t;
        }
        $opening = round($opening, 2);
        // Rebase running balance to include the opening carry-forward.
        $run = $opening;
        foreach ($rows as &$r) { $run += $r['debit'] - $r['credit']; $r['balance'] = round($run, 2); }
        unset($r);

        $totalDebit  = round(array_sum(array_column($rows, 'debit')), 2);
        $totalCredit = round(array_sum(array_column($rows, 'credit')), 2);

        Response::success([
            'customer'        => $customer,
            'from'            => $from,
            'to'              => $to,
            'opening_balance' => $opening,
            'rows'            => $rows,
            'count'           => count($rows),
            'total_debit'     => $totalDebit,
            'total_credit'    => $totalCredit,
            'closing_balance' => round($opening + $totalDebit - $totalCredit, 2),
        ]);
    }

    private static function castAmount(array $rows): array
    {
        foreach ($rows as &$r) {
            $r['amount'] = (float)$r['amount'];
        }
        return $rows;
    }

    private static function validateDate($val, string $name): void
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$val) || !strtotime((string)$val)) {
            Response::error("`$name` must be a valid YYYY-MM-DD date", 422);
        }
    }
}
