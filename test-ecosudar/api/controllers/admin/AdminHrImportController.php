<?php
declare(strict_types=1);

class AdminHrImportController
{
    public function employeeImport(Request $request): void
    {
        $result = $this->processImport(
            $request,
            [HrImport::class, 'createEmployeeJob'],
            [HrImport::class, 'dryRunEmployees'],
            [HrImport::class, 'commitEmployees']
        );
        Response::success($result, 'Employee import processed');
    }

    public function attendanceImport(Request $request): void
    {
        $result = $this->processImport(
            $request,
            [HrImport::class, 'createAttendanceJob'],
            [HrImport::class, 'dryRunAttendance'],
            [HrImport::class, 'commitAttendance']
        );
        Response::success($result, 'Attendance import processed');
    }

    public function employeeImportErrors(Request $request): void
    {
        $this->streamErrors((int)$request->param('job'));
    }

    public function attendanceImportErrors(Request $request): void
    {
        $this->streamErrors((int)$request->param('job'));
    }

    private function processImport(Request $request, callable $createJob, callable $dryRun, callable $commit): array
    {
        $jobId = (int)($request->input('job_id') ?? $request->query('job_id') ?? 0);
        $action = strtolower(trim((string)($request->input('action') ?? $request->query('action') ?? '')));
        $commitRequested = $action === 'commit' || $this->boolInput($request->input('commit', false));
        $mapping = $this->mapping($request->input('mapping'));
        $file = $this->uploadedFile();

        if ($file !== null) {
            $job = $createJob($file, $this->actorId($request));
            $jobId = (int)$job['job_id'];
        } elseif ($jobId <= 0) {
            Response::error('Upload a CSV file or provide job_id', 422);
        }

        if ($mapping !== null) {
            $result = $dryRun($jobId, $mapping);
            if (!$commitRequested) {
                return $result;
            }
        }

        if ($commitRequested) {
            return $commit($jobId);
        }

        return ImportEngine::getJob($jobId, true);
    }

    private function streamErrors(int $jobId): void
    {
        if ($jobId <= 0) {
            Response::error('Invalid import job ID', 400);
        }
        $report = ImportEngine::errorReport($jobId);
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        header_remove('Content-Type');
        header('Content-Type: text/csv; charset=UTF-8');
        header('Content-Disposition: attachment; filename="' . addcslashes($report['filename'], '"\\') . '"');
        echo $report['content'];
        exit;
    }

    private function uploadedFile(): ?array
    {
        foreach (['file', 'import', 'csv'] as $key) {
            if (isset($_FILES[$key]) && (int)($_FILES[$key]['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
                return $_FILES[$key];
            }
        }
        return null;
    }

    private function mapping(mixed $value): ?array
    {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_array($value)) {
            return $value;
        }
        $decoded = json_decode((string)$value, true);
        if (!is_array($decoded)) {
            Response::error('mapping must be a JSON object', 422);
        }
        return $decoded;
    }

    private function boolInput(mixed $value): bool
    {
        if (is_bool($value)) {
            return $value;
        }
        return in_array(strtolower(trim((string)$value)), ['1', 'true', 'yes', 'on'], true);
    }

    private function actorId(Request $request): ?int
    {
        return isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;
    }
}
