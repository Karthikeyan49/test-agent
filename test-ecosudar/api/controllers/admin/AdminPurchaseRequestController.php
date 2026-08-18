<?php
declare(strict_types=1);

class AdminPurchaseRequestController
{
    public function index(Request $request): void
    {
        $result = PurchaseRequest::all(
            [
                'status' => $request->query('status'),
                'department' => $request->query('department'),
                'from' => $request->query('from'),
                'to' => $request->query('to'),
                'search' => $request->query('search'),
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 20)
        );

        Response::paginated($result['rows'], $result['pagination']);
    }

    public function store(Request $request): void
    {
        $data = $this->headerPayload($request, true);
        $items = $this->itemsPayload($request->input('items', []), true);

        Database::beginTransaction();
        try {
            $data['pr_number'] = NumberSequence::next('PR');
            $data['requested_by'] = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;
            $id = PurchaseRequest::create($data, $items);
            $this->audit($request, 'pr_created', $id, null, ['status' => 'draft', 'pr_number' => $data['pr_number']]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('PR create error: ' . $e->getMessage());
            Response::error('Could not create purchase request', 500);
        }

        Response::success(PurchaseRequest::findById($id), 'Purchase request created', 201);
    }

    public function show(Request $request): void
    {
        Response::success($this->prOrFail((int)$request->param('id')));
    }

    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = $this->prOrFail($id);
        if ($existing['status'] !== 'draft') {
            Response::error('Only draft purchase requests can be edited', 409);
        }

        $data = $this->headerPayload($request, false);
        $items = $request->input('items') !== null
            ? $this->itemsPayload($request->input('items'), true)
            : null;

        if (empty($data) && $items === null) {
            Response::error('Provide at least one field to update', 400);
        }

        Database::beginTransaction();
        try {
            PurchaseRequest::updateDraft($id, $data, $items);
            $this->audit($request, 'pr_updated', $id, $existing, ['header' => $data, 'items_changed' => $items !== null]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('PR update error: ' . $e->getMessage());
            Response::error('Could not update purchase request', 500);
        }

        Response::success(PurchaseRequest::findById($id), 'Purchase request updated');
    }

    public function submit(Request $request): void
    {
        $this->transition($request, 'draft', 'submitted', 'pr_submitted');
    }

    public function approve(Request $request): void
    {
        $this->transition($request, 'submitted', 'approved', 'pr_approved');
    }

    public function reject(Request $request): void
    {
        $reason = trim((string)$request->input('reason', ''));
        if ($reason === '') {
            Response::error('Rejection reason is required', 422);
        }

        $this->transition($request, 'submitted', 'rejected', 'pr_rejected', $reason);
    }

    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = $this->prOrFail($id);
        if ($existing['status'] !== 'draft') {
            Response::error('Only draft purchase requests can be deleted', 409);
        }

        Database::beginTransaction();
        try {
            PurchaseRequest::deleteDraft($id);
            $this->audit($request, 'pr_deleted', $id, $existing, null);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('PR delete error: ' . $e->getMessage());
            Response::error('Could not delete purchase request', 500);
        }

        Response::success(null, 'Purchase request deleted');
    }

    private function transition(Request $request, string $from, string $to, string $action, ?string $reason = null): void
    {
        $id = (int)$request->param('id');
        $existing = $this->prOrFail($id);

        if ($existing['status'] !== $from) {
            Response::error("Purchase request must be {$from} before it can become {$to}", 409);
        }

        Database::beginTransaction();
        try {
            PurchaseRequest::transition(
                $id,
                $to,
                isset($request->user['user_id']) ? (int)$request->user['user_id'] : null,
                $reason
            );
            $this->audit($request, $action, $id, ['status' => $from], ['status' => $to, 'reason' => $reason]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('PR transition error: ' . $e->getMessage());
            Response::error('Could not update purchase request status', 500);
        }

        Response::success(PurchaseRequest::findById($id), 'Purchase request status updated');
    }

    private function headerPayload(Request $request, bool $creating): array
    {
        $provided = $request->only(['department', 'need_by_date', 'priority', 'notes']);
        $data = $provided;
        foreach ($data as $key => $value) {
            $data[$key] = trim((string)$value);
        }

        if ($creating) {
            $data += ['department' => '', 'need_by_date' => '', 'priority' => 'normal', 'notes' => ''];
        }

        if (isset($data['priority']) && !in_array($data['priority'], PurchaseRequest::PRIORITIES, true)) {
            Response::error('priority must be one of: ' . implode(', ', PurchaseRequest::PRIORITIES), 422);
        }
        if (($data['need_by_date'] ?? '') !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $data['need_by_date'])) {
            Response::error('need_by_date must be YYYY-MM-DD', 422);
        }
        if ($creating && ($data['department'] ?? '') === '') {
            Response::error('department is required', 422);
        }

        return $creating
            ? array_intersect_key($data, array_flip(['department', 'need_by_date', 'priority', 'notes']))
            : array_intersect_key($data, $provided);
    }

    private function itemsPayload(mixed $value, bool $required): array
    {
        if (!is_array($value)) {
            Response::error('items must be an array', 422);
        }
        if ($required && empty($value)) {
            Response::error('At least one item is required', 422);
        }

        $items = [];
        foreach ($value as $index => $item) {
            if (!is_array($item)) {
                Response::error("Item {$index} must be an object", 422);
            }

            $description = trim((string)($item['description'] ?? ''));
            $quantity = (float)($item['quantity'] ?? 0);
            if ($description === '') {
                Response::error("Item {$index} description is required", 422);
            }
            if ($quantity <= 0) {
                Response::error("Item {$index} quantity must be greater than 0", 422);
            }

            $productId = isset($item['product_id']) && $item['product_id'] !== '' ? (int)$item['product_id'] : null;
            if ($productId !== null && $productId <= 0) {
                Response::error("Item {$index} product_id is invalid", 422);
            }
            if ($productId !== null && !Database::fetch('SELECT product_id FROM products WHERE product_id = ? LIMIT 1', [$productId])) {
                Response::error("Item {$index} product not found", 422);
            }

            $estUnitPrice = $item['est_unit_price'] ?? $item['estimated_unit_price'] ?? null;
            $estUnitPrice = $estUnitPrice === null || $estUnitPrice === '' ? null : (float)$estUnitPrice;
            if ($estUnitPrice !== null && $estUnitPrice < 0) {
                Response::error("Item {$index} estimated unit price cannot be negative", 422);
            }

            $items[] = [
                'description' => substr($description, 0, 255),
                'product_id' => $productId,
                'quantity' => $quantity,
                'unit' => substr(trim((string)($item['unit'] ?? 'Nos')) ?: 'Nos', 0, 20),
                'est_unit_price' => $estUnitPrice,
                'sort_order' => (int)($item['sort_order'] ?? $index),
            ];
        }

        return $items;
    }

    private function prOrFail(int $id): array
    {
        if ($id <= 0) {
            Response::error('Invalid purchase request ID', 400);
        }

        $pr = PurchaseRequest::findById($id);
        if (!$pr) {
            Response::error('Purchase request not found', 404);
        }

        return $pr;
    }

    private function audit(Request $request, string $action, int $id, mixed $before, mixed $after): void
    {
        Database::execute(
            'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, ip_address, created_at)
             VALUES (?, ?, "purchase_requests", ?, ?, ?, ?, NOW())',
            [
                isset($request->user['user_id']) ? (int)$request->user['user_id'] : null,
                $action,
                $id,
                $before !== null ? json_encode($before, JSON_UNESCAPED_UNICODE) : null,
                $after !== null ? json_encode($after, JSON_UNESCAPED_UNICODE) : null,
                $request->ip(),
            ]
        );
    }
}
