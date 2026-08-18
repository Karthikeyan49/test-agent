<?php
declare(strict_types=1);

class AdminComplianceController
{
    public function index(Request $request): void
    {
        $result = EmployeeCompliance::list([
            'employee_key' => $request->query('employee_key'),
            'type' => $request->query('type'),
            'status' => $request->query('status'),
            'expiry_from' => $request->query('expiry_from'),
            'expiry_to' => $request->query('expiry_to'),
        ], (int)$request->query('page', 1), (int)$request->query('limit', 50));

        Response::success($result);
    }

    public function expiring(Request $request): void
    {
        $days = (int)$request->query('days', EmployeeCompliance::alertWindowDays());
        Response::success(EmployeeCompliance::expiring($days));
    }

    public function employeeRecords(Request $request): void
    {
        Response::success(EmployeeCompliance::forEmployee((string)$request->param('key')));
    }

    public function storeForEmployee(Request $request): void
    {
        $record = EmployeeCompliance::create(
            (string)$request->param('key'),
            $this->payload($request),
            $this->uploadedFile(),
            $this->actorId($request)
        );
        $this->audit($request, 'employee_compliance_created', 'employee_compliance', (int)$record['compliance_id'], null, $record);
        Response::success($record, 'Compliance record created', 201);
    }

    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid compliance ID', 400);
        }
        $before = EmployeeCompliance::find($id);
        if (!$before) {
            Response::error('Compliance record not found', 404);
        }
        $record = EmployeeCompliance::update($id, $this->payload($request), $this->uploadedFile(), $this->actorId($request));
        $this->audit($request, 'employee_compliance_updated', 'employee_compliance', $id, $before, $record);
        Response::success($record, 'Compliance record updated');
    }

    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid compliance ID', 400);
        }
        $before = EmployeeCompliance::find($id);
        if (!$before) {
            Response::error('Compliance record not found', 404);
        }
        EmployeeCompliance::delete($id);
        $this->audit($request, 'employee_compliance_deleted', 'employee_compliance', $id, $before, null);
        Response::success(null, 'Compliance record deleted');
    }

    public function download(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid compliance ID', 400);
        }
        $attachment = EmployeeCompliance::attachmentForRecord($id);
        if (!$attachment) {
            Response::error('Compliance document not uploaded', 404);
        }
        FileStore::stream(
            (string)$attachment['file_path'],
            $attachment['original_name'] ?? null,
            $attachment['mime_type'] ?? null,
            $request->query('download') === '1'
        );
    }

    private function payload(Request $request): array
    {
        return $request->only([
            'type',
            'provider',
            'policy_number',
            'coverage_amount',
            'premium',
            'start_date',
            'expiry_date',
            'notes',
        ]);
    }

    private function uploadedFile(): ?array
    {
        foreach (['document', 'file'] as $key) {
            if (isset($_FILES[$key]) && (int)($_FILES[$key]['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
                return $_FILES[$key];
            }
        }
        return null;
    }

    private function actorId(Request $request): ?int
    {
        return isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;
    }

    private function audit(Request $request, string $action, string $table, int $id, mixed $before, mixed $after): void
    {
        Database::execute(
            'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $this->actorId($request),
                $action,
                $table,
                $id,
                $before !== null ? json_encode($before) : null,
                $after !== null ? json_encode($after) : null,
                $request->ip(),
            ]
        );
    }
}
