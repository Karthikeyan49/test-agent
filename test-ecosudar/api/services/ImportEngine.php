<?php
declare(strict_types=1);

class ImportEngine
{
    private const VALID_JOB_STATUSES = ['pending', 'validating', 'dry_run', 'committed', 'failed'];
    private const VALID_ROW_STATUSES = ['pending', 'valid', 'invalid', 'imported', 'skipped'];

    public static function createJob(string $module, array $file, ?int $createdBy): array
    {
        $module = self::normalizeModule($module);
        $stored = FileStore::put('import', $file, 'imports');
        $extension = strtolower(pathinfo((string)$stored['original_name'], PATHINFO_EXTENSION));

        if ($extension !== 'csv') {
            FileStore::deleteLocal((string)$stored['file_path']);
            Response::error('CSV imports are supported first. XLS/XLSX reader support will be added with module mappers.', 422);
        }

        $headers = self::headersForPath((string)$stored['file_path']);
        $totalRows = self::countDataRows((string)$stored['file_path']);

        $jobId = Database::insert(
            'INSERT INTO import_jobs
                (module, file_path, status, total_rows, valid_rows, error_rows, created_by, created_at)
             VALUES (?, ?, "pending", ?, 0, 0, ?, NOW())',
            [$module, $stored['file_path'], $totalRows, $createdBy]
        );

        return self::formatJob(self::requireJob($jobId), $headers);
    }

    public static function listJobs(array $filters, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['module'])) {
            $where[] = 'module = ?';
            $params[] = self::normalizeModule((string)$filters['module']);
        }
        if (!empty($filters['status']) && in_array($filters['status'], self::VALID_JOB_STATUSES, true)) {
            $where[] = 'status = ?';
            $params[] = $filters['status'];
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM import_jobs WHERE $whereClause", $params);
        $rows = Database::fetchAll(
            "SELECT *
             FROM import_jobs
             WHERE $whereClause
             ORDER BY created_at DESC, job_id DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        return [
            'rows' => array_map([self::class, 'formatJob'], $rows),
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => (int)ceil($total / $limit),
            ],
        ];
    }

    public static function getJob(int $jobId, bool $includeRows = false): array
    {
        $job = self::requireJob($jobId);
        $headers = self::headersForPath((string)$job['file_path']);
        $formatted = self::formatJob($job, $headers);

        if ($includeRows) {
            $rows = Database::fetchAll(
                'SELECT row_id, job_id, `row_number`, raw_json, status, error_text
                 FROM import_job_rows
                 WHERE job_id = ?
                 ORDER BY `row_number` ASC
                 LIMIT 500',
                [$jobId]
            );
            $formatted['rows'] = array_map([self::class, 'formatRow'], $rows);
        }

        return $formatted;
    }

    public static function dryRun(int $jobId, array $mapping, array $requiredFields = []): array
    {
        $job = self::requireJob($jobId);
        $headers = self::headersForPath((string)$job['file_path']);
        $normalizedMapping = self::normalizeMapping($mapping, $headers);
        $requiredFields = self::normalizeRequiredFields($requiredFields);

        Database::beginTransaction();
        try {
            Database::execute(
                'UPDATE import_jobs SET status = "validating", updated_at = NOW() WHERE job_id = ?',
                [$jobId]
            );
            Database::execute('DELETE FROM import_job_rows WHERE job_id = ?', [$jobId]);

            $stats = [
                'total_rows' => 0,
                'valid_rows' => 0,
                'error_rows' => 0,
            ];

            foreach (self::rowsForPath((string)$job['file_path']) as $rowNumber => $sourceRow) {
                $mapped = self::mapRow($sourceRow, $normalizedMapping);
                $errors = self::validateMappedRow($mapped, $requiredFields);
                $status = empty($errors) ? 'valid' : 'invalid';

                $stats['total_rows']++;
                if ($status === 'valid') {
                    $stats['valid_rows']++;
                } else {
                    $stats['error_rows']++;
                }

                Database::execute(
                    'INSERT INTO import_job_rows (job_id, `row_number`, raw_json, status, error_text)
                     VALUES (?, ?, ?, ?, ?)',
                    [
                        $jobId,
                        $rowNumber,
                        json_encode(['source' => $sourceRow, 'mapped' => $mapped], JSON_UNESCAPED_UNICODE),
                        $status,
                        empty($errors) ? null : implode('; ', $errors),
                    ]
                );
            }

            Database::execute(
                'UPDATE import_jobs
                 SET status = "dry_run", total_rows = ?, valid_rows = ?, error_rows = ?, mapping_json = ?, updated_at = NOW()
                 WHERE job_id = ?',
                [
                    $stats['total_rows'],
                    $stats['valid_rows'],
                    $stats['error_rows'],
                    json_encode([
                        'mapping' => $normalizedMapping,
                        'required_fields' => $requiredFields,
                    ], JSON_UNESCAPED_UNICODE),
                    $jobId,
                ]
            );

            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            Database::execute(
                'UPDATE import_jobs SET status = "failed", updated_at = NOW() WHERE job_id = ?',
                [$jobId]
            );
            error_log('Import dry-run failed: ' . $e->getMessage());
            Response::error('Import dry-run failed', 500);
        }

        return self::getJob($jobId, true);
    }

    public static function markCommitted(int $jobId): array
    {
        $job = self::requireJob($jobId);
        if ($job['status'] !== 'dry_run') {
            Response::error('Run dry-run validation before commit', 422);
        }
        if ((int)$job['error_rows'] > 0) {
            Response::error('Fix invalid rows before commit', 422);
        }

        Database::beginTransaction();
        try {
            Database::execute(
                'UPDATE import_job_rows SET status = "imported" WHERE job_id = ? AND status = "valid"',
                [$jobId]
            );
            Database::execute(
                'UPDATE import_jobs SET status = "committed", updated_at = NOW() WHERE job_id = ?',
                [$jobId]
            );
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Import commit mark failed: ' . $e->getMessage());
            Response::error('Import commit failed', 500);
        }

        return self::getJob($jobId, true);
    }

    public static function errorReport(int $jobId): array
    {
        $job = self::requireJob($jobId);
        $rows = Database::fetchAll(
            'SELECT `row_number`, raw_json, status, error_text
             FROM import_job_rows
             WHERE job_id = ? AND status = "invalid"
             ORDER BY `row_number` ASC',
            [$jobId]
        );

        $handle = fopen('php://temp', 'r+');
        fputcsv($handle, ['row_number', 'error_text', 'mapped_json', 'source_json']);
        foreach ($rows as $row) {
            $raw = json_decode((string)($row['raw_json'] ?? '{}'), true);
            fputcsv($handle, [
                $row['row_number'],
                $row['error_text'],
                json_encode($raw['mapped'] ?? [], JSON_UNESCAPED_UNICODE),
                json_encode($raw['source'] ?? [], JSON_UNESCAPED_UNICODE),
            ]);
        }
        rewind($handle);
        $content = stream_get_contents($handle) ?: '';
        fclose($handle);

        return [
            'filename' => 'import-job-' . (int)$job['job_id'] . '-errors.csv',
            'content' => $content,
        ];
    }

    private static function requireJob(int $jobId): array
    {
        $job = Database::fetch('SELECT * FROM import_jobs WHERE job_id = ? LIMIT 1', [$jobId]);
        if (!$job) {
            Response::error('Import job not found', 404);
        }

        return $job;
    }

    private static function headersForPath(string $relativePath): array
    {
        $realPath = FileStore::resolveLocalPath($relativePath);
        if (!$realPath) {
            Response::error('Import file not found', 404);
        }

        $handle = fopen($realPath, 'r');
        if (!$handle) {
            Response::error('Could not read import file', 500);
        }

        $delimiter = self::detectDelimiter($realPath);
        $headers = fgetcsv($handle, 0, $delimiter);
        fclose($handle);

        if (!is_array($headers) || empty($headers)) {
            Response::error('Import file must contain a header row', 422);
        }

        return self::normalizeHeaders($headers);
    }

    private static function rowsForPath(string $relativePath): Generator
    {
        $realPath = FileStore::resolveLocalPath($relativePath);
        if (!$realPath) {
            Response::error('Import file not found', 404);
        }

        $handle = fopen($realPath, 'r');
        if (!$handle) {
            Response::error('Could not read import file', 500);
        }

        $delimiter = self::detectDelimiter($realPath);
        $headers = self::normalizeHeaders(fgetcsv($handle, 0, $delimiter) ?: []);
        $rowNumber = 1;

        while (($values = fgetcsv($handle, 0, $delimiter)) !== false) {
            $rowNumber++;
            if (self::isBlankRow($values)) {
                continue;
            }

            $row = [];
            foreach ($headers as $index => $header) {
                $row[$header] = isset($values[$index]) ? trim((string)$values[$index]) : '';
            }

            yield $rowNumber => $row;
        }

        fclose($handle);
    }

    private static function countDataRows(string $relativePath): int
    {
        $count = 0;
        foreach (self::rowsForPath($relativePath) as $_row) {
            $count++;
        }

        return $count;
    }

    private static function detectDelimiter(string $realPath): string
    {
        $lines = file($realPath, FILE_IGNORE_NEW_LINES);
        $line = is_array($lines) ? (string)($lines[0] ?? '') : '';
        if (trim($line) === '') {
            Response::error('Import file must contain a header row', 422);
        }

        $candidates = [',' => 0, ';' => 0, "\t" => 0];
        foreach ($candidates as $delimiter => $_count) {
            $candidates[$delimiter] = count(str_getcsv($line, $delimiter));
        }

        arsort($candidates);
        return (string)array_key_first($candidates);
    }

    private static function normalizeHeaders(array $headers): array
    {
        $seen = [];
        $out = [];

        foreach ($headers as $index => $header) {
            $header = trim((string)$header);
            $header = preg_replace('/^\xEF\xBB\xBF/', '', $header) ?: '';
            if ($header === '') {
                $header = 'column_' . ($index + 1);
            }

            $base = $header;
            $suffix = 2;
            while (isset($seen[strtolower($header)])) {
                $header = $base . '_' . $suffix;
                $suffix++;
            }
            $seen[strtolower($header)] = true;
            $out[] = $header;
        }

        return $out;
    }

    private static function normalizeMapping(array $mapping, array $headers): array
    {
        $normalized = [];
        $headerLookup = array_change_key_case(array_flip($headers), CASE_LOWER);

        foreach ($mapping as $sourceColumn => $targetField) {
            $sourceColumn = trim((string)$sourceColumn);
            $targetField = self::normalizeField((string)$targetField);
            if ($sourceColumn === '' || $targetField === '') {
                continue;
            }

            $lookupKey = strtolower($sourceColumn);
            if (!array_key_exists($lookupKey, $headerLookup)) {
                Response::error("Mapping references unknown column: {$sourceColumn}", 422);
            }

            $normalized[$headers[$headerLookup[$lookupKey]]] = $targetField;
        }

        if (empty($normalized)) {
            Response::error('Provide at least one column mapping', 422);
        }

        return $normalized;
    }

    private static function normalizeRequiredFields(array $requiredFields): array
    {
        $out = [];
        foreach ($requiredFields as $field) {
            $field = self::normalizeField((string)$field);
            if ($field !== '') {
                $out[] = $field;
            }
        }

        return array_values(array_unique($out));
    }

    private static function mapRow(array $sourceRow, array $mapping): array
    {
        $mapped = [];
        foreach ($mapping as $sourceColumn => $targetField) {
            $mapped[$targetField] = $sourceRow[$sourceColumn] ?? '';
        }

        return $mapped;
    }

    private static function validateMappedRow(array $mapped, array $requiredFields): array
    {
        $errors = [];
        foreach ($requiredFields as $field) {
            if (trim((string)($mapped[$field] ?? '')) === '') {
                $errors[] = "{$field} is required";
            }
        }

        return $errors;
    }

    private static function normalizeModule(string $module): string
    {
        $module = strtolower(trim($module));
        $module = preg_replace('/[^a-z0-9_]+/', '_', $module) ?? '';
        $module = trim($module, '_');

        if ($module === '') {
            Response::error('module is required', 422);
        }

        return substr($module, 0, 40);
    }

    private static function normalizeField(string $field): string
    {
        $field = strtolower(trim($field));
        $field = preg_replace('/[^a-z0-9_]+/', '_', $field) ?? '';

        return trim($field, '_');
    }

    private static function isBlankRow(array $values): bool
    {
        foreach ($values as $value) {
            if (trim((string)$value) !== '') {
                return false;
            }
        }

        return true;
    }

    private static function formatJob(array $row, ?array $headers = null): array
    {
        $mapping = json_decode((string)($row['mapping_json'] ?? ''), true);
        if (!is_array($mapping)) {
            $mapping = null;
        }

        return [
            'job_id' => (int)$row['job_id'],
            'module' => $row['module'],
            'file_path' => $row['file_path'],
            'status' => $row['status'],
            'total_rows' => (int)$row['total_rows'],
            'valid_rows' => (int)$row['valid_rows'],
            'error_rows' => (int)$row['error_rows'],
            'mapping' => $mapping,
            'headers' => $headers,
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }

    private static function formatRow(array $row): array
    {
        $raw = json_decode((string)($row['raw_json'] ?? '{}'), true);
        if (!is_array($raw)) {
            $raw = [];
        }

        return [
            'row_id' => (int)$row['row_id'],
            'job_id' => (int)$row['job_id'],
            'row_number' => (int)$row['row_number'],
            'source' => $raw['source'] ?? [],
            'mapped' => $raw['mapped'] ?? [],
            'status' => $row['status'],
            'error_text' => $row['error_text'],
        ];
    }
}
