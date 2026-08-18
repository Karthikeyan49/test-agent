<?php
declare(strict_types=1);

class AuthMiddleware
{
    /**
     * Validates the Bearer token. On success, attaches $request->user.
     * Returns 401 on any failure — no leaking of token vs user existence.
     */
    public static function handle(Request $request): void
    {
        $token = $request->bearerToken();

        if ($token === null) {
            Response::error('Authorization token required', 401);
        }

        $payload = JWT::decode($token);

        if ($payload === null) {
            Response::error('Token is invalid or has expired', 401);
        }

        if (($payload['type'] ?? '') !== 'access') {
            Response::error('Invalid token type — use an access token', 401);
        }

        // Check token is not blacklisted (revoked via logout)
        $revoked = Database::fetch(
            'SELECT id FROM revoked_tokens WHERE token_hash = ? LIMIT 1',
            [hash('sha256', $token)]
        );
        if ($revoked) {
            Response::error('Token has been revoked', 401);
        }

        // Verify user still exists and is active
        $user = Database::fetch(
            'SELECT ' . self::userColumns() . ' FROM users WHERE user_id = ? LIMIT 1',
            [(int)$payload['sub']]
        );

        if (!$user) {
            Response::error('User not found', 401);
        }

        if (!(bool)$user['is_active']) {
            Response::error('Account is inactive. Please contact support.', 403);
        }

        $request->user = $user;
    }

    private static function userColumns(): string
    {
        $columns = [
            'user_id',
            'name',
            'email',
            'phone',
            'user_type',
            'company_name',
            'address',
            'city',
            'state',
            'pincode',
            'gst_number',
            'is_active',
            'created_at',
        ];

        if (User::hasStaffRoleColumn()) {
            $columns[] = 'staff_role';
        }

        return implode(', ', $columns);
    }
}
