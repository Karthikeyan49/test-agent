<?php
declare(strict_types=1);

/**
 * Admin Finance Controller — Profit & Loss dashboard
 *
 * Endpoints
 * ─────────
 *   GET /admin/finance/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET /admin/finance/ratios
 *   GET /admin/finance/config         — current balance-sheet config
 *   PUT /admin/finance/config         — update investment/assets/liabilities
 *
 * Smart Inventory interconnections
 *   GET /admin/finance/inventory-valuation       — current stock value by zone
 *   GET /admin/finance/inventory-value-movement  — monthly stock value in/out
 *   GET /admin/finance/damaged-stock-writeoff    — DAMAGED zone write-off candidates
 */
class AdminFinanceController
{
    // ─── GET /admin/finance/pnl ──────────────────────────────────────────────
    public function pnl(Request $request): void
    {
        [$from, $to] = $this->window($request);
        Response::success($this->pnlData($from, $to));
    }

    /** Assemble the full P&L payload for a window — shared by the endpoint and the AI analyst. */
    public function pnlData(string $from, string $to): array
    {
        // ── Revenue = paid orders within window (delivery_fee excluded) ─────
        $revenueRow = Database::fetch(
            "SELECT COALESCE(SUM(total_amount - COALESCE(delivery_fee, 0)), 0) AS revenue
             FROM orders
             WHERE payment_status = 'paid'
               AND DATE(created_at) BETWEEN ? AND ?",
            [$from, $to]
        );
        // Revenue also includes paid manual invoices (order_id IS NULL so order-linked
        // invoices aren't double-counted — their revenue already comes from the order).
        $revenue = (float)($revenueRow['revenue'] ?? 0) + self::invoiceRevenue($from, $to);

        // ── Expenses = sum of expense amounts within window ─────────────────
        $expenseRow = Database::fetch(
            "SELECT COALESCE(SUM(amount), 0) AS expenses
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?",
            [$from, $to]
        );
        $expenses = (float)($expenseRow['expenses'] ?? 0);

        // ── Monthly breakdown (revenue/expenses by YYYY-MM) ─────────────────
        $revByMonth = Database::fetchAll(
            "SELECT DATE_FORMAT(created_at, '%Y-%m') AS m,
                    COALESCE(SUM(total_amount - COALESCE(delivery_fee, 0)), 0) AS v
             FROM orders
             WHERE payment_status = 'paid'
               AND DATE(created_at) BETWEEN ? AND ?
             GROUP BY m ORDER BY m ASC",
            [$from, $to]
        );
        $invRevByMonth = Database::fetchAll(
            "SELECT DATE_FORMAT(created_at, '%Y-%m') AS m,
                    COALESCE(SUM(total), 0) AS v
             FROM invoices
             WHERE order_id IS NULL
               AND (status IS NULL OR status <> 'Cancelled')
               AND DATE(created_at) BETWEEN ? AND ?
             GROUP BY m ORDER BY m ASC",
            [$from, $to]
        );
        $expByMonth = Database::fetchAll(
            "SELECT DATE_FORMAT(expense_date, '%Y-%m') AS m,
                    COALESCE(SUM(amount), 0) AS v
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?
             GROUP BY m ORDER BY m ASC",
            [$from, $to]
        );

        // Merge months into a single ordered series
        $months = [];
        foreach ($revByMonth as $r)    { $months[$r['m']]['revenue']  = (float)$r['v']; }
        foreach ($invRevByMonth as $r) { $months[$r['m']]['revenue']  = ($months[$r['m']]['revenue'] ?? 0) + (float)$r['v']; }
        foreach ($expByMonth as $r)    { $months[$r['m']]['expenses'] = (float)$r['v']; }
        ksort($months);

        $monthly = [];
        foreach ($months as $m => $vals) {
            $rev = (float)($vals['revenue']  ?? 0);
            $exp = (float)($vals['expenses'] ?? 0);
            $monthly[] = [
                'month'    => $m,
                'revenue'  => $rev,
                'expenses' => $exp,
                'profit'   => $rev - $exp,
            ];
        }

        // ── Expense breakdown by category ───────────────────────────────────
        $expBreakdown = Database::fetchAll(
            "SELECT category, COALESCE(SUM(amount), 0) AS amount
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?
             GROUP BY category
             ORDER BY amount DESC",
            [$from, $to]
        );
        foreach ($expBreakdown as &$e) { $e['amount'] = (float)$e['amount']; }

        // ── Revenue breakdown by customer type ──────────────────────────────
        $revBreakdown = Database::fetchAll(
            "SELECT CASE u.user_type
                        WHEN 'dealer'   THEN 'Dealer Network'
                        WHEN 'customer' THEN 'Direct Sales'
                        ELSE 'Other'
                    END AS source,
                    COALESCE(SUM(o.total_amount - COALESCE(o.delivery_fee, 0)), 0) AS amount
             FROM orders o
             JOIN users u ON u.user_id = o.user_id
             WHERE o.payment_status = 'paid'
               AND DATE(o.created_at) BETWEEN ? AND ?
             GROUP BY source
             ORDER BY amount DESC",
            [$from, $to]
        );
        foreach ($revBreakdown as &$r) { $r['amount'] = (float)$r['amount']; }
        unset($r);
        // Manual invoices (no linked order) shown as their own revenue source
        $invRev = self::invoiceRevenue($from, $to);
        if ($invRev > 0) {
            $revBreakdown[] = ['source' => 'Manual Invoices', 'amount' => round($invRev, 2)];
            usort($revBreakdown, static fn($a, $b) => $b['amount'] <=> $a['amount']);
        }

        // ── P&L totals ──────────────────────────────────────────────────────
        $grossProfit = $revenue - $expenses;
        $taxRate     = (float)self::configValue('tax_rate', 18);
        $taxes       = $grossProfit > 0 ? round($grossProfit * $taxRate / 100, 2) : 0;
        $netProfit   = $grossProfit - $taxes;

        return [
            'periodFrom'       => $from,
            'periodTo'         => $to,
            'revenue'          => round($revenue, 2),
            'expenses'         => round($expenses, 2),
            'grossProfit'      => round($grossProfit, 2),
            'netProfit'        => round($netProfit, 2),
            'taxes'            => round($taxes, 2),
            'monthly'          => $monthly,
            'expenseBreakdown' => $expBreakdown,
            'revenueBreakdown' => $revBreakdown,
        ];
    }

    // ─── GET /admin/finance/ratios ───────────────────────────────────────────
    public function ratios(Request $request): void
    {
        [$from, $to] = $this->window($request);
        Response::success($this->ratiosData($from, $to));
    }

    /** Assemble the financial ratios for a window — shared by the endpoint and the AI analyst. */
    public function ratiosData(string $from, string $to): array
    {
        $revenue = (float)(Database::fetch(
            "SELECT COALESCE(SUM(total_amount - COALESCE(delivery_fee, 0)), 0) AS v
             FROM orders WHERE payment_status = 'paid' AND DATE(created_at) BETWEEN ? AND ?",
            [$from, $to]
        )['v'] ?? 0) + self::invoiceRevenue($from, $to);

        $expenses = (float)(Database::fetch(
            "SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE expense_date BETWEEN ? AND ?",
            [$from, $to]
        )['v'] ?? 0);

        $investment         = (float)self::configValue('investment',         4500000);
        $currentAssets      = (float)self::configValue('current_assets',     2850000);
        $currentLiabilities = (float)self::configValue('current_liabilities',1320000);
        $taxRate            = (float)self::configValue('tax_rate',                18);
        $opexTaxPct         = (float)self::configValue('opex_tax_portion',        40);

        $grossProfit = $revenue - $expenses;
        $taxes       = $grossProfit > 0 ? round($grossProfit * $taxRate / 100, 2) : 0;
        $netProfit   = $grossProfit - $taxes;

        $safeDiv = static fn(float $a, float $b): float => $b == 0.0 ? 0.0 : $a / $b;

        return [
            'profitMargin'       => round($safeDiv($netProfit, $revenue), 4),
            'expenseRatio'       => round($safeDiv($expenses, $revenue), 4),
            'roi'                => round($safeDiv($netProfit, $investment), 4),
            'currentRatio'       => round($safeDiv($currentAssets, $currentLiabilities), 4),
            'grossMargin'        => round($safeDiv($grossProfit, $revenue), 4),
            'operatingMargin'    => round($safeDiv($grossProfit - $taxes * ($opexTaxPct / 100), $revenue), 4),
            'currentAssets'      => $currentAssets,
            'currentLiabilities' => $currentLiabilities,
            'investment'         => $investment,
        ];
    }

    // ─── Shared date-window parser ───────────────────────────────────────────
    private function window(Request $request): array
    {
        $to   = $request->query('to')   ?: date('Y-m-d');
        $from = $request->query('from') ?: date('Y-m-d', strtotime('-6 months', strtotime($to)));
        self::validateDate($from, 'from');
        self::validateDate($to, 'to');
        if ($from > $to) {
            Response::error('`from` must be earlier than or equal to `to`', 422);
        }
        return [$from, $to];
    }

    // ─── GET /admin/finance/cash-flow ─────────────────────────────────────────
    public function cashFlow(Request $request): void
    {
        [$from, $to] = $this->window($request);

        $sum = static function (string $sql, array $p): float {
            $row = Database::fetch($sql, $p);
            return (float)(($row ?? [])['v'] ?? 0);
        };

        // Canonical cash ledger (payments table).
        $payIn  = $sum("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE direction='in'  AND status='posted' AND paid_on BETWEEN ? AND ?", [$from, $to]);
        $payOut = $sum("SELECT COALESCE(SUM(amount),0) v FROM payments WHERE direction='out' AND status='posted' AND paid_on BETWEEN ? AND ?", [$from, $to]);

        // Operating expenses paid directly (exclude PO-billed expenses to avoid double-counting vendor out-payments).
        $expenses = $sum(
            "SELECT COALESCE(SUM(amount),0) v FROM expenses
              WHERE expense_date BETWEEN ? AND ?
                AND expense_id NOT IN (SELECT billed_expense_id FROM purchase_orders WHERE billed_expense_id IS NOT NULL)",
            [$from, $to]
        );

        // Customer collections recorded on invoices (useful before the payments ledger is adopted).
        $collections = $sum(
            "SELECT COALESCE(SUM(amount_paid),0) v FROM invoices
              WHERE amount_paid > 0
                AND DATE(COALESCE(last_payment_at, updated_at, created_at)) BETWEEN ? AND ?
                AND LOWER(status) <> 'cancelled'",
            [$from, $to]
        );

        $inflow  = round($payIn, 2);
        $outflow = round($payOut + $expenses, 2);

        $series = Database::fetchAll(
            "SELECT m, SUM(inflow) inflow, SUM(outflow) outflow FROM (
                SELECT DATE_FORMAT(paid_on,'%Y-%m') m,
                       SUM(CASE WHEN direction='in'  THEN amount ELSE 0 END) inflow,
                       SUM(CASE WHEN direction='out' THEN amount ELSE 0 END) outflow
                  FROM payments WHERE status='posted' AND paid_on BETWEEN ? AND ? GROUP BY m
                UNION ALL
                SELECT DATE_FORMAT(expense_date,'%Y-%m') m, 0 inflow, SUM(amount) outflow
                  FROM expenses WHERE expense_date BETWEEN ? AND ?
                    AND expense_id NOT IN (SELECT billed_expense_id FROM purchase_orders WHERE billed_expense_id IS NOT NULL)
                  GROUP BY m
             ) t GROUP BY m ORDER BY m ASC",
            [$from, $to, $from, $to]
        );

        $byCategory = Database::fetchAll(
            "SELECT COALESCE(NULLIF(category,''),'Uncategorised') category, SUM(amount) amount
               FROM expenses WHERE expense_date BETWEEN ? AND ?
                 AND expense_id NOT IN (SELECT billed_expense_id FROM purchase_orders WHERE billed_expense_id IS NOT NULL)
               GROUP BY category ORDER BY amount DESC LIMIT 12",
            [$from, $to]
        );

        Response::success([
            'from' => $from, 'to' => $to,
            'inflow'  => $inflow,
            'outflow' => $outflow,
            'net'     => round($inflow - $outflow, 2),
            'payments_in'         => round($payIn, 2),
            'payments_out'        => round($payOut, 2),
            'operating_expenses'  => round($expenses, 2),
            'invoice_collections' => round($collections, 2),
            'series' => array_map(static fn($r) => [
                'month' => $r['m'], 'inflow' => (float)$r['inflow'], 'outflow' => (float)$r['outflow'],
            ], $series),
            'expense_categories' => array_map(static fn($r) => [
                'category' => $r['category'], 'amount' => (float)$r['amount'],
            ], $byCategory),
        ]);
    }

    // ─── GET /admin/finance/payables — vendor payables ageing ─────────────────
    public function payables(Request $request): void
    {
        $asOf = $request->query('as_of') ?: date('Y-m-d');
        self::validateDate($asOf, 'as_of');

        $rows = Database::fetchAll(
            "SELECT po.po_id, po.po_number, po.order_date, po.total,
                    COALESCE(v.name, po.deliver_to_name, 'Vendor') AS vendor_name,
                    COALESCE(pay.paid, 0) AS paid,
                    GREATEST(po.total - COALESCE(pay.paid, 0), 0) AS balance_due,
                    DATEDIFF(?, COALESCE(po.expected_date, po.order_date)) AS days_overdue
               FROM purchase_orders po
               LEFT JOIN vendors v ON v.vendor_id = po.vendor_id
               LEFT JOIN (SELECT po_id, SUM(amount) paid FROM payments
                           WHERE direction='out' AND status='posted' GROUP BY po_id) pay
                      ON pay.po_id = po.po_id
              WHERE LOWER(po.status) NOT IN ('draft', 'cancelled')
                AND GREATEST(po.total - COALESCE(pay.paid, 0), 0) > 0.005
              ORDER BY days_overdue DESC",
            [$asOf]
        );

        $b = ['as_of' => $asOf, 'current' => 0.0, 'days_1_30' => 0.0, 'days_31_60' => 0.0, 'days_61_90' => 0.0, 'days_over_90' => 0.0, 'total_due' => 0.0];
        $list = [];
        foreach ($rows as $r) {
            $bal  = (float)$r['balance_due'];
            $days = (int)$r['days_overdue'];
            $b['total_due'] += $bal;
            if ($days <= 0)      $b['current']     += $bal;
            elseif ($days <= 30) $b['days_1_30']   += $bal;
            elseif ($days <= 60) $b['days_31_60']  += $bal;
            elseif ($days <= 90) $b['days_61_90']  += $bal;
            else                 $b['days_over_90'] += $bal;
            $list[] = [
                'po_id' => (int)$r['po_id'], 'po_number' => $r['po_number'],
                'vendor_name' => $r['vendor_name'], 'order_date' => $r['order_date'],
                'total' => (float)$r['total'], 'paid' => (float)$r['paid'],
                'balance_due' => $bal, 'days_overdue' => $days,
            ];
        }
        foreach ($b as $k => $v) if ($k !== 'as_of') $b[$k] = round((float)$v, 2);

        Response::success(['summary' => $b, 'rows' => $list]);
    }

    // ─── POST /admin/finance/ai-analysis — AI Financial Analyst ──────────────
    // Reuses the EXACT pnl + ratios figures (single source of truth) and asks the
    // LLM for a plain-language health read, drivers, risks, recommendations & outlook.
    public function aiAnalysis(Request $request): void
    {
        [$from, $to] = $this->window($request);
        $pnl    = $this->pnlData($from, $to);
        $ratios = $this->ratiosData($from, $to);

        // Compact, aggregated figures only (no raw transactions) — and the period delta.
        $monthly = $pnl['monthly'] ?? [];
        $prev = count($monthly) >= 2 ? $monthly[count($monthly) - 2] : null;
        $last = count($monthly) >= 1 ? $monthly[count($monthly) - 1] : null;

        $facts = [
            'period'             => ['from' => $from, 'to' => $to],
            'currency'           => 'INR',
            'revenue'            => $pnl['revenue'],
            'expenses'           => $pnl['expenses'],
            'gross_profit'       => $pnl['grossProfit'],
            'net_profit'         => $pnl['netProfit'],
            'estimated_taxes'    => $pnl['taxes'],
            'gross_margin_pct'   => round(($ratios['grossMargin'] ?? 0) * 100, 1),
            'net_margin_pct'     => round(($ratios['profitMargin'] ?? 0) * 100, 1),
            'expense_ratio_pct'  => round(($ratios['expenseRatio'] ?? 0) * 100, 1),
            'monthly_trend'      => array_map(fn($m) => [
                'month' => $m['month'], 'revenue' => $m['revenue'], 'expenses' => $m['expenses'], 'profit' => $m['profit'],
            ], $monthly),
            'last_vs_prev_month' => ($prev && $last) ? [
                'revenue_change_pct' => $prev['revenue'] > 0 ? round(($last['revenue'] - $prev['revenue']) / $prev['revenue'] * 100, 1) : null,
                'expense_change_pct' => $prev['expenses'] > 0 ? round(($last['expenses'] - $prev['expenses']) / $prev['expenses'] * 100, 1) : null,
            ] : null,
            'top_expense_categories' => array_slice($pnl['expenseBreakdown'] ?? [], 0, 6),
            'revenue_by_source'      => $pnl['revenueBreakdown'] ?? [],
        ];

        $system = 'You are a CFO-grade financial analyst for Eco Sudar Bio Energy LLP, an Indian biomass '
            . 'pellet manufacturer. You are given AGGREGATED financials for a period (INR). Analyse them and '
            . 'reply with STRICT JSON only, no markdown, in this exact shape: '
            . '{"health_score": <0-100 integer>, "headline": "<one sentence>", '
            . '"summary": "<2-4 sentence plain-language read of the period>", '
            . '"drivers": ["<what is moving revenue/cost/profit>", ...], '
            . '"risks": ["<concrete financial risk with the number>", ...], '
            . '"recommendations": ["<specific, actionable step>", ...], '
            . '"outlook": "<one-line forward view based on the trend>"}. '
            . 'Be specific and cite the actual figures (₹). 3-5 items per list. No generic filler.';

        try {
            $resp = GroqAPI::chat([
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => 'Analyse this period:\n' . json_encode($facts, JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT)],
            ], 'llama-3.3-70b-versatile', 0.5);
            $ai = GroqAPI::extractJSON($resp);
        } catch (\Throwable $e) {
            error_log('Finance AI analysis failed: ' . $e->getMessage());
            Response::error('AI analysis is unavailable right now. Please try again shortly.', 502);
        }

        $clean = static fn($v) => array_values(array_filter(array_map(
            fn($x) => is_string($x) ? trim($x) : '',
            is_array($v ?? null) ? $v : []
        ), fn($x) => $x !== ''));

        Response::success([
            'period'          => ['from' => $from, 'to' => $to],
            'health_score'    => max(0, min(100, (int)($ai['health_score'] ?? 0))),
            'headline'        => is_string($ai['headline'] ?? null) ? trim($ai['headline']) : '',
            'summary'         => is_string($ai['summary'] ?? null) ? trim($ai['summary']) : '',
            'drivers'         => $clean($ai['drivers'] ?? []),
            'risks'           => $clean($ai['risks'] ?? []),
            'recommendations' => $clean($ai['recommendations'] ?? []),
            'outlook'         => is_string($ai['outlook'] ?? null) ? trim($ai['outlook']) : '',
            'figures'         => $facts,
            'generated_at'    => date('Y-m-d H:i:s'),
        ], 'Financial analysis generated');
    }

    /** Revenue from paid manual invoices (no linked order) within a date window.
     *  Uses the full invoice total. Order-linked invoices are excluded here so
     *  their revenue isn't counted twice (it already comes through the order). */
    private static function invoiceRevenue(string $from, string $to): float
    {
        // Every manual invoice (order_id IS NULL) counts as revenue as soon as it is
        // created — paid OR unpaid — except Cancelled ones. Order-linked invoices are
        // excluded here so they aren't double-counted (their revenue comes from the paid order).
        return (float)(Database::fetch(
            "SELECT COALESCE(SUM(total), 0) AS v
             FROM invoices
             WHERE order_id IS NULL
               AND (status IS NULL OR status <> 'Cancelled')
               AND DATE(created_at) BETWEEN ? AND ?",
            [$from, $to]
        )['v'] ?? 0);
    }

    // ─── GET /admin/finance/config ───────────────────────────────────────────
    public function config(Request $request): void
    {
        $rows = Database::fetchAll('SELECT config_key, config_value, notes FROM finance_config');
        $out  = [];
        foreach ($rows as $r) {
            $out[$r['config_key']] = [
                'value' => (float)$r['config_value'],
                'notes' => $r['notes'],
            ];
        }
        Response::success($out);
    }

    // ─── PUT /admin/finance/config ───────────────────────────────────────────
    public function updateConfig(Request $request): void
    {
        $allowed = ['investment', 'current_assets', 'current_liabilities', 'tax_rate', 'opex_tax_portion'];
        $payload = [];
        foreach ($allowed as $key) {
            $val = $request->input($key);
            if ($val === null || $val === '') continue;
            if (!is_numeric($val)) {
                Response::error("$key must be numeric", 422);
            }
            if ((float)$val < 0) {
                Response::error("$key cannot be negative", 422);
            }
            $payload[$key] = (float)$val;
        }

        if (empty($payload)) {
            Response::error('Provide at least one config value to update', 400);
        }

        foreach ($payload as $k => $v) {
            Database::execute(
                'INSERT INTO finance_config (config_key, config_value) VALUES (?, ?)
                 ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)',
                [$k, $v]
            );
        }

        Response::success($payload, 'Finance config updated successfully');
    }

    private static function configValue(string $key, float $default): float
    {
        $row = Database::fetch(
            'SELECT config_value FROM finance_config WHERE config_key = ? LIMIT 1',
            [$key]
        );
        return $row ? (float)$row['config_value'] : $default;
    }

    private static function validateDate($val, string $name): void
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$val) || !strtotime((string)$val)) {
            Response::error("`$name` must be a valid YYYY-MM-DD date", 422);
        }
    }
}
