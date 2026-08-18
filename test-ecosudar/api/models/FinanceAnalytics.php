<?php
declare(strict_types=1);

class FinanceAnalytics
{
    public const REPORT_MODULES = ['sales', 'orders', 'payments', 'expenses', 'forecast', 'overlay'];
    public const BENCHMARK_METRICS = ['gross_margin', 'expense_ratio', 'revenue', 'aov', 'avg_payment_days', 'net_profit'];

    public static function window(?string $from, ?string $to, int $days = 30): array
    {
        $to = $to ?: date('Y-m-d');
        $from = $from ?: date('Y-m-d', strtotime("-{$days} days", strtotime($to)));
        self::validateDate($from, 'from');
        self::validateDate($to, 'to');
        if ($from > $to) {
            Response::error('from must be earlier than or equal to to', 422);
        }

        return [$from, $to];
    }

    public static function revenue(string $from, string $to, string $basis = 'cash'): float
    {
        if ($basis === 'accrual') {
            return (float)(Database::fetch(
                "SELECT COALESCE(SUM(total), 0) AS v
                 FROM invoices
                 WHERE DATE(COALESCE(invoice_date, created_at)) BETWEEN ? AND ?
                   AND LOWER(status) <> 'cancelled'",
                [$from, $to]
            )['v'] ?? 0);
        }

        $orders = (float)(Database::fetch(
            "SELECT COALESCE(SUM(total_amount - COALESCE(delivery_fee, 0)), 0) AS v
             FROM orders
             WHERE payment_status = 'paid' AND DATE(created_at) BETWEEN ? AND ?",
            [$from, $to]
        )['v'] ?? 0);
        $manual = (float)(Database::fetch(
            "SELECT COALESCE(SUM(total), 0) AS v
             FROM invoices
             WHERE payment_status = 'paid' AND order_id IS NULL
               AND DATE(COALESCE(invoice_date, created_at)) BETWEEN ? AND ?",
            [$from, $to]
        )['v'] ?? 0);

        return round($orders + $manual, 2);
    }

    public static function expenses(string $from, string $to, ?string $category = null): float
    {
        $where = ['expense_date BETWEEN ? AND ?'];
        $params = [$from, $to];
        if ($category !== null && strtolower($category) !== 'all') {
            $where[] = 'category = ?';
            $params[] = $category;
        }

        return (float)(Database::fetch(
            'SELECT COALESCE(SUM(amount), 0) AS v FROM expenses WHERE ' . implode(' AND ', $where),
            $params
        )['v'] ?? 0);
    }

    public static function cogs(string $from, string $to): float
    {
        // Inventory module retired — COGS is taken from Raw Material expenses.
        return self::expenses($from, $to, 'Raw Material');
    }

    public static function expenseAnalytics(string $from, string $to): array
    {
        $summary = Database::fetch(
            "SELECT COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total, AVG(amount) AS average,
                    MIN(amount) AS minimum, MAX(amount) AS maximum
             FROM expenses WHERE expense_date BETWEEN ? AND ?",
            [$from, $to]
        ) ?: [];
        $byCategory = Database::fetchAll(
            "SELECT category, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?
             GROUP BY category ORDER BY total DESC",
            [$from, $to]
        );
        $byVendor = Database::fetchAll(
            "SELECT vendor, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?
             GROUP BY vendor ORDER BY total DESC LIMIT 10",
            [$from, $to]
        );
        $monthly = Database::fetchAll(
            "SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month, category,
                    COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?
             GROUP BY DATE_FORMAT(expense_date, '%Y-%m'), category
             ORDER BY month ASC, total DESC",
            [$from, $to]
        );
        $trend = Database::fetchAll(
            "SELECT DATE_FORMAT(expense_date, '%Y-%m') AS month,
                    COUNT(*) AS count, COALESCE(SUM(amount), 0) AS total
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?
             GROUP BY DATE_FORMAT(expense_date, '%Y-%m')
             ORDER BY month ASC",
            [$from, $to]
        );
        $topExpenses = Database::fetchAll(
            "SELECT expense_id, expense_code, expense_date, category, vendor, amount, payment_mode
             FROM expenses
             WHERE expense_date BETWEEN ? AND ?
             ORDER BY amount DESC LIMIT 10",
            [$from, $to]
        );

        return [
            'from' => $from,
            'to' => $to,
            'summary' => self::numericRow($summary, ['count' => 'int']),
            'by_category' => self::numericRows($byCategory, ['count' => 'int']),
            'by_vendor' => self::numericRows($byVendor, ['count' => 'int']),
            'monthly_by_category' => self::numericRows($monthly, ['count' => 'int']),
            'trend' => self::withMomDelta(self::numericRows($trend, ['count' => 'int'])),
            'top_expenses' => self::numericRows($topExpenses),
        ];
    }

    public static function reportAnalytics(string $module, string $from, string $to): array
    {
        $module = strtolower($module);
        if (!in_array($module, self::REPORT_MODULES, true)) {
            Response::error('Invalid report module', 422);
        }
        if ($module === 'overlay') {
            return self::overlay($from, $to);
        }

        $series = match ($module) {
            'sales' => self::monthlyInvoiceSeries($from, $to),
            'orders' => self::monthlyOrderSeries($from, $to),
            'payments' => self::monthlyPaymentSeries($from, $to),
            'expenses' => self::expenseAnalytics($from, $to)['trend'],
            'forecast' => self::forecastSeries($from, $to),
            default => [],
        };

        $total = array_sum(array_map(fn($row) => (float)($row['total'] ?? $row['amount'] ?? 0), $series));
        return [
            'module' => $module,
            'from' => $from,
            'to' => $to,
            'series' => $series,
            'aggregates' => [
                'total' => round($total, 2),
                'count' => count($series),
                'average' => count($series) > 0 ? round($total / count($series), 2) : 0.0,
                'best_period' => self::bestPeriod($series),
                'worst_period' => self::worstPeriod($series),
            ],
        ];
    }

    public static function overlay(string $from, string $to): array
    {
        $months = [];
        foreach (self::monthlyInvoiceSeries($from, $to) as $row) {
            $months[$row['month']]['revenue'] = (float)$row['total'];
        }
        foreach (self::expenseAnalytics($from, $to)['trend'] as $row) {
            $months[$row['month']]['expenses'] = (float)$row['total'];
        }
        foreach (self::monthlyPaymentSeries($from, $to) as $row) {
            $months[$row['month']]['cash_in'] = (float)$row['cash_in'];
            $months[$row['month']]['cash_out'] = (float)$row['cash_out'];
        }
        ksort($months);
        $series = [];
        foreach ($months as $month => $values) {
            $revenue = (float)($values['revenue'] ?? 0);
            $expenses = (float)($values['expenses'] ?? 0);
            $cashIn = (float)($values['cash_in'] ?? 0);
            $cashOut = (float)($values['cash_out'] ?? $expenses);
            $series[] = [
                'month' => $month,
                'revenue' => round($revenue, 2),
                'expenses' => round($expenses, 2),
                'profit' => round($revenue - $expenses, 2),
                'cash_in' => round($cashIn, 2),
                'cash_out' => round($cashOut, 2),
                'net_cash' => round($cashIn - $cashOut, 2),
            ];
        }

        return [
            'from' => $from,
            'to' => $to,
            'series' => $series,
            'totals' => [
                'revenue' => round(array_sum(array_column($series, 'revenue')), 2),
                'expenses' => round(array_sum(array_column($series, 'expenses')), 2),
                'profit' => round(array_sum(array_column($series, 'profit')), 2),
                'cash_in' => round(array_sum(array_column($series, 'cash_in')), 2),
                'cash_out' => round(array_sum(array_column($series, 'cash_out')), 2),
                'net_cash' => round(array_sum(array_column($series, 'net_cash')), 2),
            ],
        ];
    }

    public static function budgets(int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $total = Database::count('SELECT COUNT(*) AS cnt FROM budgets');
        $rows = Database::fetchAll(
            'SELECT b.*, COUNT(bl.line_id) AS line_count, COALESCE(SUM(bl.amount), 0) AS total_budget
             FROM budgets b
             LEFT JOIN budget_lines bl ON bl.budget_id = b.budget_id
             GROUP BY b.budget_id
             ORDER BY b.created_at DESC
             LIMIT ? OFFSET ?',
            [$limit, ($page - 1) * $limit]
        );

        return ['rows' => array_map([self::class, 'formatBudget'], $rows), 'pagination' => ['page' => $page, 'limit' => $limit, 'total' => $total, 'total_pages' => (int)ceil($total / $limit)]];
    }

    public static function budget(int $id): ?array
    {
        $row = Database::fetch('SELECT * FROM budgets WHERE budget_id = ? LIMIT 1', [$id]);
        if (!$row) return null;
        $out = self::formatBudget($row);
        $out['lines'] = self::budgetLines($id);
        return $out;
    }

    public static function saveBudget(array $data, ?int $id = null): int
    {
        if ($id) {
            $sets = [];
            $params = [];
            foreach (['name', 'fiscal_year', 'period_type', 'is_active', 'notes'] as $field) {
                if (!array_key_exists($field, $data)) continue;
                $sets[] = "$field = ?";
                $params[] = $field === 'is_active' ? (int)(bool)$data[$field] : ($data[$field] ?: null);
            }
            if (!empty($sets)) {
                $params[] = $id;
                Database::execute('UPDATE budgets SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE budget_id = ?', $params);
            }
        } else {
            $id = Database::insert(
                'INSERT INTO budgets (name, fiscal_year, period_type, is_active, notes, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())',
                [$data['name'], $data['fiscal_year'], $data['period_type'], !empty($data['is_active']) ? 1 : 0, $data['notes'] ?: null, $data['created_by'] ?? null]
            );
        }
        if (isset($data['lines']) && is_array($data['lines'])) {
            self::upsertBudgetLines($id, $data['lines']);
        }

        return $id;
    }

    public static function upsertBudgetLines(int $budgetId, array $lines): void
    {
        foreach ($lines as $line) {
            Database::execute(
                'INSERT INTO budget_lines (budget_id, category, period, amount, notes)
                 VALUES (?, ?, ?, ?, ?)
                 ON DUPLICATE KEY UPDATE amount = VALUES(amount), notes = VALUES(notes)',
                [$budgetId, $line['category'], $line['period'], (float)$line['amount'], $line['notes'] ?? null]
            );
        }
    }

    public static function budgetVsActual(int $budgetId, ?string $period = null): array
    {
        $budget = self::budget($budgetId);
        if (!$budget) {
            Response::error('Budget not found', 404);
        }
        $where = 'budget_id = ?';
        $params = [$budgetId];
        if ($period) {
            $where .= ' AND period = ?';
            $params[] = $period;
        }
        $lines = Database::fetchAll("SELECT * FROM budget_lines WHERE $where ORDER BY period ASC, category ASC", $params);
        $rows = [];
        foreach ($lines as $line) {
            [$from, $to] = self::periodRange((string)$line['period']);
            $actual = self::actualForCategory((string)$line['category'], $from, $to);
            $budgetAmount = (float)$line['amount'];
            $variance = round($actual - $budgetAmount, 2);
            $variancePct = $budgetAmount > 0 ? round(($variance / $budgetAmount) * 100, 2) : 0.0;
            $rows[] = [
                'line_id' => (int)$line['line_id'],
                'category' => $line['category'],
                'period' => $line['period'],
                'from' => $from,
                'to' => $to,
                'budget' => $budgetAmount,
                'actual' => round($actual, 2),
                'variance' => $variance,
                'variance_pct' => $variancePct,
                'rag' => self::budgetRag($variancePct),
            ];
        }

        return ['budget' => $budget, 'rows' => $rows, 'totals' => self::varianceTotals($rows)];
    }

    public static function benchmarks(): array
    {
        $rows = Database::fetchAll('SELECT * FROM benchmarks ORDER BY metric ASC');
        return array_map([self::class, 'formatBenchmark'], $rows);
    }

    public static function saveBenchmark(array $data): int
    {
        Database::execute(
            'INSERT INTO benchmarks (metric, target_value, unit, comparison, is_active, notes, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
                target_value = VALUES(target_value),
                unit = VALUES(unit),
                comparison = VALUES(comparison),
                is_active = VALUES(is_active),
                notes = VALUES(notes),
                updated_at = NOW()',
            [
                $data['metric'],
                (float)$data['target_value'],
                $data['unit'] ?: null,
                $data['comparison'],
                !empty($data['is_active']) ? 1 : 0,
                $data['notes'] ?: null,
                $data['created_by'] ?? null,
            ]
        );
        $row = Database::fetch('SELECT benchmark_id FROM benchmarks WHERE metric = ? LIMIT 1', [$data['metric']]);
        return (int)($row['benchmark_id'] ?? 0);
    }

    public static function benchmarkStatus(string $from, string $to): array
    {
        $benchmarks = Database::fetchAll('SELECT * FROM benchmarks WHERE is_active = 1 ORDER BY metric ASC');
        $actuals = self::benchmarkActuals($from, $to);
        $rows = [];
        foreach ($benchmarks as $benchmark) {
            $metric = (string)$benchmark['metric'];
            $actual = (float)($actuals[$metric] ?? 0);
            $target = (float)$benchmark['target_value'];
            $comparison = (string)$benchmark['comparison'];
            $pass = $comparison === 'lte' ? $actual <= $target : $actual >= $target;
            $rows[] = self::formatBenchmark($benchmark) + [
                'actual_value' => round($actual, 4),
                'variance' => round($actual - $target, 4),
                'status' => $pass ? 'green' : 'red',
            ];
        }

        return ['from' => $from, 'to' => $to, 'actuals' => $actuals, 'benchmarks' => $rows];
    }

    public static function benchmarkActuals(string $from, string $to): array
    {
        $revenue = self::revenue($from, $to);
        $expenses = self::expenses($from, $to);
        $cogs = self::cogs($from, $to);
        $grossProfit = $revenue - $cogs;
        $netProfit = $grossProfit - max(0, $expenses - $cogs);
        $orders = (int)(Database::fetch(
            'SELECT COUNT(*) AS cnt FROM orders WHERE DATE(created_at) BETWEEN ? AND ?',
            [$from, $to]
        )['cnt'] ?? 0);
        $avgPayment = Database::fetch(
            "SELECT AVG(DATEDIFF(p.first_paid_on, COALESCE(i.invoice_date, DATE(i.created_at)))) AS v
             FROM invoices i
             JOIN (
                SELECT invoice_id, MIN(paid_on) AS first_paid_on
                FROM payments
                WHERE status = 'posted' AND direction = 'in'
                GROUP BY invoice_id
             ) p ON p.invoice_id = i.invoice_id
             WHERE DATE(COALESCE(i.invoice_date, i.created_at)) BETWEEN ? AND ?",
            [$from, $to]
        );

        return [
            'gross_margin' => $revenue > 0 ? round(($grossProfit / $revenue) * 100, 4) : 0.0,
            'expense_ratio' => $revenue > 0 ? round(($expenses / $revenue) * 100, 4) : 0.0,
            'revenue' => round($revenue, 2),
            'aov' => $orders > 0 ? round($revenue / $orders, 2) : 0.0,
            'avg_payment_days' => $avgPayment && $avgPayment['v'] !== null ? round((float)$avgPayment['v'], 1) : 0.0,
            'net_profit' => round($netProfit, 2),
        ];
    }

    private static function monthlyInvoiceSeries(string $from, string $to): array
    {
        return self::numericRows(Database::fetchAll(
            "SELECT DATE_FORMAT(COALESCE(invoice_date, DATE(created_at)), '%Y-%m') AS month,
                    COUNT(*) AS count, COALESCE(SUM(total), 0) AS total
             FROM invoices
             WHERE DATE(COALESCE(invoice_date, created_at)) BETWEEN ? AND ?
               AND LOWER(status) <> 'cancelled'
             GROUP BY DATE_FORMAT(COALESCE(invoice_date, DATE(created_at)), '%Y-%m')
             ORDER BY month ASC",
            [$from, $to]
        ), ['count' => 'int']);
    }

    private static function monthlyOrderSeries(string $from, string $to): array
    {
        return self::numericRows(Database::fetchAll(
            "SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
                    COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS total
             FROM orders
             WHERE DATE(created_at) BETWEEN ? AND ?
             GROUP BY DATE_FORMAT(created_at, '%Y-%m')
             ORDER BY month ASC",
            [$from, $to]
        ), ['count' => 'int']);
    }

    private static function monthlyPaymentSeries(string $from, string $to): array
    {
        $rows = Database::fetchAll(
            "SELECT DATE_FORMAT(paid_on, '%Y-%m') AS month,
                    COALESCE(SUM(CASE WHEN direction = 'in' THEN amount ELSE 0 END), 0) AS cash_in,
                    COALESCE(SUM(CASE WHEN direction = 'out' THEN amount ELSE 0 END), 0) AS cash_out
             FROM payments
             WHERE status = 'posted' AND paid_on BETWEEN ? AND ?
             GROUP BY DATE_FORMAT(paid_on, '%Y-%m')
             ORDER BY month ASC",
            [$from, $to]
        );
        return self::numericRows($rows);
    }

    private static function forecastSeries(string $from, string $to): array
    {
        $history = self::monthlyOrderSeries(date('Y-m-d', strtotime('-3 months', strtotime($from))), date('Y-m-d', strtotime('-1 day', strtotime($from))));
        $avg = count($history) > 0 ? array_sum(array_column($history, 'total')) / count($history) : 0.0;
        $rows = [];
        $cursor = new DateTime(date('Y-m-01', strtotime($from)));
        $end = new DateTime(date('Y-m-01', strtotime($to)));
        while ($cursor <= $end) {
            $rows[] = ['month' => $cursor->format('Y-m'), 'total' => round($avg, 2), 'basis' => 'last_3_month_average'];
            $cursor->modify('+1 month');
        }
        return $rows;
    }

    private static function budgetLines(int $budgetId): array
    {
        $rows = Database::fetchAll('SELECT * FROM budget_lines WHERE budget_id = ? ORDER BY period ASC, category ASC', [$budgetId]);
        return self::numericRows($rows);
    }

    private static function actualForCategory(string $category, string $from, string $to): float
    {
        $key = strtolower($category);
        return match ($key) {
            'revenue', 'sales' => self::revenue($from, $to),
            'cogs', 'cost of goods sold' => self::cogs($from, $to),
            default => self::expenses($from, $to, $category),
        };
    }

    private static function periodRange(string $period): array
    {
        if (preg_match('/^\d{4}-\d{2}$/', $period)) {
            $from = $period . '-01';
            return [$from, date('Y-m-t', strtotime($from))];
        }
        if (preg_match('/^(\d{4})-Q([1-4])$/', $period, $m)) {
            $month = ((int)$m[2] - 1) * 3 + 1;
            $from = sprintf('%04d-%02d-01', (int)$m[1], $month);
            return [$from, date('Y-m-t', strtotime('+2 months', strtotime($from)))];
        }
        if (preg_match('/^\d{4}$/', $period)) {
            return [$period . '-01-01', $period . '-12-31'];
        }
        Response::error('Invalid budget period. Use YYYY-MM, YYYY-Qn, or YYYY', 422);
    }

    private static function budgetRag(float $variancePct): string
    {
        if ($variancePct <= 0) return 'green';
        if ($variancePct <= 10) return 'amber';
        return 'red';
    }

    private static function varianceTotals(array $rows): array
    {
        $budget = array_sum(array_column($rows, 'budget'));
        $actual = array_sum(array_column($rows, 'actual'));
        $variance = $actual - $budget;
        return [
            'budget' => round($budget, 2),
            'actual' => round($actual, 2),
            'variance' => round($variance, 2),
            'variance_pct' => $budget > 0 ? round(($variance / $budget) * 100, 2) : 0.0,
        ];
    }

    private static function formatBudget(array $row): array
    {
        return [
            'budget_id' => (int)$row['budget_id'],
            'id' => (string)$row['budget_id'],
            'name' => $row['name'],
            'fiscal_year' => $row['fiscal_year'],
            'period_type' => $row['period_type'],
            'is_active' => (bool)$row['is_active'],
            'notes' => $row['notes'] ?? null,
            'line_count' => (int)($row['line_count'] ?? 0),
            'total_budget' => (float)($row['total_budget'] ?? 0),
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
    }

    private static function formatBenchmark(array $row): array
    {
        return [
            'benchmark_id' => (int)$row['benchmark_id'],
            'id' => (string)$row['benchmark_id'],
            'metric' => $row['metric'],
            'target_value' => (float)$row['target_value'],
            'unit' => $row['unit'],
            'comparison' => $row['comparison'],
            'is_active' => (bool)$row['is_active'],
            'notes' => $row['notes'],
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
    }

    private static function withMomDelta(array $rows): array
    {
        $previous = null;
        foreach ($rows as &$row) {
            $total = (float)($row['total'] ?? 0);
            $row['mom_delta'] = $previous === null ? null : round($total - $previous, 2);
            $row['mom_delta_pct'] = ($previous === null || abs($previous) < 0.005) ? null : round((($total - $previous) / $previous) * 100, 2);
            $previous = $total;
        }
        return $rows;
    }

    private static function bestPeriod(array $series): ?array
    {
        if (empty($series)) return null;
        usort($series, fn($a, $b) => ((float)($b['total'] ?? $b['amount'] ?? 0)) <=> ((float)($a['total'] ?? $a['amount'] ?? 0)));
        return $series[0];
    }

    private static function worstPeriod(array $series): ?array
    {
        if (empty($series)) return null;
        usort($series, fn($a, $b) => ((float)($a['total'] ?? $a['amount'] ?? 0)) <=> ((float)($b['total'] ?? $b['amount'] ?? 0)));
        return $series[0];
    }

    private static function numericRows(array $rows, array $types = []): array
    {
        foreach ($rows as &$row) {
            $row = self::numericRow($row, $types);
        }
        return $rows;
    }

    private static function numericRow(array $row, array $types = []): array
    {
        foreach ($row as $key => $value) {
            if ($value === null) continue;
            if (($types[$key] ?? null) === 'int') {
                $row[$key] = (int)$value;
            } elseif (is_numeric($value) && !str_ends_with((string)$key, '_id')) {
                $row[$key] = (float)$value;
            }
        }
        return $row;
    }

    private static function validateDate(string $value, string $name): void
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) || !strtotime($value)) {
            Response::error("$name must be YYYY-MM-DD", 422);
        }
    }
}
