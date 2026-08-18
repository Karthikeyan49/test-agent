<?php
declare(strict_types=1);

/**
 * Admin User Controller
 * GET    /admin/users              — List all users (paginated, searchable)
 * GET    /admin/users/{id}/stats  — Per-status order breakdown for one user
 * POST   /admin/users              — Create a dealer/customer as admin
 * PUT    /admin/users/{id}         — Update any user's profile
 * PUT    /admin/users/{id}/status  — Activate / deactivate a user
 * DELETE /admin/users/{id}         — Soft-deactivate a user (preserves order history)
 */
class AdminUserController
{
    // ─── GET /admin/users ────────────────────────────────────────────────────

    public function index(Request $request): void
    {
        $page = max(1, (int) $request->query('page', 1));
        $limit = min(100, max(1, (int) $request->query('limit', 20)));

        $where = ['1=1'];
        $params = [];

        // Filter by user_type
        $userType = $request->query('user_type');
        if ($userType && in_array($userType, ['customer', 'dealer', 'admin'], true)) {
            $where[] = 'u.user_type = ?';
            $params[] = $userType;
        }

        // Filter by is_active
        $isActive = $request->query('is_active');
        if ($isActive !== null && $isActive !== '') {
            $where[] = 'u.is_active = ?';
            $params[] = $isActive === 'false' ? 0 : 1;
        }

        $staffRole = $request->query('staff_role');
        if ($staffRole !== null && $staffRole !== '' && User::hasStaffRoleColumn()) {
            $staffRole = AdminMiddleware::normalizeStaffRole($staffRole);
            if ($staffRole === null) {
                Response::error('Invalid staff_role', 422);
            }
            $where[] = 'u.staff_role = ?';
            $params[] = $staffRole;
        }

        // Search name / email / phone
        $search = $request->query('search');
        if ($search && trim($search) !== '') {
            $like = '%' . trim($search) . '%';
            $where[] = '(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ?)';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        // Sort
        $allowedSort = ['created_at' => 'u.created_at', 'name' => 'u.name', 'total_orders' => 'total_orders'];
        $sortField = $allowedSort[$request->query('sort', 'created_at')] ?? 'u.created_at';
        $sortDir = strtoupper($request->query('order', 'desc')) === 'ASC' ? 'ASC' : 'DESC';

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM users u WHERE $whereClause", $params);
        $offset = ($page - 1) * $limit;
        $staffRoleSelect = User::hasStaffRoleColumn() ? 'u.staff_role,' : 'NULL AS staff_role,';

        $rows = Database::fetchAll(
            "SELECT u.user_id, u.name, u.email, u.phone, u.user_type,
                    $staffRoleSelect
                    u.company_name, u.address, u.city, u.state, u.pincode,
                    u.udyam_number, u.gst_number, u.is_active, u.created_at,
                    COUNT(DISTINCT o.order_id)       AS total_orders,
                    COALESCE(SUM(o.total_amount), 0) AS total_spent
             FROM users u
             LEFT JOIN orders o ON o.user_id = u.user_id
             WHERE $whereClause
             GROUP BY u.user_id
             ORDER BY $sortField $sortDir
             LIMIT ? OFFSET ?",
            [...$params, $limit, $offset]
        );

        foreach ($rows as &$r) {
            $r['is_active'] = (bool) $r['is_active'];
            $r['total_orders'] = (int) $r['total_orders'];
            $r['total_spent'] = (float) $r['total_spent'];
        }

        Response::paginated($rows, [
            'page' => $page,
            'limit' => $limit,
            'total' => $total,
            'total_pages' => (int) ceil($total / $limit),
        ]);
    }

    // ─── POST /admin/users ───────────────────────────────────────────────────

    public function store(Request $request): void
    {
        Validator::make($request->only(['name', 'phone', 'password', 'user_type']), [
            'user_type' => 'required|in:customer,dealer',
            'name' => 'required|string|min:2|max:100',
            'phone' => 'required|phone',
            'password' => 'required|min:6|max:72',
        ])->validate();

        $phone = preg_replace('/\D/', '', (string) $request->input('phone'));
        $rawEmail = trim((string) ($request->input('email') ?? ''));
        $hasEmail = $rawEmail !== '';
        $email = $hasEmail ? $rawEmail : $phone . '@noemail.ecosudar.local';

        $name = (string) $request->input('name');
        $rawPassword = (string) $request->input('password');
        $userType = (string) $request->input('user_type');
        $companyName = (string) ($request->input('company_name') ?? '');

        try {
            $userId = User::create([
                'name' => $name,
                'email' => $email,
                'phone' => $phone,
                'user_type' => $userType,
                'company_name' => $request->input('company_name'),
                'address' => $request->input('address'),
                'city' => $request->input('city'),
                'state' => $request->input('state'),
                'pincode' => $request->input('pincode'),
                'gst_number' => $request->input('gst_number'),
                'udyam_number' => $request->input('udyam_number'),
                'alternate_phone' => $request->input('alternate_phone'),
                'password' => $rawPassword,
            ]);
        } catch (AppException $e) {
            Response::error($e->getMessage(), $e->getCode());
        }

        $user = User::findById($userId);

        // ── Send credential emails ──────────────────────────────────────────
        $adminEmail = $request->user['email'] ?? 'admin@ecosudar.com';
        $displayType = ucfirst($userType);
        $headers = "MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nFrom: Eco Sudar <noreply@ecosudar.com>\r\n";

        // Email to the dealer (only when a real email was provided)
        if ($hasEmail) {
            $dealerSubject = "Welcome to Eco Sudar – Your Login Credentials";
            $dealerBody = self::credentialEmailBody($name, $phone, $rawPassword, $companyName, $displayType, false);
            @mail($rawEmail, $dealerSubject, $dealerBody, $headers);
        }

        // Notification copy to admin
        $adminSubject = "New {$displayType} Added – {$name}";
        $adminBody = self::credentialEmailBody($name, $phone, $rawPassword, $companyName, $displayType, true);
        @mail($adminEmail, $adminSubject, $adminBody, $headers);

        Response::success(
            array_merge(User::sanitizeForResponse($user), ['email_sent' => $hasEmail]),
            'User created successfully',
            201
        );
    }

    private static function credentialEmailBody(
        string $name,
        string $phone,
        string $password,
        string $companyName,
        string $userType,
        bool $isAdminCopy
    ): string {
        $title = $isAdminCopy ? "New {$userType} Account Created" : "Welcome to Eco Sudar";
        $intro = $isAdminCopy
            ? "A new {$userType} account has been created. Here are the details:"
            : "Your {$userType} account on the Eco Sudar platform is ready. Use the credentials below to log in to the mobile app.";
        $company = $companyName ? "<tr><td style='padding:6px 0;color:#6b7280;'>Business Name</td><td style='padding:6px 0;font-weight:600;'>" . htmlspecialchars($companyName) . "</td></tr>" : '';

        return <<<HTML
        <!DOCTYPE html>
        <html>
        <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
            <tr><td align="center">
              <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
                <tr>
                  <td style="background:#16a34a;padding:28px 36px;">
                    <h1 style="margin:0;color:#ffffff;font-size:22px;">Eco Sudar</h1>
                    <p style="margin:4px 0 0;color:#bbf7d0;font-size:13px;">Bio Energy LLP</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <h2 style="margin:0 0 8px;color:#111827;font-size:18px;">{$title}</h2>
                    <p style="margin:0 0 24px;color:#4b5563;font-size:14px;line-height:1.6;">{$intro}</p>
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:16px 20px;font-size:14px;">
                      <tr><td style="padding:6px 0;color:#6b7280;">Name</td><td style="padding:6px 0;font-weight:600;">{$name}</td></tr>
                      {$company}
                      <tr><td style="padding:6px 0;color:#6b7280;">Login (Phone)</td><td style="padding:6px 0;font-weight:600;font-family:monospace;">{$phone}</td></tr>
                      <tr><td style="padding:6px 0;color:#6b7280;">Password</td><td style="padding:6px 0;font-weight:600;font-family:monospace;">{$password}</td></tr>
                    </table>
                    <p style="margin:20px 0 0;color:#6b7280;font-size:12px;">Please change your password after first login. Do not share these credentials.</p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;">© Eco Sudar Bio Energy LLP · This is an automated message, please do not reply.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body>
        </html>
HTML;
    }

    // ─── PUT /admin/users/{id} ───────────────────────────────────────────────

    public function update(Request $request): void
    {
        $userId = (int) $request->param('id');
        if ($userId <= 0) {
            Response::error('Invalid user ID', 400);
        }

        $staffRoleSelect = User::hasStaffRoleColumn() ? ', staff_role' : '';
        $existing = Database::fetch("SELECT user_id, user_type{$staffRoleSelect} FROM users WHERE user_id = ? LIMIT 1", [$userId]);
        if (!$existing) {
            Response::error('User not found', 404);
        }

        $newPassword = trim((string) ($request->input('new_password') ?? ''));
        $input = $request->only(['name', 'email', 'phone', 'alternate_phone', 'company_name', 'address', 'city', 'state', 'pincode', 'gst_number', 'udyam_number', 'staff_role']);

        if (empty($input) && $newPassword === '') {
            Response::error('Provide at least one field to update', 400);
        }

        if (array_key_exists('staff_role', $input)) {
            if (!User::hasStaffRoleColumn()) {
                Response::error('staff_role migration has not been applied', 500);
            }
            if (($existing['user_type'] ?? '') !== 'admin') {
                Response::error('staff_role only applies to admin users', 422);
            }

            $normalizedRole = AdminMiddleware::normalizeStaffRole($input['staff_role']);
            if ($normalizedRole === null) {
                Response::error('staff_role must be one of: ' . implode(', ', AdminMiddleware::validStaffRoles()), 422);
            }
            $input['staff_role'] = $normalizedRole;
        }

        if (!empty($input)) {
            Validator::make($input, [
                'name' => 'string|min:2|max:100',
                'email' => 'email|max:100',
                'phone' => 'phone',
                'company_name' => 'string|max:150',
                'address' => 'string|max:500',
                'city' => 'string|max:50',
                'state' => 'string|max:50',
                'pincode' => 'string|max:10',
                'gst_number' => 'gst',
                'udyam_number' => 'string|max:50',
                'staff_role' => 'string|in:owner,accountant,store_keeper,hr,sales',
            ])->validate();

            if (isset($input['email']) && User::existsByEmailExcluding($input['email'], $userId)) {
                Response::error('Email already in use by another user', 409);
            }
            if (isset($input['phone']) && User::existsByPhoneExcluding($input['phone'], $userId)) {
                Response::error('Phone number already in use by another user', 409);
            }

            try {
                $beforeStaffRole = $existing['staff_role'] ?? null;
                User::update($userId, $input);
                if (array_key_exists('staff_role', $input) && $beforeStaffRole !== $input['staff_role']) {
                    $this->auditStaffRoleChange(
                        (int)($request->user['user_id'] ?? 0),
                        $userId,
                        $beforeStaffRole,
                        $input['staff_role'],
                        $request->ip()
                    );
                }
            } catch (AppException $e) {
                Response::error($e->getMessage(), $e->getCode());
            }
        }

        // Handle password change
        if ($newPassword !== '') {
            if (strlen($newPassword) < 6) {
                Response::error('New password must be at least 6 characters', 422);
            }
            User::updatePassword($userId, $newPassword);

            // Notify admin of password change
            $updated = User::findById($userId);
            $adminEmail = $request->user['email'] ?? 'admin@ecosudar.com';
            $dealerName = $updated['name'] ?? 'Dealer';
            $dealerPhone = $updated['phone'] ?? '';
            $dealerEmail = $updated['email'] ?? '';
            $hasRealEmail = !str_ends_with($dealerEmail, '@noemail.ecosudar.local');
            $headers = "MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nFrom: Eco Sudar <noreply@ecosudar.com>\r\n";

            // Notify the dealer if they have a real email
            if ($hasRealEmail) {
                $body = self::passwordChangedEmailBody($dealerName, $dealerPhone, $newPassword, false);
                @mail($dealerEmail, 'Your Eco Sudar Login Password Has Been Changed', $body, $headers);
            }

            // Always notify admin
            $adminBody = self::passwordChangedEmailBody($dealerName, $dealerPhone, $newPassword, true);
            @mail($adminEmail, "Password Changed – {$dealerName}", $adminBody, $headers);
        }

        Response::success(User::sanitizeForResponse(User::findById($userId)), 'User updated successfully');
    }

    private function auditStaffRoleChange(int $actorId, int $targetUserId, ?string $before, string $after, string $ip): void
    {
        try {
            Database::execute(
                'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, ip_address, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
                [
                    $actorId ?: null,
                    'staff_role_changed',
                    'users',
                    $targetUserId,
                    json_encode(['staff_role' => $before]),
                    json_encode(['staff_role' => $after]),
                    $ip,
                ]
            );
        } catch (Throwable $e) {
            error_log('Staff role audit failed: ' . $e->getMessage());
        }
    }

    private static function passwordChangedEmailBody(
        string $name,
        string $phone,
        string $newPassword,
        bool $isAdminCopy
    ): string {
        $title = $isAdminCopy ? "Dealer Password Changed" : "Your Password Has Been Updated";
        $intro = $isAdminCopy
            ? "An admin has changed the login password for the following dealer:"
            : "Your login password on the Eco Sudar platform has been updated by an admin. Use the new credentials below.";

        return <<<HTML
        <!DOCTYPE html>
        <html>
        <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
            <tr><td align="center">
              <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
                <tr>
                  <td style="background:#16a34a;padding:28px 36px;">
                    <h1 style="margin:0;color:#ffffff;font-size:22px;">Eco Sudar</h1>
                    <p style="margin:4px 0 0;color:#bbf7d0;font-size:13px;">Bio Energy LLP</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <h2 style="margin:0 0 8px;color:#111827;font-size:18px;">{$title}</h2>
                    <p style="margin:0 0 24px;color:#4b5563;font-size:14px;line-height:1.6;">{$intro}</p>
                    <table width="100%" cellpadding="0" cellspacing="0" style="background:#f9fafb;border-radius:8px;padding:16px 20px;font-size:14px;">
                      <tr><td style="padding:6px 0;color:#6b7280;">Name</td><td style="padding:6px 0;font-weight:600;">{$name}</td></tr>
                      <tr><td style="padding:6px 0;color:#6b7280;">Login (Phone)</td><td style="padding:6px 0;font-weight:600;font-family:monospace;">{$phone}</td></tr>
                      <tr><td style="padding:6px 0;color:#6b7280;">New Password</td><td style="padding:6px 0;font-weight:600;font-family:monospace;">{$newPassword}</td></tr>
                    </table>
                    <p style="margin:20px 0 0;color:#6b7280;font-size:12px;">Please change your password after logging in. Do not share these credentials.</p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;">© Eco Sudar Bio Energy LLP · This is an automated message, please do not reply.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body>
        </html>
HTML;
    }

    // ─── PUT /admin/users/{id}/status ────────────────────────────────────────

    public function updateStatus(Request $request): void
    {
        $userId = (int) $request->param('id');
        if ($userId <= 0) {
            Response::error('Invalid user ID', 400);
        }

        Validator::make($request->only(['is_active']), [
            'is_active' => 'required',
        ])->validate();

        $isActive = filter_var($request->input('is_active'), FILTER_VALIDATE_BOOLEAN, FILTER_NULL_ON_FAILURE);
        if ($isActive === null) {
            Response::error('is_active must be true or false', 422);
        }

        $user = Database::fetch('SELECT user_id, user_type FROM users WHERE user_id = ? LIMIT 1', [$userId]);
        if (!$user) {
            Response::error('User not found', 404);
        }
        if ($user['user_type'] === 'admin') {
            Response::error('Cannot deactivate another admin account', 403);
        }

        Database::execute(
            'UPDATE users SET is_active = ?, updated_at = NOW() WHERE user_id = ?',
            [(int) $isActive, $userId]
        );

        // ── Session revocation on deactivation ──────────────────────────────
        // When a user is deactivated, immediately invalidate all their active
        // sessions so the mobile app cannot silently refresh and stay logged in.
        if (!$isActive) {
            // 1. Delete all refresh tokens → next token refresh returns 401
            Database::execute(
                'DELETE FROM refresh_tokens WHERE user_id = ?',
                [$userId]
            );
        }
        // Note: existing access tokens for this user will be rejected by
        // AuthMiddleware on the very next API call because it re-checks
        // is_active from the DB on every request.
        // ────────────────────────────────────────────────────────────────────

        Response::success(['user_id' => $userId, 'is_active' => $isActive], 'User status updated');
    }

    // ─── GET /admin/users/{id}/stats ─────────────────────────────────────────
    // Returns per-status order breakdown for a single user.

    public function orderStats(Request $request): void
    {
        $userId = (int) $request->param('id');
        if ($userId <= 0) {
            Response::error('Invalid user ID', 400);
        }

        $user = Database::fetch('SELECT user_id FROM users WHERE user_id = ? LIMIT 1', [$userId]);
        if (!$user) {
            Response::error('User not found', 404);
        }

        // Aggregate order counts by status and total spent in one query
        $rows = Database::fetchAll(
            "SELECT order_status, COUNT(*) AS cnt, COALESCE(SUM(total_amount), 0) AS spent
             FROM orders
             WHERE user_id = ?
             GROUP BY order_status",
            [$userId]
        );

        // Build a status → count map
        $byStatus = [];
        $totalSpent = 0.0;
        foreach ($rows as $r) {
            $byStatus[strtolower($r['order_status'])] = (int) $r['cnt'];
            $totalSpent += (float) $r['spent'];
        }

        $activeStatuses = ['pending', 'confirmed', 'processing', 'shipped', 'out for delivery'];
        $activeCount = 0;
        foreach ($activeStatuses as $s) {
            $activeCount += $byStatus[$s] ?? 0;
        }

        $totalOrders = array_sum($byStatus);

        Response::success([
            'user_id'          => $userId,
            'total_orders'     => $totalOrders,
            'active_orders'    => $activeCount,
            'delivered_orders' => $byStatus['delivered'] ?? 0,
            'cancelled_orders' => $byStatus['cancelled'] ?? 0,
            'returned_orders'  => $byStatus['returned']  ?? 0,
            'total_spent'      => round($totalSpent, 2),
        ]);
    }

    // ─── DELETE /admin/users/{id} ────────────────────────────────────────────
    // Soft-deactivates the user. Orders and history are preserved.

    public function destroy(Request $request): void
    {
        $userId = (int) $request->param('id');
        if ($userId <= 0) {
            Response::error('Invalid user ID', 400);
        }

        $user = Database::fetch('SELECT user_id, user_type FROM users WHERE user_id = ? LIMIT 1', [$userId]);
        if (!$user) {
            Response::error('User not found', 404);
        }
        if ($user['user_type'] === 'admin') {
            Response::error('Cannot delete an admin account', 403);
        }

        User::deactivate($userId);

        // Revoke all refresh tokens so the mobile app cannot stay logged in
        Database::execute(
            'DELETE FROM refresh_tokens WHERE user_id = ?',
            [$userId]
        );

        Response::success(null, 'User deactivated successfully');
    }
    /**
     * Get all pending users
     * GET /admin/users/pending
     */
    public function pending(Request $request): void
    {
        try {
            $db = Database::getInstance();

            $query = "
                SELECT 
                    user_id,
                    name,
                    email,
                    phone,
                    user_type,
                    company_name,
                    address,
                    city,
                    state,
                    pincode,
                    gst_number,
                    udyam_number,
                    approval_status,
                    created_at
                FROM users
                WHERE approval_status = 'pending'
                ORDER BY created_at DESC
            ";

            $stmt = $db->prepare($query);
            $stmt->execute();
            $pendingUsers = $stmt->fetchAll(PDO::FETCH_ASSOC);

            Response::success([
                'users' => $pendingUsers,
                'count' => count($pendingUsers)
            ]);

        } catch (Exception $e) {
            error_log('Error fetching pending users: ' . $e->getMessage());
            Response::error('Failed to fetch pending users', 500);
        }
    }
    /**
     * Approve a user
     * POST /admin/users/{id}/approve
     */
    public function approve(Request $request): void
    {
        try {
            $id = (int) $request->param('id');
            $adminUser = $request->user ?? [];
            $adminId = $adminUser['user_id'] ?? 0;

            $db = Database::getInstance();

            // Get user details
            $userQuery = "SELECT user_id, name, email, approval_status FROM users WHERE user_id = ?";
            $userStmt = $db->prepare($userQuery);
            $userStmt->execute([$id]);
            $user = $userStmt->fetch(PDO::FETCH_ASSOC);

            if (!$user) {
                Response::error('User not found', 404);
            }

            if ($user['approval_status'] === 'approved') {
                Response::error('User is already approved', 400);
            }

            // Update user status
            $updateQuery = "
                UPDATE users 
                SET 
                    approval_status = 'approved',
                    is_active = true,
                    approved_at = NOW(),
                    approved_by = ?
                WHERE user_id = ?
            ";

            $updateStmt = $db->prepare($updateQuery);
            $success = $updateStmt->execute([$adminId, $id]);

            if (!$success) {
                Response::error('Failed to approve user', 500);
            }

            // Send approval email
            require_once ROOT_PATH . '/controllers/AuthController.php';
            $authController = new AuthController();
            $authController->sendApprovalEmail($user['email'], $user['name']);

            Response::success([
                'message' => 'User approved successfully',
                'user_id' => $id
            ]);

        } catch (Exception $e) {
            error_log('Error approving user: ' . $e->getMessage());
            Response::error('Failed to approve user', 500);
        }
    }
    /**
     * Reject a user
     * POST /admin/users/{id}/reject
     */
    public function reject(Request $request): void
    {
        try {
            $id = (int) $request->param('id');
            $reason = trim((string) $request->input('reason', 'No reason provided'));

            if (empty($reason)) {
                Response::error('Rejection reason is required', 400);
            }

            $db = Database::getInstance();

            // Get user details
            $userQuery = "SELECT user_id, name, email, approval_status FROM users WHERE user_id = ?";
            $userStmt = $db->prepare($userQuery);
            $userStmt->execute([$id]);
            $user = $userStmt->fetch(PDO::FETCH_ASSOC);

            if (!$user) {
                Response::error('User not found', 404);
            }

            if ($user['approval_status'] === 'rejected') {
                Response::error('User is already rejected', 400);
            }

            // Update user status
            $updateQuery = "
                UPDATE users 
                SET 
                    approval_status = 'rejected',
                    is_active = false,
                    rejection_reason = ?
                WHERE user_id = ?
            ";

            $updateStmt = $db->prepare($updateQuery);
            $success = $updateStmt->execute([$reason, $id]);

            if (!$success) {
                Response::error('Failed to reject user', 500);
            }

            // Send rejection email
            require_once ROOT_PATH . '/controllers/AuthController.php';
            $authController = new AuthController();
            $authController->sendRejectionEmail($user['email'], $user['name'], $reason);

            Response::success([
                'message' => 'User rejected successfully',
                'user_id' => $id
            ]);

        } catch (Exception $e) {
            error_log('Error rejecting user: ' . $e->getMessage());
            Response::error('Failed to reject user', 500);
        }
    }


}
