<?php
declare(strict_types=1);

class AdminDataInteropController
{
    public function modules(Request $request): void
    {
        Response::success([
            'import_modules' => DataImportMapper::modules(),
            'export_modules' => DataExportService::modules(),
        ]);
    }

    public function template(Request $request): void
    {
        $template = DataImportMapper::template((string)$request->param('module'));
        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        header_remove('Content-Type');
        header('Content-Type: text/csv; charset=UTF-8');
        header('Content-Disposition: attachment; filename="' . addcslashes($template['filename'], '"\\') . '"');
        echo $template['content'];
        exit;
    }

    public function upload(Request $request): void
    {
        if (!isset($_FILES['file']) || !is_array($_FILES['file'])) {
            Response::error('file is required', 422);
        }
        $job = DataImportMapper::createJob((string)$request->param('module'), $_FILES['file'], $this->actorId($request));
        Response::success($job, 'Import job created', 201);
    }

    public function map(Request $request): void
    {
        $jobId = (int)$request->param('job');
        if ($jobId <= 0) {
            Response::error('Invalid import job ID', 400);
        }
        $mapping = $this->mapping($request, true);
        Database::execute(
            'UPDATE import_jobs SET mapping_json = ?, updated_at = NOW() WHERE job_id = ?',
            [json_encode(['mapping' => $mapping], JSON_UNESCAPED_UNICODE), $jobId]
        );
        Response::success(ImportEngine::getJob($jobId, false), 'Import mapping saved');
    }

    public function aiMap(Request $request): void
    {
        $jobId = (int)$request->param('job');
        if ($jobId <= 0) {
            Response::error('Invalid import job ID', 400);
        }
        Response::success(
            DataImportMapper::aiSuggestMapping((string)$request->param('module'), $jobId),
            'AI suggested a column mapping from the file headers'
        );
    }

    public function dryRun(Request $request): void
    {
        $jobId = (int)$request->param('job');
        if ($jobId <= 0) {
            Response::error('Invalid import job ID', 400);
        }
        $mapping = $this->mapping($request, false) ?? $this->storedMapping($jobId);
        Response::success(
            DataImportMapper::dryRun((string)$request->param('module'), $jobId, $mapping),
            'Import dry-run completed'
        );
    }

    public function showImport(Request $request): void
    {
        $jobId = (int)$request->param('job');
        if ($jobId <= 0) {
            Response::error('Invalid import job ID', 400);
        }
        Response::success(ImportEngine::getJob($jobId, $request->query('rows') === '1'));
    }

    public function errors(Request $request): void
    {
        $jobId = (int)$request->param('job');
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

    public function commit(Request $request): void
    {
        $jobId = (int)$request->param('job');
        if ($jobId <= 0) {
            Response::error('Invalid import job ID', 400);
        }
        Response::success(
            DataImportMapper::commit((string)$request->param('module'), $jobId, $this->actorId($request)),
            'Import committed'
        );
    }

    public function exportModule(Request $request): void
    {
        $module = (string)$request->param('module');
        $this->audit($request, 'export_started', 'export', 0, null, ['module' => $module]);
        DataExportService::streamModule($module, [
            'from' => $request->query('from'),
            'to' => $request->query('to'),
            'status' => $request->query('status'),
        ], (string)$request->query('format', 'csv'));
    }

    public function exportAll(Request $request): void
    {
        $this->audit($request, 'full_export_started', 'export', 0, null, ['scope' => 'all']);
        DataExportService::streamAll([
            'from' => $request->query('from'),
            'to' => $request->query('to'),
        ]);
    }

    public function backupStatus(Request $request): void
    {
        Response::success(BackupService::status());
    }

    public function runBackup(Request $request): void
    {
        Response::success(BackupService::run($this->actorId($request)), 'Backup completed', 201);
    }

    private function mapping(Request $request, bool $required): ?array
    {
        $mapping = $request->input('mapping');
        if ($mapping === null || $mapping === '') {
            if ($required) {
                Response::error('mapping is required', 422);
            }
            return null;
        }
        if (is_array($mapping)) {
            return $mapping;
        }
        $decoded = json_decode((string)$mapping, true);
        if (!is_array($decoded)) {
            Response::error('mapping must be a JSON object', 422);
        }
        return $decoded;
    }

    private function storedMapping(int $jobId): array
    {
        $job = ImportEngine::getJob($jobId, false);
        $mapping = $job['mapping']['mapping'] ?? $job['mapping'] ?? null;
        if (!is_array($mapping)) {
            Response::error('mapping is required before dry-run', 422);
        }
        return $mapping;
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
