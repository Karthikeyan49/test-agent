<?php
declare(strict_types=1);

class UserController
{
    // ─── GET /users/{id} ────────────────────────────────────────────────────

    public function show(Request $request): void
    {
        $userId = (int)$request->param('id');
        if ($userId <= 0) {
            Response::error('Invalid user ID', 400);
        }

        // Users can only view their own profile
        if ($userId !== (int)$request->user['user_id']) {
            Response::error('Forbidden', 403);
        }

        $user = User::findById($userId);
        if (!$user) {
            Response::error('User not found', 404);
        }

        Response::success(User::sanitizeForResponse($user));
    }

    // ─── GET /users/email/{email} ────────────────────────────────────────────

    public function findByEmail(Request $request): void
    {
        $email = urldecode($request->param('email'));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
            Response::error('Invalid email address', 400);
        }

        $user = User::findByEmail($email);
        if (!$user) {
            Response::error('User not found', 404);
        }

        Response::success(User::sanitizeForResponse($user));
    }

    // ─── PUT /users/{id} ────────────────────────────────────────────────────

    public function update(Request $request): void
    {
        $userId = (int)$request->param('id');
        if ($userId !== (int)$request->user['user_id']) {
            Response::error('Forbidden', 403);
        }

        $input = $request->only(['name', 'email', 'phone', 'company_name', 'address', 'city', 'state', 'pincode', 'gst_number', 'udyam_number']);
        if (empty($input)) {
            Response::error('Provide at least one field to update', 400);
        }

        Validator::make($input, [
            'name'         => 'string|min:2|max:100',
            'email'        => 'email|max:100',
            'phone'        => 'phone',
            'company_name' => 'string|max:150',
            'address'      => 'string|max:500',
            'city'         => 'string|max:50',
            'state'        => 'string|max:50',
            'pincode'      => 'string|max:10',
            'gst_number'   => 'gst',
            'udyam_number' => 'string|max:50',
        ])->validate();

        if (isset($input['email']) && User::existsByEmailExcluding($input['email'], $userId)) {
            Response::error('Email already in use by another user', 409);
        }

        if (isset($input['phone']) && User::existsByPhoneExcluding($input['phone'], $userId)) {
            Response::error('Phone number already in use by another user', 409);
        }

        try {
            User::update($userId, $input);
        } catch (AppException $e) {
            Response::error($e->getMessage(), $e->getCode());
        }

        Response::success(User::sanitizeForResponse(User::findById($userId)), 'User updated successfully');
    }

    // ─── PUT /users/{id}/password ────────────────────────────────────────────

    public function changePassword(Request $request): void
    {
        $userId = (int)$request->param('id');
        if ($userId !== (int)$request->user['user_id']) {
            Response::error('Forbidden', 403);
        }

        Validator::make($request->only(['current_password', 'new_password', 'confirm_password']), [
            'current_password' => 'required',
            'new_password'     => 'required|min:8|max:72',
            'confirm_password' => 'required',
        ])->validate();

        if ($request->input('new_password') !== $request->input('confirm_password')) {
            Response::error('New passwords do not match', 422);
        }
        if ($request->input('current_password') === $request->input('new_password')) {
            Response::error('New password must differ from current password', 422);
        }

        $full = User::findByPhone($request->user['phone']);
        if (!$full || !User::verifyPassword($request->input('current_password'), $full['password_hash'])) {
            Response::error('Current password is incorrect', 401);
        }

        User::updatePassword($userId, $request->input('new_password'));
        Response::success(null, 'Password changed successfully');
    }

    // ─── DELETE /users/{id} ──────────────────────────────────────────────────

    public function deactivate(Request $request): void
    {
        $userId = (int)$request->param('id');
        if ($userId !== (int)$request->user['user_id']) {
            Response::error('Forbidden', 403);
        }

        Validator::make($request->only(['password']), [
            'password' => 'required',
        ])->validate();

        $full = User::findByPhone($request->user['phone']);
        if (!$full || !User::verifyPassword($request->input('password'), $full['password_hash'])) {
            Response::error('Incorrect password', 401);
        }

        User::deactivate($userId);
        Response::success(null, 'Account deactivated successfully');
    }

    // ─── GET /users/{userId}/orders ──────────────────────────────────────────

    public function orders(Request $request): void
    {
        $userId = (int)$request->param('userId');
        if ($userId !== (int)$request->user['user_id']) {
            Response::error('Forbidden', 403);
        }

        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(50, max(1, (int)$request->query('limit', 10)));

        $filters = [
            'status' => $request->query('status'),
            'sort'   => $request->query('sort', 'order_date'),
            'order'  => $request->query('order', 'desc'),
        ];

        // Validate status if provided
        if (!empty($filters['status']) && !in_array(strtolower($filters['status']), Order::STATUSES, true)) {
            Response::error('Invalid status. Allowed: ' . implode(', ', Order::STATUSES), 400);
        }

        $result = Order::forUser($userId, $filters, $page, $limit);
        $total  = $result['total'];

        Response::paginated($result['rows'], [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $total,
            'total_pages' => (int)ceil($total / $limit),
        ]);
    }
}
