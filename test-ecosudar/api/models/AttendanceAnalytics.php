<?php
declare(strict_types=1);

class AttendanceAnalytics
{
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

    public static function analytics(string $from, string $to, ?string $department = null, ?string $employeeKey = null): array
    {
        [$where, $params] = self::where($from, $to, $department, $employeeKey);

        $summary = self::summary($where, $params);
        $daily = self::dailyTrend($where, $params);
        $departments = self::departmentSummary($from, $to, $department);
        $employees = self::employeeSummary($where, $params);
        $heatmap = self::heatmap($where, $params);

        return [
            'from' => $from,
            'to' => $to,
            'department' => $department,
            'employee_key' => $employeeKey,
            'summary' => $summary,
            'daily_trend' => $daily,
            'departments' => $departments,
            'employees' => $employees,
            'heatmap' => $heatmap,
            'payroll_ready' => $employees,
        ];
    }

    public static function anomalies(string $from, string $to, ?string $department = null): array
    {
        [$where, $params] = self::where($from, $to, $department, null);
        $rows = Database::fetchAll(
            "SELECT a.employee_key, e.name, e.department, e.designation,
                    COUNT(a.attendance_id) AS scheduled_days,
                    SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS absent_days,
                    SUM(CASE WHEN a.status = 'Leave' THEN 1 ELSE 0 END) AS leave_days,
                    SUM(CASE WHEN a.late_minutes > 0 THEN 1 ELSE 0 END) AS late_days,
                    SUM(COALESCE(a.overtime_hours, 0)) AS overtime_hours
             FROM attendance a
             JOIN employees e ON e.employee_key = a.employee_key
             WHERE $where
             GROUP BY a.employee_key, e.name, e.department, e.designation
             ORDER BY late_days DESC, absent_days DESC, overtime_hours DESC",
            $params
        );

        $lateThreshold = self::settingInt('attendance_chronic_late_days', 3);
        $absenceThreshold = self::settingInt('attendance_absence_alert_days', 3);
        $otThreshold = self::settingFloat('attendance_overtime_alert_hours', 10.0);

        $late = [];
        $absence = [];
        $overtime = [];
        foreach ($rows as $row) {
            $formatted = [
                'employee_key' => $row['employee_key'],
                'name' => $row['name'],
                'department' => $row['department'],
                'designation' => $row['designation'],
                'scheduled_days' => (int)$row['scheduled_days'],
                'absent_days' => (int)$row['absent_days'],
                'leave_days' => (int)$row['leave_days'],
                'late_days' => (int)$row['late_days'],
                'overtime_hours' => (float)$row['overtime_hours'],
            ];
            if ($formatted['late_days'] >= $lateThreshold) {
                $late[] = $formatted + ['reason' => 'chronic_late'];
            }
            if (($formatted['absent_days'] + $formatted['leave_days']) >= $absenceThreshold) {
                $absence[] = $formatted + ['reason' => 'frequent_absence'];
            }
            if ($formatted['overtime_hours'] >= $otThreshold) {
                $overtime[] = $formatted + ['reason' => 'excessive_overtime'];
            }
        }

        return [
            'from' => $from,
            'to' => $to,
            'department' => $department,
            'thresholds' => [
                'late_days' => $lateThreshold,
                'absence_days' => $absenceThreshold,
                'overtime_hours' => $otThreshold,
            ],
            'chronic_late' => $late,
            'frequent_absence' => $absence,
            'excessive_overtime' => $overtime,
            'all' => array_values(array_merge($late, $absence, $overtime)),
        ];
    }

    private static function summary(string $where, array $params): array
    {
        $row = Database::fetch(
            "SELECT COUNT(a.attendance_id) AS scheduled_days,
                    SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS present_days,
                    SUM(CASE WHEN a.status = 'Half-day' THEN 1 ELSE 0 END) AS half_days,
                    SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS absent_days,
                    SUM(CASE WHEN a.status = 'Leave' THEN 1 ELSE 0 END) AS leave_days,
                    SUM(CASE WHEN a.late_minutes > 0 THEN 1 ELSE 0 END) AS late_days,
                    SUM(COALESCE(a.hours_worked, 0)) AS total_hours,
                    SUM(COALESCE(a.overtime_hours, 0)) AS overtime_hours
             FROM attendance a
             JOIN employees e ON e.employee_key = a.employee_key
             WHERE $where",
            $params
        ) ?: [];

        return self::rates(self::castCounters($row));
    }

    private static function dailyTrend(string $where, array $params): array
    {
        $rows = Database::fetchAll(
            "SELECT a.date,
                    COUNT(a.attendance_id) AS scheduled_days,
                    SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS present_days,
                    SUM(CASE WHEN a.status = 'Half-day' THEN 1 ELSE 0 END) AS half_days,
                    SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS absent_days,
                    SUM(CASE WHEN a.status = 'Leave' THEN 1 ELSE 0 END) AS leave_days,
                    SUM(CASE WHEN a.late_minutes > 0 THEN 1 ELSE 0 END) AS late_days,
                    SUM(COALESCE(a.hours_worked, 0)) AS total_hours,
                    SUM(COALESCE(a.overtime_hours, 0)) AS overtime_hours
             FROM attendance a
             JOIN employees e ON e.employee_key = a.employee_key
             WHERE $where
             GROUP BY a.date
             ORDER BY a.date ASC",
            $params
        );

        return array_map(fn($row) => self::rates(self::castCounters($row)), $rows);
    }

    private static function departmentSummary(string $from, string $to, ?string $department): array
    {
        $where = ['a.date BETWEEN ? AND ?'];
        $params = [$from, $to];
        if ($department !== null && $department !== '') {
            $where[] = 'e.department = ?';
            $params[] = $department;
        }

        $rows = Database::fetchAll(
            "SELECT COALESCE(e.department, 'Unassigned') AS department,
                    COUNT(a.attendance_id) AS scheduled_days,
                    SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS present_days,
                    SUM(CASE WHEN a.status = 'Half-day' THEN 1 ELSE 0 END) AS half_days,
                    SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS absent_days,
                    SUM(CASE WHEN a.status = 'Leave' THEN 1 ELSE 0 END) AS leave_days,
                    SUM(CASE WHEN a.late_minutes > 0 THEN 1 ELSE 0 END) AS late_days,
                    SUM(COALESCE(a.hours_worked, 0)) AS total_hours,
                    SUM(COALESCE(a.overtime_hours, 0)) AS overtime_hours
             FROM attendance a
             JOIN employees e ON e.employee_key = a.employee_key
             WHERE " . implode(' AND ', $where) . "
             GROUP BY COALESCE(e.department, 'Unassigned')
             ORDER BY department ASC",
            $params
        );

        return array_map(fn($row) => self::rates(self::castCounters($row)), $rows);
    }

    private static function employeeSummary(string $where, array $params): array
    {
        $rows = Database::fetchAll(
            "SELECT a.employee_key, e.name, e.department, e.designation,
                    COUNT(a.attendance_id) AS scheduled_days,
                    SUM(CASE WHEN a.status = 'Present' THEN 1 ELSE 0 END) AS present_days,
                    SUM(CASE WHEN a.status = 'Half-day' THEN 1 ELSE 0 END) AS half_days,
                    SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) AS absent_days,
                    SUM(CASE WHEN a.status = 'Leave' THEN 1 ELSE 0 END) AS leave_days,
                    SUM(CASE WHEN a.late_minutes > 0 THEN 1 ELSE 0 END) AS late_days,
                    SUM(COALESCE(a.hours_worked, 0)) AS total_hours,
                    SUM(COALESCE(a.overtime_hours, 0)) AS overtime_hours
             FROM attendance a
             JOIN employees e ON e.employee_key = a.employee_key
             WHERE $where
             GROUP BY a.employee_key, e.name, e.department, e.designation
             ORDER BY e.name ASC",
            $params
        );

        return array_map(fn($row) => self::rates(self::castCounters($row)), $rows);
    }

    private static function heatmap(string $where, array $params): array
    {
        $rows = Database::fetchAll(
            "SELECT a.employee_key, e.name, e.department, a.date, a.status,
                    a.late_minutes, a.overtime_hours, a.hours_worked
             FROM attendance a
             JOIN employees e ON e.employee_key = a.employee_key
             WHERE $where
             ORDER BY a.employee_key ASC, a.date ASC
             LIMIT 1500",
            $params
        );

        return array_map(static fn($row) => [
            'employee_key' => $row['employee_key'],
            'name' => $row['name'],
            'department' => $row['department'],
            'date' => $row['date'],
            'status' => $row['status'],
            'late_minutes' => (int)$row['late_minutes'],
            'overtime_hours' => (float)$row['overtime_hours'],
            'hours_worked' => $row['hours_worked'] !== null ? (float)$row['hours_worked'] : null,
            'color' => self::statusColor((string)$row['status'], (int)$row['late_minutes']),
        ], $rows);
    }

    private static function where(string $from, string $to, ?string $department, ?string $employeeKey): array
    {
        $where = ['a.date BETWEEN ? AND ?'];
        $params = [$from, $to];
        if ($department !== null && trim($department) !== '') {
            $where[] = 'e.department = ?';
            $params[] = trim($department);
        }
        if ($employeeKey !== null && trim($employeeKey) !== '') {
            $where[] = 'a.employee_key = ?';
            $params[] = Employee::normalizeEmployeeKey($employeeKey, true);
        }

        return [implode(' AND ', $where), $params];
    }

    private static function rates(array $row): array
    {
        $scheduled = max(0, (int)($row['scheduled_days'] ?? 0));
        $effectivePresent = (float)($row['present_days'] ?? 0) + ((float)($row['half_days'] ?? 0) * 0.5);
        $row['effective_present_days'] = round($effectivePresent, 2);
        $row['attendance_pct'] = $scheduled > 0 ? round(($effectivePresent / $scheduled) * 100, 2) : 0.0;
        $row['late_rate_pct'] = $scheduled > 0 ? round(((float)($row['late_days'] ?? 0) / $scheduled) * 100, 2) : 0.0;
        $row['absenteeism_pct'] = $scheduled > 0 ? round((((float)($row['absent_days'] ?? 0) + (float)($row['leave_days'] ?? 0)) / $scheduled) * 100, 2) : 0.0;
        return $row;
    }

    private static function castCounters(array $row): array
    {
        foreach (['scheduled_days', 'present_days', 'half_days', 'absent_days', 'leave_days', 'late_days'] as $field) {
            $row[$field] = (int)($row[$field] ?? 0);
        }
        foreach (['total_hours', 'overtime_hours'] as $field) {
            $row[$field] = round((float)($row[$field] ?? 0), 2);
        }
        return $row;
    }

    private static function statusColor(string $status, int $lateMinutes): string
    {
        return match ($status) {
            'Present' => $lateMinutes > 0 ? 'amber' : 'green',
            'Half-day' => 'amber',
            'Leave' => 'blue',
            'Absent' => 'red',
            default => 'gray',
        };
    }

    private static function settingInt(string $key, int $default): int
    {
        $row = Database::fetch('SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1', [$key]);
        $value = (int)($row['setting_value'] ?? $default);
        return max(1, $value);
    }

    private static function settingFloat(string $key, float $default): float
    {
        $row = Database::fetch('SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1', [$key]);
        $value = (float)($row['setting_value'] ?? $default);
        return max(0.1, $value);
    }

    private static function validateDate(string $value, string $name): void
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) || !strtotime($value)) {
            Response::error("{$name} must be YYYY-MM-DD", 422);
        }
    }
}
