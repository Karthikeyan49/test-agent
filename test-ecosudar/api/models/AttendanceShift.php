<?php
declare(strict_types=1);

class AttendanceShift
{
    public static function all(bool $activeOnly = false): array
    {
        $where = $activeOnly ? 'WHERE is_active = 1' : '';
        return Database::fetchAll(
            "SELECT * FROM attendance_shifts
              $where
              ORDER BY is_default DESC, is_active DESC, start_time ASC, name ASC"
        );
    }

    public static function find(int $id): ?array
    {
        return Database::fetch(
            'SELECT * FROM attendance_shifts WHERE shift_id = ? LIMIT 1',
            [$id]
        );
    }

    public static function default(): array
    {
        $row = Database::fetch(
            'SELECT * FROM attendance_shifts
              WHERE is_default = 1 AND is_active = 1
              ORDER BY shift_id ASC
              LIMIT 1'
        );

        if (!$row) {
            $row = Database::fetch(
                'SELECT * FROM attendance_shifts
                  WHERE is_active = 1
                  ORDER BY shift_id ASC
                  LIMIT 1'
            );
        }

        return $row ?? [
            'shift_id'      => null,
            'name'          => 'General Shift',
            'start_time'    => '09:00:00',
            'end_time'      => '17:00:00',
            'working_hours' => 8.0,
            'grace_minutes' => 0,
            'is_default'    => 1,
            'is_active'     => 1,
        ];
    }

    public static function forScan(?int $nowTs = null, ?string $date = null): array
    {
        $nowTs = $nowTs ?? time();
        $date = $date ?: date('Y-m-d', $nowTs);
        $shifts = self::all(true);
        if (!$shifts) return self::default();

        $fallback = $shifts[0];
        $current = null;
        $upcoming = null;
        $upcomingStart = null;
        $earlyWindowSeconds = 2 * 3600;

        foreach ($shifts as $shift) {
            [$startTs, $endTs] = self::windowForDate($shift, $date);
            if ($nowTs >= $startTs && $nowTs <= $endTs) {
                $current = $shift;
            }
            if ($nowTs < $startTs && ($upcomingStart === null || $startTs < $upcomingStart)) {
                $upcoming = $shift;
                $upcomingStart = $startTs;
            }

            [$prevStartTs, $prevEndTs] = self::windowForDate($shift, date('Y-m-d', strtotime($date . ' -1 day')));
            if ($prevEndTs > $prevStartTs && $nowTs >= $prevStartTs && $nowTs <= $prevEndTs) {
                $current = $shift;
            }
        }

        if ($upcoming && $upcomingStart !== null && ($upcomingStart - $nowTs) <= $earlyWindowSeconds) {
            return $upcoming;
        }

        return $current ?? $upcoming ?? $fallback;
    }

    public static function create(array $data): int
    {
        $clean = self::normalize($data);
        if ($clean['is_default'] === 1) {
            Database::execute('UPDATE attendance_shifts SET is_default = 0 WHERE is_default = 1');
        }

        return Database::insert(
            'INSERT INTO attendance_shifts
               (name, start_time, end_time, working_hours, grace_minutes, is_default, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $clean['name'],
                $clean['start_time'],
                $clean['end_time'],
                $clean['working_hours'],
                $clean['grace_minutes'],
                $clean['is_default'],
                $clean['is_active'],
            ]
        );
    }

    public static function update(int $id, array $data): void
    {
        $existing = self::find($id);
        if (!$existing) Response::error('Shift not found', 404);

        $clean = self::normalize(array_merge($existing, $data));
        if ($clean['is_default'] === 1) {
            Database::execute('UPDATE attendance_shifts SET is_default = 0 WHERE shift_id <> ?', [$id]);
        }

        Database::execute(
            'UPDATE attendance_shifts
                SET name = ?, start_time = ?, end_time = ?, working_hours = ?,
                    grace_minutes = ?, is_default = ?, is_active = ?, updated_at = NOW()
              WHERE shift_id = ?',
            [
                $clean['name'],
                $clean['start_time'],
                $clean['end_time'],
                $clean['working_hours'],
                $clean['grace_minutes'],
                $clean['is_default'],
                $clean['is_active'],
                $id,
            ]
        );
    }

    public static function format(array $row): array
    {
        return [
            'id'           => isset($row['shift_id']) && $row['shift_id'] !== null ? (string)$row['shift_id'] : '',
            'name'         => (string)$row['name'],
            'startTime'    => substr((string)$row['start_time'], 0, 5),
            'endTime'      => substr((string)$row['end_time'], 0, 5),
            'workingHours' => (float)$row['working_hours'],
            'graceMinutes' => (int)$row['grace_minutes'],
            'isDefault'    => (bool)(int)$row['is_default'],
            'active'       => (bool)(int)$row['is_active'],
        ];
    }

    private static function normalize(array $data): array
    {
        $name = trim((string)($data['name'] ?? ''));
        if ($name === '') Response::error('Shift name is required', 422);

        $start = self::normalizeTime((string)($data['startTime'] ?? $data['start_time'] ?? ''));
        $end   = self::normalizeTime((string)($data['endTime'] ?? $data['end_time'] ?? ''));

        $workingHours = (float)($data['workingHours'] ?? $data['working_hours'] ?? 0);
        if ($workingHours <= 0) {
            $workingHours = self::hoursBetween($start, $end);
        }
        if ($workingHours <= 0 || $workingHours > 24) {
            Response::error('Working hours must be between 0 and 24', 422);
        }

        $grace = max(0, min(240, (int)($data['graceMinutes'] ?? $data['grace_minutes'] ?? 0)));

        return [
            'name'          => $name,
            'start_time'    => $start,
            'end_time'      => $end,
            'working_hours' => round($workingHours, 2),
            'grace_minutes' => $grace,
            'is_default'    => self::boolValue($data['isDefault'] ?? $data['is_default'] ?? false) ? 1 : 0,
            'is_active'     => self::boolValue($data['active'] ?? $data['is_active'] ?? true) ? 1 : 0,
        ];
    }

    private static function normalizeTime(string $value): string
    {
        $value = trim($value);
        if (!preg_match('/^\d{1,2}:\d{2}(:\d{2})?$/', $value)) {
            Response::error('Shift time must be HH:MM', 422);
        }
        $ts = strtotime($value);
        if ($ts === false) Response::error('Invalid shift time', 422);
        return date('H:i:s', $ts);
    }

    private static function windowForDate(array $shift, string $date): array
    {
        $startTs = strtotime($date . ' ' . (string)($shift['start_time'] ?? '09:00:00'));
        $endTs = strtotime($date . ' ' . (string)($shift['end_time'] ?? '17:00:00'));
        if ($startTs === false || $endTs === false) {
            $startTs = strtotime($date . ' 09:00:00');
            $endTs = strtotime($date . ' 17:00:00');
        }
        if ($endTs <= $startTs) $endTs += 86400;
        return [$startTs, $endTs];
    }

    private static function hoursBetween(string $start, string $end): float
    {
        $startTs = strtotime('2000-01-01 ' . $start);
        $endTs   = strtotime('2000-01-01 ' . $end);
        if ($startTs === false || $endTs === false) return 0.0;
        if ($endTs <= $startTs) $endTs += 86400;
        return round(($endTs - $startTs) / 3600, 2);
    }

    private static function boolValue(mixed $value): bool
    {
        if (is_bool($value)) return $value;
        return in_array(strtolower(trim((string)$value)), ['1', 'true', 'yes', 'on'], true);
    }
}
