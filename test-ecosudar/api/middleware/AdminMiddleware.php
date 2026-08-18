<?php
declare(strict_types=1);

/**
 * AdminMiddleware — ensures the authenticated user has user_type = 'admin'.
 * Must be run AFTER AuthMiddleware has already attached $request->user.
 */
class AdminMiddleware
{
    private const STAFF_ROLES = ['owner', 'accountant', 'store_keeper', 'hr', 'sales'];

    public static function handle(Request $request, string $guard = 'admin'): void
    {
        if (($request->user['user_type'] ?? '') !== 'admin') {
            self::auditDenied($request, $guard, 'not_admin');
            Response::error('Admin access required', 403);
        }

        $allowedRoles = self::rolesFromGuard($guard);
        if (empty($allowedRoles)) {
            return;
        }

        $staffRole = self::staffRole($request);
        if (!$staffRole || !in_array($staffRole, $allowedRoles, true)) {
            self::auditDenied($request, $guard, $staffRole ?: 'missing_role');
            Response::error('Admin role not permitted. Required: ' . implode(', ', $allowedRoles), 403);
        }
    }

    public static function validStaffRoles(): array
    {
        return self::STAFF_ROLES;
    }

    public static function normalizeStaffRole(mixed $role): ?string
    {
        $role = strtolower(trim((string)$role));
        if ($role === '') {
            return null;
        }

        return in_array($role, self::STAFF_ROLES, true) ? $role : null;
    }

    private static function rolesFromGuard(string $guard): array
    {
        if (!str_contains($guard, ':')) {
            return [];
        }

        [, $roles] = explode(':', $guard, 2);
        return array_values(array_filter(array_map(
            fn(string $role): ?string => self::normalizeStaffRole($role),
            explode(',', $roles)
        )));
    }

    private static function staffRole(Request $request): ?string
    {
        $role = self::normalizeStaffRole($request->user['staff_role'] ?? null);
        if ($role !== null) {
            return $role;
        }

        // Existing admin accounts predate staff_role; treat them as owner until assigned.
        return ($request->user['user_type'] ?? '') === 'admin' ? 'owner' : null;
    }

    private static function auditDenied(Request $request, string $guard, string $reason): void
    {
        try {
            Database::execute(
                'INSERT INTO audit_log (user_id, action, table_name, old_value, new_value, ip_address, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, NOW())',
                [
                    isset($request->user['user_id']) ? (int)$request->user['user_id'] : null,
                    'permission_denied',
                    'auth',
                    json_encode(['guard' => $guard]),
                    json_encode(['reason' => $reason, 'path' => $request->path()]),
                    $request->ip(),
                ]
            );
        } catch (Throwable $e) {
            error_log('Permission denial audit failed: ' . $e->getMessage());
        }
    }
}
