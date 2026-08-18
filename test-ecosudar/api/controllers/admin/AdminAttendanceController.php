<?php
declare(strict_types=1);

/**
 * Admin Attendance Controller
 * GET    /admin/attendance                   — list records (filters: from, to, employeeId)
 * GET    /admin/attendance/report            — date-range report with filters
 * GET    /admin/attendance/summary           — month summary per employee
 * GET    /admin/attendance/cutoff            — read current cutoff time (AM/PM)
 * POST   /admin/attendance/scan              — QR scan: auto check-in or check-out
 * POST   /admin/attendance/check-in          — explicit check-in (token or employeeId)
 * POST   /admin/attendance/check-out         — explicit check-out
 * POST   /admin/attendance/auto-mark-absent  — cron-triggered: marks active employees Absent if past cutoff
 * GET    /admin/attendance/employee/{id}     — list records for a specific employee
 * PUT    /admin/attendance/{id}              — manual correction by attendance_id
 */
class AdminAttendanceController
{
    // ─── GET /admin/attendance ────────────────────────────────────────────────

    public function index(Request $request): void
    {
        $filters = [];
        if ($from  = $request->query('from'))       $filters['from']         = $from;
        if ($to    = $request->query('to'))         $filters['to']           = $to;
        if ($empId = $request->query('employeeId')) $filters['employee_key'] = $empId;

        $rows = Attendance::list($filters);
        Response::success(array_map([Attendance::class, 'format'], $rows));
    }

    // ─── GET /admin/attendance/cutoff ─────────────────────────────────────────

    public function cutoff(Request $request): void
    {
        Response::success(['cutoff' => Attendance::getCutoffString()]);
    }

    // ─── GET /admin/attendance/shifts ───────────────────────────────────────

    public function shifts(Request $request): void
    {
        Response::success(array_map([AttendanceShift::class, 'format'], AttendanceShift::all()));
    }

    // ─── POST /admin/attendance/shifts ──────────────────────────────────────

    public function storeShift(Request $request): void
    {
        $id = AttendanceShift::create($request->only([
            'name', 'startTime', 'endTime', 'workingHours', 'graceMinutes', 'isDefault', 'active',
        ]));
        Response::success(AttendanceShift::format(AttendanceShift::find($id)), 'Shift created', 201);
    }

    // ─── PUT /admin/attendance/shifts/{id} ──────────────────────────────────

    public function updateShift(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) Response::error('Invalid shift ID', 400);

        AttendanceShift::update($id, $request->only([
            'name', 'startTime', 'endTime', 'workingHours', 'graceMinutes', 'isDefault', 'active',
        ]));
        Response::success(AttendanceShift::format(AttendanceShift::find($id)), 'Shift updated');
    }

    // ─── POST /admin/attendance/scan ─────────────────────────────────────────

    public function scan(Request $request): void
    {
        $token = trim((string)$request->input('token', ''));
        if (!$token) Response::error('QR token is required', 422);

        $emp = Employee::findByQrToken($token);
        if (!$emp)              Response::error('Invalid QR token', 400);
        if (!$emp['is_active']) Response::error('Employee is inactive', 400);

        $now    = date('Y-m-d H:i:s');
        $open   = Attendance::findRecentOpenByEmployee($emp['employee_key']);
        $date   = $open ? (string)$open['date'] : date('Y-m-d');
        $auto   = $open ? null : Attendance::findAutoMarkedByEmployeeAndDate($emp['employee_key'], $date);
        $action = '';
        $entryId = null;

        if ($open) {
            $shift   = $this->shiftForAttendanceRow($open);
            $metrics = $this->calculateMetrics($date, $open['check_in'], $now, 'Present', $shift, false);
            $this->updateAttendanceRow((int)$open['attendance_id'], $date, $shift, $open['check_in'], $now, $metrics, Attendance::SOURCE_QR);
            $entryId = (int)$open['attendance_id'];
            $action = 'checked-out';
        } else {
            $shift   = $this->resolveShiftForScan($request, $auto);
            $metrics = $this->calculateMetrics($date, $now, null, 'Present', $shift, false);

            if ($auto) {
                $this->updateAttendanceRow((int)$auto['attendance_id'], $date, $shift, $now, null, $metrics, Attendance::SOURCE_QR);
                $entryId = (int)$auto['attendance_id'];
            } else {
                $entryId = $this->insertAttendanceRow(
                    $emp['employee_key'],
                    $date,
                    $shift,
                    $now,
                    null,
                    $metrics,
                    Attendance::SOURCE_QR
                );
            }
            $action = 'checked-in';
        }

        $entry = Attendance::findById($entryId);
        Response::success([
            'employee' => Employee::format($emp),
            'entry'    => Attendance::format($entry),
            'action'   => $action,
        ]);
    }

    // ─── POST /admin/attendance/check-in ─────────────────────────────────────

    public function checkIn(Request $request): void
    {
        $emp = $this->resolveEmployee($request);
        if (!$emp['is_active']) Response::error('Employee is inactive', 400);

        $existing = Attendance::findRecentOpenByEmployee($emp['employee_key']);
        $date     = $existing ? (string)$existing['date'] : date('Y-m-d');
        if ($existing && $existing['check_in']) {
            Response::error('Already checked in for today', 400);
        }

        $now    = date('Y-m-d H:i:s');
        $source = trim((string)$request->input('token', '')) !== ''
            ? Attendance::SOURCE_QR
            : Attendance::SOURCE_MANUAL;
        $auto    = Attendance::findAutoMarkedByEmployeeAndDate($emp['employee_key'], $date);
        $shift   = $source === Attendance::SOURCE_QR
            ? $this->resolveShiftForScan($request, $auto)
            : $this->resolveShiftForEmployee($request, $emp, $auto);
        $metrics = $this->calculateMetrics($date, $now, null, 'Present', $shift, false);

        if ($auto) {
            $entryId = (int)$auto['attendance_id'];
            $this->updateAttendanceRow($entryId, $date, $shift, $now, null, $metrics, $source);
        } else {
            $entryId = $this->insertAttendanceRow(
                $emp['employee_key'],
                $date,
                $shift,
                $now,
                null,
                $metrics,
                $source
            );
        }

        $entry = Attendance::findById($entryId);
        Response::success([
            'employee' => Employee::format($emp),
            'entry'    => Attendance::format($entry),
            'action'   => 'checked-in',
        ]);
    }

    // ─── POST /admin/attendance/check-out ────────────────────────────────────

    public function checkOut(Request $request): void
    {
        $emp = $this->resolveEmployee($request);
        if (!$emp['is_active']) Response::error('Employee is inactive', 400);

        $date     = date('Y-m-d');
        $existing = Attendance::findOpenByEmployeeAndDate($emp['employee_key'], $date);
        if (!$existing || !$existing['check_in']) {
            Response::error('No active check-in found for today', 400);
        }
        if ($existing['check_out']) {
            Response::error('Already checked out for today', 400);
        }

        $now     = date('Y-m-d H:i:s');
        $shift   = $this->shiftForAttendanceRow($existing);
        $metrics = $this->calculateMetrics($date, $existing['check_in'], $now, 'Present', $shift, false);
        $source  = trim((string)$request->input('token', '')) !== ''
            ? Attendance::SOURCE_QR
            : Attendance::SOURCE_MANUAL;

        $this->updateAttendanceRow((int)$existing['attendance_id'], $date, $shift, $existing['check_in'], $now, $metrics, $source);

        $entry = Attendance::findById((int)$existing['attendance_id']);
        Response::success([
            'employee' => Employee::format($emp),
            'entry'    => Attendance::format($entry),
            'action'   => 'checked-out',
        ]);
    }

    // ─── POST /admin/attendance/auto-mark-absent ─────────────────────────────
    // Triggered by cron (every 5–10 min). Idempotent — only inserts for employees
    // missing a row for the date AND only after the configured cutoff time.

    public function autoMarkAbsent(Request $request): void
    {
        $date   = $request->input('date');   // optional, defaults to today
        $result = Attendance::autoMarkAbsent(is_string($date) ? $date : null);
        Response::success($result, 'Auto-mark absent run complete');
    }

    // ─── GET /admin/attendance/employee/{id} ─────────────────────────────────

    public function byEmployee(Request $request): void
    {
        $empId = $request->param('id');
        $emp   = Employee::findByKey($empId);
        if (!$emp) Response::error('Employee not found', 404);

        $filters = ['employee_key' => $empId];
        if ($from = $request->query('from')) $filters['from'] = $from;
        if ($to   = $request->query('to'))   $filters['to']   = $to;

        $rows = Attendance::list($filters);
        Response::success(array_map([Attendance::class, 'format'], $rows));
    }

    // ─── GET /admin/attendance/report ────────────────────────────────────────

    public function report(Request $request): void
    {
        $from = $request->query('from') ?? date('Y-m-01');
        $to   = $request->query('to')   ?? date('Y-m-d');

        $rows = Database::fetchAll(
            "SELECT a.*, e.name AS employee_name, e.department, e.designation
               FROM attendance a
               JOIN employees e ON a.employee_key = e.employee_key
              WHERE a.date BETWEEN ? AND ?
              ORDER BY a.date DESC, e.employee_key ASC",
            [$from, $to]
        );

        $result = array_map(function ($r) {
            $base = Attendance::format($r);
            $base['employeeName'] = $r['employee_name'];
            $base['department']   = $r['department'];
            $base['designation']  = $r['designation'];
            return $base;
        }, $rows);

        $summary = Database::fetch(
            "SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status = 'Present'  THEN 1 ELSE 0 END) AS present,
                    SUM(CASE WHEN status = 'Half-day' THEN 1 ELSE 0 END) AS half_day,
                    SUM(CASE WHEN status = 'Absent'   THEN 1 ELSE 0 END) AS absent,
                    SUM(CASE WHEN status = 'Leave'    THEN 1 ELSE 0 END) AS leaves,
                    SUM(COALESCE(overtime_hours, 0)) AS overtime_hours
             FROM attendance WHERE date BETWEEN ? AND ?",
            [$from, $to]
        );

        foreach ($summary as $k => &$v) {
            $v = $k === 'overtime_hours' ? (float)$v : (int)$v;
        }

        Response::success([
            'from'    => $from,
            'to'      => $to,
            'summary' => $summary,
            'records' => $result,
        ]);
    }

    // ─── GET /admin/attendance/summary ───────────────────────────────────────

    public function summary(Request $request): void
    {
        $month = $request->query('month') ?? date('Y-m');
        if (!preg_match('/^\d{4}-\d{2}$/', $month)) {
            Response::error('Valid month required (YYYY-MM)', 422);
        }

        $rows = Database::fetchAll(
            "SELECT e.employee_key, e.name, e.department, e.designation,
                    COUNT(a.attendance_id) AS days_recorded,
                    SUM(CASE WHEN a.status = 'Present'  THEN 1 ELSE 0 END) AS present,
                    SUM(CASE WHEN a.status = 'Half-day' THEN 1 ELSE 0 END) AS half_day,
                    SUM(CASE WHEN a.status = 'Absent'   THEN 1 ELSE 0 END) AS absent,
                    SUM(CASE WHEN a.status = 'Leave'    THEN 1 ELSE 0 END) AS leaves,
                    SUM(COALESCE(a.hours_worked, 0))    AS total_hours,
                    SUM(COALESCE(a.overtime_hours, 0))  AS overtime_hours
               FROM employees e
          LEFT JOIN attendance a
                 ON a.employee_key = e.employee_key
                AND DATE_FORMAT(a.date, '%Y-%m') = ?
              WHERE e.is_active = 1
              GROUP BY e.employee_key
              ORDER BY e.employee_key ASC",
            [$month]
        );

        $result = array_map(fn($r) => [
            'employeeId'   => $r['employee_key'],
            'name'         => $r['name'],
            'department'   => $r['department'],
            'designation'  => $r['designation'],
            'daysRecorded' => (int)$r['days_recorded'],
            'present'      => (int)$r['present'],
            'halfDay'      => (int)$r['half_day'],
            'absent'       => (int)$r['absent'],
            'leaves'       => (int)$r['leaves'],
            'totalHours'   => (float)$r['total_hours'],
            'overtimeHours'=> (float)$r['overtime_hours'],
        ], $rows);

        Response::success([
            'month'   => $month,
            'records' => $result,
        ]);
    }

    // ─── PUT /admin/attendance/{id} ──────────────────────────────────────────
    // Manual correction by admin — clears the auto-marked flag, source=manual.

    public function update(Request $request): void
    {
        $id  = (int)$request->param('id');
        $row = Attendance::findById($id);
        if (!$row) Response::error('Attendance record not found', 404);

        $date   = trim((string)$request->input('date', (string)$row['date']));
        $status = trim((string)$request->input('status', (string)$row['status']));
        $this->assertStatus($status);

        $shift = $this->resolveShiftForEmployee($request, [], $row);
        $checkInDt = $this->normalizeDateTimeInput($date, $request->input('checkIn', $row['check_in']));
        $checkOutDt = $this->normalizeDateTimeInput($date, $request->input('checkOut', $row['check_out']));

        if (in_array($status, ['Absent', 'Leave'], true)) {
            $checkInDt = null;
            $checkOutDt = null;
        }

        $checkOutDt = $this->rollCheckoutIfOvernight($checkInDt, $checkOutDt);
        $metrics = $this->calculateMetrics($date, $checkInDt, $checkOutDt, $status, $shift, true);

        $this->updateAttendanceRow($id, $date, $shift, $checkInDt, $checkOutDt, $metrics, Attendance::SOURCE_MANUAL);

        $updated = Attendance::findById($id);
        Response::success(Attendance::format($updated), 'Attendance updated');
    }

    // ─── POST /admin/attendance/manual ───────────────────────────────────────

    public function manual(Request $request): void
    {
        $entryId = (int)$request->input('entryId', 0);
        $empId  = trim((string)$request->input('employeeId', ''));
        $date   = trim((string)$request->input('date', ''));
        $status = trim((string)$request->input('status', 'Present'));

        if (!$empId && $entryId <= 0) Response::error('employeeId required', 422);
        if (!$date || !preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            Response::error('Valid date required (YYYY-MM-DD)', 422);
        }
        $this->assertStatus($status);

        $existing = $entryId > 0 ? Attendance::findById($entryId) : null;
        if ($entryId > 0 && !$existing) Response::error('Attendance record not found', 404);

        $empId = $existing ? (string)$existing['employee_key'] : $empId;
        $emp = Employee::findByKey($empId);
        if (!$emp) Response::error('Employee not found', 404);

        $checkInTime  = trim((string)$request->input('checkIn', ''));
        $checkOutTime = trim((string)$request->input('checkOut', ''));

        $checkInDt  = $this->normalizeDateTimeInput($date, $checkInTime);
        $checkOutDt = $this->normalizeDateTimeInput($date, $checkOutTime);
        if (in_array($status, ['Absent', 'Leave'], true)) {
            $checkInDt = null;
            $checkOutDt = null;
        }

        $checkOutDt = $this->rollCheckoutIfOvernight($checkInDt, $checkOutDt);
        if (!$existing) {
            $existing = Attendance::findAutoMarkedByEmployeeAndDate($empId, $date);
        }

        $shift = $this->resolveShiftForEmployee($request, $emp, $existing);
        $metrics = $this->calculateMetrics($date, $checkInDt, $checkOutDt, $status, $shift, true);

        if ($existing) {
            $this->updateAttendanceRow((int)$existing['attendance_id'], $date, $shift, $checkInDt, $checkOutDt, $metrics, Attendance::SOURCE_MANUAL);
            $result = Attendance::findById((int)$existing['attendance_id']);
        } else {
            $newId = $this->insertAttendanceRow(
                $empId,
                $date,
                $shift,
                $checkInDt,
                $checkOutDt,
                $metrics,
                Attendance::SOURCE_MANUAL
            );
            $result = Attendance::findById($newId);
        }

        Response::success(
            Attendance::format($result),
            $existing ? 'Attendance updated' : 'Attendance recorded',
            $existing ? 200 : 201
        );
    }

    // ─── DELETE /admin/attendance/{id} ──────────────────────────────────────

    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid attendance ID', 400);
        }

        $existing = Attendance::findById($id);
        if (!$existing) Response::error('Attendance record not found', 404);

        Database::execute(
            'DELETE FROM attendance WHERE attendance_id = ?',
            [$id]
        );

        Response::success(null, 'Attendance record deleted');
    }

    // ─── private ─────────────────────────────────────────────────────────────

    private function assertStatus(string $status): void
    {
        if (!in_array($status, ['Present', 'Half-day', 'Absent', 'Leave'], true)) {
            Response::error('Invalid status', 422);
        }
    }

    private function resolveShiftForEmployee(Request $request, array $emp = [], ?array $existing = null): array
    {
        $requestedShiftId = $request->input('shiftId');
        if ($requestedShiftId !== null && $requestedShiftId !== '') {
            $shift = AttendanceShift::find((int)$requestedShiftId);
            if (!$shift || (int)($shift['is_active'] ?? 0) !== 1) {
                Response::error('Selected shift is not active', 422);
            }
            return $shift;
        }

        if (isset($existing['shift_id']) && $existing['shift_id'] !== null) {
            $shift = AttendanceShift::find((int)$existing['shift_id']);
            if ($shift) return $shift;
        }

        if (isset($emp['default_shift_id']) && $emp['default_shift_id'] !== null) {
            $shift = AttendanceShift::find((int)$emp['default_shift_id']);
            if ($shift && (int)($shift['is_active'] ?? 0) === 1) return $shift;
        }

        return AttendanceShift::default();
    }

    private function shiftForAttendanceRow(array $row): array
    {
        if (isset($row['shift_id']) && $row['shift_id'] !== null) {
            $shift = AttendanceShift::find((int)$row['shift_id']);
            if ($shift) return $shift;
        }
        return AttendanceShift::default();
    }

    private function normalizeDateTimeInput(string $date, mixed $value): ?string
    {
        $raw = trim((string)($value ?? ''));
        if ($raw === '') return null;

        $source = preg_match('/^\d{4}-\d{2}-\d{2}/', $raw)
            ? $raw
            : $date . ' ' . $raw;
        $ts = strtotime($source);
        return $ts === false ? null : date('Y-m-d H:i:s', $ts);
    }

    private function rollCheckoutIfOvernight(?string $checkInDt, ?string $checkOutDt): ?string
    {
        if (!$checkInDt || !$checkOutDt) return $checkOutDt;

        $inTs = strtotime($checkInDt);
        $outTs = strtotime($checkOutDt);
        if ($inTs === false || $outTs === false) return $checkOutDt;
        if ($outTs <= $inTs) {
            $outTs += 86400;
        }
        return date('Y-m-d H:i:s', $outTs);
    }

    private function calculateMetrics(
        string $date,
        ?string $checkInDt,
        ?string $checkOutDt,
        string $status,
        array $shift,
        bool $manualOverride
    ): array {
        $scheduledHours = round(max(0.01, (float)($shift['working_hours'] ?? 8.0)), 2);

        if (in_array($status, ['Absent', 'Leave'], true)) {
            return [
                'status'         => $status,
                'hoursWorked'    => 0.0,
                'scheduledHours' => $scheduledHours,
                'lateMinutes'    => 0,
                'overtimeHours'  => 0.0,
            ];
        }

        $lateMinutes = 0;
        $hoursWorked = null;
        $overtimeHours = 0.0;

        [$shiftStart] = $this->shiftWindow($date, $shift);
        $graceSeconds = max(0, (int)($shift['grace_minutes'] ?? 0)) * 60;

        if ($checkInDt) {
            $checkInTs = strtotime($checkInDt);
            if ($checkInTs !== false && $checkInTs > ($shiftStart + $graceSeconds)) {
                $lateMinutes = (int)floor(($checkInTs - ($shiftStart + $graceSeconds)) / 60);
            }
        }

        if ($checkInDt && $checkOutDt) {
            $checkInTs = strtotime($checkInDt);
            $checkOutTs = strtotime($checkOutDt);
            if ($checkInTs !== false && $checkOutTs !== false) {
                if ($checkOutTs <= $checkInTs) $checkOutTs += 86400;
                $payableStart = max($checkInTs, $shiftStart);
                $hoursWorked = round(max(0, ($checkOutTs - $payableStart) / 3600), 2);
            }
        }

        if (!$manualOverride) {
            $halfDayFloor = min(5.0, max(4.0, $scheduledHours / 2));
            $status = ($lateMinutes > 0 || ($hoursWorked !== null && $hoursWorked < $halfDayFloor))
                ? 'Half-day'
                : 'Present';
        }

        return [
            'status'         => $status,
            'hoursWorked'    => $hoursWorked,
            'scheduledHours' => $scheduledHours,
            'lateMinutes'    => $lateMinutes,
            'overtimeHours'  => $overtimeHours,
        ];
    }

    private function shiftWindow(string $date, array $shift): array
    {
        $startTime = (string)($shift['start_time'] ?? '09:00:00');
        $endTime = (string)($shift['end_time'] ?? '17:00:00');
        $startTs = strtotime($date . ' ' . $startTime);
        $endTs = strtotime($date . ' ' . $endTime);
        if ($startTs === false) $startTs = strtotime($date . ' 09:00:00');
        if ($endTs === false) $endTs = strtotime($date . ' 17:00:00');
        if ($endTs <= $startTs) $endTs += 86400;
        return [$startTs, $endTs];
    }

    private function resolveShiftForScan(Request $request, ?array $existing = null): array
    {
        $requestedShiftId = $request->input('shiftId');
        if ($requestedShiftId !== null && $requestedShiftId !== '') {
            $shift = AttendanceShift::find((int)$requestedShiftId);
            if (!$shift || (int)($shift['is_active'] ?? 0) !== 1) {
                Response::error('Selected shift is not active', 422);
            }
            return $shift;
        }

        if (isset($existing['shift_id']) && $existing['shift_id'] !== null) {
            $shift = AttendanceShift::find((int)$existing['shift_id']);
            if ($shift) return $shift;
        }

        return AttendanceShift::forScan();
    }

    private function insertAttendanceRow(
        string $employeeKey,
        string $date,
        array $shift,
        ?string $checkInDt,
        ?string $checkOutDt,
        array $metrics,
        string $source
    ): int {
        return Database::insert(
            'INSERT INTO attendance
               (employee_key, date, shift_id, check_in, check_out, hours_worked, scheduled_hours,
                late_minutes, overtime_hours, status, is_auto_marked, source, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW())',
            [
                $employeeKey,
                $date,
                $shift['shift_id'] ?? null,
                $checkInDt,
                $checkOutDt,
                $metrics['hoursWorked'],
                $metrics['scheduledHours'],
                $metrics['lateMinutes'],
                $metrics['overtimeHours'],
                $metrics['status'],
                $source,
            ]
        );
    }

    private function updateAttendanceRow(
        int $id,
        string $date,
        array $shift,
        ?string $checkInDt,
        ?string $checkOutDt,
        array $metrics,
        string $source
    ): void {
        Database::execute(
            'UPDATE attendance
                SET date = ?, shift_id = ?, check_in = ?, check_out = ?, hours_worked = ?,
                    scheduled_hours = ?, late_minutes = ?, overtime_hours = ?,
                    status = ?, is_auto_marked = 0, source = ?, updated_at = NOW()
              WHERE attendance_id = ?',
            [
                $date,
                $shift['shift_id'] ?? null,
                $checkInDt,
                $checkOutDt,
                $metrics['hoursWorked'],
                $metrics['scheduledHours'],
                $metrics['lateMinutes'],
                $metrics['overtimeHours'],
                $metrics['status'],
                $source,
                $id,
            ]
        );
    }

    /** Resolve employee from either a QR token or an explicit employeeId field. */
    private function resolveEmployee(Request $request): array
    {
        $token = trim((string)$request->input('token', ''));
        if ($token !== '') {
            $emp = Employee::findByQrToken($token);
            if (!$emp) Response::error('Invalid QR token', 400);
            return $emp;
        }

        $empId = trim((string)$request->input('employeeId', ''));
        if ($empId === '') Response::error('Provide token or employeeId', 422);

        $emp = Employee::findByKey($empId);
        if (!$emp) Response::error('Employee not found', 404);
        return $emp;
    }
}
