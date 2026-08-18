<?php
declare(strict_types=1);

class Sop
{
    private const DEPARTMENTS = [
        'Procurement',
        'Production',
        'Quality Control',
        'Packing',
        'Sales',
        'Marketing',
        'Material Management',
        'HR',
        'Dispatch',
        'Service',
        'Customer Care',
    ];

    public static function all(array $filters = []): array
    {
        $where = ['1=1'];
        $params = [];

        // Filter by department
        if (!empty($filters['department'])) {
            $where[] = 's.department = ?';
            $params[] = $filters['department'];
        }

        // Filter by access role
        if (!empty($filters['access_role'])) {
            $where[] = 's.access_role = ?';
            $params[] = $filters['access_role'];
        }

        // Search by title or code
        if (!empty($filters['search'])) {
            $where[] = '(s.title LIKE ? OR s.code LIKE ?)';
            $params[] = '%' . $filters['search'] . '%';
            $params[] = '%' . $filters['search'] . '%';
        }

        $sql = "SELECT s.*, 
                       sv.version as current_version,
                       sv.status as version_status,
                       sv.file_name,
                       sv.file_path,
                       sv.mime_type,
                       u.name as owner_name
                FROM sops s
                LEFT JOIN sop_versions sv ON s.current_version_id = sv.version_id
                LEFT JOIN users u ON s.owner_id = u.user_id
                WHERE " . implode(' AND ', $where) . "
                ORDER BY s.code ASC";

        $sops = Database::fetchAll($sql, $params);
        
        // Load versions for each SOP
        foreach ($sops as &$sop) {
            $sop['versions'] = self::getVersions((int)$sop['sop_id']);
        }
        
        return $sops;
    }

    public static function findById(int $id): ?array
    {
        $sop = Database::fetch(
            "SELECT s.*, u.name as owner_name
             FROM sops s
             LEFT JOIN users u ON s.owner_id = u.user_id
             WHERE s.sop_id = ?",
            [$id]
        );

        if (!$sop) {
            return null;
        }

        // Get all versions
        $sop['versions'] = self::getVersions($id);

        return $sop;
    }

    public static function getVersions(int $sopId): array
    {
        return Database::fetchAll(
            "SELECT sv.*, u.name as uploaded_by_name, a.name as approved_by_name
             FROM sop_versions sv
             LEFT JOIN users u ON sv.uploaded_by = u.user_id
             LEFT JOIN users a ON sv.approved_by = a.user_id
             WHERE sv.sop_id = ?
             ORDER BY sv.uploaded_at DESC",
            [$sopId]
        );
    }

    public static function findVersion(int $sopId, int $versionId): ?array
    {
        return Database::fetch(
            "SELECT sv.*, s.code, s.title
             FROM sop_versions sv
             JOIN sops s ON s.sop_id = sv.sop_id
             WHERE sv.sop_id = ? AND sv.version_id = ?
             LIMIT 1",
            [$sopId, $versionId]
        );
    }

    public static function nextVersion(int $sopId, bool $major): string
    {
        $latest = Database::fetch(
            'SELECT version FROM sop_versions WHERE sop_id = ? ORDER BY version_id DESC LIMIT 1',
            [$sopId]
        );

        if (!$latest || !preg_match('/^(\d+)(?:\.(\d+))?$/', (string)$latest['version'], $m)) {
            return '1.0';
        }

        $majorPart = (int)$m[1];
        $minorPart = isset($m[2]) ? (int)$m[2] : 0;

        return $major ? ($majorPart + 1) . '.0' : $majorPart . '.' . ($minorPart + 1);
    }

    public static function create(array $data): int
    {
        $id = Database::insert(
            'INSERT INTO sops
                (code, title, department, description, owner_id, access_role, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [
                $data['code'],
                $data['title'],
                $data['department'],
                $data['description'] ?? null,
                $data['owner_id'] ?? null,
                $data['access_role'] ?? 'All Staff',
            ]
        );
        // Tags live in the sop_tags junction (one row per tag).
        self::syncTags($id, is_array($data['tags'] ?? null) ? $data['tags'] : []);
        return $id;
    }

    /** An SOP's tags as a plain string array (from the sop_tags junction). */
    public static function tagsFor(int $sopId): array
    {
        return array_column(
            Database::fetchAll('SELECT tag FROM sop_tags WHERE sop_id = ? ORDER BY tag ASC', [$sopId]),
            'tag'
        );
    }

    /** Replace an SOP's tag set (deduped, non-empty). */
    public static function syncTags(int $sopId, array $tags): void
    {
        Database::execute('DELETE FROM sop_tags WHERE sop_id = ?', [$sopId]);
        $seen = [];
        foreach ($tags as $t) {
            $t = trim((string)$t);
            if ($t === '' || isset($seen[$t])) continue;
            $seen[$t] = true;
            Database::execute('INSERT IGNORE INTO sop_tags (sop_id, tag) VALUES (?, ?)', [$sopId, $t]);
        }
    }

    public static function update(int $id, array $data): void
    {
        $fields = [];
        $params = [];

        $fieldMap = [
            'code' => 'code',
            'title' => 'title',
            'department' => 'department',
            'description' => 'description',
            'owner_id' => 'owner_id',
            'access_role' => 'access_role',
        ];

        foreach ($fieldMap as $key => $col) {
            if (array_key_exists($key, $data)) {
                $fields[] = "$col = ?";
                $params[] = $data[$key];
            }
        }

        // Tags → sop_tags junction (handled separately, not a column)
        if (array_key_exists('tags', $data)) {
            self::syncTags($id, is_array($data['tags']) ? $data['tags'] : []);
        }

        if (empty($fields)) {
            return;
        }

        $fields[] = 'updated_at = NOW()';
        $params[] = $id;

        Database::execute(
            'UPDATE sops SET ' . implode(', ', $fields) . ' WHERE sop_id = ?',
            $params
        );
    }

    public static function delete(int $id): void
    {
        Database::execute('DELETE FROM sops WHERE sop_id = ?', [$id]);
    }

    public static function addVersion(int $sopId, array $data): int
    {
        return Database::insert(
            'INSERT INTO sop_versions 
                (sop_id, version, uploaded_by, file_name, file_path, file_size, mime_type, change_log, status, uploaded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $sopId,
                $data['version'],
                $data['uploaded_by'] ?? null,
                $data['file_name'],
                $data['file_path'] ?? null,
                $data['file_size'],
                $data['mime_type'] ?? null,
                $data['change_log'] ?? null,
                $data['status'] ?? 'Draft',
            ]
        );
    }

    public static function setCurrentVersion(int $sopId, int $versionId): void
    {
        Database::execute(
            'UPDATE sops SET current_version_id = ?, updated_at = NOW() WHERE sop_id = ?',
            [$versionId, $sopId]
        );
    }

    public static function updateVersionStatus(int $sopId, int $versionId, string $status, ?int $userId): bool
    {
        try {
            $version = self::findVersion($sopId, $versionId);
            if (!$version) {
                return false;
            }

            if ($status === 'Approved') {
                Database::execute(
                    'UPDATE sop_versions
                     SET status = "Approved", approved_by = ?, approved_at = NOW()
                     WHERE version_id = ? AND sop_id = ?',
                    [$userId, $versionId, $sopId]
                );
                self::setCurrentVersion($sopId, $versionId);
                return true;
            }

            Database::execute(
                'UPDATE sop_versions SET status = ? WHERE version_id = ? AND sop_id = ?',
                [$status, $versionId, $sopId]
            );

            if ($status === 'Archived') {
                $sop = Database::fetch('SELECT current_version_id FROM sops WHERE sop_id = ? LIMIT 1', [$sopId]);
                if ((int)($sop['current_version_id'] ?? 0) === $versionId) {
                    $fallback = Database::fetch(
                        'SELECT version_id FROM sop_versions
                         WHERE sop_id = ? AND status = "Approved" AND version_id != ?
                         ORDER BY approved_at DESC, uploaded_at DESC, version_id DESC
                         LIMIT 1',
                        [$sopId, $versionId]
                    );
                    Database::execute(
                        'UPDATE sops SET current_version_id = ?, updated_at = NOW() WHERE sop_id = ?',
                        [$fallback ? (int)$fallback['version_id'] : null, $sopId]
                    );
                }
            }

            return true;
        } catch (Exception $e) {
            error_log('SOP version status error: ' . $e->getMessage());
            return false;
        }
    }

    public static function publish(int $sopId, int $userId): bool
    {
        try {
            // Get latest version
            $version = Database::fetch(
                'SELECT version_id FROM sop_versions 
                 WHERE sop_id = ? 
                 ORDER BY uploaded_at DESC 
                 LIMIT 1',
                [$sopId]
            );

            if (!$version) {
                return false;
            }

            $versionId = (int)$version['version_id'];

            // Update version status to Approved
            Database::execute(
                'UPDATE sop_versions 
                 SET status = "Approved", approved_by = ?, approved_at = NOW() 
                 WHERE version_id = ?',
                [$userId, $versionId]
            );

            // Set as current version
            Database::execute(
                'UPDATE sops 
                 SET current_version_id = ? 
                 WHERE sop_id = ?',
                [$versionId, $sopId]
            );

            return true;
        } catch (Exception $e) {
            error_log('SOP publish error: ' . $e->getMessage());
            return false;
        }
    }

    public static function getDepartments(): array
    {
        return self::DEPARTMENTS;
    }

    public static function format(array $row): array
    {
        $versions = $row['versions'] ?? [];
        $currentVersion = null;
        $currentId = isset($row['current_version_id']) ? (int)$row['current_version_id'] : 0;

        foreach ($versions as $version) {
            if ((int)$version['version_id'] === $currentId) {
                $currentVersion = $version;
                break;
            }
        }

        if (!$currentVersion && !empty($versions)) {
            $currentVersion = $versions[0];
            $currentId = (int)$currentVersion['version_id'];
        }
        
        // Format versions array
        $formattedVersions = array_map(function($v) {
            return [
                'id' => (string)$v['version_id'],
                'version_id' => (int)$v['version_id'],
                'sop_id' => (int)$v['sop_id'],
                'version' => $v['version'],
                'uploaded_by' => $v['uploaded_by'] ? (int)$v['uploaded_by'] : null,
                'uploaded_by_name' => $v['uploaded_by_name'] ?? null,
                'uploaded_at' => $v['uploaded_at'] ?? null,
                'file_name' => $v['file_name'] ?? null,
                'file_path' => $v['file_path'] ?? null,
                'file_size' => $v['file_size'] ? (int)$v['file_size'] : null,
                'mime_type' => $v['mime_type'] ?? null,
                'change_log' => $v['change_log'] ?? null,
                'status' => $v['status'] ?? 'Draft',
                'approved_by' => $v['approved_by'] ? (int)$v['approved_by'] : null,
                'approved_by_name' => $v['approved_by_name'] ?? null,
                'approved_at' => $v['approved_at'] ?? null,
            ];
        }, $versions);
        
        $tags = self::tagsFor((int)$row['sop_id']);

        return [
            'id' => (string)$row['sop_id'],
            'sop_id' => (int)$row['sop_id'],
            'code' => $row['code'],
            'title' => $row['title'],
            'department' => $row['department'],
            'description' => $row['description'] ?? '',
            'owner_id' => $row['owner_id'] ? (int)$row['owner_id'] : null,
            'owner_name' => $row['owner_name'] ?? null,
            'access_role' => $row['access_role'] ?? 'All Staff',
            'tags' => $tags,
            'current_version_id' => $currentId ? (string)$currentId : null,
            'current_version' => $row['current_version'] ?? ($currentVersion['version'] ?? null),
            'version_status' => $row['version_status'] ?? ($currentVersion['status'] ?? null),
            'file_name' => $row['file_name'] ?? ($currentVersion['file_name'] ?? null),
            'file_path' => $row['file_path'] ?? ($currentVersion['file_path'] ?? null),
            'mime_type' => $row['mime_type'] ?? ($currentVersion['mime_type'] ?? null),
            'versions' => $formattedVersions,
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }
}
