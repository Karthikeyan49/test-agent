<?php
declare(strict_types=1);

class Workflow
{
    private const TYPES = [
        'Purchase Request',
        'Leave Request',
        'Expense Claim',
        'Production Order',
        'Quality Hold Release',
        'Dispatch Approval',
        'Marketing Campaign',
        'Other',
    ];

    private const STAGES = [
        'Pending',
        'In Progress',
        'Approved',
        'Completed',
        'Rejected',
    ];

    private const PRIORITIES = [
        'Low',
        'Medium',
        'High',
        'Urgent',
    ];

    public static function all(array $filters = []): array
    {
        $where = ['1=1'];
        $params = [];

        // Filter by type
        if (!empty($filters['type'])) {
            $where[] = 'w.type = ?';
            $params[] = $filters['type'];
        }

        // Filter by stage
        if (!empty($filters['stage'])) {
            $where[] = 'w.stage = ?';
            $params[] = $filters['stage'];
        }

        // Filter by priority
        if (!empty($filters['priority'])) {
            $where[] = 'w.priority = ?';
            $params[] = $filters['priority'];
        }

        // Filter by requester
        if (!empty($filters['requester_id'])) {
            $where[] = 'w.requester_id = ?';
            $params[] = $filters['requester_id'];
        }

        // Filter by approver
        if (!empty($filters['approver_id'])) {
            $where[] = 'w.approver_id = ?';
            $params[] = $filters['approver_id'];
        }

        $sql = "SELECT w.workflow_id, w.title, w.type, w.description, 
                       w.requester_id, w.requester_name, 
                       w.approver_id, w.approver_name, 
                       w.priority, w.amount, 
                       w.due_date, w.stage, w.created_at, w.updated_at
                FROM workflows w
                WHERE " . implode(' AND ', $where) . "
                ORDER BY w.created_at DESC";

        return Database::fetchAll($sql, $params);
    }

    public static function findById(int $id): ?array
    {
        $workflow = Database::fetch(
            "SELECT w.workflow_id, w.title, w.type, w.description, 
                    w.requester_id, w.requester_name,
                    w.approver_id, w.approver_name,
                    w.priority, w.amount, 
                    w.due_date, w.stage, w.created_at, w.updated_at
             FROM workflows w
             WHERE w.workflow_id = ?",
            [$id]
        );

        if (!$workflow) {
            return null;
        }

        // Get history
        $workflow['history'] = self::getHistory($id);

        return $workflow;
    }

    public static function getHistory(int $workflowId): array
    {
        return Database::fetchAll(
            "SELECT h.history_id, h.workflow_id, h.actor_id, h.actor_name,
                    h.from_stage, h.to_stage, h.note, h.created_at
             FROM workflow_history h
             WHERE h.workflow_id = ?
             ORDER BY h.created_at DESC",
            [$workflowId]
        );
    }

    public static function create(array $data): int
    {
        $id = Database::insert(
            'INSERT INTO workflows 
                (title, type, description, requester_id, requester_name, approver_id, approver_name, priority, amount, due_date, stage, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $data['title'],
                $data['type'],
                $data['description'] ?? null,
                $data['requester_id'] ?? null,
                $data['requester_name'],
                $data['approver_id'] ?? null,
                $data['approver_name'],
                $data['priority'] ?? 'Medium',
                $data['amount'] ?? null,
                $data['due_date'] ?? null,
                $data['stage'] ?? 'Pending',
            ]
        );

        // Add initial history entry with name
        self::addHistory($id, $data['requester_id'] ?? null, $data['requester_name'], null, 'Pending', 'Workflow created');

        return $id;
    }

    public static function transition(int $id, string $toStage, string $actorId, ?string $note = null): bool
    {
        try {
            // Get current stage
            $current = Database::fetch(
                'SELECT stage FROM workflows WHERE workflow_id = ?',
                [$id]
            );

            if (!$current) {
                return false;
            }

            $fromStage = $current['stage'];

            // Update workflow stage
            Database::execute(
                'UPDATE workflows SET stage = ? WHERE workflow_id = ?',
                [$toStage, $id]
            );

            // Get actor name from employees table using employee_key
            $actor = Database::fetch('SELECT name FROM employees WHERE employee_key = ? LIMIT 1', [$actorId]);
            $actorName = $actor ? $actor['name'] : 'Unknown';
            
            // Add history entry
            self::addHistory($id, $actorId, $actorName, $fromStage, $toStage, $note);

            return true;
        } catch (Exception $e) {
            error_log('Workflow transition error: ' . $e->getMessage());
            return false;
        }
    }

    private static function addHistory(int $workflowId, ?string $actorId, string $actorName, ?string $fromStage, string $toStage, ?string $note): void
    {
        Database::insert(
            'INSERT INTO workflow_history 
                (workflow_id, actor_id, actor_name, from_stage, to_stage, note, created_at) 
             VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [$workflowId, $actorId, $actorName, $fromStage, $toStage, $note]
        );
    }

    public static function delete(int $id): void
    {
        Database::execute('DELETE FROM workflows WHERE workflow_id = ?', [$id]);
    }

    public static function getTypes(): array
    {
        return self::TYPES;
    }

    public static function getStages(): array
    {
        return self::STAGES;
    }

    public static function getPriorities(): array
    {
        return self::PRIORITIES;
    }

    public static function format(array $row): array
    {
        $history = $row['history'] ?? [];
        
        // Format history array
        $formattedHistory = array_map(function($h) {
            return [
                'id' => (string)$h['history_id'],
                'history_id' => (int)$h['history_id'],
                'workflow_id' => (int)$h['workflow_id'],
                'actor_id' => $h['actor_id'] ?? null, // Now stores EMP-XXX
                'actor_name' => $h['actor_name'] ?? null,
                'from_stage' => $h['from_stage'] ?? null,
                'to_stage' => $h['to_stage'],
                'note' => $h['note'] ?? null,
                'created_at' => $h['created_at'] ?? null,
            ];
        }, $history);

        return [
            'id' => (string)$row['workflow_id'],
            'workflow_id' => (int)$row['workflow_id'],
            'title' => $row['title'],
            'type' => $row['type'],
            'description' => $row['description'] ?? '',
            'requester_id' => $row['requester_id'] ?? null, // Now stores EMP-XXX
            'requester_name' => $row['requester_name'] ?? null,
            'approver_id' => $row['approver_id'] ?? null, // Now stores EMP-XXX
            'approver_name' => $row['approver_name'] ?? null,
            'priority' => $row['priority'] ?? 'Medium',
            'amount' => $row['amount'] ? (float)$row['amount'] : null,
            'due_date' => $row['due_date'] ?? null,
            'stage' => $row['stage'] ?? 'Pending',
            'history' => $formattedHistory,
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }
}