<?php
declare(strict_types=1);

class User
{
    // Safe public fields — never include password_hash in API responses
    private const BASE_PUBLIC_FIELDS = 'user_id, name, email, phone, alternate_phone, user_type, company_name,
        address, city, state, pincode, gst_number, udyam_number, is_active, approval_status, created_at, updated_at';

    /**
     * @throws AppException
     */
    public static function create(array $data): int
    {
        if (self::existsByPhone($data['phone'])) {
            throw new AppException('Phone number already registered', 409);
        }
        if (self::existsByEmail($data['email'])) {
            throw new AppException('Email address already registered', 409);
        }

        return Database::insert(
            'INSERT INTO users
                (name, email, phone, alternate_phone, user_type, company_name, address, city, state, pincode, gst_number, udyam_number, password_hash, is_active, approval_status, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                Request::sanitize($data['name']),
                strtolower(trim($data['email'])),
                preg_replace('/\D/', '', $data['phone']), // digits only
                isset($data['alternate_phone']) && $data['alternate_phone'] !== '' ? preg_replace('/\D/', '', $data['alternate_phone']) : null,
                strtolower($data['user_type']),           // customer | dealer
                isset($data['company_name']) ? Request::sanitize($data['company_name']) : null,
                isset($data['address'])      ? Request::sanitize($data['address'])      : null,
                isset($data['city'])         ? Request::sanitize($data['city'])         : null,
                isset($data['state'])        ? Request::sanitize($data['state'])        : null,
                isset($data['pincode'])      ? Request::sanitize($data['pincode'])      : null,
                isset($data['gst_number'])   ? strtoupper(trim($data['gst_number']))   : null,
                isset($data['udyam_number']) ? strtoupper(trim($data['udyam_number'])) : null,
                password_hash($data['password'], PASSWORD_BCRYPT, ['cost' => BCRYPT_COST]),
                $data['is_active'] ?? true, // Support default true or explicit false
                $data['approval_status'] ?? 'approved', // Default 'approved' for backwards compatibility, fallback for 'pending'
            ]
        );
    }

    public static function findById(int $id): ?array
    {
        return Database::fetch(
            'SELECT ' . self::publicFields() . ' FROM users WHERE user_id = ? LIMIT 1',
            [$id]
        );
    }

    public static function findByPhone(string $phone): ?array
    {
        $digits = preg_replace('/\D/', '', $phone);
        return Database::fetch(
            'SELECT * FROM users WHERE phone = ? LIMIT 1',
            [$digits]
        );
    }

    public static function findByEmail(string $email): ?array
    {
        return Database::fetch(
            'SELECT * FROM users WHERE email = ? LIMIT 1',
            [strtolower(trim($email))]
        );
    }

    public static function existsByPhone(string $phone): bool
    {
        $digits = preg_replace('/\D/', '', $phone);
        return Database::fetch('SELECT user_id FROM users WHERE phone = ? LIMIT 1', [$digits]) !== null;
    }

    public static function existsByEmail(string $email): bool
    {
        return Database::fetch('SELECT user_id FROM users WHERE email = ? LIMIT 1', [strtolower(trim($email))]) !== null;
    }

    public static function existsByPhoneExcluding(string $phone, int $excludeUserId): bool
    {
        $digits = preg_replace('/\D/', '', $phone);
        return Database::fetch('SELECT user_id FROM users WHERE phone = ? AND user_id != ? LIMIT 1', [$digits, $excludeUserId]) !== null;
    }

    public static function existsByEmailExcluding(string $email, int $excludeUserId): bool
    {
        return Database::fetch('SELECT user_id FROM users WHERE email = ? AND user_id != ? LIMIT 1', [strtolower(trim($email)), $excludeUserId]) !== null;
    }

    public static function verifyPassword(string $plain, string $hash): bool
    {
        return password_verify($plain, $hash);
    }

    /**
     * @throws AppException
     */
    public static function update(int $userId, array $data): void
    {
        $allowed = ['name', 'email', 'phone', 'alternate_phone', 'company_name', 'address', 'city', 'state', 'pincode', 'gst_number', 'udyam_number'];
        if (self::hasStaffRoleColumn()) {
            $allowed[] = 'staff_role';
        }
        $fields  = [];
        $values  = [];

        foreach ($allowed as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $fields[] = "$field = ?";
            $values[] = match ($field) {
                'email'           => strtolower(trim((string)$data[$field])),
                'phone'           => preg_replace('/\D/', '', (string)$data[$field]),
                'alternate_phone' => $data[$field] !== null && $data[$field] !== '' ? preg_replace('/\D/', '', (string)$data[$field]) : null,
                'staff_role'      => $data[$field] === null ? null : AdminMiddleware::normalizeStaffRole($data[$field]),
                'gst_number'      => strtoupper(trim((string)$data[$field])),
                'udyam_number'    => strtoupper(trim((string)$data[$field])),
                default           => Request::sanitize((string)$data[$field]),
            };
        }

        if (empty($fields)) {
            throw new AppException('No valid fields provided to update', 400);
        }

        $values[] = $userId;
        Database::execute(
            'UPDATE users SET ' . implode(', ', $fields) . ', updated_at = NOW() WHERE user_id = ?',
            $values
        );
    }

    public static function updatePassword(int $userId, string $newPassword): void
    {
        Database::execute(
            'UPDATE users SET password_hash = ?, updated_at = NOW() WHERE user_id = ?',
            [password_hash($newPassword, PASSWORD_BCRYPT, ['cost' => BCRYPT_COST]), $userId]
        );
    }

    /**
     * Soft-deactivate — marks is_active = FALSE. Data preserved.
     */
    public static function deactivate(int $userId): void
    {
        Database::execute(
            'UPDATE users SET is_active = FALSE, updated_at = NOW() WHERE user_id = ?',
            [$userId]
        );
    }

    /**
     * Strips password_hash from a full DB row before returning to client.
     */
    public static function sanitizeForResponse(array $user): array
    {
        unset($user['password_hash']);
        $user['is_active'] = (bool)$user['is_active'];
        return $user;
    }

    public static function publicFields(): string
    {
        return self::BASE_PUBLIC_FIELDS . (self::hasStaffRoleColumn() ? ', staff_role' : '');
    }

    public static function hasStaffRoleColumn(): bool
    {
        static $hasColumn = null;
        if ($hasColumn !== null) {
            return $hasColumn;
        }

        try {
            $hasColumn = Database::fetch("SHOW COLUMNS FROM users LIKE 'staff_role'") !== null;
        } catch (Throwable $e) {
            $hasColumn = false;
        }

        return $hasColumn;
    }
}
