<?php
declare(strict_types=1);

class BackupService
{
    public static function run(?int $actorId): array
    {
        $backupId = Database::insert(
            'INSERT INTO backup_runs (backup_type, status, created_by, started_at)
             VALUES ("database", "running", ?, NOW())',
            [$actorId]
        );

        $relativePath = null;
        try {
            $relativePath = self::createDatabaseDump($backupId);
            $fullPath = ROOT_PATH . '/' . $relativePath;
            Database::execute(
                'UPDATE backup_runs
                 SET file_path = ?, size_bytes = ?, status = "completed", finished_at = NOW()
                 WHERE backup_id = ?',
                [$relativePath, is_file($fullPath) ? filesize($fullPath) : 0, $backupId]
            );
            self::cleanupRetention();
            self::audit($actorId, 'backup_completed', 'backup_runs', $backupId, null, ['file_path' => $relativePath]);
        } catch (Throwable $e) {
            Database::execute(
                'UPDATE backup_runs SET status = "failed", error_text = ?, finished_at = NOW() WHERE backup_id = ?',
                [substr($e->getMessage(), 0, 500), $backupId]
            );
            error_log('Backup failed: ' . $e->getMessage());
            Response::error('Backup failed', 500);
        }

        return self::find($backupId);
    }

    public static function status(): array
    {
        $latest = Database::fetch('SELECT * FROM backup_runs ORDER BY started_at DESC, backup_id DESC LIMIT 1');
        $staleHours = self::settingInt('backup_stale_hours', 24);
        $isStale = true;
        if ($latest && $latest['status'] === 'completed' && !empty($latest['finished_at'])) {
            $ageSeconds = time() - strtotime((string)$latest['finished_at']);
            $isStale = $ageSeconds > ($staleHours * 3600);
        }

        $history = Database::fetchAll(
            'SELECT * FROM backup_runs ORDER BY started_at DESC, backup_id DESC LIMIT 20'
        );

        return [
            'latest' => $latest ? self::format($latest) : null,
            'is_stale' => $isStale,
            'stale_after_hours' => $staleHours,
            'backup_directory' => 'backups/',
            'history' => array_map([self::class, 'format'], $history),
        ];
    }

    private static function createDatabaseDump(int $backupId): string
    {
        $directory = ROOT_PATH . '/backups';
        if (!is_dir($directory) && !mkdir($directory, 0750, true)) {
            throw new RuntimeException('Could not create backup directory');
        }

        $filename = 'ecosudar-db-' . date('Ymd-His') . '-' . $backupId . '.sql.gz';
        $path = $directory . '/' . $filename;
        $gz = gzopen($path, 'wb9');
        if (!$gz) {
            throw new RuntimeException('Could not open backup file');
        }

        gzwrite($gz, "-- Eco Sudar database backup\n");
        gzwrite($gz, '-- Generated at ' . date('c') . "\n\n");
        gzwrite($gz, "SET FOREIGN_KEY_CHECKS=0;\n\n");

        foreach (self::tables() as $table) {
            self::writeTable($gz, $table);
        }

        gzwrite($gz, "SET FOREIGN_KEY_CHECKS=1;\n");
        gzclose($gz);
        chmod($path, 0640);

        return 'backups/' . $filename;
    }

    private static function tables(): array
    {
        $rows = Database::fetchAll("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'");
        $tables = [];
        foreach ($rows as $row) {
            $values = array_values($row);
            if (!empty($values[0])) {
                $tables[] = (string)$values[0];
            }
        }
        sort($tables);
        return $tables;
    }

    private static function writeTable($gz, string $table): void
    {
        $quotedTable = self::quoteIdent($table);
        $createRow = Database::fetch("SHOW CREATE TABLE {$quotedTable}");
        $createValues = $createRow ? array_values($createRow) : [];
        $createSql = $createValues[1] ?? null;
        if (!$createSql) {
            return;
        }

        gzwrite($gz, "--\n-- Table {$table}\n--\n");
        gzwrite($gz, "DROP TABLE IF EXISTS {$quotedTable};\n");
        gzwrite($gz, $createSql . ";\n\n");

        $pdo = Database::getInstance();
        $stmt = $pdo->query("SELECT * FROM {$quotedTable}");
        while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
            $columns = array_map([self::class, 'quoteIdent'], array_keys($row));
            $values = [];
            foreach ($row as $value) {
                $values[] = $value === null ? 'NULL' : $pdo->quote((string)$value);
            }
            gzwrite(
                $gz,
                'INSERT INTO ' . $quotedTable . ' (' . implode(', ', $columns) . ') VALUES (' . implode(', ', $values) . ");\n"
            );
        }
        gzwrite($gz, "\n");
    }

    private static function cleanupRetention(): void
    {
        $days = self::settingInt('backup_retention_days', 14);
        $cutoff = date('Y-m-d H:i:s', strtotime("-{$days} days"));
        $oldRows = Database::fetchAll(
            'SELECT * FROM backup_runs WHERE status = "completed" AND finished_at < ? ORDER BY finished_at ASC',
            [$cutoff]
        );
        foreach ($oldRows as $row) {
            $path = ROOT_PATH . '/' . ltrim((string)($row['file_path'] ?? ''), '/');
            if (is_file($path) && str_starts_with(realpath($path) ?: '', realpath(ROOT_PATH . '/backups') ?: '')) {
                @unlink($path);
            }
            Database::execute('DELETE FROM backup_runs WHERE backup_id = ?', [(int)$row['backup_id']]);
        }
    }

    private static function find(int $backupId): array
    {
        $row = Database::fetch('SELECT * FROM backup_runs WHERE backup_id = ? LIMIT 1', [$backupId]);
        if (!$row) {
            Response::error('Backup run not found', 404);
        }
        return self::format($row);
    }

    private static function format(array $row): array
    {
        return [
            'backup_id' => (int)$row['backup_id'],
            'id' => (string)$row['backup_id'],
            'backup_type' => $row['backup_type'],
            'file_path' => $row['file_path'],
            'size_bytes' => $row['size_bytes'] !== null ? (int)$row['size_bytes'] : null,
            'status' => $row['status'],
            'started_at' => $row['started_at'],
            'finished_at' => $row['finished_at'],
            'error_text' => $row['error_text'],
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
        ];
    }

    private static function quoteIdent(string $identifier): string
    {
        return '`' . str_replace('`', '``', $identifier) . '`';
    }

    private static function settingInt(string $key, int $default): int
    {
        $row = Database::fetch('SELECT setting_value FROM settings WHERE setting_key = ? LIMIT 1', [$key]);
        $value = (int)($row['setting_value'] ?? $default);
        return max(1, $value);
    }

    private static function audit(?int $actorId, string $action, string $table, int $recordId, mixed $before, mixed $after): void
    {
        Database::execute(
            'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, NOW())',
            [
                $actorId,
                $action,
                $table,
                $recordId,
                $before !== null ? json_encode($before) : null,
                $after !== null ? json_encode($after) : null,
            ]
        );
    }
}
