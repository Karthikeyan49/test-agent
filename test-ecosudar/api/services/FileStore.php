<?php
declare(strict_types=1);

class FileStore
{
    private const MAX_LOCAL_BYTES = 8 * 1024 * 1024;

    private const DANGEROUS_EXTENSIONS = [
        'php', 'phtml', 'phar', 'exe', 'dll', 'bat', 'cmd', 'sh', 'js', 'html', 'htm', 'svg',
    ];

    private const CATEGORY_CONFIG = [
        'certificate' => [
            'module' => 'certificates',
            'max_bytes' => self::MAX_LOCAL_BYTES,
            'extensions' => ['pdf', 'jpg', 'jpeg', 'png'],
            'mimes' => ['application/pdf', 'image/jpeg', 'image/png', 'application/octet-stream'],
        ],
        'meeting_photo' => [
            'module' => 'meetings',
            'max_bytes' => 50 * 1024 * 1024,
            'extensions' => ['jpg', 'jpeg', 'png', 'webp'],
            'mimes' => ['image/jpeg', 'image/png', 'image/webp'],
        ],
        'meeting_video' => [
            'module' => 'meetings',
            'max_bytes' => 200 * 1024 * 1024,
            'extensions' => ['mp4', 'mov', 'webm'],
            'mimes' => ['video/mp4', 'video/quicktime', 'video/webm', 'application/octet-stream'],
        ],
        'import' => [
            'module' => 'imports',
            'max_bytes' => self::MAX_LOCAL_BYTES,
            'extensions' => ['csv', 'xls', 'xlsx'],
            'mimes' => [
                'text/csv',
                'text/plain',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/zip',
                'application/x-zip-compressed',
                'application/octet-stream',
            ],
        ],
        'employee_doc' => [
            'module' => 'employees',
            'max_bytes' => self::MAX_LOCAL_BYTES,
            'extensions' => ['pdf', 'jpg', 'jpeg', 'png'],
            'mimes' => ['application/pdf', 'image/jpeg', 'image/png', 'application/octet-stream'],
        ],
        'sop_document' => [
            'module' => 'sops',
            'max_bytes' => self::MAX_LOCAL_BYTES,
            'extensions' => ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'txt'],
            'mimes' => [
                'application/pdf',
                'application/x-pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/zip',
                'application/x-zip-compressed',
                'text/plain',
                'application/octet-stream',
            ],
        ],
        'po_document' => [
            'module' => 'procurement',
            'max_bytes' => self::MAX_LOCAL_BYTES,
            'extensions' => ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'jpg', 'jpeg', 'png'],
            'mimes' => [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/zip',
                'application/x-zip-compressed',
                'image/jpeg',
                'image/png',
                'application/octet-stream',
            ],
        ],
        'default' => [
            'module' => 'documents',
            'max_bytes' => self::MAX_LOCAL_BYTES,
            'extensions' => ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv', 'txt', 'jpg', 'jpeg', 'png'],
            'mimes' => [
                'application/pdf',
                'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
                'application/vnd.ms-excel',
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
                'application/zip',
                'application/x-zip-compressed',
                'text/csv',
                'text/plain',
                'image/jpeg',
                'image/png',
                'application/octet-stream',
            ],
        ],
    ];

    public static function put(string $category, array $file, ?string $module = null): array
    {
        $category = self::normalizeSlug($category) ?: 'default';
        $config = self::CATEGORY_CONFIG[$category] ?? self::CATEGORY_CONFIG['default'];
        $module = self::normalizeSlug($module ?: $config['module']) ?: $config['module'];

        self::validateUpload($file, $category, $config);

        $originalName = self::safeOriginalName((string)($file['name'] ?? 'upload.bin'));
        $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        $mime = self::detectMime((string)$file['tmp_name'], $extension);

        $directory = ROOT_PATH . '/uploads/' . $module . '/' . date('Y') . '/' . date('m');
        if (!is_dir($directory) && !mkdir($directory, 0755, true)) {
            Response::error('Could not prepare upload directory', 500);
        }

        $storedName = bin2hex(random_bytes(16)) . '.' . $extension;
        $target = $directory . '/' . $storedName;
        $tmpName = (string)$file['tmp_name'];

        $moved = is_uploaded_file($tmpName)
            ? move_uploaded_file($tmpName, $target)
            : (PHP_SAPI === 'cli' && is_file($tmpName) && rename($tmpName, $target));

        if (!$moved) {
            Response::error('Could not save uploaded file', 500);
        }

        chmod($target, 0644);

        return [
            'category' => $category,
            'module' => $module,
            'file_path' => self::relativeUploadsPath($target),
            'stored_name' => $storedName,
            'original_name' => $originalName,
            'mime_type' => $mime,
            'size_bytes' => (int)$file['size'],
            'storage_disk' => 'local',
        ];
    }

    public static function createAttachment(
        string $entityType,
        int $entityId,
        string $category,
        array $storedFile,
        ?int $uploadedBy = null
    ): int {
        return Database::insert(
            'INSERT INTO attachments
                (entity_type, entity_id, category, file_path, original_name, mime_type, size_bytes, storage_disk, uploaded_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                self::normalizeSlug($entityType),
                $entityId,
                self::normalizeSlug($category),
                $storedFile['file_path'],
                $storedFile['original_name'] ?? null,
                $storedFile['mime_type'] ?? null,
                $storedFile['size_bytes'] ?? null,
                $storedFile['storage_disk'] ?? 'local',
                $uploadedBy,
            ]
        );
    }

    public static function resolveLocalPath(string $relativePath): ?string
    {
        $relativePath = ltrim(str_replace('\\', '/', trim($relativePath)), '/');
        if ($relativePath === '' || str_contains($relativePath, '../')) {
            return null;
        }

        $uploadsRoot = realpath(ROOT_PATH . '/uploads');
        $candidate = ROOT_PATH . '/' . $relativePath;
        $realFile = realpath($candidate);

        if (!$uploadsRoot || !$realFile || !is_file($realFile)) {
            return null;
        }

        $uploadsRoot = rtrim(str_replace('\\', '/', $uploadsRoot), '/');
        $realFileNormalized = str_replace('\\', '/', $realFile);

        if ($realFileNormalized !== $uploadsRoot && !str_starts_with($realFileNormalized, $uploadsRoot . '/')) {
            return null;
        }

        return $realFile;
    }

    public static function stream(string $relativePath, ?string $downloadName, ?string $mimeType, bool $download): void
    {
        $realFile = self::resolveLocalPath($relativePath);
        if (!$realFile) {
            Response::error('Attachment file not found', 404);
        }

        while (ob_get_level() > 0) {
            ob_end_clean();
        }

        $name = self::safeDownloadName($downloadName ?: basename($realFile));
        $mime = $mimeType ?: self::detectMime($realFile, strtolower(pathinfo($realFile, PATHINFO_EXTENSION)));
        $disposition = $download ? 'attachment' : 'inline';
        $size = filesize($realFile);

        header_remove('Content-Type');
        header('Content-Type: ' . $mime);
        header('Content-Disposition: ' . $disposition . '; filename="' . addcslashes($name, '"\\') . '"');
        header('Cache-Control: private, no-store, max-age=0');
        // Advertise byte-range support so browsers can stream/seek video & audio
        // instead of downloading the whole file before playback.
        header('Accept-Ranges: bytes');

        $start = 0;
        $end = $size - 1;
        $rangeHeader = $_SERVER['HTTP_RANGE'] ?? '';
        $isPartial = false;

        if ($rangeHeader !== '' && preg_match('/^bytes=(\d*)-(\d*)$/', trim($rangeHeader), $m)) {
            $reqStart = $m[1] === '' ? null : (int) $m[1];
            $reqEnd   = $m[2] === '' ? null : (int) $m[2];

            if ($reqStart === null && $reqEnd !== null) {
                // suffix range: last N bytes
                $start = max(0, $size - $reqEnd);
            } else {
                $start = $reqStart ?? 0;
                if ($reqEnd !== null) $end = min($reqEnd, $size - 1);
            }

            if ($start > $end || $start >= $size) {
                header('HTTP/1.1 416 Range Not Satisfiable');
                header('Content-Range: bytes */' . $size);
                exit;
            }
            $isPartial = true;
        }

        $length = $end - $start + 1;

        if ($isPartial) {
            header('HTTP/1.1 206 Partial Content');
            header('Content-Range: bytes ' . $start . '-' . $end . '/' . $size);
        }
        header('Content-Length: ' . $length);

        $fp = fopen($realFile, 'rb');
        if ($fp === false) {
            Response::error('Could not open attachment file', 500);
        }
        if ($start > 0) fseek($fp, $start);

        $remaining = $length;
        $chunkSize = 8192;
        while ($remaining > 0 && !feof($fp)) {
            $read = fread($fp, (int) min($chunkSize, $remaining));
            if ($read === false) break;
            echo $read;
            flush();
            $remaining -= strlen($read);
        }
        fclose($fp);
        exit;
    }

    public static function deleteLocal(string $relativePath): void
    {
        $realFile = self::resolveLocalPath($relativePath);
        if ($realFile) {
            @unlink($realFile);
        }
    }

    public static function isExternalUrl(string $path): bool
    {
        return (bool)filter_var($path, FILTER_VALIDATE_URL);
    }

    private static function validateUpload(array $file, string $category, array $config): void
    {
        if (($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
            Response::error('File is required', 422);
        }

        if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK) {
            Response::error('Upload failed with code ' . (string)$file['error'], 422);
        }

        $tmpName = (string)($file['tmp_name'] ?? '');
        if ($tmpName === '' || !is_file($tmpName)) {
            Response::error('Uploaded file is not available', 422);
        }

        $size = (int)($file['size'] ?? 0);
        if ($size <= 0) {
            Response::error('Uploaded file is empty', 422);
        }
        if ($size > (int)$config['max_bytes']) {
            Response::error("{$category} file must be " . self::formatBytes((int)$config['max_bytes']) . ' or less', 422);
        }

        $originalName = self::safeOriginalName((string)($file['name'] ?? ''));
        $extension = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
        if ($extension === '' || in_array($extension, self::DANGEROUS_EXTENSIONS, true)) {
            Response::error('This file type is not allowed', 422);
        }
        if (!in_array($extension, $config['extensions'], true)) {
            Response::error("{$category} file extension is not allowed", 422);
        }

        $mime = self::detectMime($tmpName, $extension);
        if (!in_array($mime, $config['mimes'], true)) {
            Response::error("{$category} file MIME type is not allowed", 422);
        }
    }

    private static function detectMime(string $path, string $extension): string
    {
        if (function_exists('finfo_open')) {
            $finfo = finfo_open(FILEINFO_MIME_TYPE);
            if ($finfo) {
                $mime = finfo_file($finfo, $path);
                finfo_close($finfo);
                if (is_string($mime) && $mime !== '') {
                    return $mime;
                }
            }
        }

        return match ($extension) {
            'pdf' => 'application/pdf',
            'doc' => 'application/msword',
            'docx' => 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'xls' => 'application/vnd.ms-excel',
            'xlsx' => 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            'csv' => 'text/csv',
            'txt' => 'text/plain',
            'jpg', 'jpeg' => 'image/jpeg',
            'png' => 'image/png',
            'webp' => 'image/webp',
            'mp4' => 'video/mp4',
            'mov' => 'video/quicktime',
            'webm' => 'video/webm',
            default => 'application/octet-stream',
        };
    }

    private static function relativeUploadsPath(string $absolutePath): string
    {
        $root = rtrim(str_replace('\\', '/', ROOT_PATH), '/');
        $path = str_replace('\\', '/', $absolutePath);

        return ltrim(str_replace($root, '', $path), '/');
    }

    private static function safeOriginalName(string $name): string
    {
        $name = trim(basename(str_replace('\\', '/', $name)));
        $name = preg_replace('/[\x00-\x1F\x7F]+/', '', $name) ?: 'upload.bin';

        return substr($name, 0, 255);
    }

    private static function safeDownloadName(string $name): string
    {
        $name = self::safeOriginalName($name);

        return $name !== '' ? $name : 'attachment';
    }

    private static function normalizeSlug(string $value): string
    {
        $value = strtolower(trim($value));
        $value = preg_replace('/[^a-z0-9_]+/', '_', $value) ?? '';

        return trim($value, '_');
    }

    private static function formatBytes(int $bytes): string
    {
        if ($bytes >= 1024 * 1024) {
            return (string)round($bytes / 1024 / 1024, 1) . ' MB';
        }

        return (string)round($bytes / 1024, 1) . ' KB';
    }
}
