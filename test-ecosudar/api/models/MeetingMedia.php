<?php
declare(strict_types=1);

class MeetingMedia
{
    public static function list(int $meetingId): array
    {
        self::requireMeeting($meetingId);
        $rows = Database::fetchAll(
            "SELECT a.*, u.name AS uploaded_by_name
             FROM attachments a
             LEFT JOIN users u ON u.user_id = a.uploaded_by
             WHERE a.entity_type = 'meeting' AND a.entity_id = ?
               AND a.category IN ('meeting_photo', 'meeting_video')
             ORDER BY a.created_at DESC, a.attachment_id DESC",
            [$meetingId]
        );

        return array_map([self::class, 'format'], $rows);
    }

    public static function uploadFiles(int $meetingId, array $files, ?string $caption, ?int $actorId): array
    {
        self::requireMeeting($meetingId);
        if (!$files) {
            Response::error('At least one file is required', 422);
        }

        $created = [];
        foreach ($files as $file) {
            $category = self::categoryForFile($file);
            $stored = FileStore::put($category, $file, 'meetings');
            $thumbnail = $category === 'meeting_photo'
                ? self::createThumbnail((string)$stored['file_path'])
                : null;
            $attachmentId = FileStore::createAttachment('meeting', $meetingId, $category, $stored, $actorId);
            Database::execute(
                'UPDATE attachments
                    SET caption = ?, thumbnail_path = ?, metadata_json = ?
                  WHERE attachment_id = ?',
                [
                    $caption ? Request::sanitize($caption) : null,
                    $thumbnail,
                    json_encode(['meeting_id' => $meetingId], JSON_UNESCAPED_UNICODE),
                    $attachmentId,
                ]
            );
            $created[] = self::find($attachmentId);
        }

        return array_values(array_filter($created));
    }

    public static function attachExternalVideo(int $meetingId, string $url, ?string $title, ?string $caption, ?int $actorId): array
    {
        self::requireMeeting($meetingId);
        $url = trim($url);
        if (!filter_var($url, FILTER_VALIDATE_URL) || !preg_match('#^https?://#i', $url)) {
            Response::error('external_url must be a valid http/https URL', 422);
        }

        $attachmentId = Database::insert(
            'INSERT INTO attachments
                (entity_type, entity_id, category, caption, file_path, original_name, mime_type,
                 size_bytes, storage_disk, metadata_json, uploaded_by, created_at)
             VALUES ("meeting", ?, "meeting_video", ?, ?, ?, "video/external", NULL, "external", ?, ?, NOW())',
            [
                $meetingId,
                $caption ? Request::sanitize($caption) : null,
                $url,
                $title ? Request::sanitize($title) : 'External video',
                json_encode(['meeting_id' => $meetingId, 'external' => true], JSON_UNESCAPED_UNICODE),
                $actorId,
            ]
        );

        return self::find($attachmentId);
    }

    public static function delete(int $meetingId, int $attachmentId): void
    {
        self::requireMeeting($meetingId);
        $attachment = Database::fetch(
            "SELECT * FROM attachments
             WHERE attachment_id = ? AND entity_type = 'meeting' AND entity_id = ?
             LIMIT 1",
            [$attachmentId, $meetingId]
        );
        if (!$attachment) {
            Response::error('Meeting media not found', 404);
        }

        Database::beginTransaction();
        try {
            Database::execute('DELETE FROM attachments WHERE attachment_id = ?', [$attachmentId]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Meeting media delete failed: ' . $e->getMessage());
            Response::error('Could not delete meeting media', 500);
        }

        if (($attachment['storage_disk'] ?? 'local') === 'local') {
            FileStore::deleteLocal((string)$attachment['file_path']);
            $thumb = (string)($attachment['thumbnail_path'] ?? '');
            if ($thumb !== '' && $thumb !== (string)$attachment['file_path']) {
                FileStore::deleteLocal($thumb);
            }
        }
    }

    private static function find(int $attachmentId): ?array
    {
        $row = Database::fetch(
            'SELECT a.*, u.name AS uploaded_by_name
             FROM attachments a
             LEFT JOIN users u ON u.user_id = a.uploaded_by
             WHERE a.attachment_id = ?
             LIMIT 1',
            [$attachmentId]
        );

        return $row ? self::format($row) : null;
    }

    private static function requireMeeting(int $meetingId): array
    {
        if ($meetingId <= 0) {
            Response::error('Invalid meeting ID', 400);
        }
        $meeting = Meeting::findById($meetingId);
        if (!$meeting) {
            Response::error('Meeting not found', 404);
        }
        return $meeting;
    }

    private static function categoryForFile(array $file): string
    {
        $name = strtolower((string)($file['name'] ?? ''));
        $extension = strtolower(pathinfo($name, PATHINFO_EXTENSION));
        if (in_array($extension, ['jpg', 'jpeg', 'png', 'webp'], true)) {
            return 'meeting_photo';
        }
        if (in_array($extension, ['mp4', 'mov', 'webm'], true)) {
            return 'meeting_video';
        }
        Response::error('Meeting media must be an image or supported video', 422);
    }

    private static function createThumbnail(string $relativePath): string
    {
        $source = FileStore::resolveLocalPath($relativePath);
        if (!$source || !extension_loaded('gd')) {
            return $relativePath;
        }

        $extension = strtolower(pathinfo($source, PATHINFO_EXTENSION));
        $loader = match ($extension) {
            'jpg', 'jpeg' => 'imagecreatefromjpeg',
            'png' => 'imagecreatefrompng',
            'webp' => function_exists('imagecreatefromwebp') ? 'imagecreatefromwebp' : null,
            default => null,
        };
        if (!$loader || !function_exists($loader)) {
            return $relativePath;
        }

        $image = @$loader($source);
        if (!$image) {
            return $relativePath;
        }

        $width = imagesx($image);
        $height = imagesy($image);
        if ($width <= 0 || $height <= 0) {
            imagedestroy($image);
            return $relativePath;
        }

        $max = 360;
        $scale = min($max / $width, $max / $height, 1);
        $thumbWidth = max(1, (int)round($width * $scale));
        $thumbHeight = max(1, (int)round($height * $scale));
        $thumb = imagecreatetruecolor($thumbWidth, $thumbHeight);
        imagecopyresampled($thumb, $image, 0, 0, 0, 0, $thumbWidth, $thumbHeight, $width, $height);

        $directory = dirname($source) . '/thumbs';
        if (!is_dir($directory) && !mkdir($directory, 0755, true)) {
            imagedestroy($image);
            imagedestroy($thumb);
            return $relativePath;
        }

        $target = $directory . '/' . pathinfo($source, PATHINFO_FILENAME) . '-thumb.jpg';
        imagejpeg($thumb, $target, 82);
        imagedestroy($image);
        imagedestroy($thumb);
        chmod($target, 0644);

        return self::relativePath($target);
    }

    private static function relativePath(string $absolutePath): string
    {
        $root = rtrim(str_replace('\\', '/', ROOT_PATH), '/');
        $path = str_replace('\\', '/', $absolutePath);
        return ltrim(str_replace($root, '', $path), '/');
    }

    private static function format(array $row): array
    {
        $metadata = json_decode((string)($row['metadata_json'] ?? '{}'), true);
        if (!is_array($metadata)) {
            $metadata = [];
        }

        return [
            'attachment_id' => (int)$row['attachment_id'],
            'id' => (string)$row['attachment_id'],
            'meeting_id' => (int)$row['entity_id'],
            'category' => $row['category'],
            'type' => $row['category'] === 'meeting_video' ? 'video' : 'photo',
            'caption' => $row['caption'] ?? null,
            'file_path' => $row['file_path'],
            'thumbnail_path' => $row['thumbnail_path'] ?: $row['file_path'],
            'download_url' => '/api/admin/attachments/' . (int)$row['attachment_id'] . '/download',
            'original_name' => $row['original_name'],
            'mime_type' => $row['mime_type'],
            'size_bytes' => $row['size_bytes'] !== null ? (int)$row['size_bytes'] : null,
            'storage_disk' => $row['storage_disk'],
            'metadata' => $metadata,
            'uploaded_by' => $row['uploaded_by'] ? (int)$row['uploaded_by'] : null,
            'uploaded_by_name' => $row['uploaded_by_name'] ?? null,
            'created_at' => $row['created_at'],
        ];
    }
}
