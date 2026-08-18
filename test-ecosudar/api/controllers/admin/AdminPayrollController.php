<?php
declare(strict_types=1);

/**
 * Admin Payroll Controller
 * GET  /admin/payroll                         — fetch payroll for a month (?month=YYYY-MM)
 * GET  /admin/payroll/report                  — month totals (employee count, sum net_pay, etc.)
 * GET  /admin/payroll/{id}                    — single payroll slip by payroll_id
 * GET  /admin/payroll/{employee_id}/history   — full payroll history for an employee
 * POST /admin/payroll/calculate               — preview calc WITHOUT persisting
 * POST /admin/payroll/run                     — compute + persist (existing, re-run safe)
 * POST /admin/payroll/process                 — mark month as Processed / Paid
 */
class AdminPayrollController
{
    // ─── GET /admin/payroll ───────────────────────────────────────────────────

    public function index(Request $request): void
    {
        $month = $request->query('month') ?? date('Y-m');
        $rows  = Payroll::forMonth($month);
        Response::success(array_map([Payroll::class, 'format'], $rows));
    }

    // ─── POST /admin/payroll/ai-check — pre-run anomaly audit ────────────────
    // Compares this month's generated payroll against each employee's OWN recent
    // history and flags rows that look wrong BEFORE you process/pay. Only payroll
    // figures + employee IDs (not names) are sent to the AI.
    public function aiCheck(Request $request): void
    {
        $month = trim((string)($request->input('month') ?? $request->query('month') ?? date('Y-m')));
        if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
            Response::error('Valid month required (YYYY-MM)', 422);
        }

        $rows = Payroll::forMonth($month);
        if (empty($rows)) {
            Response::error("No payroll generated for {$month}. Run payroll first.", 422);
        }

        // Per-employee baseline from up to 3 prior months.
        $keys = array_values(array_unique(array_map(fn($r) => (string)$r['employee_key'], $rows)));
        $placeholders = implode(',', array_fill(0, count($keys), '?'));
        $history = Database::fetchAll(
            "SELECT employee_key, month, net_pay, overtime_hrs, pf, professional_tax, deductions, base_salary
             FROM payroll
             WHERE month < ? AND employee_key IN ($placeholders)
             ORDER BY employee_key ASC, month DESC",
            array_merge([$month], $keys)
        );
        $baseline = [];
        foreach ($history as $h) {
            $k = (string)$h['employee_key'];
            if (!isset($baseline[$k])) $baseline[$k] = [];
            if (count($baseline[$k]) < 3) $baseline[$k][] = $h;
        }

        $avg = static fn(array $list, string $f) => $list ? round(array_sum(array_map(fn($x) => (float)$x[$f], $list)) / count($list), 2) : null;

        $facts = [];
        foreach ($rows as $r) {
            $k = (string)$r['employee_key'];
            $hist = $baseline[$k] ?? [];
            $net = (float)$r['net_pay'];
            $avgNet = $avg($hist, 'net_pay');
            $facts[] = [
                'employee_key'     => $k,
                'present_days'     => (float)$r['present_days'],
                'working_days'     => (int)$r['working_days'],
                'base_salary'      => (float)$r['base_salary'],
                'overtime_hrs'     => (float)($r['overtime_hrs'] ?? 0),
                'overtime_salary'  => (float)($r['overtime_salary'] ?? 0),
                'pf'               => (float)$r['pf'],
                'professional_tax' => (float)$r['professional_tax'],
                'deductions'       => (float)$r['deductions'],
                'deducted_advance' => (float)($r['deducted_advance'] ?? 0),
                'net_pay'          => $net,
                'baseline'         => [
                    'months'           => count($hist),
                    'avg_net_pay'      => $avgNet,
                    'avg_overtime_hrs' => $avg($hist, 'overtime_hrs'),
                    'avg_pf'           => $avg($hist, 'pf'),
                    'last_net_pay'     => $hist ? (float)$hist[0]['net_pay'] : null,
                ],
                'net_pay_change_pct' => ($avgNet && $avgNet > 0) ? round(($net - $avgNet) / $avgNet * 100, 1) : null,
            ];
        }

        $system = 'You are a meticulous payroll auditor for an Indian manufacturer. You are given this month\'s '
            . 'payroll rows (INR) with each employee\'s own recent baseline. Flag ONLY rows that look wrong and '
            . 'should be checked BEFORE payment. Look for: net pay swinging sharply vs baseline; overtime far above '
            . 'the employee\'s norm; statutory deduction (pf/professional_tax) zero/missing when their history had it; '
            . 'negative or zero net pay; present_days greater than working_days; advance deduction spikes. '
            . 'Ignore normal variation and brand-new employees with no history. Reply with STRICT JSON only: '
            . '{"overall":"<one sentence verdict>","flags":[{"employee_key":"<id>","severity":"high|medium|low",'
            . '"issue":"<short label>","detail":"<one line citing the numbers>"}]}. No markdown, no prose.';

        try {
            $resp = GroqAPI::chat([
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => 'Month ' . $month . ' payroll:\n' . json_encode($facts, JSON_UNESCAPED_UNICODE)],
            ], 'llama-3.3-70b-versatile', 0.2);
            $ai = GroqAPI::extractJSON($resp);
        } catch (\Throwable $e) {
            error_log('Payroll AI check failed: ' . $e->getMessage());
            Response::error('AI check is unavailable right now. Please try again shortly.', 502);
        }

        // Validate flags against real rows + attach names for display.
        $nameByKey = [];
        foreach ($rows as $r) { $nameByKey[(string)$r['employee_key']] = $r['employee_name'] ?? null; }
        $validKeys = array_keys($nameByKey);
        $flags = [];
        foreach ((array)($ai['flags'] ?? []) as $f) {
            $key = (string)($f['employee_key'] ?? '');
            $sev = strtolower((string)($f['severity'] ?? 'low'));
            if (!in_array($key, $validKeys, true)) continue;
            if (!in_array($sev, ['high', 'medium', 'low'], true)) $sev = 'low';
            $flags[] = [
                'employee_key'  => $key,
                'employee_name' => $nameByKey[$key] ?? null,
                'severity'      => $sev,
                'issue'         => is_string($f['issue'] ?? null) ? trim($f['issue']) : '',
                'detail'        => is_string($f['detail'] ?? null) ? trim($f['detail']) : '',
            ];
        }
        $order = ['high' => 0, 'medium' => 1, 'low' => 2];
        usort($flags, fn($a, $b) => $order[$a['severity']] <=> $order[$b['severity']]);

        Response::success([
            'month'        => $month,
            'checked'      => count($rows),
            'overall'      => is_string($ai['overall'] ?? null) ? trim($ai['overall']) : '',
            'flags'        => $flags,
            'flagged'      => count($flags),
            'high'         => count(array_filter($flags, fn($f) => $f['severity'] === 'high')),
            'generated_at' => date('Y-m-d H:i:s'),
        ], 'Payroll checked');
    }

    // ─── POST /admin/payroll/run ──────────────────────────────────────────────

    public function run(Request $request): void
    {
        $month = trim((string)$request->input('month', ''));
        if (!$month || !preg_match('/^\d{4}-\d{2}$/', $month)) {
            Response::error('Valid month required (YYYY-MM)', 422);
        }

        $workingDays = $this->resolveWorkingDays($request, $month);
        $manualOvertimeHours = $this->resolveOvertimeHours($request);
        $advanceTotals = EmployeeAdvance::totalsForMonth($month);

        $employees = Database::fetchAll('SELECT * FROM employees WHERE is_active = 1', []);

        foreach ($employees as $emp) {
            $entries = Database::fetchAll(
                "SELECT * FROM attendance
                  WHERE employee_key = ?
                    AND DATE_FORMAT(date, '%Y-%m') = ?",
                [$emp['employee_key'], $month]
            );
            $slip = $this->buildSlip(
                $emp,
                $entries,
                $month,
                $workingDays,
                $manualOvertimeHours,
                $advanceTotals
            );

            Payroll::upsert([
                'employeeKey'     => $emp['employee_key'],
                'month'           => $month,
                'workingDays'     => $slip['workingDays'],
                'presentDays'     => $slip['presentDays'],
                'salaryPerDay'    => $slip['salaryPerDay'],
                'leaves'          => $slip['leaves'],
                'leaveAvailedThisMonth' => $slip['leaveAvailedThisMonth'],
                'leaveSalary'     => $slip['leaveSalary'],
                'travelAllow'     => $slip['travelAllow'],
                'baseSalary'      => $slip['baseSalary'],
                'siteAllowance'   => $slip['siteAllowance'],
                'da'              => $slip['da'],
                'foodAllowance'   => $slip['foodAllowance'],
                'grossSalary'     => $slip['grossSalary'] ?? ($slip['totalSalay'] ?? 0),
                'earnedSalary'    => $slip['earnedSalary'],
                'attendBonus'     => $slip['attendBonus'],
                'salaryAdvancePaid' => $slip['salaryAdvancePaid'],
                'deductedAdvance' => $slip['deductedAdvance'],
                'overtimeRate'    => $slip['overtimeRate'],
                'overtimeHours'   => $slip['overtimeHours'],
                'overtimeSalary'  => $slip['overtimeSalary'],
                'totalSalary'     => $slip['totalSalary'],
                'hra'             => $slip['hra'],
                'allowances'      => $slip['allowances'],
                'pf'              => $slip['pf'],
                'professionalTax' => $slip['professionalTax'],
                'deductions'      => $slip['deductions'],
                'netPay'          => $slip['netPay'],
            ]);
        }

        $result = Payroll::forMonth($month);
        Response::success(array_map([Payroll::class, 'format'], $result), 'Payroll computed');
    }

    // ─── GET /admin/payroll/{id} ─────────────────────────────────────────────

    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        $row = Database::fetch(
            'SELECT p.*, e.name AS employee_name, e.designation, e.joined_at
               FROM payroll p
               JOIN employees e ON p.employee_key = e.employee_key
              WHERE p.payroll_id = ? LIMIT 1',
            [$id]
        );
        if (!$row) Response::error('Payroll slip not found', 404);
        Response::success(Payroll::format($row));
    }

    // ─── GET /admin/payroll/{employee_id}/history ────────────────────────────

    public function history(Request $request): void
    {
        $empId = $request->param('id');
        $emp   = Employee::findByKey($empId);
        if (!$emp) Response::error('Employee not found', 404);

        $rows = Database::fetchAll(
            'SELECT p.*, e.name AS employee_name, e.designation, e.joined_at
               FROM payroll p
               JOIN employees e ON p.employee_key = e.employee_key
              WHERE p.employee_key = ?
              ORDER BY p.month DESC',
            [$empId]
        );

        Response::success(array_map([Payroll::class, 'format'], $rows));
    }

    // ─── POST /admin/payroll/calculate ───────────────────────────────────────

    public function calculate(Request $request): void
    {
        $month = trim((string)$request->input('month', ''));
        if (!$month || !preg_match('/^\d{4}-\d{2}$/', $month)) {
            Response::error('Valid month required (YYYY-MM)', 422);
        }

        $workingDays = $this->resolveWorkingDays($request, $month);
        $manualOvertimeHours = $this->resolveOvertimeHours($request);
        $advanceTotals = EmployeeAdvance::totalsForMonth($month);

        $employees = Database::fetchAll('SELECT * FROM employees WHERE is_active = 1', []);
        $slips     = [];

        foreach ($employees as $emp) {
            $entries = Database::fetchAll(
                "SELECT * FROM attendance
                  WHERE employee_key = ?
                    AND DATE_FORMAT(date, '%Y-%m') = ?",
                [$emp['employee_key'], $month]
            );
            $slips[] = $this->buildSlip(
                $emp,
                $entries,
                $month,
                $workingDays,
                $manualOvertimeHours,
                $advanceTotals
            );
        }

        Response::success($slips, 'Preview (not saved)');
    }

    // ─── POST /admin/payroll/process ─────────────────────────────────────────

    public function process(Request $request): void
    {
        $month  = trim((string)$request->input('month', ''));
        $status = trim((string)$request->input('status', 'Processed'));

        if (!$month || !preg_match('/^\d{4}-\d{2}$/', $month)) {
            Response::error('Valid month required (YYYY-MM)', 422);
        }
        if (!in_array($status, ['Processed', 'Paid'], true)) {
            Response::error('Status must be Processed or Paid', 422);
        }

        $timestampCol = $status === 'Paid' ? 'paid_at' : 'processed_at';

        $affected = Database::execute(
            "UPDATE payroll SET status = ?, $timestampCol = NOW() WHERE month = ?",
            [$status, $month]
        );

        $result = Payroll::forMonth($month);
        Response::success([
            'month'    => $month,
            'status'   => $status,
            'affected' => (int)$affected,
            'slips'    => array_map([Payroll::class, 'format'], $result),
        ], "Payroll marked $status");
    }

    // ─── GET /admin/payroll/report ───────────────────────────────────────────

    public function report(Request $request): void
    {
        $month = $request->query('month') ?? date('Y-m');
        if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
            Response::error('Valid month required (YYYY-MM)', 422);
        }

        $summary = Database::fetch(
            "SELECT COUNT(*) AS employees,
                    SUM(earned_salary)    AS total_earned,
                    SUM(overtime_salary)  AS total_overtime,
                    SUM(hra)              AS total_hra,
                    SUM(allowances)       AS total_allowances,
                    SUM(pf)               AS total_pf,
                    SUM(deductions)       AS total_deductions,
                    SUM(net_pay)          AS total_net_pay
             FROM payroll WHERE month = ?",
            [$month]
        );

        $statusBreakdown = Database::fetchAll(
            "SELECT status, COUNT(*) AS count
             FROM payroll WHERE month = ?
             GROUP BY status",
            [$month]
        );

        Response::success([
            'month'   => $month,
            'summary' => [
                'employees'        => (int)($summary['employees']         ?? 0),
                'totalEarned'      => (float)($summary['total_earned']      ?? 0),
                'totalOvertime'    => (float)($summary['total_overtime']    ?? 0),
                'totalHra'         => (float)($summary['total_hra']         ?? 0),
                'totalAllowances'  => (float)($summary['total_allowances']  ?? 0),
                'totalPf'          => (float)($summary['total_pf']          ?? 0),
                'totalDeductions'  => (float)($summary['total_deductions']  ?? 0),
                'totalNetPay'      => (float)($summary['total_net_pay']     ?? 0),
            ],
            'byStatus' => array_map(fn($r) => [
                'status' => $r['status'],
                'count'  => (int)$r['count'],
            ], $statusBreakdown),
        ]);
    }

    // ─── private ─────────────────────────────────────────────────────────────

    private function buildSlip(
        array $emp,
        array $entries,
        string $month,
        int $workingDays,
        array $manualOvertimeHours = [],
        array $advanceTotals = []
    ): array {
        $dayFractions = [];
        $dayLeaves = [];

        foreach ($entries as $entry) {
            $date = (string)($entry['date'] ?? '');
            if (($entry['status'] ?? '') === 'Present') {
                $dayFractions[$date] = ($dayFractions[$date] ?? 0) + 1;
            } elseif (($entry['status'] ?? '') === 'Half-day') {
                $dayFractions[$date] = ($dayFractions[$date] ?? 0) + 0.5;
            } elseif (($entry['status'] ?? '') === 'Leave') {
                $dayLeaves[$date] = true;
            }
        }

        $present = 0.0;
        foreach ($dayFractions as $date => $fraction) {
            if ($date !== '') $present += min(1.0, (float)$fraction);
        }
        $leaves = 0;
        foreach ($dayLeaves as $date => $_) {
            if (!isset($dayFractions[$date]) || $dayFractions[$date] <= 0) $leaves++;
        }

        $baseSalary = round(max(0, (float)($emp['base_salary'] ?? 0)), 2);
        $siteAllowance = round(max(0, (float)($emp['site_allowance'] ?? 0)), 2);
        $da = round(max(0, (float)($emp['da'] ?? 0)), 2);
        $foodAllowance = round(max(0, (float)($emp['food_allowance'] ?? 0)), 2);
        $travelAllow = round(max(0, (float)($emp['travel_allowance'] ?? 0)), 2);
        $monthlySalary = round($baseSalary + $siteAllowance + $da + $foodAllowance + $travelAllow, 2);
        $grossSalary = $monthlySalary;
        $salaryPerDay = $workingDays > 0 ? round($monthlySalary / $workingDays, 2) : 0.0;
        $overtimeHrs = round(max(0, (float)($manualOvertimeHours[$emp['employee_key']] ?? 0)), 2);
        $overtimeRate = $workingDays > 0
            ? round((($baseSalary + $da) / $workingDays / 8) * 1.5, 2)
            : 0.0;

        $presentDays = round($present, 1);
        $leaveAvailed = (int)$leaves;
        $earnedSalary = round($salaryPerDay * $presentDays, 2);
        $overtimeSalary = round($overtimeRate * $overtimeHrs, 2);
        $attendanceBonusAmount = round(max(0, (float)($emp['attendance_bonus_amount'] ?? 750)), 2);
        $attendBonus = $presentDays >= $workingDays ? $attendanceBonusAmount : 0.0;
        $leaveSalary = round($salaryPerDay * $leaveAvailed, 2);

        $hra = 0.0;
        $allowances = 0.0;
        $totalSalary = round($earnedSalary + $attendBonus + $overtimeSalary, 2);

        $pfEnabled = (int)($emp['pf_enabled'] ?? 1) === 1;
        $pfPercent = max(0, (float)($emp['pf_percent'] ?? 12));
        $pf = $pfEnabled ? round($earnedSalary * ($pfPercent / 100), 2) : 0.0;
        $esiEnabled = (int)($emp['esi_enabled'] ?? 0) === 1;
        $esiPercent = max(0, (float)($emp['esi_employee_percent'] ?? 0));
        $esi = $esiEnabled ? round($earnedSalary * ($esiPercent / 100), 2) : 0.0;
        $professionalTax = 0.0;
        $salaryAdvancePaid = round(max(0, (float)($advanceTotals[$emp['employee_key']] ?? 0)), 2);
        $deductedAdvance = $salaryAdvancePaid;
        $deductions = round($pf + $esi + $deductedAdvance, 2);
        $netPay = round(max(0, $totalSalary - $deductions), 2);

        return [
            'employeeId'      => $emp['employee_key'],
            'employeeName'    => $emp['name'],
            'designation'     => (string)($emp['designation'] ?? ''),
            'doj'             => (string)($emp['joined_at'] ?? ''),
            'month'           => $month,
            'workingDays'     => $workingDays,
            'presentDays'     => $presentDays,
            'leaves'          => $leaveAvailed,
            'baseSalary'      => $baseSalary,
            'siteAllowance'   => $siteAllowance,
            'da'              => $da,
            'foodAllowance'   => $foodAllowance,
            'grossSalary'     => $grossSalary,
            'salaryPerDay'    => $salaryPerDay,
            'overtimeRate'    => $overtimeRate,
            'overtimeHours'   => $overtimeHrs,
            'overtimeHrs'     => $overtimeHrs,
            'earnedSalary'    => $earnedSalary,
            'overtimeSalary'  => $overtimeSalary,
            'attendBonus'     => $attendBonus,
            'leaveAvailedThisMonth' => $leaveAvailed,
            'leaveSalary'     => $leaveSalary,
            'travelAllow'     => $travelAllow,
            'salaryAdvancePaid' => $salaryAdvancePaid,
            'deductedAdvance' => $deductedAdvance,
            'totalSalary'     => $totalSalary,
            // Keep legacy fields populated for existing reports/integrations.
            'hra'             => $hra,
            'allowances'      => $allowances,
            'pf'              => $pf,
            'professionalTax' => $professionalTax,
            'deductions'      => $deductions,
            'netPay'          => $netPay,
        ];
    }

    /**
     * Working days for the month: prefers the value sent from the admin UI
     * (clamped to 1–31), falls back to calendar count excluding Sundays.
     */
    private function resolveWorkingDays(Request $request, string $month): int
    {
        $override = $request->input('workingDays');
        if ($override !== null && $override !== '') {
            $n = (int)$override;
            if ($n >= 1 && $n <= 31) return $n;
        }

        [$y, $m] = array_map('intval', explode('-', $month));
        $lastDay = (int)date('t', mktime(0, 0, 0, $m, 1, $y));
        $count   = 0;
        for ($d = 1; $d <= $lastDay; $d++) {
            if (date('w', mktime(0, 0, 0, $m, $d, $y)) !== '0') $count++;
        }
        return $count;
    }

    private function resolveOvertimeHours(Request $request): array
    {
        $raw = $request->input('overtimeHours', []);
        if (!is_array($raw)) return [];

        $hours = [];
        foreach ($raw as $employeeKey => $value) {
            $key = trim((string)$employeeKey);
            if ($key === '') continue;
            $hours[$key] = round(max(0, (float)$value), 2);
        }
        return $hours;
    }
}
