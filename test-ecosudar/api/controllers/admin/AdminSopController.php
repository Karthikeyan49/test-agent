<?php
declare(strict_types=1);

class AdminSopController
{
    private const VALID_ROLES = ['All Staff', 'Managers', 'Department Only', 'Admin Only'];
    private const VALID_STATUSES = ['Draft', 'Pending Approval', 'Approved', 'Archived'];

    /**
     * GET /api/admin/sops - List all SOPs
     */
    public function index(Request $request): void
    {
        $filters = [];
        
        if ($dept = $request->query('department')) {
            $filters['department'] = $dept;
        }
        if ($role = $request->query('access_role')) {
            $filters['access_role'] = $role;
        }
        if ($search = $request->query('search')) {
            $filters['search'] = $search;
        }

        $rows = Sop::all($filters);
        Response::success(array_map([Sop::class, 'format'], $rows));
    }

    /**
     * GET /api/admin/sops/categories - Get available departments
     */
    public function categories(Request $request): void
    {
        $departments = Sop::getDepartments();
        Response::success($departments);
    }

    /**
     * GET /api/admin/sops/{id} - Get single SOP with all versions
     */
    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        $sop = Sop::findById($id);
        
        if (!$sop) {
            Response::error('SOP not found', 404);
        }
        
        Response::success(Sop::format($sop));
    }

    /**
     * POST /api/admin/sops - Create new SOP
     */
    public function store(Request $request): void
    {
        $code = trim((string)$request->input('code', ''));
        $title = trim((string)$request->input('title', ''));
        $department = trim((string)$request->input('department', ''));
        $description = trim((string)$request->input('description', ''));
        $owner_id = $this->ownerId($request);
        $access_role = trim((string)($request->input('access_role') ?? $request->input('accessRole', 'All Staff')));
        $tags = $this->parseTags($request->input('tags', []));

        // Validation
        if (!$code) Response::error('Code is required', 422);
        if (!$title) Response::error('Title is required', 422);
        if (!$department) Response::error('Department is required', 422);
        
        if (strlen($code) > 20) {
            Response::error('Code must not exceed 20 characters', 422);
        }
        if (strlen($title) > 200) {
            Response::error('Title must not exceed 200 characters', 422);
        }

        $validDepartments = Sop::getDepartments();
        if (!in_array($department, $validDepartments, true)) {
            Response::error('Invalid department', 422);
        }

        if (!in_array($access_role, self::VALID_ROLES, true)) {
            Response::error('Invalid access role', 422);
        }

        // Check if SOP code already exists
        $existing = Database::fetch(
            'SELECT sop_id FROM sops WHERE code = ? LIMIT 1',
            [$code]
        );
        if ($existing) {
            Response::error('SOP code already exists. Please use a different code.', 422);
        }

        $document = $this->storeSopDocument($code, '1.0');

        $id = Sop::create([
            'code' => $code,
            'title' => $title,
            'department' => $department,
            'description' => $description,
            'owner_id' => $owner_id,
            'access_role' => $access_role,
            'tags' => $tags,
        ]);

        if ($document) {
            $versionId = Sop::addVersion($id, [
                'version' => '1.0',
                'uploaded_by' => (int)($request->user['user_id'] ?? 0) ?: null,
                'file_name' => $document['file_name'],
                'file_path' => $document['file_path'],
                'file_size' => $document['file_size'],
                'mime_type' => $document['mime_type'],
                'change_log' => trim((string)$request->input('change_log', 'Initial SOP document upload')),
                'status' => 'Pending Approval',
            ]);
            Sop::setCurrentVersion($id, $versionId);
        }

        $row = Sop::findById($id);
        Response::success(Sop::format($row), 'SOP created', 201);
    }

    /**
     * PUT /api/admin/sops/{id} - Update SOP
     */
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $sop = Sop::findById($id);
        
        if (!$sop) {
            Response::error('SOP not found', 404);
        }

        $data = [];
        
        // Simple fields
        foreach (['code', 'title', 'department', 'description', 'access_role'] as $field) {
            $val = $request->input($field);
            if ($val !== null) {
                $data[$field] = trim((string)$val);
            }
        }

        if ($request->input('owner_id') !== null || $request->input('ownerId') !== null) {
            $data['owner_id'] = $this->ownerId($request, false);
        }
        if ($request->input('tags') !== null) {
            $data['tags'] = $this->parseTags($request->input('tags'));
        }

        if (empty($data)) {
            Response::error('No fields to update', 400);
        }

        // Validation
        if (isset($data['code']) && strlen($data['code']) > 20) {
            Response::error('Code must not exceed 20 characters', 422);
        }
        if (isset($data['title']) && strlen($data['title']) > 200) {
            Response::error('Title must not exceed 200 characters', 422);
        }
        if (isset($data['department'])) {
            $validDepartments = Sop::getDepartments();
            if (!in_array($data['department'], $validDepartments, true)) {
                Response::error('Invalid department', 422);
            }
        }
        if (isset($data['access_role'])) {
            if (!in_array($data['access_role'], self::VALID_ROLES, true)) {
                Response::error('Invalid access role', 422);
            }
        }

        Sop::update($id, $data);
        
        $updated = Sop::findById($id);
        Response::success(Sop::format($updated), 'SOP updated');
    }

    /**
     * POST /api/admin/sops/{id}/versions - Upload a new SOP document version
     */
    public function uploadVersion(Request $request): void
    {
        $id = (int)$request->param('id');
        $sop = Sop::findById($id);

        if (!$sop) {
            Response::error('SOP not found', 404);
        }

        $changeLog = trim((string)$request->input('change_log', ''));
        if ($changeLog === '') {
            Response::error('Change log is required', 422);
        }

        $major = in_array((string)$request->input('major', '0'), ['1', 'true', 'yes', 'on'], true);
        $version = Sop::nextVersion($id, $major);
        $document = $this->storeSopDocument((string)$sop['code'], $version, true);

        $versionId = Sop::addVersion($id, [
            'version' => $version,
            'uploaded_by' => (int)($request->user['user_id'] ?? 0) ?: null,
            'file_name' => $document['file_name'],
            'file_path' => $document['file_path'],
            'file_size' => $document['file_size'],
            'mime_type' => $document['mime_type'],
            'change_log' => $changeLog,
            'status' => 'Pending Approval',
        ]);

        if (empty($sop['current_version_id'])) {
            Sop::setCurrentVersion($id, $versionId);
        }

        $updated = Sop::findById($id);
        Response::success(Sop::format($updated), 'SOP version uploaded', 201);
    }

    /**
     * PUT /api/admin/sops/{id}/versions/{versionId}/status
     */
    public function updateVersionStatus(Request $request): void
    {
        $id = (int)$request->param('id');
        $versionId = (int)$request->param('versionId');
        $status = trim((string)$request->input('status', ''));

        if (!in_array($status, self::VALID_STATUSES, true)) {
            Response::error('Invalid version status', 422);
        }

        $sop = Sop::findById($id);
        if (!$sop) {
            Response::error('SOP not found', 404);
        }

        $success = Sop::updateVersionStatus(
            $id,
            $versionId,
            $status,
            isset($request->user['user_id']) ? (int)$request->user['user_id'] : null
        );

        if (!$success) {
            Response::error('SOP version not found or could not be updated', 404);
        }

        $updated = Sop::findById($id);
        Response::success(Sop::format($updated), 'SOP version status updated');
    }

    /**
     * GET /api/admin/sops/{id}/versions/{versionId}/download
     */
    public function downloadVersion(Request $request): void
    {
        $id = (int)$request->param('id');
        $versionId = (int)$request->param('versionId');
        $version = Sop::findVersion($id, $versionId);

        if (!$version) {
            Response::error('SOP version not found', 404);
        }

        $relativePath = trim((string)($version['file_path'] ?? ''));
        if ($relativePath === '') {
            $relativePath = 'uploads/sops/' . basename((string)($version['file_name'] ?? ''));
        }
        if ($relativePath === 'uploads/sops/') {
            Response::error('SOP document path is not available', 404);
        }

        FileStore::stream(
            $relativePath,
            $version['file_name'] ?? null,
            $version['mime_type'] ?? null,
            $request->query('download') === '1'
        );
    }

    /**
     * DELETE /api/admin/sops/{id} - Delete SOP
     */
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        $sop = Sop::findById($id);
        
        if (!$sop) {
            Response::error('SOP not found', 404);
        }

        foreach (($sop['versions'] ?? []) as $version) {
            $this->deleteStoredDocument((string)($version['file_path'] ?? ''));
        }

        Sop::delete($id);
        Response::success(null, 'SOP deleted');
    }

    /**
     * POST /api/admin/sops/{id}/publish - Publish SOP (approve and set as current)
     */
    public function publish(Request $request): void
    {
        $id = (int)$request->param('id');
        $sop = Sop::findById($id);
        
        if (!$sop) {
            Response::error('SOP not found', 404);
        }

        // Check if there are any versions
        if (empty($sop['versions'])) {
            Response::error('No versions available to publish', 400);
        }

        $userId = $request->user['user_id'] ?? null;
        if (!$userId) {
            Response::error('User not authenticated', 401);
        }

        $success = Sop::publish($id, $userId);
        
        if (!$success) {
            Response::error('Failed to publish SOP', 500);
        }

        $updated = Sop::findById($id);
        Response::success(Sop::format($updated), 'SOP published');
    }

    private function ownerId(Request $request, bool $defaultToCurrentUser = true): ?int
    {
        $raw = $request->input('owner_id');
        if ($raw === null) {
            $raw = $request->input('ownerId');
        }

        if ($raw === null || $raw === '') {
            return $defaultToCurrentUser && isset($request->user['user_id'])
                ? (int)$request->user['user_id']
                : null;
        }

        $ownerId = (int)$raw;
        return $ownerId > 0 ? $ownerId : null;
    }

    private function parseTags(mixed $value): array
    {
        if (is_array($value)) {
            return array_values(array_filter(array_map(
                fn($tag) => trim((string)$tag),
                $value
            )));
        }

        if (is_string($value)) {
            $trimmed = trim($value);
            if ($trimmed === '') {
                return [];
            }
            $decoded = json_decode($trimmed, true);
            if (is_array($decoded)) {
                return $this->parseTags($decoded);
            }
            return array_values(array_filter(array_map('trim', explode(',', $trimmed))));
        }

        return [];
    }

    private function storeSopDocument(string $sopCode, string $version, bool $required = false): ?array
    {
        if (!isset($_FILES['document']) || !is_array($_FILES['document'])) {
            if ($required) {
                Response::error('SOP document is required', 422);
            }
            return null;
        }

        $file = $_FILES['document'];
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            if ($required) {
                Response::error('SOP document is required', 422);
            }
            return null;
        }

        $stored = FileStore::put('sop_document', $file, 'sops');

        return [
            'file_name' => $stored['original_name'],
            'file_path' => $stored['file_path'],
            'file_size' => $stored['size_bytes'],
            'mime_type' => $stored['mime_type'],
        ];
    }

    private function deleteStoredDocument(string $relativePath): void
    {
        FileStore::deleteLocal($relativePath);
    }
}
