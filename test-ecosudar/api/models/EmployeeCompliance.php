<?php
declare(strict_types=1);

class EmployeeCompliance
{
    public const TYPES = ['insurance', 'esi', 'pf', 'license', 'medical'];
    public const STATUSES = ['active', 'expiring', 'expired'];

    public static function list(array $filters, int $page, int $limit): array
    {
        self::refreshStatuses(self::alertWindowDays());

        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['employee_key'])) {
            $where[] = 'c.employee_key = ?';
            $params[] = Employee::normalizeEmployeeKey($filters['employee_key'], true);
        }
        if (!empty($filters['type'])) {
            $type = self::normalizeType((string)$filters['type']);
            $where[] = 'c.type = ?';
            $params[] = $type;
        }
        if (!empty($filters['status'])) {
            $status = self::normalizeStatus((string)$filters['status']);
            $where[] = 'c.status = ?';
            $params[] = $status;
        }
        if (!empty($filters['expiry_from'])) {
            self::validateDate((string)$filters['expiry_from'], 'expiry_from');
            $where[] = 'c.expiry_date >= ?';
            $params[] = $filters['expiry_from'];
        }
        if (!empty($filters['expiry_to'])) {
            self::validateDate((string)$filters['expiry_to'], 'expiry_to');
            $where[] = 'c.expiry_date <= ?';
            $params[] = $filters['expiry_to'];
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count(
            "SELECT COUNT(*) AS cnt
             FROM employee_compliance c
             JOIN employees e ON e.employee_key = c.employee_key
             WHERE $whereClause",
            $params
        );
        $rows = Database::fetchAll(
            "SELECT c.*, e.name AS employee_name, e.department, e.designation,
                    a.file_path, a.original_name, a.mime_type, a.size_bytes
             FROM employee_compliance c
             JOIN employees e ON e.employee_key = c.employee_key
             LEFT JOIN attachments a ON a.attachment_id = c.attachment_id
             WHERE $whereClause
             ORDER BY c.expiry_date ASC, c.compliance_id DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        return [
            'rows' => array_map([self::class, 'format'], $rows),
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => (int)ceil($total / $limit),
            ],
            'summary' => self::summary(),
        ];
    }

    public static function forEmployee(string $employeeKey): array
    {
        $employeeKey = Employee::normalizeEmployeeKey($employeeKey, true);
        self::requireEmployee($employeeKey);

        return self::list(['employee_key' => $employeeKey], 1, 100)['rows'];
    }

    public static function find(int $id): ?array
    {
        $row = Database::fetch(
            "SELECT c.*, e.name AS employee_name, e.department, e.designation,
                    a.file_path, a.original_name, a.mime_type, a.size_bytes
             FROM employee_compliance c
             JOIN employees e ON e.employee_key = c.employee_key
             LEFT JOIN attachments a ON a.attachment_id = c.attachment_id
             WHERE c.compliance_id = ?
             LIMIT 1",
            [$id]
        );

        return $row ? self::format($row) : null;
    }

    public static function create(string $employeeKey, array $data, ?array $file, ?int $actorId): array
    {
        $employeeKey = Employee::normalizeEmployeeKey($employeeKey, true);
        self::requireEmployee($employeeKey);
        $clean = self::cleanPayload($data, true);
        $storedFile = null;

        Database::beginTransaction();
        try {
            $id = Database::insert(
                'INSERT INTO employee_compliance
                    (employee_key, type, provider, policy_number, coverage_amount, premium,
                     start_date, expiry_date, status, notes, created_by, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                [
                    $employeeKey,
                    $clean['type'],
                    $clean['provider'],
                    $clean['policy_number'],
                    $clean['coverage_amount'],
                    $clean['premium'],
                    $clean['start_date'],
                    $clean['expiry_date'],
                    self::statusForExpiry($clean['expiry_date'], self::alertWindowDays()),
                    $clean['notes'],
                    $actorId,
                ]
            );

            if ($file !== null) {
                $storedFile = FileStore::put('employee_doc', $file, 'employees');
                $attachmentId = FileStore::createAttachment('employee_compliance', $id, 'employee_doc', $storedFile, $actorId);
                Database::execute(
                    'UPDATE employee_compliance SET attachment_id = ?, updated_at = NOW() WHERE compliance_id = ?',
                    [$attachmentId, $id]
                );
            }

            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            if ($storedFile !== null) {
                FileStore::deleteLocal((string)$storedFile['file_path']);
            }
            error_log('Compliance create failed: ' . $e->getMessage());
            Response::error('Could not create compliance record', 500);
        }

        return self::find($id);
    }

    public static function update(int $id, array $data, ?array $file, ?int $actorId): array
    {
        $existing = self::raw($id);
        if (!$existing) {
            Response::error('Compliance record not found', 404);
        }

        $clean = self::cleanPayload($data, false);
        $storedFile = null;
        $oldAttachment = null;

        Database::beginTransaction();
        try {
            if (!empty($clean)) {
                $sets = [];
                $params = [];
                foreach ($clean as $field => $value) {
                    $sets[] = "$field = ?";
                    $params[] = $value;
                }
                if (array_key_exists('expiry_date', $clean)) {
                    $sets[] = 'status = ?';
                    $params[] = self::statusForExpiry((string)$clean['expiry_date'], self::alertWindowDays());
                }
                $params[] = $id;
                Database::execute(
                    'UPDATE employee_compliance SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE compliance_id = ?',
                    $params
                );
            }

            if ($file !== null) {
                $oldAttachment = self::attachmentForRecord($id);
                $storedFile = FileStore::put('employee_doc', $file, 'employees');
                $attachmentId = FileStore::createAttachment('employee_compliance', $id, 'employee_doc', $storedFile, $actorId);
                Database::execute(
                    'UPDATE employee_compliance SET attachment_id = ?, updated_at = NOW() WHERE compliance_id = ?',
                    [$attachmentId, $id]
                );
                if ($oldAttachment) {
                    Database::execute('DELETE FROM attachments WHERE attachment_id = ?', [(int)$oldAttachment['attachment_id']]);
                }
            }

            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            if ($storedFile !== null) {
                FileStore::deleteLocal((string)$storedFile['file_path']);
            }
            error_log('Compliance update failed: ' . $e->getMessage());
            Response::error('Could not update compliance record', 500);
        }

        if ($oldAttachment && ($oldAttachment['storage_disk'] ?? 'local') === 'local') {
            FileStore::deleteLocal((string)$oldAttachment['file_path']);
        }

        return self::find($id);
    }

    public static function delete(int $id): void
    {
        $existing = self::raw($id);
        if (!$existing) {
            Response::error('Compliance record not found', 404);
        }
        $attachment = self::attachmentForRecord($id);

        Database::beginTransaction();
        try {
            Database::execute('DELETE FROM employee_compliance WHERE compliance_id = ?', [$id]);
            if ($attachment) {
                Database::execute('DELETE FROM attachments WHERE attachment_id = ?', [(int)$attachment['attachment_id']]);
            }
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Compliance delete failed: ' . $e->getMessage());
            Response::error('Could not delete compliance record', 500);
        }

        if ($attachment && ($attachment['storage_disk'] ?? 'local') === 'local') {
            FileStore::deleteLocal((string)$attachment['file_path']);
        }
    }

    public static function expiring(int $days): array
    {
        $days = max(0, min(365, $days));
        self::refreshStatuses($days);

        $rows = Database::fetchAll(
            "SELECT c.*, e.name AS employee_name, e.department, e.designation,
                    a.file_path, a.original_name, a.mime_type, a.size_bytes
             FROM employee_compliance c
             JOIN employees e ON e.employee_key = c.employee_key
             LEFT JOIN attachments a ON a.attachment_id = c.attachment_id
             WHERE c.expiry_date <= DATE_ADD(CURDATE(), INTERVAL {$days} DAY)
             ORDER BY c.expiry_date ASC, c.compliance_id DESC"
        );

        return [
            'days' => $days,
            'records' => array_map([self::class, 'format'], $rows),
            'summary' => self::summary(),
        ];
    }

    public static function attachmentForRecord(int $id): ?array
    {
        return Database::fetch(
            'SELECT a.*
             FROM employee_compliance c
             JOIN attachments a ON a.attachment_id = c.attachment_id
             WHERE c.compliance_id = ?
             LIMIT 1',
            [$id]
        );
    }

    public static function refreshStatuses(int $days): int
    {
        $days = max(0, min(365, $days));
        return Database::execute(
            "UPDATE employee_compliance
             SET status = CASE
                WHEN expiry_date < CURDATE() THEN 'expired'
                WHEN expiry_date <= DATE_ADD(CURDATE(), INTERVAL {$days} DAY) THEN 'expiring'
                ELSE 'active'
             END"
        );
    }

    public static function alertWindowDays(): int
    {
        $row = Database::fetch(
            "SELECT setting_value FROM settings WHERE setting_key = 'compliance_expiry_alert_days' LIMIT 1"
        );
        $days = (int)($row['setting_value'] ?? 30);
        return max(1, min(365, $days));
    }

    private static function raw(int $id): ?array
    {
        return Database::fetch('SELECT * FROM employee_compliance WHERE compliance_id = ? LIMIT 1', [$id]);
    }

    private static function summary(): array
    {
        $byStatus = Database::fetchAll(
            'SELECT status, COUNT(*) AS count, COALESCE(SUM(coverage_amount), 0) AS coverage_amount,
                    COALESCE(SUM(premium), 0) AS premium
             FROM employee_compliance
             GROUP BY status
             ORDER BY status ASC'
        );
        $byType = Database::fetchAll(
            'SELECT type, COUNT(*) AS count, COALESCE(SUM(coverage_amount), 0) AS coverage_amount,
                    COALESCE(SUM(premium), 0) AS premium
             FROM employee_compliance
             GROUP BY type
             ORDER BY type ASC'
        );

        return [
            'alert_window_days' => self::alertWindowDays(),
            'by_status' => self::numericRows($byStatus),
            'by_type' => self::numericRows($byType),
        ];
    }

    private static function cleanPayload(array $data, bool $creating): array
    {
        $allowed = ['type', 'provider', 'policy_number', 'coverage_amount', 'premium', 'start_date', 'expiry_date', 'notes'];
        $clean = [];
        foreach ($allowed as $field) {
            if (array_key_exists($field, $data)) {
                $clean[$field] = $data[$field];
            }
        }

        if ($creating) {
            foreach (['type', 'expiry_date'] as $required) {
                if (trim((string)($clean[$required] ?? '')) === '') {
                    Response::error("{$required} is required", 422);
                }
            }
        }

        if (array_key_exists('type', $clean)) {
            $clean['type'] = self::normalizeType((string)$clean['type']);
        }
        foreach (['provider', 'policy_number', 'notes'] as $field) {
            if (array_key_exists($field, $clean)) {
                $text = trim((string)($clean[$field] ?? ''));
                $clean[$field] = $text === '' ? null : Request::sanitize($text);
            }
        }
        foreach (['coverage_amount', 'premium'] as $field) {
            if (array_key_exists($field, $clean)) {
                $clean[$field] = round(max(0, (float)$clean[$field]), 2);
            } elseif ($creating) {
                $clean[$field] = 0.0;
            }
        }
        foreach (['start_date', 'expiry_date'] as $field) {
            if (array_key_exists($field, $clean)) {
                $value = trim((string)($clean[$field] ?? ''));
                if ($value === '') {
                    $clean[$field] = null;
                } else {
                    self::validateDate($value, $field);
                    $clean[$field] = $value;
                }
            }
        }
        if ($creating && empty($clean['expiry_date'])) {
            Response::error('expiry_date is required', 422);
        }

        return $clean;
    }

    private static function normalizeType(string $type): string
    {
        $type = strtolower(trim($type));
        if (!in_array($type, self::TYPES, true)) {
            Response::error('type must be one of: ' . implode(', ', self::TYPES), 422);
        }
        return $type;
    }

    private static function normalizeStatus(string $status): string
    {
        $status = strtolower(trim($status));
        if (!in_array($status, self::STATUSES, true)) {
            Response::error('status must be one of: ' . implode(', ', self::STATUSES), 422);
        }
        return $status;
    }

    private static function statusForExpiry(string $expiryDate, int $days): string
    {
        $today = new DateTime(date('Y-m-d'));
        $expiry = new DateTime($expiryDate);
        if ($expiry < $today) {
            return 'expired';
        }
        $diff = (int)$today->diff($expiry)->format('%a');
        return $diff <= $days ? 'expiring' : 'active';
    }

    private static function requireEmployee(string $employeeKey): array
    {
        $employee = Employee::findByKey($employeeKey);
        if (!$employee) {
            Response::error('Employee not found', 404);
        }
        return $employee;
    }

    private static function validateDate(string $value, string $name): void
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) || !strtotime($value)) {
            Response::error("{$name} must be YYYY-MM-DD", 422);
        }
    }

    private static function numericRows(array $rows): array
    {
        foreach ($rows as &$row) {
            foreach ($row as $key => $value) {
                if ($value === null) {
                    continue;
                }
                if ($key === 'count') {
                    $row[$key] = (int)$value;
                } elseif (is_numeric($value)) {
                    $row[$key] = (float)$value;
                }
            }
        }
        return $rows;
    }

    private static function format(array $row): array
    {
        $expiry = (string)$row['expiry_date'];
        $daysLeft = (int)((new DateTime(date('Y-m-d')))->diff(new DateTime($expiry))->format('%r%a'));
        return [
            'compliance_id' => (int)$row['compliance_id'],
            'id' => (string)$row['compliance_id'],
            'employee_key' => $row['employee_key'],
            'employee_name' => $row['employee_name'] ?? null,
            'department' => $row['department'] ?? null,
            'designation' => $row['designation'] ?? null,
            'type' => $row['type'],
            'provider' => $row['provider'],
            'policy_number' => $row['policy_number'],
            'coverage_amount' => (float)$row['coverage_amount'],
            'premium' => (float)$row['premium'],
            'start_date' => $row['start_date'],
            'expiry_date' => $expiry,
            'days_to_expiry' => $daysLeft,
            'status' => $row['status'],
            'notes' => $row['notes'],
            'attachment_id' => $row['attachment_id'] ? (int)$row['attachment_id'] : null,
            'document' => $row['attachment_id'] ? [
                'attachment_id' => (int)$row['attachment_id'],
                'download_url' => '/api/admin/attachments/' . (int)$row['attachment_id'] . '/download',
                'file_path' => $row['file_path'] ?? null,
                'original_name' => $row['original_name'] ?? null,
                'mime_type' => $row['mime_type'] ?? null,
                'size_bytes' => isset($row['size_bytes']) ? (int)$row['size_bytes'] : null,
            ] : null,
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
    }
}
