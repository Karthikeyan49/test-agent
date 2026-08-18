<?php
declare(strict_types=1);

class AdminWorkflowController
{
    /**
     * GET /api/admin/workflows - List all workflows
     */
    public function index(Request $request): void
    {
        $filters = [];
        
        if ($type = $request->query('type')) {
            $filters['type'] = $type;
        }
        if ($stage = $request->query('stage')) {
            $filters['stage'] = $stage;
        }
        if ($priority = $request->query('priority')) {
            $filters['priority'] = $priority;
        }
        if ($requesterId = $request->query('requester_id')) {
            $filters['requester_id'] = $requesterId;
        }
        if ($approverId = $request->query('approver_id')) {
            $filters['approver_id'] = $approverId;
        }

        $rows = Workflow::all($filters);
        Response::success(array_map([Workflow::class, 'format'], $rows));
    }

    /**
     * GET /api/admin/workflows/{id} - Get single workflow with history
     */
    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        $workflow = Workflow::findById($id);
        
        if (!$workflow) {
            Response::error('Workflow not found', 404);
        }
        
        Response::success(Workflow::format($workflow));
    }

    /**
     * POST /api/admin/workflows - Create new workflow
     */
    public function store(Request $request): void
    {
        $title = trim((string)$request->input('title', ''));
        $type = trim((string)$request->input('type', ''));
        $description = trim((string)$request->input('description', ''));
        
        // Handle both camelCase and snake_case field names
        $requester_input = $request->input('requesterId') ?? $request->input('requester_id');
        $approver_input = $request->input('approverId') ?? $request->input('approver_id');
        
        // Convert employee ID (EMP-XXX) to employee name
        $requester_name = self::resolveEmployeeName($requester_input);
        $approver_name = self::resolveEmployeeName($approver_input);
        
        // Store the employee key (EMP-XXX) in the ID columns
        $requester_id = $requester_input; // Store EMP-003
        $approver_id = $approver_input;   // Store EMP-004
        
        $priority = trim((string)$request->input('priority', 'Medium'));
        $amount = $request->input('amount');
        
        // Handle both camelCase and snake_case for due_date
        $due_date = $request->input('dueDate') ?? $request->input('due_date');
        
        $stage = trim((string)$request->input('stage', 'Pending'));

        // Validation
        if (!$title) Response::error('Title is required', 422);
        if (!$type) Response::error('Type is required', 422);
        if (!$requester_name) Response::error('Requester is required', 422);
        if (!$approver_name) Response::error('Approver is required', 422);
        
        if (strlen($title) > 200) {
            Response::error('Title must not exceed 200 characters', 422);
        }

        $validTypes = Workflow::getTypes();
        if (!in_array($type, $validTypes, true)) {
            Response::error('Invalid workflow type', 422);
        }

        $validPriorities = Workflow::getPriorities();
        if (!in_array($priority, $validPriorities, true)) {
            Response::error('Invalid priority', 422);
        }

        $validStages = Workflow::getStages();
        if (!in_array($stage, $validStages, true)) {
            Response::error('Invalid stage', 422);
        }

        if ($due_date && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $due_date)) {
            Response::error('Due date must be in YYYY-MM-DD format', 422);
        }

        if ($amount !== null && !is_numeric($amount)) {
            Response::error('Amount must be a number', 422);
        }

        try {
            $id = Workflow::create([
                'title' => $title,
                'type' => $type,
                'description' => $description,
                'requester_id' => $requester_id,
                'requester_name' => $requester_name,
                'approver_id' => $approver_id,
                'approver_name' => $approver_name,
                'priority' => $priority,
                'amount' => $amount,
                'due_date' => $due_date,
                'stage' => $stage,
            ]);

            $row = Workflow::findById($id);
            Response::success(Workflow::format($row), 'Workflow created', 201);
        } catch (Exception $e) {
            error_log('Workflow creation error: ' . $e->getMessage());
            Response::error('Failed to create workflow: ' . $e->getMessage(), 500);
        }
    }

    /**
     * POST /api/admin/workflows/{id}/transition - Transition workflow stage
     */
    public function transition(Request $request): void
    {
        $id = (int)$request->param('id');
        $workflow = Workflow::findById($id);
        
        if (!$workflow) {
            Response::error('Workflow not found', 404);
        }

        $stage = trim((string)$request->input('stage', ''));
        $note = trim((string)$request->input('note', ''));

        if (!$stage) {
            Response::error('Stage is required', 422);
        }

        $validStages = Workflow::getStages();
        if (!in_array($stage, $validStages, true)) {
            Response::error('Invalid stage', 422);
        }

        $userId = $request->user['user_id'] ?? null;
        if (!$userId) {
            Response::error('User not authenticated', 401);
        }

        // Get employee_key for the authenticated user
        $employee = Database::fetch('SELECT employee_key FROM employees WHERE employee_id = ? LIMIT 1', [$userId]);
        $actorId = $employee ? $employee['employee_key'] : null;
        
        if (!$actorId) {
            Response::error('Employee not found for user', 404);
        }

        $success = Workflow::transition($id, $stage, $actorId, $note ?: null);

        if (!$success) {
            Response::error('Failed to transition workflow', 500);
        }

        $updated = Workflow::findById($id);
        Response::success(Workflow::format($updated), 'Workflow transitioned');
    }

    /**
     * DELETE /api/admin/workflows/{id} - Delete workflow
     */
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        $workflow = Workflow::findById($id);
        
        if (!$workflow) {
            Response::error('Workflow not found', 404);
        }

        Workflow::delete($id);
        Response::success(null, 'Workflow deleted');
    }

    /**
     * GET /api/admin/workflows/types - Get available workflow types
     */
    public function types(Request $request): void
    {
        Response::success(Workflow::getTypes());
    }

    /**
     * GET /api/admin/workflows/stages - Get available stages
     */
    public function stages(Request $request): void
    {
        Response::success(Workflow::getStages());
    }

    /**
     * GET /api/admin/workflows/priorities - Get available priorities
     */
    public function priorities(Request $request): void
    {
        Response::success(Workflow::getPriorities());
    }

    /**
     * Helper: Convert employee key (EMP-XXX format) to employee name
     */
    private static function resolveEmployeeName($input): ?string
    {
        if (empty($input)) {
            return null;
        }
        
        // If it's already a name (not EMP-XXX format), return it as-is
        if (is_string($input) && !preg_match('/^EMP-\d+$/', $input)) {
            return $input;
        }
        
        // If it's an employee key in format EMP-XXX, look up the name
        if (is_string($input) && preg_match('/^EMP-\d+$/', $input)) {
            $employee = Database::fetch(
                'SELECT name FROM employees WHERE employee_key = ? LIMIT 1',
                [$input]
            );
            return $employee ? $employee['name'] : null;
        }
        
        return null;
    }
}
