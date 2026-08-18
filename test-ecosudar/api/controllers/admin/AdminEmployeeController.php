<?php
declare(strict_types=1);

/**
 * Admin Employee Controller
 * GET    /admin/employees                  — list all employees (filters: department, active)
 * GET    /admin/employees/{id}             — single employee by key
 * POST   /admin/employees                  — create employee (custom or auto-generated EMP-XXX + QR token)
 * POST   /admin/employees/{id}             — update employee with optional PDF upload
 * PUT    /admin/employees/{id}             — update employee (alias for PATCH)
 * PATCH  /admin/employees/{id}             — update employee fields
 * DELETE /admin/employees/{id}             — soft-deactivate employee (preserves history)
 * GET    /admin/employees/{id}/qr          — get QR token payload
 * GET    /admin/employees/{id}/profile     — employee + recent attendance + last 3 payslips
 * GET    /admin/employees/{id}/insurance   — admin-only insurance PDF stream
 * PUT    /admin/employees/{id}/status      — set active / inactive explicitly
 * GET    /admin/employees/{id}/inventory-consumption — Smart Inventory: 30-day stock issue summary + history
 */
class AdminEmployeeController
{
    private const VALID_DEPARTMENTS = [
        'Production', 'Quality', 'Sales', 'Admin', 'Dispatch', 'Maintenance',
    ];

    private const VALID_EMPLOYMENT_TYPES = ['permanent', 'contract', 'job_work'];

    // ─── GET /admin/employees ─────────────────────────────────────────────────

    public function index(Request $request): void
    {
        $filters = [];
        if ($dept = $request->query('department')) {
            $filters['department'] = $dept;
        }
        $active = $request->query('active');
        if ($active !== null) {
            $filters['is_active'] = $active === '1' ? 1 : 0;
        }

        $rows = Employee::all($filters);
        Response::success(array_map([Employee::class, 'format'], $rows));
    }

    // ─── GET /admin/employees/{id} ───────────────────────────────────────────

    public function show(Request $request): void
    {
        $emp = Employee::findByKey($request->param('id'));
        if (!$emp) Response::error('Employee not found', 404);
        Response::success(Employee::format($emp));
    }

    // ─── POST /admin/employees ────────────────────────────────────────────────

    public function store(Request $request): void
    {
        $payload = $this->employeePayload($request, true);

        $name        = (string)$payload['name'];
        $email       = (string)$payload['email'];
        $phone       = (string)$payload['phone'];
        $department  = (string)$payload['department'];

        if (!$name)        Response::error('Name is required', 422);
        if (!$phone)       Response::error('Phone is required', 422);

        if (trim($department) !== '' && !in_array($department, self::VALID_DEPARTMENTS, true)) {
            Response::error('Invalid department', 422);
        }

        if ($email !== '') {
            $existing = Database::fetch(
                'SELECT employee_id FROM employees WHERE email = ? LIMIT 1',
                [strtolower($email)]
            );
            if ($existing) Response::error('Email already registered', 409);
        }

        $id  = Employee::create($payload);

        $row = Database::fetch('SELECT * FROM employees WHERE employee_id = ? LIMIT 1', [$id]);
        $upload = $this->storeInsurancePdf((string)$row['employee_key']);
        if ($upload) {
            Database::execute(
                'UPDATE employees SET insurance_pdf_path = ?, insurance_pdf_name = ?, updated_at = NOW() WHERE employee_id = ?',
                [$upload['insurancePdfPath'], $upload['insurancePdfName'], $id]
            );
            $row = Database::fetch('SELECT * FROM employees WHERE employee_id = ? LIMIT 1', [$id]);
        }

        // Handle optional employee photo
        $photo = $this->storeEmployeePhoto((string)$row['employee_key']);
        if ($photo) {
            Database::execute(
                'UPDATE employees SET photo_path = ?, updated_at = NOW() WHERE employee_id = ?',
                [$photo, $id]
            );
            $row = Database::fetch('SELECT * FROM employees WHERE employee_id = ? LIMIT 1', [$id]);
        }

        Response::success(Employee::format($row), 'Employee created', 201);
    }

    // ─── PATCH /admin/employees/{id} ─────────────────────────────────────────

    public function update(Request $request): void
    {
        $key = $request->param('id');
        $emp = Employee::findByKey($key);
        if (!$emp) Response::error('Employee not found', 404);

        $payload = $this->employeePayload($request, false);

        if (array_key_exists('customId', $payload)) {
            $requestedKey = Employee::normalizeEmployeeKey($payload['customId'], true);
            unset($payload['customId']);
            if ($requestedKey !== $key) {
                $key = Employee::updateKey($key, $requestedKey);
            }
        }

        $upload = $this->storeInsurancePdf($key);
        if ($upload) {
            $payload['insurancePdfPath'] = $upload['insurancePdfPath'];
            $payload['insurancePdfName'] = $upload['insurancePdfName'];
        }

        // Handle optional employee photo
        $photo = $this->storeEmployeePhoto($key);
        if ($photo) {
            // New photo uploaded — delete old file first
            $currentEmp = Employee::findByKey($key);
            $oldPath = trim((string)($currentEmp['photo_path'] ?? ''));
            if ($oldPath !== '') {
                $oldFile = ROOT_PATH . '/' . ltrim($oldPath, '/');
                if (is_file($oldFile)) @unlink($oldFile);
            }
            $payload['photoPath'] = $photo;
        } elseif (($_POST['deletePhoto'] ?? '') === '1') {
            // User explicitly removed the photo
            $currentEmp = Employee::findByKey($key);
            $oldPath = trim((string)($currentEmp['photo_path'] ?? ''));
            if ($oldPath !== '') {
                $oldFile = ROOT_PATH . '/' . ltrim($oldPath, '/');
                if (is_file($oldFile)) @unlink($oldFile);
            }
            $payload['photoPath'] = null;
        }

        $fields = [];
        $params = [];

        foreach (Employee::fieldColumns() as $camel => $snake) {
            if (!array_key_exists($camel, $payload)) continue;
            $val = $payload[$camel];

            if ($camel === 'department' && trim((string)$val) !== '' && !in_array($val, self::VALID_DEPARTMENTS, true)) {
                Response::error('Invalid department', 422);
            }

            if ($camel === 'employmentType' && !in_array($val, self::VALID_EMPLOYMENT_TYPES, true)) {
                Response::error('Invalid employment type', 422);
            }

            $fields[]  = "$snake = ?";
            $params[]  = Employee::normalizeField($camel, $val);
        }

        if (!$fields) {
            $updated = Employee::findByKey($key);
            Response::success(Employee::format($updated), 'Employee updated');
        }

        $params[] = $key;
        Database::execute(
            'UPDATE employees SET ' . implode(', ', $fields) . ', updated_at = NOW() WHERE employee_key = ?',
            $params
        );

        $updated = Employee::findByKey($key);
        Response::success(Employee::format($updated), 'Employee updated');
    }

    // ─── DELETE /admin/employees/{id} ────────────────────────────────────────

    public function destroy(Request $request): void
    {
        $key = $request->param('id');
        $emp = Employee::findByKey($key);
        if (!$emp) Response::error('Employee not found', 404);

        // Soft-delete: preserves attendance/payroll history
        Database::execute(
            'UPDATE employees SET is_active = 0, updated_at = NOW() WHERE employee_key = ?',
            [$key]
        );
        Response::success(null, 'Employee deactivated');
    }

    // ─── GET /admin/employees/{id}/qr ────────────────────────────────────────

    public function qr(Request $request): void
    {
        $key = $request->param('id');
        $emp = Employee::findByKey($key);
        if (!$emp) Response::error('Employee not found', 404);

        Response::success([
            'token'   => $emp['qr_token'],
            'payload' => json_encode(['token' => $emp['qr_token'], 'employeeId' => $emp['employee_key']]),
        ]);
    }

    // ─── GET /admin/employees/{id}/profile ───────────────────────────────────

    public function profile(Request $request): void
    {
        $key = $request->param('id');
        $emp = Employee::findByKey($key);
        if (!$emp) Response::error('Employee not found', 404);

        // Last 30 days attendance
        $attendance = Database::fetchAll(
            "SELECT * FROM attendance
              WHERE employee_key = ?
                AND date >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
              ORDER BY date DESC",
            [$key]
        );

        // Last 3 months of payroll
        $payroll = Database::fetchAll(
            "SELECT p.*, e.name AS employee_name, e.designation, e.joined_at
               FROM payroll p
               JOIN employees e ON p.employee_key = e.employee_key
              WHERE p.employee_key = ?
              ORDER BY p.month DESC
              LIMIT 3",
            [$key]
        );

        // Tasks summary
        $taskStats = Database::fetch(
            "SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
                    SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
                    SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending,
                    SUM(CASE WHEN due_date < CURDATE() AND status != 'Completed' THEN 1 ELSE 0 END) AS overdue
             FROM tasks WHERE assignee_id = ?",
            [$key]
        );

        Response::success([
            'employee'   => Employee::format($emp),
            'attendance' => array_map([Attendance::class, 'format'], $attendance),
            'payslips'   => array_map([Payroll::class, 'format'], $payroll),
            'tasks'      => [
                'total'      => (int)($taskStats['total']       ?? 0),
                'completed'  => (int)($taskStats['completed']   ?? 0),
                'inProgress' => (int)($taskStats['in_progress'] ?? 0),
                'pending'    => (int)($taskStats['pending']     ?? 0),
                'overdue'    => (int)($taskStats['overdue']     ?? 0),
            ],
        ]);
    }

    // ─── GET /admin/employees/{id}/photo ─────────────────────────────────────

    public function photo(Request $request): void
    {
        $key = $request->param('id');
        $emp = Employee::findByKey($key);
        if (!$emp) Response::error('Employee not found', 404);

        $relativePath = trim((string)($emp['photo_path'] ?? ''));
        if ($relativePath === '') {
            Response::error('Employee photo not uploaded', 404);
        }

        $fullPath = ROOT_PATH . '/' . ltrim($relativePath, '/');
        $realRoot = realpath(ROOT_PATH . '/uploads/employee-photos');
        $realFile = realpath($fullPath);

        if (!$realRoot || !$realFile || !str_starts_with($realFile, $realRoot) || !is_file($realFile)) {
            Response::error('Employee photo not found', 404);
        }

        while (ob_get_level() > 0) {
            ob_end_clean();
        }

        $ext  = strtolower(pathinfo($realFile, PATHINFO_EXTENSION));
        $mime = match ($ext) {
            'jpg', 'jpeg' => 'image/jpeg',
            'png'         => 'image/png',
            'webp'        => 'image/webp',
            default       => 'application/octet-stream',
        };

        header('Content-Type: ' . $mime);
        header('Content-Length: ' . filesize($realFile));
        header('Cache-Control: no-cache, no-store, must-revalidate');
        header('Pragma: no-cache');
        // CORS origin is already set by the front controller (index.php) from the
        // configured allowlist — do not override it with a wildcard here.
        readfile($realFile);
        exit;
    }

    // ─── GET /admin/employees/{id}/insurance ─────────────────────────────────

    public function insurance(Request $request): void
    {
        $key = $request->param('id');
        $emp = Employee::findByKey($key);
        if (!$emp) Response::error('Employee not found', 404);

        $relativePath = trim((string)($emp['insurance_pdf_path'] ?? ''));
        if ($relativePath === '') {
            Response::error('Insurance PDF not uploaded', 404);
        }

        $fullPath = ROOT_PATH . '/' . ltrim($relativePath, '/');
        $realRoot = realpath(ROOT_PATH . '/uploads/employee-insurance');
        $realFile = realpath($fullPath);

        if (!$realRoot || !$realFile || !str_starts_with($realFile, $realRoot) || !is_file($realFile)) {
            Response::error('Insurance PDF not found', 404);
        }

        while (ob_get_level() > 0) {
            ob_end_clean();
        }

        $fileName = $emp['insurance_pdf_name'] ?: basename($realFile);
        header('Content-Type: application/pdf');
        header('Content-Length: ' . filesize($realFile));
        header('Content-Disposition: inline; filename="' . addslashes($fileName) . '"');
        readfile($realFile);
        exit;
    }

    // ─── PUT /admin/employees/{id}/status ────────────────────────────────────

    public function updateStatus(Request $request): void
    {
        $key = $request->param('id');
        $emp = Employee::findByKey($key);
        if (!$emp) Response::error('Employee not found', 404);

        $active = $request->input('active');
        if ($active === null) Response::error('`active` boolean required', 422);

        Database::execute(
            'UPDATE employees SET is_active = ?, updated_at = NOW() WHERE employee_key = ?',
            [$active ? 1 : 0, $key]
        );

        $updated = Employee::findByKey($key);
        Response::success(Employee::format($updated), 'Status updated');
    }

    private function employeePayload(Request $request, bool $forCreate): array
    {
        $fields = [
            'name',
            'email',
            'phone',
            'alternatePhone',
            'department',
            'designation',
            'employmentType',
            'baseSalary',
            'joinedAt',
            'communicationAddress',
            'permanentAddress',
            'sameAsCommunicationAddress',
            'aadhaarNumber',
            'dob',
            'bloodGroup',
            'experience',
            'relativesWorking',
            'relativesDetails',
            'qualifications',
            'bankAccountHolder',
            'bankName',
            'bankAccountNumber',
            'bankIfsc',
            'bankBranch',
            'pfEnabled',
            'pfPercent',
            'bonusPercent',
            'esiEnabled',
            'esiEmployeePercent',
            'foodAllowance',
            'travelAllowance',
            'uniformIssued',
            'uniformIssuedAt',
            'shoesIssued',
            'shoesIssuedAt',
            'active',
            'customId',
        ];

        $payload = [];
        foreach ($fields as $field) {
            $value = $request->input($field);
            if ($value === null && !$forCreate) {
                continue;
            }
            $payload[$field] = $value;
        }

        if ($forCreate) {
            $payload['active'] = $payload['active'] ?? true;
            $payload['email'] = $payload['email'] ?? '';
            $payload['department'] = $payload['department'] ?? '';
            $payload['designation'] = $payload['designation'] ?? '';
            $payload['baseSalary'] = $payload['baseSalary'] ?: 0;
            $payload['joinedAt'] = $payload['joinedAt'] ?? '';
            $payload['employmentType'] = $payload['employmentType'] ?: 'permanent';
            $payload['pfEnabled'] = $payload['pfEnabled'] ?? true;
            $payload['pfPercent'] = $payload['pfPercent'] ?: 12;
            $payload['bonusPercent'] = $payload['bonusPercent'] ?: 0;
            $payload['esiEnabled'] = $payload['esiEnabled'] ?? false;
            $payload['esiEmployeePercent'] = $payload['esiEmployeePercent'] ?: 0.75;
            $payload['foodAllowance'] = $payload['foodAllowance'] ?: 0;
            $payload['travelAllowance'] = $payload['travelAllowance'] ?: 0;
        }

        if (isset($payload['department']) && trim((string)$payload['department']) !== '' && !in_array($payload['department'], self::VALID_DEPARTMENTS, true)) {
            Response::error('Invalid department', 422);
        }

        if (isset($payload['employmentType'])) {
            $payload['employmentType'] = strtolower(trim((string)$payload['employmentType']));
            if (!in_array($payload['employmentType'], self::VALID_EMPLOYMENT_TYPES, true)) {
                Response::error('Invalid employment type', 422);
            }
        }

        if (array_key_exists('sameAsCommunicationAddress', $payload) && $this->boolValue($payload['sameAsCommunicationAddress'])) {
            $payload['permanentAddress'] = $payload['communicationAddress'] ?? $request->input('communicationAddress', '');
        }

        if (array_key_exists('qualifications', $payload)) {
            $payload['qualifications'] = $this->qualifications($payload['qualifications']);
        }

        if (array_key_exists('uniformIssuedAt', $payload)) {
            $payload['uniformValidUntil'] = $this->oneYearFrom($payload['uniformIssuedAt']);
        }

        if (array_key_exists('shoesIssuedAt', $payload)) {
            $payload['shoesValidUntil'] = $this->oneYearFrom($payload['shoesIssuedAt']);
        }

        return $payload;
    }

    private function qualifications(mixed $raw): array
    {
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);
            $raw = is_array($decoded) ? $decoded : [];
        }
        if (!is_array($raw)) {
            return [];
        }

        $rows = [];
        foreach ($raw as $row) {
            if (!is_array($row)) {
                continue;
            }
            $clean = [
                'qualification' => trim((string)($row['qualification'] ?? '')),
                'institution'   => trim((string)($row['institution'] ?? '')),
                'year'          => trim((string)($row['year'] ?? '')),
                'grade'         => trim((string)($row['grade'] ?? '')),
            ];
            if (implode('', $clean) === '') {
                continue;
            }
            $rows[] = $clean;
        }
        return $rows;
    }

    private function boolValue(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        return in_array(strtolower(trim((string)$value)), ['1', 'true', 'yes', 'on'], true);
    }

    private function oneYearFrom(mixed $date): ?string
    {
        $date = trim((string)$date);
        if ($date === '') {
            return null;
        }
        $timestamp = strtotime($date . ' +1 year');
        return $timestamp ? date('Y-m-d', $timestamp) : null;
    }

    private function storeInsurancePdf(string $employeeKey): ?array
    {
        if (!isset($_FILES['insurancePdf']) || !is_array($_FILES['insurancePdf'])) {
            return null;
        }

        $file = $_FILES['insurancePdf'];
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            return null;
        }
        if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
            Response::error('Insurance PDF upload failed', 422);
        }

        if ((int)($file['size'] ?? 0) > 5 * 1024 * 1024) {
            Response::error('Insurance PDF must be 5 MB or less', 422);
        }

        $originalName = (string)($file['name'] ?? 'insurance.pdf');
        $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        if ($extension !== 'pdf') {
            Response::error('Insurance document must be a PDF', 422);
        }

        $mime = function_exists('mime_content_type') ? mime_content_type((string)$file['tmp_name']) : 'application/pdf';
        if ($mime && !in_array($mime, ['application/pdf', 'application/x-pdf', 'application/octet-stream'], true)) {
            Response::error('Insurance document must be a PDF', 422);
        }

        $dir = ROOT_PATH . '/uploads/employee-insurance';
        if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
            Response::error('Could not prepare upload directory', 500);
        }

        $safeKey = preg_replace('/[^A-Z0-9-]/i', '-', $employeeKey) ?: 'employee';
        $fileName = $safeKey . '-' . date('YmdHis') . '-' . bin2hex(random_bytes(4)) . '.pdf';
        $target = $dir . '/' . $fileName;

        if (!move_uploaded_file((string)$file['tmp_name'], $target)) {
            Response::error('Could not save insurance PDF', 500);
        }

        return [
            'insurancePdfPath' => 'uploads/employee-insurance/' . $fileName,
            'insurancePdfName' => $originalName,
        ];
    }

    // ─── Helper: save employee photo ─────────────────────────────────────────

    private function storeEmployeePhoto(string $employeeKey): ?string
    {
        if (!isset($_FILES['employeePhoto']) || !is_array($_FILES['employeePhoto'])) {
            return null;
        }

        $file = $_FILES['employeePhoto'];
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            return null;
        }
        if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
            Response::error('Photo upload failed', 422);
        }

        if ((int)($file['size'] ?? 0) > 3 * 1024 * 1024) {
            Response::error('Employee photo must be 3 MB or less', 422);
        }

        $originalName = (string)($file['name'] ?? 'photo.jpg');
        $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        if (!in_array($extension, ['jpg', 'jpeg', 'png', 'webp'], true)) {
            Response::error('Photo must be JPG, PNG or WebP', 422);
        }

        $mime = function_exists('mime_content_type')
            ? mime_content_type((string)$file['tmp_name'])
            : 'image/jpeg';
        $allowedMimes = ['image/jpeg', 'image/png', 'image/webp', 'image/jpg'];
        if ($mime && !in_array($mime, $allowedMimes, true)) {
            Response::error('Photo must be a valid image (JPG, PNG, WebP)', 422);
        }

        $dir = ROOT_PATH . '/uploads/employee-photos';
        if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
            Response::error('Could not prepare photo upload directory', 500);
        }

        $safeKey  = preg_replace('/[^A-Z0-9-]/i', '-', $employeeKey) ?: 'employee';
        $fileName = $safeKey . '-' . date('YmdHis') . '-' . bin2hex(random_bytes(4)) . '.' . $extension;
        $target   = $dir . '/' . $fileName;

        if (!move_uploaded_file((string)$file['tmp_name'], $target)) {
            Response::error('Could not save employee photo', 500);
        }

        return 'uploads/employee-photos/' . $fileName;
    }
}
