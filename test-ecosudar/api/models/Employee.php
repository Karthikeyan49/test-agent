<?php
declare(strict_types=1);

class Employee
{
    private const VALID_DEPARTMENTS = [
        'Production', 'Quality', 'Sales', 'Admin', 'Dispatch', 'Maintenance',
    ];

    private const EXTRA_FIELD_COLUMNS = [
        'alternatePhone'              => 'alternate_phone',
        'employmentType'              => 'employment_type',
        'communicationAddress'        => 'communication_address',
        'permanentAddress'            => 'permanent_address',
        'sameAsCommunicationAddress'  => 'same_as_communication_address',
        'aadhaarNumber'               => 'aadhaar_number',
        'dob'                         => 'dob',
        'bloodGroup'                  => 'blood_group',
        'experience'                  => 'experience',
        'relativesWorking'            => 'relatives_working',
        'relativesDetails'            => 'relatives_details',
        'qualifications'              => 'qualification_json',
        'bankAccountHolder'           => 'bank_account_holder',
        'bankName'                    => 'bank_name',
        'bankAccountNumber'           => 'bank_account_number',
        'bankIfsc'                    => 'bank_ifsc',
        'bankBranch'                  => 'bank_branch',
        'pfEnabled'                   => 'pf_enabled',
        'pfPercent'                   => 'pf_percent',
        'bonusPercent'                => 'bonus_percent',
        'attendanceBonusAmount'       => 'attendance_bonus_amount',
        'defaultShiftId'              => 'default_shift_id',
        'esiEnabled'                  => 'esi_enabled',
        'esiEmployeePercent'          => 'esi_employee_percent',
        'siteAllowance'               => 'site_allowance',
        'da'                          => 'da',
        'foodAllowance'               => 'food_allowance',
        'travelAllowance'             => 'travel_allowance',
        'insurancePdfPath'            => 'insurance_pdf_path',
        'insurancePdfName'            => 'insurance_pdf_name',
        'uniformIssued'               => 'uniform_issued',
        'uniformIssuedAt'             => 'uniform_issued_at',
        'uniformValidUntil'           => 'uniform_valid_until',
        'shoesIssued'                 => 'shoes_issued',
        'shoesIssuedAt'               => 'shoes_issued_at',
        'shoesValidUntil'             => 'shoes_valid_until',
        'photoPath'                   => 'photo_path',
    ];

    public static function all(array $filters = []): array
    {
        $where  = ['1=1'];
        $params = [];

        if (isset($filters['department']) && in_array($filters['department'], self::VALID_DEPARTMENTS, true)) {
            $where[]  = 'department = ?';
            $params[] = $filters['department'];
        }
        if (array_key_exists('is_active', $filters)) {
            $where[]  = 'is_active = ?';
            $params[] = (int)$filters['is_active'];
        }

        return Database::fetchAll(
            'SELECT * FROM employees WHERE ' . implode(' AND ', $where) . ' ORDER BY employee_key ASC',
            $params
        );
    }

    public static function findByKey(string $key): ?array
    {
        return Database::fetch(
            'SELECT * FROM employees WHERE employee_key = ? LIMIT 1',
            [$key]
        );
    }

    public static function findByQrToken(string $token): ?array
    {
        return Database::fetch(
            'SELECT * FROM employees WHERE qr_token = ? LIMIT 1',
            [$token]
        );
    }

    public static function normalizeEmployeeKey(mixed $value, bool $required = false): ?string
    {
        $key = strtoupper(trim((string)$value));
        if ($key === '') {
            if ($required) {
                Response::error('Employee ID is required', 422);
            }
            return null;
        }

        if (strlen($key) > 12) {
            Response::error('Employee ID must be 12 characters or less', 422);
        }

        if (!preg_match('/^[A-Z0-9][A-Z0-9-]*$/', $key)) {
            Response::error('Employee ID can contain only letters, numbers and hyphen', 422);
        }

        return $key;
    }

    public static function updateKey(string $currentKey, mixed $newKeyValue): string
    {
        $currentKey = trim($currentKey);
        $newKey = self::normalizeEmployeeKey($newKeyValue, true);
        if ($newKey === $currentKey) {
            return $currentKey;
        }

        $existing = Database::fetch(
            'SELECT employee_id FROM employees WHERE employee_key = ? LIMIT 1',
            [$newKey]
        );
        if ($existing) {
            Response::error("Employee ID '{$newKey}' already exists", 409);
        }

        try {
            Database::beginTransaction();

            $updated = Database::execute(
                'UPDATE employees SET employee_key = ?, updated_at = NOW() WHERE employee_key = ?',
                [$newKey, $currentKey]
            );
            if ($updated < 1) {
                throw new RuntimeException('Employee ID update affected no rows');
            }

            Database::execute('UPDATE tasks SET assignee_id = ? WHERE assignee_id = ?', [$newKey, $currentKey]);
            Database::execute(
                'UPDATE workflows SET requester_id = CASE WHEN requester_id = ? THEN ? ELSE requester_id END,
                                      approver_id = CASE WHEN approver_id = ? THEN ? ELSE approver_id END
                  WHERE requester_id = ? OR approver_id = ?',
                [$currentKey, $newKey, $currentKey, $newKey, $currentKey, $currentKey]
            );
            Database::execute(
                'UPDATE workflow_history SET actor_id = ? WHERE actor_id = ?',
                [$newKey, $currentKey]
            );
            self::updateMeetingEmployeeRefs($currentKey, $newKey);

            Database::commit();
            return $newKey;
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('[Employee] Employee ID update failed: ' . $e->getMessage());
            Response::error('Could not update employee ID', 500);
        }
    }

    public static function create(array $data): int
    {
        // Use custom employee key if provided, otherwise auto-generate EMP-XXX
        $customId = self::normalizeEmployeeKey($data['customId'] ?? '');
        if ($customId !== null) {
            // Check uniqueness
            $existing = Database::fetch(
                'SELECT employee_id FROM employees WHERE employee_key = ? LIMIT 1',
                [$customId]
            );
            if ($existing) {
                Response::error("Employee ID '{$customId}' already exists", 409);
            }
            $key = $customId;
        } else {
            $count = Database::count('SELECT COUNT(*) AS cnt FROM employees');
            $num   = $count + 1;
            do {
                $key = 'EMP-' . str_pad((string)$num, 3, '0', STR_PAD_LEFT);
                $exists = Database::fetch(
                    'SELECT employee_id FROM employees WHERE employee_key = ? LIMIT 1',
                    [$key]
                );
                if (!$exists) {
                    break;
                }
                $num++;
            } while (true);
        }

        // Derive a sequence number for QR token (use count-based)
        $count = $count ?? Database::count('SELECT COUNT(*) AS cnt FROM employees');
        $num   = $num ?? $count + 1;

        // Generate unique QR token: ESD-{INITIALS}-{NUM}-{RAND4}
        $parts    = array_filter(explode(' ', $data['name']));
        $initials = strtoupper(implode('', array_map(fn($p) => substr($p, 0, 1), $parts)));
        $initials = substr($initials, 0, 2);
        $rand     = strtoupper(substr(bin2hex(random_bytes(3)), 0, 4));
        $qrToken  = 'ESD-' . $initials . '-' . str_pad((string)$num, 3, '0', STR_PAD_LEFT) . '-' . $rand;

        $columns = [
            'employee_key', 'name', 'email', 'phone', 'department', 'designation',
            'base_salary', 'joined_at', 'qr_token', 'is_active', 'created_at',
        ];
        $values = [
            $key,
            trim((string)$data['name']),
            self::normalizeField('email', $data['email'] ?? null),
            trim((string)$data['phone']),
            self::normalizeField('department', $data['department'] ?? null),
            self::normalizeField('designation', $data['designation'] ?? null),
            self::normalizeField('baseSalary', $data['baseSalary'] ?? 0),
            self::normalizeField('joinedAt', $data['joinedAt'] ?? null),
            $qrToken,
            array_key_exists('active', $data) ? self::normalizeField('active', $data['active']) : 1,
            date('Y-m-d H:i:s'),
        ];

        foreach (self::EXTRA_FIELD_COLUMNS as $field => $column) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $columns[] = $column;
            $values[]  = self::normalizeField($field, $data[$field]);
        }

        return Database::insert(
            'INSERT INTO employees (' . implode(', ', $columns) . ')
             VALUES (' . implode(', ', array_fill(0, count($columns), '?')) . ')',
            $values
        );
    }

    public static function fieldColumns(): array
    {
        return array_merge([
            'name'        => 'name',
            'email'       => 'email',
            'phone'       => 'phone',
            'department'  => 'department',
            'designation' => 'designation',
            'baseSalary'  => 'base_salary',
            'joinedAt'    => 'joined_at',
            'active'      => 'is_active',
        ], self::EXTRA_FIELD_COLUMNS);
    }

    public static function normalizeField(string $field, mixed $value): mixed
    {
        if (in_array($field, [
            'active',
            'sameAsCommunicationAddress',
            'relativesWorking',
            'pfEnabled',
            'esiEnabled',
            'uniformIssued',
            'shoesIssued',
        ], true)) {
            return self::boolValue($value) ? 1 : 0;
        }

        if (in_array($field, [
            'baseSalary',
            'pfPercent',
            'bonusPercent',
            'attendanceBonusAmount',
            'esiEmployeePercent',
            'siteAllowance',
            'da',
            'foodAllowance',
            'travelAllowance',
        ], true)) {
            return round(max(0, (float)$value), 2);
        }

        if ($field === 'defaultShiftId') {
            $id = (int)$value;
            return $id > 0 ? $id : null;
        }

        if (in_array($field, [
            'joinedAt',
            'dob',
            'uniformIssuedAt',
            'uniformValidUntil',
            'shoesIssuedAt',
            'shoesValidUntil',
        ], true)) {
            $date = trim((string)$value);
            return $date === '' ? null : $date;
        }

        if ($field === 'qualifications') {
            if (is_array($value)) {
                return json_encode(array_values($value), JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            }
            $raw = trim((string)$value);
            if ($raw === '') {
                return null;
            }
            $decoded = json_decode($raw, true);
            return json_encode(is_array($decoded) ? array_values($decoded) : [], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
        }

        if ($field === 'email') {
            $text = strtolower(trim((string)$value));
            return $text === '' ? null : $text;
        }

        if ($field === 'bankIfsc') {
            $text = strtoupper(trim((string)$value));
            return $text === '' ? null : $text;
        }

        if ($field === 'employmentType') {
            return strtolower(trim((string)$value)) ?: 'permanent';
        }

        $text = trim((string)$value);
        return $text === '' ? null : $text;
    }

    public static function format(array $row): array
    {
        return [
            'id'                         => $row['employee_key'],
            'employee_id'                => (int)$row['employee_id'],
            'name'                       => $row['name'],
            'email'                      => $row['email'] ?? '',
            'phone'                      => $row['phone'],
            'alternatePhone'             => $row['alternate_phone'] ?? '',
            'department'                 => $row['department'] ?? '',
            'designation'                => $row['designation'] ?? '',
            'employmentType'             => $row['employment_type'] ?? 'permanent',
            'baseSalary'                 => (float)$row['base_salary'],
            'joinedAt'                   => $row['joined_at'] ?? '',
            'communicationAddress'       => $row['communication_address'] ?? '',
            'permanentAddress'           => $row['permanent_address'] ?? '',
            'sameAsCommunicationAddress' => (bool)($row['same_as_communication_address'] ?? false),
            'aadhaarNumber'              => $row['aadhaar_number'] ?? '',
            'dob'                        => $row['dob'] ?? '',
            'bloodGroup'                 => $row['blood_group'] ?? '',
            'experience'                 => $row['experience'] ?? '',
            'relativesWorking'           => (bool)($row['relatives_working'] ?? false),
            'relativesDetails'           => $row['relatives_details'] ?? '',
            'qualifications'             => self::decodeQualifications($row['qualification_json'] ?? null),
            'bankAccountHolder'          => $row['bank_account_holder'] ?? '',
            'bankName'                   => $row['bank_name'] ?? '',
            'bankAccountNumber'          => $row['bank_account_number'] ?? '',
            'bankIfsc'                   => $row['bank_ifsc'] ?? '',
            'bankBranch'                 => $row['bank_branch'] ?? '',
            'pfEnabled'                  => (bool)($row['pf_enabled'] ?? true),
            'pfPercent'                  => (float)($row['pf_percent'] ?? 12),
            'bonusPercent'               => (float)($row['bonus_percent'] ?? 0),
            'attendanceBonusAmount'      => (float)($row['attendance_bonus_amount'] ?? 750),
            'defaultShiftId'             => isset($row['default_shift_id']) && $row['default_shift_id'] !== null ? (string)$row['default_shift_id'] : '',
            'esiEnabled'                 => (bool)($row['esi_enabled'] ?? false),
            'esiEmployeePercent'         => (float)($row['esi_employee_percent'] ?? 0.75),
            'siteAllowance'              => (float)($row['site_allowance'] ?? 0),
            'da'                         => (float)($row['da'] ?? 0),
            'foodAllowance'              => (float)($row['food_allowance'] ?? 0),
            'travelAllowance'            => (float)($row['travel_allowance'] ?? 0),
            'insurancePdfPath'           => $row['insurance_pdf_path'] ?? null,
            'insurancePdfName'           => $row['insurance_pdf_name'] ?? null,
            'uniformIssued'              => (bool)($row['uniform_issued'] ?? false),
            'uniformIssuedAt'            => $row['uniform_issued_at'] ?? '',
            'uniformValidUntil'          => $row['uniform_valid_until'] ?? '',
            'shoesIssued'                => (bool)($row['shoes_issued'] ?? false),
            'shoesIssuedAt'              => $row['shoes_issued_at'] ?? '',
            'shoesValidUntil'            => $row['shoes_valid_until'] ?? '',
            'photoPath'                  => $row['photo_path'] ?? null,
            'qrToken'                    => $row['qr_token'],
            'active'                     => (bool)$row['is_active'],
        ];
    }

    private static function boolValue(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        return in_array(strtolower(trim((string)$value)), ['1', 'true', 'yes', 'on'], true);
    }

    private static function decodeQualifications(?string $json): array
    {
        if (!$json) {
            return [];
        }
        $decoded = json_decode($json, true);
        return is_array($decoded) ? array_values($decoded) : [];
    }

    private static function updateMeetingEmployeeRefs(string $currentKey, string $newKey): void
    {
        $candidateColumns = ['attendees', 'participants', 'raci', 'raci_matrix', 'action_items'];
        try {
            $schemaRows = Database::fetchAll('SHOW COLUMNS FROM meetings', []);
        } catch (Throwable $e) {
            error_log('[Employee] Skipping meeting employee ID sync: ' . $e->getMessage());
            return;
        }

        $existingColumns = array_map(static fn(array $row) => (string)($row['Field'] ?? ''), $schemaRows);
        $jsonColumns = array_values(array_intersect($candidateColumns, $existingColumns));
        if (!$jsonColumns) {
            return;
        }

        $selectColumns = implode(', ', array_map(static fn(string $column) => "`{$column}`", $jsonColumns));
        $where = implode(' OR ', array_map(static fn(string $column) => "`{$column}` LIKE ?", $jsonColumns));
        $params = array_fill(0, count($jsonColumns), "%{$currentKey}%");

        $rows = Database::fetchAll(
            "SELECT meeting_id, {$selectColumns}
               FROM meetings
              WHERE {$where}",
            $params
        );

        foreach ($rows as $row) {
            $sets = [];
            $params = [];
            foreach ($jsonColumns as $column) {
                $raw = $row[$column] ?? null;
                if (!is_string($raw) || $raw === '' || !str_contains($raw, $currentKey)) {
                    continue;
                }
                $decoded = json_decode($raw, true);
                if (!is_array($decoded)) {
                    continue;
                }
                $updated = self::replaceEmployeeKeyInValue($decoded, $currentKey, $newKey);
                $sets[] = "`{$column}` = ?";
                $params[] = json_encode($updated, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
            }

            if (!$sets) {
                continue;
            }
            $params[] = $row['meeting_id'];
            Database::execute(
                'UPDATE meetings SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE meeting_id = ?',
                $params
            );
        }
    }

    private static function replaceEmployeeKeyInValue(mixed $value, string $currentKey, string $newKey): mixed
    {
        if (is_string($value)) {
            return $value === $currentKey ? $newKey : $value;
        }

        if (!is_array($value)) {
            return $value;
        }

        $replaced = [];
        foreach ($value as $key => $item) {
            $nextKey = is_string($key) && $key === $currentKey ? $newKey : $key;
            $replaced[$nextKey] = self::replaceEmployeeKeyInValue($item, $currentKey, $newKey);
        }
        return $replaced;
    }
}
