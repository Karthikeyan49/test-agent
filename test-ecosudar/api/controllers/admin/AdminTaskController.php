<?php
declare(strict_types=1);

/**
 * Admin Task Controller
 * GET    /admin/tasks                       — list tasks (filters: status, assignee, month)
 * GET    /admin/tasks/performance           — server-side performance rankings (?month=YYYY-MM)
 * GET    /admin/tasks/statistics            — total / pending / in-progress / completed / overdue
 * GET    /admin/tasks/employee/{id}         — all tasks assigned to an employee
 * GET    /admin/tasks/{id}                  — single task by task_key
 * POST   /admin/tasks                       — create task
 * PUT    /admin/tasks/{id}                  — full update (alias for PATCH)
 * PATCH  /admin/tasks/{id}                  — partial update
 * PUT    /admin/tasks/{id}/status           — status only
 * PUT    /admin/tasks/{id}/assign           — reassign
 * PUT    /admin/tasks/{id}/priority         — priority only
 * POST   /admin/tasks/{id}/comment          — add a comment
 * DELETE /admin/tasks/{id}                  — delete task (and its comments)
 */
class AdminTaskController
{
    private const VALID_STATUSES   = Task::VALID_STATUSES;
    private const VALID_PRIORITIES = Task::VALID_PRIORITIES;

    /** Kept as instance wrapper so `[$this, 'formatTask']` still works everywhere below. */
    private function formatTask(array $row): array
    {
        return Task::format($row);
    }

    // ─── GET /admin/tasks ─────────────────────────────────────────────────────

    public function index(Request $request): void
    {
        $filters = [
            'status'   => $request->query('status'),
            'assignee' => $request->query('assignee'),
            'month'    => $request->query('month'),
        ];

        $tasks = array_map([Task::class, 'format'], Task::all(array_filter($filters)));
        Response::success($tasks);
    }

    // ─── POST /admin/tasks ────────────────────────────────────────────────────

    public function store(Request $request): void
    {
        $title      = trim((string)$request->input('title', ''));
        $assigneeId = trim((string)$request->input('assigneeId', ''));
        $dueDate    = trim((string)$request->input('dueDate', ''));

        if (!$title)      Response::error('Title is required', 422);
        if (!$assigneeId) Response::error('Assignee is required', 422);
        if (!$dueDate)    Response::error('Due date is required', 422);

        $priority = $request->input('priority', 'Medium');
        $status   = $request->input('status', 'Pending');

        if (!in_array($priority, self::VALID_PRIORITIES, true)) {
            Response::error('Invalid priority', 422);
        }
        if (!in_array($status, self::VALID_STATUSES, true)) {
            Response::error('Invalid status', 422);
        }

        $num     = Task::create([
            'title'       => $title,
            'description' => $request->input('description', ''),
            'assigneeId'  => $assigneeId,
            'assignedBy'  => $request->input('assignedBy', 'Admin'),
            'priority'    => $priority,
            'status'      => $status,
            'dueDate'     => $dueDate,
            'tags'        => $request->input('tags', []),
        ]);

        $taskKey = 'TSK-' . str_pad((string)$num, 3, '0', STR_PAD_LEFT);
        $task    = Task::findByKey($taskKey);
        Response::success(Task::format($task), 'Task created', 201);
    }

    // ─── PATCH /admin/tasks/{id} ──────────────────────────────────────────────

    public function update(Request $request): void
    {
        $taskKey = $request->param('id');
        $task    = Task::findByKey($taskKey);

        if (!$task) Response::error('Task not found', 404);

        // Map camelCase fields from frontend → DB snake_case columns.
        // `tags` is handled separately (task_tags junction), not as a column.
        $camelToSnake = [
            'title'       => 'title',
            'description' => 'description',
            'assigneeId'  => 'assignee_id',
            'assignedBy'  => 'assigned_by',
            'priority'    => 'priority',
            'status'      => 'status',
            'dueDate'     => 'due_date',
        ];

        $fields = [];
        $params = [];

        foreach ($camelToSnake as $camel => $snake) {
            $val = $request->input($camel);
            if ($val === null) continue;

            $fields[]  = "$snake = ?";
            $params[]  = $val;
        }

        // Auto-manage completedAt based on status change
        $newStatus = $request->input('status');
        if ($newStatus === 'Completed' && !$task['completed_at']) {
            $fields[] = 'completed_at = NOW()';
        } elseif ($newStatus !== null && $newStatus !== 'Completed') {
            $fields[] = 'completed_at = NULL';
        }

        $tagsInput = $request->input('tags');

        if (!$fields && $tagsInput === null) Response::error('No fields to update', 400);

        if ($fields) {
            $params[] = $taskKey;
            Database::execute(
                'UPDATE tasks SET ' . implode(', ', $fields) . ' WHERE task_key = ?',
                $params
            );
        }

        // Tags → junction table
        if ($tagsInput !== null) {
            Task::syncTags($taskKey, is_array($tagsInput) ? $tagsInput : []);
        }

        $updated = Task::findByKey($taskKey);
        Response::success($this->formatTask($updated), 'Task updated');
    }

    // ─── DELETE /admin/tasks/{id} ─────────────────────────────────────────────

    public function destroy(Request $request): void
    {
        $taskKey = $request->param('id');
        $task    = Database::fetch('SELECT task_id FROM tasks WHERE task_key = ? LIMIT 1', [$taskKey]);

        if (!$task) Response::error('Task not found', 404);

        Database::execute('DELETE FROM tasks WHERE task_key = ?', [$taskKey]);
        Response::success(null, 'Task deleted');
    }

    // ─── GET /admin/tasks/{id} ───────────────────────────────────────────────

    public function show(Request $request): void
    {
        $taskKey = $request->param('id');
        $task    = Task::findByKey($taskKey);
        if (!$task) Response::error('Task not found', 404);

        $payload = Task::format($task);
        $payload['comments'] = Task::comments($taskKey);

        Response::success($payload);
    }

    // ─── PUT /admin/tasks/{id}/status ────────────────────────────────────────

    public function updateStatus(Request $request): void
    {
        $this->applySingleField($request, 'status', self::VALID_STATUSES);
    }

    // ─── PUT /admin/tasks/{id}/assign ────────────────────────────────────────

    public function assign(Request $request): void
    {
        $taskKey = $request->param('id');
        $task    = Task::findByKey($taskKey);
        if (!$task) Response::error('Task not found', 404);

        $assigneeId = trim((string)$request->input('assigneeId', ''));
        if (!$assigneeId) Response::error('assigneeId required', 422);

        Database::execute(
            'UPDATE tasks SET assignee_id = ? WHERE task_key = ?',
            [$assigneeId, $taskKey]
        );

        $updated = Task::findByKey($taskKey);
        Response::success($this->formatTask($updated), 'Task reassigned');
    }

    // ─── PUT /admin/tasks/{id}/priority ──────────────────────────────────────

    public function updatePriority(Request $request): void
    {
        $this->applySingleField($request, 'priority', self::VALID_PRIORITIES);
    }

    // ─── GET /admin/tasks/employee/{id} ──────────────────────────────────────

    public function byEmployee(Request $request): void
    {
        $rows = Task::byEmployee($request->param('id'));
        Response::success(array_map([Task::class, 'format'], $rows));
    }

    // ─── GET /admin/tasks/statistics ─────────────────────────────────────────

    public function statistics(Request $request): void
    {
        $stats = Database::fetch(
            "SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status = 'Pending'     THEN 1 ELSE 0 END) AS pending,
                    SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
                    SUM(CASE WHEN status = 'Completed'   THEN 1 ELSE 0 END) AS completed,
                    SUM(CASE WHEN status = 'Blocked'     THEN 1 ELSE 0 END) AS blocked,
                    SUM(CASE WHEN due_date < CURDATE() AND status != 'Completed' THEN 1 ELSE 0 END) AS overdue
             FROM tasks"
        );

        foreach ($stats as &$v) $v = (int)$v;

        Response::success($stats);
    }

    // ─── GET /admin/tasks/performance ────────────────────────────────────────

    public function performance(Request $request): void
    {
        $month  = $request->query('month');
        $where  = '';
        $params = [];
        if ($month && preg_match('/^\d{4}-\d{2}$/', $month)) {
            $where  = "WHERE DATE_FORMAT(t.created_at, '%Y-%m') = ?";
            $params = [$month];
        }

        $rows = Database::fetchAll(
            "SELECT t.assignee_id,
                    COUNT(*)                                                 AS total,
                    SUM(CASE WHEN t.status = 'Completed'   THEN 1 ELSE 0 END) AS completed,
                    SUM(CASE WHEN t.status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
                    SUM(CASE WHEN t.status IN ('Pending','Blocked') THEN 1 ELSE 0 END) AS pending,
                    SUM(CASE WHEN t.status != 'Completed' AND t.due_date < CURDATE() THEN 1 ELSE 0 END) AS overdue,
                    SUM(CASE WHEN t.status = 'Completed' AND t.completed_at IS NOT NULL
                                  AND DATE(t.completed_at) <= t.due_date THEN 1 ELSE 0 END) AS on_time
               FROM tasks t
               $where
              GROUP BY t.assignee_id",
            $params
        );

        $result = array_map(function ($r) {
            $total          = (int)$r['total'];
            $completed      = (int)$r['completed'];
            $inProgress     = (int)$r['in_progress'];
            $pending        = (int)$r['pending'];
            $overdue        = (int)$r['overdue'];
            $onTime         = (int)$r['on_time'];
            $completionRate = $total     > 0 ? $completed / $total : 0;
            $onTimeRate     = $completed > 0 ? $onTime    / $completed : 0;
            $overdueRatio   = $total     > 0 ? $overdue   / $total : 0;
            $score          = max(0, (int)round(
                ($completionRate * 70 + $onTimeRate * 30) * (1 - $overdueRatio * 0.4)
            ));

            return [
                'employeeId'        => $r['assignee_id'],
                'total'             => $total,
                'completed'         => $completed,
                'inProgress'        => $inProgress,
                'pending'           => $pending,
                'overdue'           => $overdue,
                'onTime'            => $onTime,
                'completionRate'    => round($completionRate, 4),
                'onTimeRate'        => round($onTimeRate, 4),
                'productivityScore' => $score,
            ];
        }, $rows);

        Response::success($result);
    }

    // ─── POST /admin/tasks/{id}/comment ──────────────────────────────────────

    public function addComment(Request $request): void
    {
        $taskKey = $request->param('id');
        $task    = Database::fetch('SELECT task_id FROM tasks WHERE task_key = ? LIMIT 1', [$taskKey]);
        if (!$task) Response::error('Task not found', 404);

        $body = trim((string)$request->input('body', ''));
        if (!$body) Response::error('Comment body required', 422);

        $author = trim((string)$request->input('author', ''));
        if (!$author) {
            // Fall back to the authenticated admin's email
            $author = $request->user['email'] ?? 'Admin';
        }

        $commentId = Database::insert(
            'INSERT INTO task_comments (task_key, author, body, created_at) VALUES (?, ?, ?, NOW())',
            [$taskKey, $author, $body]
        );

        $row = Database::fetch('SELECT * FROM task_comments WHERE comment_id = ? LIMIT 1', [$commentId]);
        Response::success([
            'id'        => (int)$row['comment_id'],
            'taskId'    => $taskKey,
            'author'    => $row['author'],
            'body'      => $row['body'],
            'createdAt' => date('c', strtotime($row['created_at'])),
        ], 'Comment added', 201);
    }

    // ─── private ─────────────────────────────────────────────────────────────

    /** Shared helper for updateStatus / updatePriority — validates a single-field PUT. */
    private function applySingleField(Request $request, string $field, array $validValues): void
    {
        $taskKey = $request->param('id');
        $task    = Task::findByKey($taskKey);
        if (!$task) Response::error('Task not found', 404);

        $val = $request->input($field);
        if ($val === null || $val === '') Response::error("$field required", 422);
        if (!in_array($val, $validValues, true)) Response::error("Invalid $field", 422);

        if ($field === 'status') {
            $completedAtUpdate = '';
            if ($val === 'Completed' && !$task['completed_at']) {
                $completedAtUpdate = ', completed_at = NOW()';
            } elseif ($val !== 'Completed') {
                $completedAtUpdate = ', completed_at = NULL';
            }
            Database::execute(
                "UPDATE tasks SET status = ?$completedAtUpdate WHERE task_key = ?",
                [$val, $taskKey]
            );
        } else {
            Database::execute(
                "UPDATE tasks SET $field = ? WHERE task_key = ?",
                [$val, $taskKey]
            );
        }

        $updated = Task::findByKey($taskKey);
        Response::success($this->formatTask($updated), ucfirst($field) . ' updated');
    }
}
