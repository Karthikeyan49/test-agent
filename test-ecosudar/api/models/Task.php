<?php
declare(strict_types=1);

class Task
{
    public const VALID_STATUSES   = ['Pending', 'In Progress', 'Completed', 'Blocked'];
    public const VALID_PRIORITIES = ['Low', 'Medium', 'High', 'Critical'];

    public static function all(array $filters = []): array
    {
        $where  = ['1=1'];
        $params = [];

        if (!empty($filters['status']) && in_array($filters['status'], self::VALID_STATUSES, true)) {
            $where[]  = 'status = ?';
            $params[] = $filters['status'];
        }
        if (!empty($filters['assignee'])) {
            $where[]  = 'assignee_id = ?';
            $params[] = $filters['assignee'];
        }
        if (!empty($filters['priority']) && in_array($filters['priority'], self::VALID_PRIORITIES, true)) {
            $where[]  = 'priority = ?';
            $params[] = $filters['priority'];
        }
        if (!empty($filters['month']) && preg_match('/^\d{4}-\d{2}$/', (string)$filters['month'])) {
            $where[]  = "DATE_FORMAT(created_at, '%Y-%m') = ?";
            $params[] = $filters['month'];
        }

        return Database::fetchAll(
            'SELECT * FROM tasks WHERE ' . implode(' AND ', $where) . ' ORDER BY created_at DESC',
            $params
        );
    }

    public static function findByKey(string $key): ?array
    {
        return Database::fetch('SELECT * FROM tasks WHERE task_key = ? LIMIT 1', [$key]);
    }

    public static function byEmployee(string $employeeKey): array
    {
        return Database::fetchAll(
            'SELECT * FROM tasks WHERE assignee_id = ? ORDER BY created_at DESC',
            [$employeeKey]
        );
    }

    public static function create(array $data): int
    {
        $count   = Database::count('SELECT COUNT(*) AS cnt FROM tasks');
        $taskKey = 'TSK-' . str_pad((string)($count + 1), 3, '0', STR_PAD_LEFT);

        $tags = $data['tags'] ?? [];
        if (!is_array($tags)) $tags = [];

        Database::insert(
            'INSERT INTO tasks
               (task_key, title, description, assignee_id, assigned_by, priority, status, due_date, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $taskKey,
                $data['title'],
                $data['description'] ?? '',
                $data['assigneeId'],
                $data['assignedBy'] ?? 'Admin',
                $data['priority']   ?? 'Medium',
                $data['status']     ?? 'Pending',
                $data['dueDate'],
            ]
        );

        // Tags live in the task_tags junction (one row per tag) — no repeated JSON blob.
        self::syncTags($taskKey, $tags);

        // Return the generated task_key instead of task_id — callers identify tasks by key
        return $count + 1;
    }

    /** A task's tags as a plain string array (from the task_tags junction). */
    public static function tagsFor(string $taskKey): array
    {
        return array_column(
            Database::fetchAll('SELECT tag FROM task_tags WHERE task_key = ? ORDER BY tag ASC', [$taskKey]),
            'tag'
        );
    }

    /** Replace a task's tag set (deduped, non-empty). */
    public static function syncTags(string $taskKey, array $tags): void
    {
        Database::execute('DELETE FROM task_tags WHERE task_key = ?', [$taskKey]);
        $seen = [];
        foreach ($tags as $t) {
            $t = trim((string)$t);
            if ($t === '' || isset($seen[$t])) continue;
            $seen[$t] = true;
            Database::execute('INSERT IGNORE INTO task_tags (task_key, tag) VALUES (?, ?)', [$taskKey, $t]);
        }
    }

    public static function format(array $row): array
    {
        return [
            'id'          => $row['task_key'],
            'title'       => $row['title'],
            'description' => $row['description'] ?? '',
            'assigneeId'  => $row['assignee_id'],
            'assignedBy'  => $row['assigned_by'],
            'priority'    => $row['priority'],
            'status'      => $row['status'],
            'dueDate'     => $row['due_date'],
            'tags'        => self::tagsFor((string)$row['task_key']),
            'completedAt' => $row['completed_at'] ? date('c', strtotime($row['completed_at'])) : null,
            'createdAt'   => date('c', strtotime($row['created_at'])),
        ];
    }

    /** Fetch a task's comments in chronological order. */
    public static function comments(string $taskKey): array
    {
        $rows = Database::fetchAll(
            'SELECT * FROM task_comments WHERE task_key = ? ORDER BY created_at ASC',
            [$taskKey]
        );
        return array_map(fn($c) => [
            'id'        => (int)$c['comment_id'],
            'author'    => $c['author'],
            'body'      => $c['body'],
            'createdAt' => date('c', strtotime($c['created_at'])),
        ], $rows);
    }
}
