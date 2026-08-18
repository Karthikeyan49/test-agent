<?php
declare(strict_types=1);

class AdminImportController
{
    public function index(Request $request): void
    {
        $result = ImportEngine::listJobs(
            [
                'module' => $request->query('module'),
                'status' => $request->query('status'),
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 20)
        );

        Response::paginated($result['rows'], $result['pagination']);
    }

    public function store(Request $request): void
    {
        $module = trim((string)$request->input('module', ''));
        if ($module === '') {
            Response::error('module is required', 422);
        }
        if (!isset($_FILES['file']) || !is_array($_FILES['file'])) {
            Response::error('file is required', 422);
        }

        $job = ImportEngine::createJob(
            $module,
            $_FILES['file'],
            isset($request->user['user_id']) ? (int)$request->user['user_id'] : null
        );

        Response::success($job, 'Import job created', 201);
    }

    public function show(Request $request): void
    {
        $jobId = (int)$request->param('id');
        if ($jobId <= 0) {
            Response::error('Invalid import job ID', 400);
        }

        Response::success(ImportEngine::getJob($jobId, $request->query('rows') === '1'));
    }

    public function dryRun(Request $request): void
    {
        $jobId = (int)$request->param('id');
        if ($jobId <= 0) {
            Response::error('Invalid import job ID', 400);
        }

        $mapping = $request->input('mapping', []);
        if (!is_array($mapping)) {
            Response::error('mapping must be an object of source column to target field', 422);
        }

        $requiredFields = $request->input('required_fields', $request->input('requiredFields', []));
        if (!is_array($requiredFields)) {
            Response::error('required_fields must be an array', 422);
        }

        Response::success(ImportEngine::dryRun($jobId, $mapping, $requiredFields), 'Import dry-run completed');
    }

    public function commit(Request $request): void
    {
        $jobId = (int)$request->param('id');
        if ($jobId <= 0) {
            Response::error('Invalid import job ID', 400);
        }

        Response::success(
            ImportEngine::markCommitted($jobId),
            'Import job marked committed. Module-specific writers will attach during module implementation.'
        );
    }

    public function errors(Request $request): void
    {
        $jobId = (int)$request->param('id');
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
        header('Cache-Control: private, no-store, max-age=0');
        echo $report['content'];
        exit;
    }
}
