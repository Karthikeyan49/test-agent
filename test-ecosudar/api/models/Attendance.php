<?php
declare(strict_types=1);

class Attendance
{
    public const SOURCE_MANUAL = 'manual';
    public const SOURCE_QR     = 'qr';
    public const SOURCE_AUTO   = 'auto';
    public const SOURCE_TMS    = 'tms';

    public const DEFAULT_CUTOFF          = '10:30 AM';
    public const DEFAULT_CHECKOUT_CUTOFF = '05:00 PM';

    /** Weekday numbers (date('w'): 0=Sun … 6=Sat) treated as working days by default.
     *  Mon–Sat work, Sunday off — the common default for the LLP. */
    public const DEFAULT_WORKING_DAYS = '1,2,3,4,5,6';

    public static function list(array $filters = []): array
    {
        $where  = ['1=1'];
        $params = [];

        if (isset($filters['employee_key'])) {
            $where[]  = 'a.employee_key = ?';
            $params[] = $filters['employee_key'];
        }
        if (isset($filters['from'])) {
            $where[]  = 'a.date >= ?';
            $params[] = $filters['from'];
        }
        if (isset($filters['to'])) {
            $where[]  = 'a.date <= ?';
            $params[] = $filters['to'];
        }

        return Database::fetchAll(
            'SELECT a.*, s.name AS shift_name, s.start_time AS shift_start_time, s.end_time AS shift_end_time
               FROM attendance a
          LEFT JOIN attendance_shifts s ON s.shift_id = a.shift_id
              WHERE ' . implode(' AND ', $where) . '
              ORDER BY a.date DESC, COALESCE(a.check_in, a.created_at) DESC, a.attendance_id DESC',
            $params
        );
    }

    public static function findByEmployeeAndDate(string $employeeKey, string $date): ?array
    {
        return Database::fetch(
            'SELECT a.*, s.name AS shift_name, s.start_time AS shift_start_time, s.end_time AS shift_end_time
               FROM attendance a
          LEFT JOIN attendance_shifts s ON s.shift_id = a.shift_id
              WHERE a.employee_key = ? AND a.date = ?
              ORDER BY a.attendance_id DESC
              LIMIT 1',
            [$employeeKey, $date]
        );
    }

    public static function findById(int $id): ?array
    {
        return Database::fetch(
            'SELECT a.*, s.name AS shift_name, s.start_time AS shift_start_time, s.end_time AS shift_end_time
               FROM attendance a
          LEFT JOIN attendance_shifts s ON s.shift_id = a.shift_id
              WHERE a.attendance_id = ?
              LIMIT 1',
            [$id]
        );
    }

    public static function findOpenByEmployeeAndDate(string $employeeKey, string $date): ?array
    {
        return Database::fetch(
            'SELECT a.*, s.name AS shift_name, s.start_time AS shift_start_time, s.end_time AS shift_end_time
               FROM attendance a
          LEFT JOIN attendance_shifts s ON s.shift_id = a.shift_id
              WHERE a.employee_key = ?
                AND a.date = ?
                AND a.check_in IS NOT NULL
                AND a.check_out IS NULL
                AND a.status IN (\'Present\', \'Half-day\')
              ORDER BY a.attendance_id DESC
              LIMIT 1',
            [$employeeKey, $date]
        );
    }

    public static function findRecentOpenByEmployee(string $employeeKey): ?array
    {
        return Database::fetch(
            'SELECT a.*, s.name AS shift_name, s.start_time AS shift_start_time, s.end_time AS shift_end_time
               FROM attendance a
          LEFT JOIN attendance_shifts s ON s.shift_id = a.shift_id
              WHERE a.employee_key = ?
                AND a.check_in IS NOT NULL
                AND a.check_out IS NULL
                AND a.status IN (\'Present\', \'Half-day\')
                AND a.check_in >= DATE_SUB(NOW(), INTERVAL 36 HOUR)
              ORDER BY a.check_in DESC, a.attendance_id DESC
              LIMIT 1',
            [$employeeKey]
        );
    }

    public static function findAutoMarkedByEmployeeAndDate(string $employeeKey, string $date): ?array
    {
        return Database::fetch(
            'SELECT a.*, s.name AS shift_name, s.start_time AS shift_start_time, s.end_time AS shift_end_time
               FROM attendance a
          LEFT JOIN attendance_shifts s ON s.shift_id = a.shift_id
              WHERE a.employee_key = ?
                AND a.date = ?
                AND a.is_auto_marked = 1
                AND a.source = ?
              ORDER BY a.attendance_id DESC
              LIMIT 1',
            [$employeeKey, $date, self::SOURCE_AUTO]
        );
    }

    public static function format(array $row): array
    {
        return [
            'id'             => (string)$row['attendance_id'],
            'employeeId'     => $row['employee_key'],
            'date'           => $row['date'],
            'shiftId'        => isset($row['shift_id']) && $row['shift_id'] !== null ? (string)$row['shift_id'] : null,
            'shiftName'      => $row['shift_name'] ?? null,
            'shiftStartTime' => isset($row['shift_start_time']) && $row['shift_start_time'] !== null ? substr((string)$row['shift_start_time'], 0, 5) : null,
            'shiftEndTime'   => isset($row['shift_end_time']) && $row['shift_end_time'] !== null ? substr((string)$row['shift_end_time'], 0, 5) : null,
            'checkIn'        => $row['check_in']  ? date('Y-m-d\TH:i:s', strtotime($row['check_in']))  : null,
            'checkOut'       => $row['check_out'] ? date('Y-m-d\TH:i:s', strtotime($row['check_out'])) : null,
            'hoursWorked'    => $row['hours_worked'] !== null ? (float)$row['hours_worked'] : null,
            'scheduledHours' => isset($row['scheduled_hours']) ? (float)$row['scheduled_hours'] : null,
            'lateMinutes'    => isset($row['late_minutes']) ? (int)$row['late_minutes'] : 0,
            'overtimeHours'  => isset($row['overtime_hours']) ? (float)$row['overtime_hours'] : 0.0,
            'status'         => $row['status'],
            'isAutoMarked'   => (bool)(int)($row['is_auto_marked'] ?? 0),
            'source'         => $row['source'] ?? self::SOURCE_MANUAL,
        ];
    }

    // ─── Cutoff helpers ──────────────────────────────────────────────────────

    /** Read cutoff string (e.g. "10:30 AM") from settings; falls back to default. */
    public static function getCutoffString(): string
    {
        $row = Database::fetch(
            "SELECT setting_value FROM settings WHERE setting_key = 'attendance_cutoff_time' LIMIT 1"
        );
        $val = $row['setting_value'] ?? '';
        return self::isValidCutoff($val) ? $val : self::DEFAULT_CUTOFF;
    }

    /** Validate a 12-hour AM/PM string like "10:30 AM" or "9:05 PM". */
    public static function isValidCutoff(string $val): bool
    {
        return (bool) preg_match('/^(0?[1-9]|1[0-2]):[0-5][0-9]\s?(AM|PM|am|pm)$/', trim($val));
    }

    /** Convert "10:30 AM" → "10:30:00" (24h). */
    public static function cutoffTo24h(string $val): string
    {
        $ts = strtotime($val);
        if ($ts === false) $ts = strtotime(self::DEFAULT_CUTOFF);
        return date('H:i:s', $ts);
    }

    /** Build full datetime for the cutoff on a given date: returns a unix timestamp. */
    public static function cutoffTimestamp(string $date, ?string $cutoff = null): int
    {
        $cutoff = $cutoff ?? self::getCutoffString();
        $ts = strtotime($date . ' ' . self::cutoffTo24h($cutoff));
        return $ts === false ? strtotime($date . ' ' . self::cutoffTo24h(self::DEFAULT_CUTOFF)) : $ts;
    }

    /** Read evening check-out cutoff string (e.g. "05:00 PM") from settings. */
    public static function getCheckoutCutoffString(): string
    {
        $row = Database::fetch(
            "SELECT setting_value FROM settings WHERE setting_key = 'attendance_checkout_cutoff_time' LIMIT 1"
        );
        $val = $row['setting_value'] ?? '';
        return self::isValidCutoff($val) ? $val : self::DEFAULT_CHECKOUT_CUTOFF;
    }

    /** Build full datetime for the check-out cutoff on a given date. */
    public static function checkoutCutoffTimestamp(string $date, ?string $cutoff = null): int
    {
        $cutoff = $cutoff ?? self::getCheckoutCutoffString();
        $ts = strtotime($date . ' ' . self::cutoffTo24h($cutoff));
        return $ts === false ? strtotime($date . ' ' . self::cutoffTo24h(self::DEFAULT_CHECKOUT_CUTOFF)) : $ts;
    }

    /**
     * Read the configured working days from settings as a set of weekday numbers
     * (date('w'): 0=Sun … 6=Sat). Falls back to all 7 days when unset/invalid so
     * existing behavior is preserved if the setting was never saved.
     *
     * @return array<int,bool> keyed by weekday number, true = working day
     */
    public static function getWorkingDays(): array
    {
        $row = Database::fetch(
            "SELECT setting_value FROM settings WHERE setting_key = 'attendance_working_days' LIMIT 1"
        );
        $raw = trim((string)($row['setting_value'] ?? ''));
        if ($raw === '' || !self::isValidWorkingDays($raw)) {
            // No valid config saved → treat every day as a working day (old behavior).
            return [0 => true, 1 => true, 2 => true, 3 => true, 4 => true, 5 => true, 6 => true];
        }

        $set = [0 => false, 1 => false, 2 => false, 3 => false, 4 => false, 5 => false, 6 => false];
        foreach (explode(',', $raw) as $d) {
            $n = (int)trim($d);
            if ($n >= 0 && $n <= 6) {
                $set[$n] = true;
            }
        }
        return $set;
    }

    /** Validate a working-days CSV like "1,2,3,4,5,6" — unique weekday numbers 0–6. */
    public static function isValidWorkingDays(string $val): bool
    {
        $val = trim($val);
        if ($val === '') return false;
        $parts = explode(',', $val);
        $seen = [];
        foreach ($parts as $p) {
            $p = trim($p);
            if ($p === '' || !ctype_digit($p)) return false;
            $n = (int)$p;
            if ($n < 0 || $n > 6) return false;
            if (isset($seen[$n])) return false; // no duplicates
            $seen[$n] = true;
        }
        return true;
    }

    /** True when the given Y-m-d date falls on a configured working day. */
    public static function isWorkingDay(string $date): bool
    {
        $weekday = (int)date('w', strtotime($date));
        $days = self::getWorkingDays();
        return $days[$weekday] ?? true;
    }

    // ─── Auto-mark Absent (cron) ─────────────────────────────────────────────

    /**
     * For each active employee with no attendance row for the given date, insert
     * an Absent row marked is_auto_marked=1, source=auto.
     *
     * Returns: ['marked' => int, 'skipped' => int, 'cutoff' => string, 'date' => string]
     */
    public static function autoMarkAbsent(?string $date = null, ?string $nowDateTime = null): array
    {
        $date    = $date ?? date('Y-m-d');
        $nowTs   = $nowDateTime ? strtotime($nowDateTime) : time();
        $cutoff  = self::getCutoffString();
        $cutoffTs = self::cutoffTimestamp($date, $cutoff);

        // Skip non-working days (weekends/holidays per the Settings config)
        if (!self::isWorkingDay($date)) {
            return ['marked' => 0, 'skipped' => 0, 'cutoff' => $cutoff, 'date' => $date, 'reason' => 'non-working-day'];
        }

        // Only run after the cutoff time on the given date
        if ($nowTs < $cutoffTs) {
            return ['marked' => 0, 'skipped' => 0, 'cutoff' => $cutoff, 'date' => $date, 'reason' => 'before-cutoff'];
        }

        // Active employees without any attendance row for the date
        $missing = Database::fetchAll(
            "SELECT e.employee_key
               FROM employees e
          LEFT JOIN attendance a
                 ON a.employee_key = e.employee_key
                AND a.date         = ?
              WHERE e.is_active = 1
                AND a.attendance_id IS NULL",
            [$date]
        );

        $marked = 0;
        foreach ($missing as $row) {
            $shift = AttendanceShift::default();
            Database::insert(
                "INSERT INTO attendance
                   (employee_key, date, shift_id, check_in, check_out, hours_worked, scheduled_hours, late_minutes, overtime_hours, status, is_auto_marked, source, created_at)
                 VALUES (?, ?, ?, NULL, NULL, 0, ?, 0, 0, 'Absent', 1, 'auto', NOW())",
                [
                    $row['employee_key'],
                    $date,
                    $shift['shift_id'] ?? null,
                    (float)($shift['working_hours'] ?? 8.0),
                ]
            );
            $marked++;
        }

        return [
            'marked'  => $marked,
            'skipped' => 0,
            'cutoff'  => $cutoff,
            'date'    => $date,
        ];
    }
}
