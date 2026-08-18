<?php
declare(strict_types=1);

class AdminPurchaseItemController
{
    public function index(Request $request): void
    {
        $result = PurchaseItem::all(
            [
                'search'   => $request->query('search'),
                'category' => $request->query('category'),
                'active'   => $request->query('active', $request->query('is_active')),
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 100)
        );

        Response::paginated($result['rows'], $result['pagination']);
    }

    public function show(Request $request): void
    {
        Response::success($this->itemOrFail((int)$request->param('id')));
    }

    /**
     * Purchase orders that reference this item.
     *
     * PO line items link to the catalog by name (`description`), not an id — so
     * this matches on the item's current name. Returns each line's qty/rate plus
     * the parent PO's number, vendor and status, for the item's "purchase history".
     */
    public function orders(Request $request): void
    {
        $item = $this->itemOrFail((int)$request->param('id'));

        // Match on the catalog FK when the line is linked; fall back to the name
        // for legacy rows that predate purchase_item_id.
        $rows = Database::fetchAll(
            "SELECT po.po_id, po.po_number, po.order_date, po.status, po.payment_status,
                    po.vendor_id, v.name AS vendor_name,
                    poi.quantity, poi.unit, poi.unit_price, poi.line_total
             FROM purchase_order_items poi
             JOIN purchase_orders po ON po.po_id = poi.po_id
             JOIN vendors v ON v.vendor_id = po.vendor_id
             WHERE poi.purchase_item_id = ?
                OR (poi.purchase_item_id IS NULL AND poi.description = ?)
             ORDER BY po.order_date DESC, po.po_id DESC",
            [(int)$item['purchase_item_id'], $item['name']]
        );

        Response::success($rows);
    }

    public function store(Request $request): void
    {
        $data = $this->payload($request, true);

        Database::beginTransaction();
        try {
            $id = PurchaseItem::create($data);
            $this->audit($request, 'purchase_item_created', 'purchase_items', $id, null, ['name' => $data['name']]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('PurchaseItem create error: ' . $e->getMessage());
            Response::error('Could not create item', 500);
        }

        Response::success(PurchaseItem::findById($id), 'Item created', 201);
    }

    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = $this->itemOrFail($id);
        $data = $this->payload($request, false, $id);
        if (empty($data)) {
            Response::error('Provide at least one field to update', 400);
        }

        Database::beginTransaction();
        try {
            PurchaseItem::update($id, $data);
            $this->audit($request, 'purchase_item_updated', 'purchase_items', $id, $existing, $data);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('PurchaseItem update error: ' . $e->getMessage());
            Response::error('Could not update item', 500);
        }

        Response::success(PurchaseItem::findById($id), 'Item updated');
    }

    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = $this->itemOrFail($id);

        PurchaseItem::deactivate($id);
        $this->audit($request, 'purchase_item_deactivated', 'purchase_items', $id, ['is_active' => $existing['is_active']], ['is_active' => false]);

        Response::success(null, 'Item deactivated');
    }

    private function payload(Request $request, bool $creating, ?int $itemId = null): array
    {
        $keys = ['item_code', 'name', 'specification', 'category', 'item_type', 'unit', 'rate', 'gst_rate', 'hsn_code', 'is_active'];
        $data = $request->only($keys);

        if ($creating && trim((string)($data['name'] ?? '')) === '') {
            Response::error('Item name is required', 422);
        }

        foreach ($data as $key => $value) {
            if ($key === 'is_active') {
                $data[$key] = filter_var($value, FILTER_VALIDATE_BOOLEAN);
                continue;
            }
            if ($key === 'rate' || $key === 'gst_rate') {
                $data[$key] = (float)$value;
                continue;
            }
            $data[$key] = trim((string)$value);
        }

        if (array_key_exists('rate', $data) && $data['rate'] < 0) {
            Response::error('Rate cannot be negative', 422);
        }
        if (array_key_exists('gst_rate', $data) && $data['gst_rate'] < 0) {
            Response::error('GST rate cannot be negative', 422);
        }
        if (($data['item_code'] ?? '') !== '' && PurchaseItem::existsByCode($data['item_code'], $itemId)) {
            Response::error('Item code already exists', 409);
        }

        return $data;
    }

    private function itemOrFail(int $id): array
    {
        if ($id <= 0) {
            Response::error('Invalid item ID', 400);
        }
        $item = PurchaseItem::findById($id);
        if (!$item) {
            Response::error('Item not found', 404);
        }
        return $item;
    }

    private function audit(Request $request, string $action, string $table, int $id, mixed $before, mixed $after): void
    {
        Database::execute(
            'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                isset($request->user['user_id']) ? (int)$request->user['user_id'] : null,
                $action,
                $table,
                $id,
                $before !== null ? json_encode($before, JSON_UNESCAPED_UNICODE) : null,
                $after !== null ? json_encode($after, JSON_UNESCAPED_UNICODE) : null,
                $request->ip(),
            ]
        );
    }
}
