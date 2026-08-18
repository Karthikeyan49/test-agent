<?php
declare(strict_types=1);

class AdminFinancePlanningController
{
    public function expenseAnalytics(Request $request): void
    {
        [$from, $to] = FinanceAnalytics::window($request->query('from'), $request->query('to'), 90);
        Response::success(FinanceAnalytics::expenseAnalytics($from, $to));
    }

    public function reportsAnalytics(Request $request): void
    {
        [$from, $to] = FinanceAnalytics::window($request->query('from'), $request->query('to'), 90);
        $module = strtolower((string)$request->query('module', 'sales'));
        Response::success(FinanceAnalytics::reportAnalytics($module, $from, $to));
    }

    public function overlay(Request $request): void
    {
        [$from, $to] = FinanceAnalytics::window($request->query('from'), $request->query('to'), 180);
        Response::success(FinanceAnalytics::overlay($from, $to));
    }

    public function budgets(Request $request): void
    {
        $result = FinanceAnalytics::budgets((int)$request->query('page', 1), (int)$request->query('limit', 20));
        Response::paginated($result['rows'], $result['pagination']);
    }

    public function createBudget(Request $request): void
    {
        $data = $this->budgetPayload($request, true);
        $data['created_by'] = $this->actorId($request) ?: null;
        $id = FinanceAnalytics::saveBudget($data);
        $this->audit($request, 'budget_created', 'budgets', $id, null, $data);
        Response::success(FinanceAnalytics::budget($id), 'Budget created', 201);
    }

    public function showBudget(Request $request): void
    {
        $budget = FinanceAnalytics::budget((int)$request->param('id'));
        if (!$budget) {
            Response::error('Budget not found', 404);
        }
        Response::success($budget);
    }

    public function updateBudget(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = FinanceAnalytics::budget($id);
        if (!$existing) {
            Response::error('Budget not found', 404);
        }
        $data = $this->budgetPayload($request, false);
        if (empty($data)) {
            Response::error('Provide at least one field to update', 400);
        }
        FinanceAnalytics::saveBudget($data, $id);
        $this->audit($request, 'budget_updated', 'budgets', $id, $existing, $data);
        Response::success(FinanceAnalytics::budget($id), 'Budget updated');
    }

    public function budgetVsActual(Request $request): void
    {
        Response::success(FinanceAnalytics::budgetVsActual(
            (int)$request->param('id'),
            $request->query('period') ?: null
        ));
    }

    public function benchmarks(Request $request): void
    {
        Response::success(FinanceAnalytics::benchmarks());
    }

    public function saveBenchmark(Request $request): void
    {
        $data = $this->benchmarkPayload($request);
        $data['created_by'] = $this->actorId($request) ?: null;
        $id = FinanceAnalytics::saveBenchmark($data);
        $this->audit($request, 'benchmark_saved', 'benchmarks', $id, null, $data);
        Response::success(Database::fetch('SELECT * FROM benchmarks WHERE benchmark_id = ? LIMIT 1', [$id]), 'Benchmark saved', 201);
    }

    public function benchmarkStatus(Request $request): void
    {
        [$from, $to] = FinanceAnalytics::window($request->query('from'), $request->query('to'), 90);
        Response::success(FinanceAnalytics::benchmarkStatus($from, $to));
    }

    private function budgetPayload(Request $request, bool $creating): array
    {
        $data = $request->only(['name', 'fiscal_year', 'period_type', 'is_active', 'notes', 'lines']);
        if ($creating) {
            foreach (['name', 'fiscal_year'] as $required) {
                if (trim((string)($data[$required] ?? '')) === '') {
                    Response::error("$required is required", 422);
                }
            }
            $data['period_type'] = $data['period_type'] ?? 'monthly';
            $data['is_active'] = array_key_exists('is_active', $data) ? $data['is_active'] : true;
        }
        if (array_key_exists('name', $data)) {
            $data['name'] = Request::sanitize((string)$data['name']);
        }
        if (array_key_exists('fiscal_year', $data)) {
            $data['fiscal_year'] = Request::sanitize((string)$data['fiscal_year']);
        }
        if (array_key_exists('period_type', $data)) {
            $data['period_type'] = strtolower(trim((string)$data['period_type']));
            if (!in_array($data['period_type'], ['monthly', 'quarterly', 'yearly'], true)) {
                Response::error('period_type must be monthly, quarterly, or yearly', 422);
            }
        }
        if (array_key_exists('is_active', $data)) {
            $data['is_active'] = filter_var($data['is_active'], FILTER_VALIDATE_BOOLEAN);
        }
        if (array_key_exists('notes', $data)) {
            $data['notes'] = $data['notes'] ? Request::sanitize((string)$data['notes']) : null;
        }
        if (array_key_exists('lines', $data)) {
            $data['lines'] = $this->budgetLinesPayload($data['lines']);
        }

        return $data;
    }

    private function budgetLinesPayload(mixed $lines): array
    {
        if (!is_array($lines)) {
            Response::error('lines must be an array', 422);
        }
        $clean = [];
        foreach ($lines as $idx => $line) {
            if (!is_array($line)) {
                Response::error("lines[$idx] must be an object", 422);
            }
            $category = trim((string)($line['category'] ?? ''));
            $period = trim((string)($line['period'] ?? ''));
            $amount = (float)($line['amount'] ?? -1);
            if ($category === '' || $period === '') {
                Response::error("lines[$idx] requires category and period", 422);
            }
            if ($amount < 0) {
                Response::error("lines[$idx].amount cannot be negative", 422);
            }
            $clean[] = [
                'category' => Request::sanitize($category),
                'period' => Request::sanitize($period),
                'amount' => round($amount, 2),
                'notes' => isset($line['notes']) ? Request::sanitize((string)$line['notes']) : null,
            ];
        }
        return $clean;
    }

    private function benchmarkPayload(Request $request): array
    {
        $metric = strtolower(trim((string)$request->input('metric', '')));
        if (!in_array($metric, FinanceAnalytics::BENCHMARK_METRICS, true)) {
            Response::error('metric must be one of: ' . implode(', ', FinanceAnalytics::BENCHMARK_METRICS), 422);
        }
        $comparison = strtolower(trim((string)$request->input('comparison', 'gte')));
        if (!in_array($comparison, ['gte', 'lte'], true)) {
            Response::error('comparison must be gte or lte', 422);
        }
        $target = $request->input('target_value');
        if (!is_numeric($target)) {
            Response::error('target_value must be numeric', 422);
        }

        return [
            'metric' => $metric,
            'target_value' => (float)$target,
            'unit' => $request->input('unit') ? Request::sanitize((string)$request->input('unit')) : null,
            'comparison' => $comparison,
            'is_active' => filter_var($request->input('is_active', true), FILTER_VALIDATE_BOOLEAN),
            'notes' => $request->input('notes') ? Request::sanitize((string)$request->input('notes')) : null,
        ];
    }

    private function actorId(Request $request): int
    {
        return isset($request->user['user_id']) ? (int)$request->user['user_id'] : 0;
    }

    private function audit(Request $request, string $action, string $table, int $id, mixed $before, mixed $after): void
    {
        Database::execute(
            'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $this->actorId($request) ?: null,
                $action,
                $table,
                $id,
                $before !== null ? json_encode($before) : null,
                $after !== null ? json_encode($after) : null,
                $request->ip(),
            ]
        );
    }
}
