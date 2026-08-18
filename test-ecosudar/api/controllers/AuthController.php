<?php
declare(strict_types=1);

$a=1;
class AuthController
{
    // ─── POST /auth/register ─────────────────────────────────────────────────
    // new chnages in api
    public function register(Request $request): void
    {
        $isDealer = strtolower($request->input('user_type', '')) === 'dealer';

        $rules = [
            'user_type' => 'required|in:customer,Customer,dealer,Dealer',
            'name' => 'required|string|min:2|max:100',
            'phone' => 'required|phone',
            'email' => 'required|email|max:100',
            'password' => 'required|min:8|max:72',
        ];

        if ($isDealer) {
            $rules['company_name'] = 'required|string|max:150';
            $rules['address'] = 'required|string|max:500';
            $rules['gst_number'] = 'required|gst';
        }

        Validator::make($request->only(array_keys($rules)), $rules)->validate();

        try {
            // NEW: Get user data and add approval fields
            $userData = $request->only([
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
                'udyam_number',
                'password',
            ]);
            
            // NEW: Add approval status fields
            $userData['approval_status'] = 'pending';
            $userData['is_active'] = false;
            
            $userId = User::create($userData);
            $dealerLink = strtolower((string)$userData['user_type']) === 'customer'
                ? DealerNetwork::linkDirectRegistration($userId)
                : ['status' => 'not_applicable'];
        } catch (AppException $e) {
            Response::error($e->getMessage(), $e->getCode());
        }

        $user = User::findById($userId);
        
        // NEW: Send pending approval email
        $this->sendPendingApprovalEmail($user['email'], $user['name']);
        
        // MODIFIED: Don't issue tokens, return pending status instead
        Response::success(
            [
                'user_id' => $userId,
                'approval_status' => 'pending',
                'dealer_link' => $dealerLink ?? ['status' => 'skipped'],
                'message' => 'Registration submitted successfully. Your account is pending admin approval.',
            ],
            'Registration submitted. Awaiting admin approval.',
            201
        );
    }

    // ─── POST /auth/login ────────────────────────────────────────────────────

    public function login(Request $request): void
    {
        try {
            $phone = $request->input('phone');
            $email = $request->input('email');
            $password = $request->input('password');
    
            if (!$password) {
                Response::error('Password is required', 400);
            }
    
            if (!$phone && !$email) {
                Response::error('Phone or Email and password are required', 400);
            }
    
            $user = null;
            if (!empty($phone)) {
                $user = User::findByPhone($phone);
            } else if (!empty($email)) {
                $user = User::findByEmail($email);
            }
    
            // Generic message prevents enumeration
            if (!$user || !User::verifyPassword((string) $password, $user['password_hash'] ?? '')) {
                Response::error('Invalid credentials', 401);
            }
    
            // ✅ NEW: Check approval status BEFORE is_active check
            if (isset($user['approval_status'])) {
                if ($user['approval_status'] === 'pending') {
                    Response::error(
                        'Your account is pending admin approval. You will receive an email once approved.',
                        403
                    );
                }
                
                if ($user['approval_status'] === 'rejected') {
                    $reason = $user['rejection_reason'] ?? 'No reason provided';
                    Response::error(
                        "Your registration was not approved. Reason: {$reason}",
                        403
                    );
                }
            }
    
            if (!(bool) $user['is_active']) {
                Response::error('Account is inactive. Please contact support.', 403);
            }
    
            // Rehash if bcrypt cost changed
            if (password_needs_rehash($user['password_hash'], PASSWORD_BCRYPT, ['cost' => BCRYPT_COST])) {
                User::updatePassword((int) $user['user_id'], (string) $password);
            }
    
            [$access, $refresh, $refreshExpiry] = $this->issueTokenPair((int) $user['user_id'], $request);
            self::storeRefreshToken((int) $user['user_id'], $refresh, $refreshExpiry);
    
            Response::success([
                'token' => $access,
                'refresh_token' => $refresh,
                'user' => User::sanitizeForResponse($user),
            ], 'Login successful');
    
        } catch (\Throwable $e) {
            error_log('[Login] ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
            Response::error('Internal server error', 500);
        }
    }


    // ─── POST /auth/logout ───────────────────────────────────────────────────

    public function logout(Request $request): void
    {
        // Revoke the access token so it can't be replayed
        $token = $request->bearerToken();
        if ($token) {
            Database::execute(
                'INSERT IGNORE INTO revoked_tokens (token_hash, expired_at, created_at)
                 VALUES (?, DATE_ADD(NOW(), INTERVAL ? SECOND), NOW())',
                [hash('sha256', $token), JWT_ACCESS_EXPIRY]
            );
        }

        // Revoke refresh token if provided
        $refreshToken = $request->input('refresh_token');
        if ($refreshToken) {
            Database::execute(
                'DELETE FROM refresh_tokens WHERE token_hash = ? AND user_id = ?',
                [hash('sha256', $refreshToken), (int) $request->user['user_id']]
            );
        }

        Response::success(null, 'Logged out successfully');
    }

    // ─── GET /auth/me ────────────────────────────────────────────────────────

    public function me(Request $request): void
    {
        Response::success(User::sanitizeForResponse($request->user));
    }

    // ─── POST /auth/refresh ──────────────────────────────────────────────────

    public function refresh(Request $request): void
    {
        try {
            Validator::make($request->only(['refresh_token']), [
                'refresh_token' => 'required|string',
            ])->validate();

            $rawToken = $request->input('refresh_token');
            $payload = JWT::decode($rawToken);

            if (!$payload || ($payload['type'] ?? '') !== 'refresh') {
                Response::error('Refresh token is invalid or expired', 401);
            }

            $tokenHash = hash('sha256', $rawToken);
            $stored = Database::fetch(
                'SELECT id, user_id FROM refresh_tokens WHERE token_hash = ? AND expires_at > NOW() LIMIT 1',
                [$tokenHash]
            );

            if (!$stored) {
                Response::error('Refresh token not found or expired', 401);
            }

            $user = User::findById((int) $stored['user_id']);
            if (!$user || !(bool) $user['is_active']) {
                Response::error('User not found or inactive', 401);
            }

            // Rotate: delete old, issue new pair.
            // IMPORTANT: Use the client type embedded in the refresh token payload,
            // NOT the current request header. This ensures mobile app users always
            // get long-lived tokens (30 days) even if X-Client-Type is missing
            // from the refresh request — preventing false "session expired" errors.
            $originalClientType = $payload['client'] ?? 'web';
            Database::execute('DELETE FROM refresh_tokens WHERE id = ?', [(int) $stored['id']]);
            [$access, $refresh, $refreshExpiry] = $this->issueTokenPairForClient(
                (int) $stored['user_id'],
                $originalClientType
            );
            self::storeRefreshToken((int) $stored['user_id'], $refresh, $refreshExpiry);

            Response::success([
                'token' => $access,
                'refresh_token' => $refresh,
            ], 'Token refreshed');
        } catch (\Throwable $e) {
            error_log('[Refresh] ' . $e->getMessage() . ' in ' . $e->getFile() . ':' . $e->getLine());
            Response::error('Internal server error', 500);
        }
    }

    // ─── POST /auth/forgot-password ──────────────────────────────────────────
    public function forgotPassword(Request $request): void
    {
        $phone = $request->input('phone');
        $email = $request->input('email');

        if (!$phone && !$email) {
            Response::error('Phone or email is required', 400);
        }

        $user = null;
        $identifier = '';
        $type = '';

        if ($phone) {
            // Validate format before hitting DB
            $digits = preg_replace('/\D/', '', (string) $phone);
            if (strlen($digits) !== 10) {
                Response::error('Invalid phone number. Must be a 10-digit number.', 400);
            }
            $identifier = $digits;
            $type = 'phone';
            $user = User::findByPhone($identifier);
        } else {
            // Validate format before hitting DB
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                Response::error('Invalid email address format.', 400);
            }
            $identifier = strtolower(trim((string) $email));
            $type = 'email';
            $user = User::findByEmail($identifier);
        }

        // Block non-existing accounts — do NOT send OTP to unknown identifiers
        if (!$user) {
            $label = ($type === 'email') ? 'email address' : 'phone number';
            Response::error('No account found with this ' . $label . '. Please sign up first.', 404);
        }

        // Block inactive accounts
        if (!(bool) $user['is_active']) {
            Response::error('This account is inactive. Please contact support.', 403);
        }

        // Generate 6-digit OTP
        try {
            $otp = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        } catch (\Exception $e) {
            $otp = '123456';
        }

        // Delete old unused OTPs for this user
        Database::execute(
            'DELETE FROM otp_verifications WHERE user_id = ? AND purpose = ?',
            [(int) $user['user_id'], 'password_reset']
        );

        Database::execute(
            "INSERT INTO otp_verifications (user_id, identifier, identifier_type, otp_code, purpose, expires_at)
             VALUES (?, ?, ?, ?, 'password_reset', DATE_ADD(NOW(), INTERVAL 10 MINUTE))",
            [(int) $user['user_id'], $identifier, $type, $otp]
        );

        // Send OTP
        if ($type === 'email') {
            @mail($identifier, 'Your EcoSudar Password Reset OTP', "Your OTP is: $otp. It will expire in 10 minutes.");
        } elseif ($type === 'phone') {
            $apiKey = trim(@file_get_contents(ROOT_PATH . '/../fast25sms.txt'), ". \n\r");
            if ($apiKey) {
                $curl = curl_init();
                curl_setopt_array($curl, [
                    CURLOPT_URL => "https://www.fast2sms.com/dev/bulkV2",
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_ENCODING => "",
                    CURLOPT_MAXREDIRS => 10,
                    CURLOPT_TIMEOUT => 30,
                    CURLOPT_SSL_VERIFYHOST => 0,
                    CURLOPT_SSL_VERIFYPEER => 0,
                    CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
                    CURLOPT_CUSTOMREQUEST => "POST",
                    CURLOPT_POSTFIELDS => json_encode([
                        "variables_values" => $otp,
                        "route" => "otp",
                        "numbers" => $identifier,
                    ]),
                    CURLOPT_HTTPHEADER => [
                        "authorization: " . $apiKey,
                        "accept: */*",
                        "cache-control: no-cache",
                        "content-type: application/json",
                    ],
                ]);
                @curl_exec($curl);
                @curl_close($curl);
            }
        }

        Response::success([
            'identifier' => $identifier,
            'identifier_type' => $type,
            'otp_expires_at' => date('Y-m-d\TH:i:s.000\Z', time() + 600),
            'retry_after_seconds' => 60,
        ], 'OTP sent successfully');
    }


    // ─── POST /auth/send-otp ──────────────────────────────────────────────
    // Called BEFORE signup — user does NOT need to exist in the database yet.
    // Sends an OTP to the given email/phone for pre-registration verification.
    // Returns `user_exists` so the app can redirect to login if already registered.
    public function sendOtp(Request $request): void
    {
        $phone = $request->input('phone');
        $email = $request->input('email');

        if (!$phone && !$email) {
            Response::error('Phone or email is required', 400);
        }

        $identifier = '';
        $type = '';

        if ($phone) {
            // Basic phone validation: must be 10 digits
            if (!preg_match('/^\d{10}$/', (string) $phone)) {
                Response::error('Invalid phone number. Must be 10 digits.', 400);
            }
            $identifier = (string) $phone;
            $type = 'phone';
        } else {
            // Basic email validation
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                Response::error('Invalid email address.', 400);
            }
            $identifier = strtolower(trim((string) $email));
            $type = 'email';
        }

        // Check if user already exists — do NOT block, just inform the app
        $existingUser = ($type === 'phone')
            ? User::findByPhone($identifier)
            : User::findByEmail($identifier);

        $userExists = $existingUser !== null;

        // Generate 6-digit OTP
        try {
            $otp = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        } catch (\Exception $e) {
            $otp = '123456';
        }

        // Delete any previous unused OTPs for this identifier + purpose
        $purpose = $type . '_verification';
        Database::execute(
            'DELETE FROM otp_verifications WHERE identifier = ? AND purpose = ?',
            [$identifier, $purpose]
        );

        // Store OTP — user_id is NULL because the user may not exist yet
        Database::execute(
            "INSERT INTO otp_verifications (user_id, identifier, identifier_type, otp_code, purpose, expires_at)
             VALUES (NULL, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE))",
            [$identifier, $type, $otp, $purpose]
        );

        // Send OTP
        if ($type === 'email') {
            @mail(
                $identifier,
                'Your EcoSudar Verification OTP',
                "Your OTP is: $otp. It will expire in 10 minutes."
            );
        } elseif ($type === 'phone') {
            $apiKey = trim(@file_get_contents(ROOT_PATH . '/../fast25sms.txt'), ". \n\r");
            if ($apiKey) {
                $curl = curl_init();
                curl_setopt_array($curl, [
                    CURLOPT_URL => "https://www.fast2sms.com/dev/bulkV2",
                    CURLOPT_RETURNTRANSFER => true,
                    CURLOPT_ENCODING => "",
                    CURLOPT_MAXREDIRS => 10,
                    CURLOPT_TIMEOUT => 30,
                    CURLOPT_SSL_VERIFYHOST => 0,
                    CURLOPT_SSL_VERIFYPEER => 0,
                    CURLOPT_HTTP_VERSION => CURL_HTTP_VERSION_1_1,
                    CURLOPT_CUSTOMREQUEST => "POST",
                    CURLOPT_POSTFIELDS => json_encode([
                        "variables_values" => $otp,
                        "route" => "otp",
                        "numbers" => $identifier,
                    ]),
                    CURLOPT_HTTPHEADER => [
                        "authorization: " . $apiKey,
                        "accept: */*",
                        "cache-control: no-cache",
                        "content-type: application/json",
                    ],
                ]);
                @curl_exec($curl);
                @curl_close($curl);
            }
        }

        Response::success([
            'identifier' => $identifier,
            'type' => $type,
            'purpose' => $purpose,
            'expires_in' => 600, // 10 minutes
            'user_exists' => $userExists, // true → redirect to login; false → continue signup
        ], 'OTP sent successfully');
    }

    // ─── POST /auth/verify-otp ───────────────────────────────────────────────
    public function verifyOtp(Request $request): void
    {
        $identifier = $request->input('identifier');
        $otp = $request->input('otp');
        $purpose = $request->input('purpose') ?? 'password_reset';

        if (!$identifier || !$otp) {
            Response::error('Identifier and OTP are required', 400);
        }

        if (strlen((string) $otp) < 4 || strlen((string) $otp) > 6) {
            Response::error('Invalid OTP format. Please enter 4-6 digits.', 400);
        }

        $record = Database::fetch(
            "SELECT *, (expires_at <= NOW()) AS is_expired FROM otp_verifications
             WHERE identifier = ? AND purpose = ? AND is_used = FALSE
             ORDER BY created_at DESC LIMIT 1",
            [$identifier, $purpose]
        );

        if (!$record) {
            Response::error('Invalid OTP code', 401, ['attempts_remaining' => 0]);
        }

        if ($record['is_expired']) {
            Response::error('OTP has expired. Please request a new one.', 401);
        }

        if ($record['otp_code'] !== $otp) {
            Response::error('Invalid OTP code', 401);
        }

        // Success!
        Database::execute(
            'UPDATE otp_verifications SET is_used = TRUE, verified_at = NOW() WHERE otp_id = ?',
            [(int) $record['otp_id']]
        );

        if ($purpose === 'password_reset') {
            // Issue a special reset token for password reset
            $resetToken = JWT::encodeAccess(['sub' => $record['user_id'], 'type' => 'password_reset']);
            Response::success([
                'reset_token' => $resetToken,
                'expires_at' => date('Y-m-d\TH:i:s.000\Z', time() + 600)
            ], 'OTP verified successfully');
        } else {
            // For general verification (email, phone)
            Response::success([
                'verified' => true,
                'purpose' => $purpose
            ], ucfirst(explode('_', $purpose)[0]) . ' verified successfully');
        }
    }

    // ─── POST /auth/reset-password ───────────────────────────────────────────
    public function resetPassword(Request $request): void
    {
        $token = $request->bearerToken();
        if (!$token) {
            Response::error('Authorization token required', 401);
        }

        $payload = JWT::decode($token);
        if (!$payload || ($payload['type'] ?? '') !== 'password_reset') {
            Response::error('Invalid or expired reset token', 401);
        }

        // Check if this reset token has already been used (revoked)
        $tokenHash = hash('sha256', $token);
        $revoked = Database::fetch(
            'SELECT id FROM revoked_tokens WHERE token_hash = ? LIMIT 1',
            [$tokenHash]
        );
        if ($revoked) {
            Response::error('Invalid or expired reset token', 401);
        }

        $newPass = $request->input('new_password');
        $confirmPass = $request->input('confirm_password');

        if (!$newPass || !$confirmPass) {
            Response::error('New password and confirm_password are required', 400);
        }

        if ($newPass !== $confirmPass) {
            Response::error('Passwords do not match', 400);
        }

        if (strlen($newPass) < 6) {
            Response::error('Password must be at least 6 characters long', 400);
        }

        $userId = (int) $payload['sub'];
        User::updatePassword($userId, $newPass);

        // Revoke the reset token so it cannot be reused
        Database::execute(
            'INSERT IGNORE INTO revoked_tokens (token_hash, expired_at, created_at)
             VALUES (?, DATE_ADD(NOW(), INTERVAL 600 SECOND), NOW())',
            [$tokenHash]
        );

        // Find user to return email
        $user = User::findById($userId);

        Response::success([
            'user_id' => $userId,
            'email' => $user['email'] ?? null
        ], 'Password reset successfully');
    }

    // ─── Helpers ─────────────────────────────────────────────────────────────

    private function issueTokenPair(int $userId, Request $request): array
    {
        // Detect client type: mobile apps send X-Client-Type: app
        // Everything else (website, admin dashboard) defaults to web short-lived tokens
        $clientType = strtolower(trim($request->header('X-Client-Type') ?? 'web'));
        return $this->issueTokenPairForClient($userId, $clientType);
    }

    /**
     * Issue a token pair for a known client type.
     * Use this internally (e.g. from refresh) to preserve the original
     * client type without relying on the current request header.
     */
    private function issueTokenPairForClient(int $userId, string $clientType): array
    {
        $isApp = ($clientType === 'app');

        $accessExpiry  = $isApp ? JWT_ACCESS_EXPIRY        : JWT_WEB_ACCESS_EXPIRY;
        $refreshExpiry = $isApp ? JWT_REFRESH_EXPIRY       : JWT_WEB_REFRESH_EXPIRY;

        $access  = JWT::encode(['sub' => $userId, 'type' => 'access',  'client' => $clientType], $accessExpiry);
        $refresh = JWT::encode(['sub' => $userId, 'type' => 'refresh', 'client' => $clientType], $refreshExpiry);

        return [$access, $refresh, $refreshExpiry];
    }

    private static function storeRefreshToken(int $userId, string $rawToken, int $expirySeconds): void
    {
        Database::execute(
            'INSERT INTO refresh_tokens (user_id, token_hash, expires_at, created_at)
             VALUES (?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND), NOW())',
            [$userId, hash('sha256', $rawToken), $expirySeconds]
        );
    }
    
    /**
     * Send pending approval email to user
     */
    private function sendPendingApprovalEmail(string $email, string $name): void
    {
        $subject = "Registration Received - Pending Approval";
        $message = "
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
                    .content { padding: 20px; background-color: #f9f9f9; }
                    .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
                </style>
            </head>
            <body>
                <div class='container'>
                    <div class='header'>
                        <h1>EcoSudar</h1>
                    </div>
                    <div class='content'>
                        <h2>Hello {$name},</h2>
                        <p>Thank you for registering with EcoSudar!</p>
                        <p>Your account is currently <strong>pending admin approval</strong>. You will receive an email notification once your account has been reviewed and approved.</p>
                        <p>This process typically takes <strong>24-48 hours</strong>.</p>
                        <p>If you have any questions, please don't hesitate to contact our support team.</p>
                    </div>
                    <div class='footer'>
                        <p>Best regards,<br>EcoSudar Team</p>
                        <p>&copy; " . date('Y') . " EcoSudar. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
        ";
        
        $this->sendEmail($email, $subject, $message);
    }
    
        /**
     * Send approval email to user
     */
    public function sendApprovalEmail(string $email, string $name): void
    {
        $subject = "Account Approved - Welcome to EcoSudar!";
        $message = "
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background-color: #4CAF50; color: white; padding: 20px; text-align: center; }
                    .content { padding: 20px; background-color: #f9f9f9; }
                    .button { display: inline-block; padding: 12px 24px; background-color: #4CAF50; color: white; text-decoration: none; border-radius: 4px; margin: 20px 0; }
                    .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
                </style>
            </head>
            <body>
                <div class='container'>
                    <div class='header'>
                        <h1> Welcome to EcoSudar!</h1>
                    </div>
                    <div class='content'>
                        <h2>Hello {$name},</h2>
                        <p><strong>Great news!</strong> Your EcoSudar account has been approved.</p>
                        <p>You can now log in to the app using your registered email and password.</p>
                        <p style='text-align: center;'>
                            <a href='#' class='button'>Open EcoSudar App</a>
                        </p>
                        <p>Welcome aboard! We're excited to have you as part of our community.</p>
                    </div>
                    <div class='footer'>
                        <p>Best regards,<br>EcoSudar Team</p>
                        <p>&copy; " . date('Y') . " EcoSudar. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
        ";
        
        $this->sendEmail($email, $subject, $message);
    }

    /**
     * Send rejection email to user
     */
    public function sendRejectionEmail(string $email, string $name, string $reason): void
    {
        $subject = "Registration Status Update";
        $message = "
            <!DOCTYPE html>
            <html>
            <head>
                <style>
                    body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
                    .container { max-width: 600px; margin: 0 auto; padding: 20px; }
                    .header { background-color: #f44336; color: white; padding: 20px; text-align: center; }
                    .content { padding: 20px; background-color: #f9f9f9; }
                    .reason-box { background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0; }
                    .footer { padding: 20px; text-align: center; font-size: 12px; color: #666; }
                </style>
            </head>
            <body>
                <div class='container'>
                    <div class='header'>
                        <h1>EcoSudar</h1>
                    </div>
                    <div class='content'>
                        <h2>Hello {$name},</h2>
                        <p>Thank you for your interest in EcoSudar.</p>
                        <p>Unfortunately, we are unable to approve your registration at this time.</p>
                        <div class='reason-box'>
                            <strong>Reason:</strong><br>
                            {$reason}
                        </div>
                        <p>If you have any questions or would like to discuss this decision, please contact our support team.</p>
                    </div>
                    <div class='footer'>
                        <p>Best regards,<br>EcoSudar Team</p>
                        <p>&copy; " . date('Y') . " EcoSudar. All rights reserved.</p>
                    </div>
                </div>
            </body>
            </html>
        ";
        
        $this->sendEmail($email, $subject, $message);
    }
    /**
     * Send email using configured mail system
     */
    private function sendEmail(string $to, string $subject, string $message): void
    {
        // Configure email headers
        $headers = [
            'MIME-Version: 1.0',
            'Content-type: text/html; charset=UTF-8',
            'From: EcoSudar <noreply@ecosudar.com>',
            'Reply-To: support@ecosudar.com',
            'X-Mailer: PHP/' . phpversion()
        ];
        
        // Send email
        $success = @mail($to, $subject, $message, implode("\r\n", $headers));
        
        if (!$success) {
            error_log("Failed to send email to: {$to}");
        }
    }
}
