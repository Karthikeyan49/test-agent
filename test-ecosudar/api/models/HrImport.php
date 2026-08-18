<?php
declare(strict_types=1);

class HrImport
{
    private const EMPLOYEE_DEPARTMENTS = ['Production', 'Quality', 'Sales', 'Admin', 'Dispatch', 'Maintenance'];
    private const EMPLOYMENT_TYPES = ['permanent', 'contract', 'job_work'];

    public static function createEmployeeJob(array $file, ?int $actorId): array
    {
        return ImportEngine::createJob('employee_master', $file, $actorId);
    }

    public static function createAttendanceJob(array $file, ?int $actorId): array
    {
        return ImportEngine::createJob('attendance_punch', $file, $actorId);
    }

    public static function dryRunEmployees(int $jobId, array $mapping): array
    {
        $job = ImportEngine::dryRun($jobId, $mapping, ['employee_key', 'name', 'phone']);
        self::validateRows($jobId, [self::class, 'validateEmployeeRow']);
        return ImportEngine::getJob($jobId, true);
    }

    public static function dryRunAttendance(int $jobId, array $mapping): array
    {
        $job = ImportEngine::dryRun($jobId, $mapping, ['employee_key', 'timestamp']);
        self::validateRows($jobId, [self::class, 'validateAttendanceRow']);
        return ImportEngine::getJob($jobId, true);
    }

    public static function commitEmployees(int $jobId): array
    {
        self::assertJobModule($jobId, 'employee_master');
        $rows = self::validRows($jobId);
        if (!$rows) {
            Response::error('No valid employee rows to import', 422);
        }

        $created = 0;
        $updated = 0;
        $skipped = 0;

        Database::beginTransaction();
        try {
            foreach ($rows as $row) {
                $mapped = self::mapped($row);
                $payload = self::employeePayload($mapped);
                $employeeKey = $payload['customId'];
                $existing = Employee::findByKey($employeeKey);

                if ($existing) {
                    $fields = [];
                    $params = [];
                    foreach (Employee::fieldColumns() as $camel => $column) {
                        if ($camel === 'customId' || !array_key_exists($camel, $payload)) {
                            continue;
                        }
                        $fields[] = "{$column} = ?";
                        $params[] = Employee::normalizeField($camel, $payload[$camel]);
                    }
                    if ($fields) {
                        $params[] = $employeeKey;
                        Database::execute(
                            'UPDATE employees SET ' . implode(', ', $fields) . ', updated_at = NOW() WHERE employee_key = ?',
                            $params
                        );
                        $updated++;
                    } else {
                        $skipped++;
                    }
                } else {
                    Employee::create($payload);
                    $created++;
                }

                Database::execute(
                    'UPDATE import_job_rows SET status = "imported", error_text = NULL WHERE row_id = ?',
                    [(int)$row['row_id']]
                );
            }

            Database::execute(
                'UPDATE import_jobs SET status = "committed", updated_at = NOW() WHERE job_id = ?',
                [$jobId]
            );
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            Database::execute('UPDATE import_jobs SET status = "failed", updated_at = NOW() WHERE job_id = ?', [$jobId]);
            error_log('Employee import commit failed: ' . $e->getMessage());
            Response::error('Employee import commit failed', 500);
        }

        $job = ImportEngine::getJob($jobId, true);
        $job['commit_summary'] = ['created' => $created, 'updated' => $updated, 'skipped' => $skipped];
        return $job;
    }

    public static function commitAttendance(int $jobId): array
    {
        self::assertJobModule($jobId, 'attendance_punch');
        $rows = self::validRows($jobId);
        if (!$rows) {
            Response::error('No valid attendance punch rows to import', 422);
        }

        $groups = [];
        $importedPunches = 0;

        Database::beginTransaction();
        try {
            foreach ($rows as $row) {
                $mapped = self::mapped($row);
                $punch = self::attendancePunchPayload($mapped);
                $rawJson = json_encode(['source' => self::source($row), 'mapped' => $mapped], JSON_UNESCAPED_UNICODE);

                Database::execute(
                    'INSERT INTO attendance_punches
                        (employee_key, punch_timestamp, direction, external_punch_id, import_job_id, raw_json, status, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, "imported", NOW())
                     ON DUPLICATE KEY UPDATE
                        import_job_id = VALUES(import_job_id),
                        raw_json = VALUES(raw_json),
                        status = "imported",
                        error_text = NULL',
                    [
                        $punch['employee_key'],
                        $punch['timestamp'],
                        $punch['direction'],
                        $punch['external_punch_id'],
                        $jobId,
                        $rawJson,
                    ]
                );

                $date = substr($punch['timestamp'], 0, 10);
                $groups[$punch['employee_key'] . '|' . $date] = [$punch['employee_key'], $date];
                Database::execute(
                    'UPDATE import_job_rows SET status = "imported", error_text = NULL WHERE row_id = ?',
                    [(int)$row['row_id']]
                );
                $importedPunches++;
            }

            $attendanceRows = 0;
            $incompleteDays = 0;
            foreach ($groups as [$employeeKey, $date]) {
                $result = self::upsertAttendanceFromPunches($employeeKey, $date);
                $attendanceRows++;
                if (!empty($result['incomplete'])) {
                    $incompleteDays++;
                    self::markGroupWarning($jobId, $employeeKey, $date, 'Missing out-punch; attendance check-in only');
                }
            }

            Database::execute(
                'UPDATE import_jobs SET status = "committed", updated_at = NOW() WHERE job_id = ?',
                [$jobId]
            );
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            Database::execute('UPDATE import_jobs SET status = "failed", updated_at = NOW() WHERE job_id = ?', [$jobId]);
            error_log('Attendance import commit failed: ' . $e->getMessage());
            Response::error('Attendance import commit failed', 500);
        }

        $job = ImportEngine::getJob($jobId, true);
        $job['commit_summary'] = [
            'punches_processed' => $importedPunches,
            'attendance_days_updated' => $attendanceRows,
            'incomplete_days' => $incompleteDays,
        ];
        return $job;
    }

    private static function validateRows(int $jobId, callable $validator): void
    {
        $rows = Database::fetchAll(
            'SELECT row_id, raw_json, status FROM import_job_rows WHERE job_id = ? ORDER BY `row_number` ASC',
            [$jobId]
        );
        $total = 0;
        $valid = 0;
        $errors = 0;
        foreach ($rows as $row) {
            $total++;
            if ((string)$row['status'] !== 'valid') {
                $errors++;
                continue;
            }
            $mapped = self::mapped($row);
            $rowErrors = $validator($mapped);
            if ($rowErrors) {
                $errors++;
                Database::execute(
                    'UPDATE import_job_rows SET status = "invalid", error_text = ? WHERE row_id = ?',
                    [implode('; ', $rowErrors), (int)$row['row_id']]
                );
            } else {
                $valid++;
            }
        }

        Database::execute(
            'UPDATE import_jobs SET total_rows = ?, valid_rows = ?, error_rows = ?, updated_at = NOW() WHERE job_id = ?',
            [$total, $valid, $errors, $jobId]
        );
    }

    public static function validateEmployeeRow(array $mapped): array
    {
        $errors = [];
        $employeeKey = self::value($mapped, ['employee_key', 'employee_id', 'employeeid', 'custom_id', 'customid']);
        if (!self::validEmployeeKey($employeeKey)) {
            $errors[] = 'employee_key is invalid';
        }
        if (self::value($mapped, ['name']) === '') {
            $errors[] = 'name is required';
        }
        if (self::value($mapped, ['phone', 'mobile']) === '') {
            $errors[] = 'phone is required';
        }
        $department = self::value($mapped, ['department']);
        if ($department !== '' && !in_array($department, self::EMPLOYEE_DEPARTMENTS, true)) {
            $errors[] = 'department is invalid';
        }
        $employmentType = strtolower(self::value($mapped, ['employment_type', 'employmenttype']));
        if ($employmentType !== '' && !in_array($employmentType, self::EMPLOYMENT_TYPES, true)) {
            $errors[] = 'employment_type is invalid';
        }
        foreach (['joined_at', 'joinedat', 'dob'] as $field) {
            $date = self::value($mapped, [$field]);
            if ($date !== '' && !self::validDate($date)) {
                $errors[] = "{$field} must be YYYY-MM-DD";
            }
        }

        return $errors;
    }

    public static function validateAttendanceRow(array $mapped): array
    {
        $errors = [];
        $employeeKey = self::normalizeEmployeeKeySoft(self::value($mapped, ['employee_key', 'employee_id', 'employeeid']));
        if ($employeeKey === '') {
            $errors[] = 'employee_key is required';
        } elseif (!Employee::findByKey($employeeKey)) {
            $errors[] = 'employee not found';
        }

        $timestamp = self::parseTimestamp(self::value($mapped, ['timestamp', 'punch_time', 'punchtime', 'datetime', 'date_time']));
        if ($timestamp === null) {
            $errors[] = 'timestamp is invalid';
        }
        $direction = self::normalizeDirection(self::value($mapped, ['direction', 'type', 'punch_type', 'punctype']));
        if ($direction === false) {
            $errors[] = 'direction must be in or out when provided';
        }

        return $errors;
    }

    private static function upsertAttendanceFromPunches(string $employeeKey, string $date): array
    {
        $employee = Employee::findByKey($employeeKey);
        if (!$employee) {
            throw new RuntimeException('Employee disappeared during attendance import');
        }

        $punches = Database::fetchAll(
            'SELECT * FROM attendance_punches
             WHERE employee_key = ? AND DATE(punch_timestamp) = ?
             ORDER BY punch_timestamp ASC, punch_id ASC',
            [$employeeKey, $date]
        );
        if (!$punches) {
            return ['attendance_id' => null, 'incomplete' => true];
        }

        [$checkIn, $checkOut] = self::pairPunches($punches);
        $shift = self::shiftForEmployee($employee);
        $metrics = self::metrics($date, $checkIn, $checkOut, $shift);
        $existing = Attendance::findByEmployeeAndDate($employeeKey, $date);

        if ($existing) {
            Database::execute(
                'UPDATE attendance
                    SET shift_id = ?, check_in = ?, check_out = ?, hours_worked = ?,
                        scheduled_hours = ?, late_minutes = ?, overtime_hours = ?,
                        status = ?, is_auto_marked = 0, source = ?, updated_at = NOW()
                  WHERE attendance_id = ?',
                [
                    $shift['shift_id'] ?? null,
                    $checkIn,
                    $checkOut,
                    $metrics['hoursWorked'],
                    $metrics['scheduledHours'],
                    $metrics['lateMinutes'],
                    $metrics['overtimeHours'],
                    $metrics['status'],
                    Attendance::SOURCE_TMS,
                    (int)$existing['attendance_id'],
                ]
            );
            $attendanceId = (int)$existing['attendance_id'];
        } else {
            $attendanceId = Database::insert(
                'INSERT INTO attendance
                    (employee_key, date, shift_id, check_in, check_out, hours_worked, scheduled_hours,
                     late_minutes, overtime_hours, status, is_auto_marked, source, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, NOW())',
                [
                    $employeeKey,
                    $date,
                    $shift['shift_id'] ?? null,
                    $checkIn,
                    $checkOut,
                    $metrics['hoursWorked'],
                    $metrics['scheduledHours'],
                    $metrics['lateMinutes'],
                    $metrics['overtimeHours'],
                    $metrics['status'],
                    Attendance::SOURCE_TMS,
                ]
            );
        }

        return ['attendance_id' => $attendanceId, 'incomplete' => $checkOut === null];
    }

    private static function pairPunches(array $punches): array
    {
        $ins = [];
        $outs = [];
        $unknown = [];
        foreach ($punches as $punch) {
            $timestamp = (string)$punch['punch_timestamp'];
            $direction = self::normalizeDirection((string)($punch['direction'] ?? ''));
            if ($direction === 'in') {
                $ins[] = $timestamp;
            } elseif ($direction === 'out') {
                $outs[] = $timestamp;
            } else {
                $unknown[] = $timestamp;
            }
        }

        sort($ins);
        sort($outs);
        sort($unknown);

        $checkIn = $ins[0] ?? $unknown[0] ?? null;
        $checkOut = null;
        if ($outs) {
            $checkOut = end($outs);
        } elseif (count($unknown) >= 2) {
            $checkOut = end($unknown);
        }
        if ($checkIn && $checkOut && strtotime($checkOut) <= strtotime($checkIn)) {
            $checkOut = null;
        }

        return [$checkIn, $checkOut];
    }

    private static function metrics(string $date, ?string $checkInDt, ?string $checkOutDt, array $shift): array
    {
        $scheduledHours = round(max(0.01, (float)($shift['working_hours'] ?? 8.0)), 2);
        $lateMinutes = 0;
        $hoursWorked = null;
        $overtimeHours = 0.0;

        [$shiftStart] = self::shiftWindow($date, $shift);
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
            if ($checkInTs !== false && $checkOutTs !== false && $checkOutTs > $checkInTs) {
                $hoursWorked = round(max(0, ($checkOutTs - $checkInTs) / 3600), 2);
                $overtimeHours = round(max(0, $hoursWorked - $scheduledHours), 2);
            }
        }

        $halfDayFloor = min(5.0, max(4.0, $scheduledHours / 2));
        $status = ($lateMinutes > 0 || ($hoursWorked !== null && $hoursWorked < $halfDayFloor))
            ? 'Half-day'
            : 'Present';

        return [
            'status' => $status,
            'hoursWorked' => $hoursWorked,
            'scheduledHours' => $scheduledHours,
            'lateMinutes' => $lateMinutes,
            'overtimeHours' => $overtimeHours,
        ];
    }

    private static function shiftForEmployee(array $employee): array
    {
        if (!empty($employee['default_shift_id'])) {
            $shift = AttendanceShift::find((int)$employee['default_shift_id']);
            if ($shift && (int)($shift['is_active'] ?? 0) === 1) {
                return $shift;
            }
        }
        return AttendanceShift::default();
    }

    private static function shiftWindow(string $date, array $shift): array
    {
        $startTs = strtotime($date . ' ' . (string)($shift['start_time'] ?? '09:00:00'));
        $endTs = strtotime($date . ' ' . (string)($shift['end_time'] ?? '17:00:00'));
        if ($startTs === false) {
            $startTs = strtotime($date . ' 09:00:00');
        }
        if ($endTs === false) {
            $endTs = strtotime($date . ' 17:00:00');
        }
        if ($endTs <= $startTs) {
            $endTs += 86400;
        }
        return [$startTs, $endTs];
    }

    private static function validRows(int $jobId): array
    {
        $job = self::assertDryRunJob($jobId);
        return Database::fetchAll(
            'SELECT row_id, `row_number`, raw_json, status, error_text
             FROM import_job_rows
             WHERE job_id = ? AND status = "valid"
             ORDER BY `row_number` ASC',
            [$job['job_id']]
        );
    }

    private static function assertDryRunJob(int $jobId): array
    {
        $job = Database::fetch('SELECT * FROM import_jobs WHERE job_id = ? LIMIT 1', [$jobId]);
        if (!$job) {
            Response::error('Import job not found', 404);
        }
        if (!in_array($job['status'], ['dry_run', 'committed'], true)) {
            Response::error('Run dry-run validation before commit', 422);
        }
        return $job;
    }

    private static function assertJobModule(int $jobId, string $module): void
    {
        $job = Database::fetch('SELECT module FROM import_jobs WHERE job_id = ? LIMIT 1', [$jobId]);
        if (!$job) {
            Response::error('Import job not found', 404);
        }
        if ((string)$job['module'] !== $module) {
            Response::error("Import job does not belong to {$module}", 422);
        }
    }

    private static function employeePayload(array $mapped): array
    {
        $employeeKey = self::normalizeEmployeeKeySoft(self::value($mapped, ['employee_key', 'employee_id', 'employeeid', 'custom_id', 'customid']));
        $payload = ['customId' => $employeeKey];

        self::putMapped($payload, 'name', $mapped, ['name']);
        self::putMapped($payload, 'email', $mapped, ['email']);
        self::putMapped($payload, 'phone', $mapped, ['phone', 'mobile']);
        self::putMapped($payload, 'alternatePhone', $mapped, ['alternate_phone', 'alternatephone']);
        self::putMapped($payload, 'department', $mapped, ['department']);
        self::putMapped($payload, 'designation', $mapped, ['designation']);
        self::putMapped($payload, 'employmentType', $mapped, ['employment_type', 'employmenttype'], static fn(string $value): string => strtolower($value) ?: 'permanent');
        self::putMapped($payload, 'baseSalary', $mapped, ['base_salary', 'basesalary', 'salary']);
        self::putMapped($payload, 'joinedAt', $mapped, ['joined_at', 'joinedat', 'joining_date']);
        self::putMapped($payload, 'communicationAddress', $mapped, ['communication_address', 'address']);
        self::putMapped($payload, 'permanentAddress', $mapped, ['permanent_address']);
        self::putMapped($payload, 'aadhaarNumber', $mapped, ['aadhaar_number', 'aadhaar']);
        self::putMapped($payload, 'dob', $mapped, ['dob']);
        self::putMapped($payload, 'bloodGroup', $mapped, ['blood_group', 'bloodgroup']);
        self::putMapped($payload, 'bankAccountHolder', $mapped, ['bank_account_holder']);
        self::putMapped($payload, 'bankName', $mapped, ['bank_name']);
        self::putMapped($payload, 'bankAccountNumber', $mapped, ['bank_account_number']);
        self::putMapped($payload, 'bankIfsc', $mapped, ['bank_ifsc', 'ifsc']);
        self::putMapped($payload, 'bankBranch', $mapped, ['bank_branch']);
        self::putMapped($payload, 'active', $mapped, ['active', 'is_active'], static fn(string $value): bool => $value === '' ? true : self::boolValue($value));

        return $payload;
    }

    private static function attendancePunchPayload(array $mapped): array
    {
        $timestamp = self::parseTimestamp(self::value($mapped, ['timestamp', 'punch_time', 'punchtime', 'datetime', 'date_time']));
        if ($timestamp === null) {
            throw new RuntimeException('Invalid timestamp after dry-run');
        }
        return [
            'employee_key' => self::normalizeEmployeeKeySoft(self::value($mapped, ['employee_key', 'employee_id', 'employeeid'])),
            'timestamp' => $timestamp,
            'direction' => self::normalizeDirection(self::value($mapped, ['direction', 'type', 'punch_type', 'punctype'])) ?: 'unknown',
            'external_punch_id' => self::value($mapped, ['punch_id', 'punchid', 'external_punch_id', 'device_punch_id']) ?: null,
        ];
    }

    private static function parseTimestamp(string $value): ?string
    {
        $value = trim($value);
        if ($value === '') {
            return null;
        }
        $ts = strtotime($value);
        return $ts === false ? null : date('Y-m-d H:i:s', $ts);
    }

    private static function normalizeDirection(string $value): string|false
    {
        $value = strtolower(trim($value));
        if ($value === '') {
            return '';
        }
        if (in_array($value, ['in', 'check_in', 'checkin', 'entry', 'i'], true)) {
            return 'in';
        }
        if (in_array($value, ['out', 'check_out', 'checkout', 'exit', 'o'], true)) {
            return 'out';
        }
        return false;
    }

    private static function validEmployeeKey(string $value): bool
    {
        $value = self::normalizeEmployeeKeySoft($value);
        return $value !== '' && strlen($value) <= 12 && (bool)preg_match('/^[A-Z0-9][A-Z0-9-]*$/', $value);
    }

    private static function normalizeEmployeeKeySoft(string $value): string
    {
        return strtoupper(trim($value));
    }

    private static function validDate(string $value): bool
    {
        return (bool)(preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) && strtotime($value));
    }

    private static function boolValue(string $value): bool
    {
        return in_array(strtolower(trim($value)), ['1', 'true', 'yes', 'on', 'active'], true);
    }

    private static function markGroupWarning(int $jobId, string $employeeKey, string $date, string $warning): void
    {
        $rows = Database::fetchAll(
            'SELECT row_id, raw_json FROM import_job_rows WHERE job_id = ? AND status = "imported"',
            [$jobId]
        );
        foreach ($rows as $row) {
            $mapped = self::mapped($row);
            $payload = self::attendancePunchPayload($mapped);
            if ($payload['employee_key'] === $employeeKey && substr($payload['timestamp'], 0, 10) === $date) {
                Database::execute('UPDATE import_job_rows SET error_text = ? WHERE row_id = ?', [$warning, (int)$row['row_id']]);
            }
        }
    }

    private static function mapped(array $row): array
    {
        $raw = json_decode((string)($row['raw_json'] ?? '{}'), true);
        return is_array($raw) && isset($raw['mapped']) && is_array($raw['mapped']) ? $raw['mapped'] : [];
    }

    private static function source(array $row): array
    {
        $raw = json_decode((string)($row['raw_json'] ?? '{}'), true);
        return is_array($raw) && isset($raw['source']) && is_array($raw['source']) ? $raw['source'] : [];
    }

    private static function value(array $mapped, array $keys): string
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $mapped)) {
                return trim((string)$mapped[$key]);
            }
        }
        return '';
    }

    private static function putMapped(array &$payload, string $target, array $mapped, array $keys, ?callable $transform = null): void
    {
        foreach ($keys as $key) {
            if (array_key_exists($key, $mapped)) {
                $value = trim((string)$mapped[$key]);
                $payload[$target] = $transform ? $transform($value) : $value;
                return;
            }
        }
    }
}
