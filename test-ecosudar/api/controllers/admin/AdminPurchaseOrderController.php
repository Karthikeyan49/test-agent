<?php
declare(strict_types=1);

class AdminPurchaseOrderController
{
    public function index(Request $request): void
    {
        $result = PurchaseOrder::all(
            [
                'status' => $request->query('status'),
                'vendor_id' => $request->query('vendor_id'),
                'from' => $request->query('from'),
                'to' => $request->query('to'),
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 20)
        );
        Response::paginated($result['rows'], $result['pagination']);
    }

    public function store(Request $request): void
    {
        $data = $this->headerPayload($request, true);
        $items = $this->itemsPayload($request->input('items', []), (int)($data['pr_id'] ?? 0));

        Database::beginTransaction();
        try {
            $data['po_number'] = !empty($data['po_number'])
                ? $data['po_number']
                : NumberSequence::next('PO');
            $this->ensureUniquePoNumber($data['po_number']);
            $data['created_by'] = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;
            $id = PurchaseOrder::create($data, $items);
            if (!empty($data['pr_id'])) {
                PurchaseRequest::transition((int)$data['pr_id'], 'converted');
            }
            $this->audit($request, 'po_created', 'purchase_orders', $id, null, ['po_number' => $data['po_number']]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('PO create error: ' . $e->getMessage());
            Response::error('Could not create purchase order', 500);
        }

        Response::success(PurchaseOrder::findById($id), 'Purchase order created', 201);
    }

    public function show(Request $request): void
    {
        Response::success($this->poOrFail((int)$request->param('id')));
    }

    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = $this->poOrFail($id);
        $received = false;
        foreach ($existing['items'] as $it) {
            if ((float)$it['received_qty'] > 0) { $received = true; break; }
        }
        if (!in_array($existing['status'], ['draft', 'issued'], true) || $received) {
            Response::error('Only draft or unreceived issued POs can be edited — revert this PO first', 409);
        }

        $data = $this->headerPayload($request, false);
        $items = $request->input('items') !== null ? $this->itemsPayload($request->input('items'), 0) : null;
        if (empty($data) && $items === null) {
            Response::error('Provide at least one field to update', 400);
        }

        Database::beginTransaction();
        try {
            if (!empty($data['po_number'])) {
                $this->ensureUniquePoNumber($data['po_number'], $id);
            }
            PurchaseOrder::updateDraft($id, $data, $items);
            $this->audit($request, 'po_updated', 'purchase_orders', $id, $existing, ['header' => $data, 'items_changed' => $items !== null]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('PO update error: ' . $e->getMessage());
            Response::error('Could not update purchase order', 500);
        }

        Response::success(PurchaseOrder::findById($id), 'Purchase order updated');
    }

    public function issue(Request $request): void
    {
        $this->transition($request, 'draft', 'issued', 'po_issued');
    }

    public function cancel(Request $request): void
    {
        $id = (int)$request->param('id');
        $po = $this->poOrFail($id);
        if (!in_array($po['status'], ['draft', 'issued'], true)) {
            Response::error('Only draft or unreceived issued POs can be cancelled', 409);
        }
        foreach ($po['items'] as $item) {
            if ((float)$item['received_qty'] > 0) {
                Response::error('Cannot cancel a PO after receipt; use short-close', 409);
            }
        }
        $this->transition($request, $po['status'], 'cancelled', 'po_cancelled');
    }

    /**
     * Move a PO back one stage so it can be corrected — the reverse of the
     * forward flow. Guarded so it never leaves inconsistent data:
     *   issued    -> draft     (only if nothing has been received)
     *   billed    -> received  (deletes the auto-created expense; blocked if payments exist)
     *   cancelled -> draft     (reinstate)
     * To undo a receipt, void the goods receipt (that reverses received_qty),
     * which drops the PO back toward issued on its own.
     */
    public function revert(Request $request): void
    {
        $id = (int)$request->param('id');
        $po = $this->poOrFail($id);
        $status = (string)$po['status'];

        if ($status === 'issued') {
            foreach ($po['items'] as $item) {
                if ((float)$item['received_qty'] > 0) {
                    Response::error('Void the goods receipts before reverting this PO', 409);
                }
            }
            Database::execute('UPDATE purchase_orders SET status = "draft", updated_at = NOW() WHERE po_id = ?', [$id]);
            $this->audit($request, 'po_reverted', 'purchase_orders', $id, ['status' => $status], ['status' => 'draft']);
            Response::success(PurchaseOrder::findById($id), 'Purchase order reverted to draft');
            return;
        }

        if ($status === 'cancelled') {
            Database::execute('UPDATE purchase_orders SET status = "draft", updated_at = NOW() WHERE po_id = ?', [$id]);
            $this->audit($request, 'po_reverted', 'purchase_orders', $id, ['status' => $status], ['status' => 'draft']);
            Response::success(PurchaseOrder::findById($id), 'Purchase order reinstated as draft');
            return;
        }

        if ($status === 'billed') {
            $paid = Database::count('SELECT COUNT(*) AS cnt FROM payments WHERE po_id = ? AND status = "posted"', [$id]);
            if ($paid > 0) {
                Response::error('Reverse the recorded payments before un-billing this PO', 409);
            }
            Database::beginTransaction();
            try {
                if (!empty($po['billed_expense_id'])) {
                    Database::execute('DELETE FROM expenses WHERE expense_id = ?', [(int)$po['billed_expense_id']]);
                }
                Database::execute('UPDATE purchase_orders SET status = "received", billed_expense_id = NULL, payment_status = "unpaid", updated_at = NOW() WHERE po_id = ?', [$id]);
                $this->audit($request, 'po_reverted', 'purchase_orders', $id, ['status' => 'billed', 'expense_id' => $po['billed_expense_id']], ['status' => 'received']);
                Database::commit();
            } catch (Throwable $e) {
                Database::rollBack();
                error_log('PO revert(bill) error: ' . $e->getMessage());
                Response::error('Could not un-bill purchase order', 500);
            }
            Response::success(PurchaseOrder::findById($id), 'Bill reversed — PO back to received');
            return;
        }

        if (in_array($status, ['received', 'partially_received', 'short_closed'], true)) {
            Response::error('Void the goods receipts to move this PO back before Bill', 409);
        }

        Response::error('This purchase order cannot be reverted from its current status', 409);
    }

    public function shortClose(Request $request): void
    {
        $id = (int)$request->param('id');
        $po = $this->poOrFail($id);
        if (!in_array($po['status'], ['issued', 'partially_received'], true)) {
            Response::error('Only issued or partially received POs can be short-closed', 409);
        }
        $this->transition($request, $po['status'], 'short_closed', 'po_short_closed');
    }

    public function receive(Request $request): void
    {
        $id = (int)$request->param('id');
        $po = $this->poOrFail($id);
        if (!in_array($po['status'], ['issued', 'partially_received'], true)) {
            Response::error('PO must be issued before receiving', 409);
        }

        $payload = [
            'received_on' => trim((string)$request->input('received_on', date('Y-m-d'))),
            'notes' => trim((string)$request->input('notes', '')),
            'received_by' => isset($request->user['user_id']) ? (int)$request->user['user_id'] : null,
        ];
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $payload['received_on'])) {
            Response::error('received_on must be YYYY-MM-DD', 422);
        }

        $receiptItems = $request->input('items', []);
        if (is_string($receiptItems)) {
            $decoded = json_decode($receiptItems, true);
            $receiptItems = is_array($decoded) ? $decoded : [];
        }
        $lines = $this->receiptLinesPayload($receiptItems, $po);

        Database::beginTransaction();
        try {
            $payload['grn_number'] = NumberSequence::next('GRN');
            $grnId = PurchaseOrder::createReceipt($id, $payload, $lines);
            $photo = $this->uploadedReceiptPhoto();
            if ($photo !== null) {
                $stored = FileStore::put('po_document', $photo, 'procurement');
                FileStore::createAttachment(
                    'grn',
                    $grnId,
                    'delivery_photo',
                    $stored,
                    isset($request->user['user_id']) ? (int)$request->user['user_id'] : null
                );
            }
            $this->audit($request, 'grn_created', 'goods_receipts', $grnId, null, ['po_id' => $id, 'grn_number' => $payload['grn_number']]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('GRN create error: ' . $e->getMessage());
            Response::error('Could not receive goods', 500);
        }

        Response::success(PurchaseOrder::findById($id), 'Goods receipt created', 201);
    }

    public function bill(Request $request): void
    {
        $id = (int)$request->param('id');
        $po = $this->poOrFail($id);
        if (!in_array($po['status'], ['received', 'short_closed'], true)) {
            Response::error('Only received or short-closed POs can be billed', 409);
        }
        if (!empty($po['billed_expense_id'])) {
            Response::error('PO is already billed', 409);
        }

        Database::beginTransaction();
        try {
            $expenseCode = substr('POE' . date('ymdHis') . $id, 0, 20);
            $paymentMode = trim((string)$request->input('payment_mode', 'Bank Transfer'));
            if (!in_array($paymentMode, ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Card'], true)) {
                Response::error('payment_mode must be one of: Cash, Bank Transfer, UPI, Cheque, Card', 422);
            }
            $expenseId = Database::insert(
                'INSERT INTO expenses
                    (expense_code, expense_date, category, vendor, description, amount, payment_mode, created_by, created_at)
                 VALUES (?, CURDATE(), "Material Purchase", ?, ?, ?, ?, ?, NOW())',
                [
                    $expenseCode,
                    $po['vendor_name'],
                    'Purchase order ' . $po['po_number'],
                    $po['total'],
                    $paymentMode,
                    isset($request->user['user_id']) ? (int)$request->user['user_id'] : null,
                ]
            );
            Database::execute('UPDATE purchase_orders SET status = "billed", billed_expense_id = ?, updated_at = NOW() WHERE po_id = ?', [$expenseId, $id]);
            $this->audit($request, 'po_billed', 'purchase_orders', $id, ['status' => $po['status']], ['status' => 'billed', 'expense_id' => $expenseId]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('PO bill error: ' . $e->getMessage());
            Response::error('Could not bill purchase order', 500);
        }

        Response::success(PurchaseOrder::findById($id), 'Purchase order billed');
    }

    public function pdf(Request $request): void
    {
        $po = $this->poOrFail((int)$request->param('id'));
        Response::success(['purchase_order' => $po], 'PDF generation is reserved for the frontend/backend PDF template pass');
    }

    private function transition(Request $request, string $from, string $to, string $action): void
    {
        $id = (int)$request->param('id');
        $po = $this->poOrFail($id);
        if ($po['status'] !== $from) {
            Response::error("PO must be {$from} before it can become {$to}", 409);
        }

        PurchaseOrder::transition($id, $to);
        $this->audit($request, $action, 'purchase_orders', $id, ['status' => $from], ['status' => $to]);
        Response::success(PurchaseOrder::findById($id), 'Purchase order status updated');
    }

    private function headerPayload(Request $request, bool $creating): array
    {
        $textFields = [
            'po_number', 'reference_number', 'order_date', 'expected_date', 'shipment_preference',
            'deliver_to_type', 'deliver_to_name', 'deliver_to_address', 'payment_terms',
            'seller_state', 'vendor_state', 'vendor_gstin', 'gst_treatment', 'notes', 'terms_conditions',
        ];
        $provided = $request->only([...$textFields, 'vendor_id', 'pr_id', 'other_charges', 'reverse_charge']);
        $data = $provided;
        foreach ($data as $key => $value) {
            $data[$key] = is_string($value) ? Request::sanitize($value) : $value;
        }
        if ($creating) {
            $data += [
                'po_number' => '',
                'reference_number' => '',
                'order_date' => date('Y-m-d'),
                'expected_date' => '',
                'shipment_preference' => '',
                'deliver_to_type' => 'organization',
                'deliver_to_name' => 'Eco Sudar',
                'deliver_to_address' => '',
                'payment_terms' => '',
                'seller_state' => '',
                'vendor_state' => '',
                'vendor_gstin' => '',
                'gst_treatment' => '',
                'reverse_charge' => 0,
                'other_charges' => 0,
                'notes' => '',
                'terms_conditions' => '',
                'pr_id' => null,
            ];
        }
        if (isset($data['po_number'])) {
            $data['po_number'] = substr((string)$data['po_number'], 0, 40);
        }
        if ($creating && empty($data['vendor_id'])) {
            Response::error('vendor_id is required', 422);
        }
        if (isset($data['vendor_id']) && !Vendor::findById((int)$data['vendor_id'])) {
            Response::error('Vendor not found', 404);
        }
        if (!empty($data['pr_id'])) {
            $pr = PurchaseRequest::findById((int)$data['pr_id']);
            if (!$pr) {
                Response::error('Purchase request not found', 404);
            }
            if ($creating && $pr['status'] !== 'approved') {
                Response::error('Only approved purchase requests can convert to PO', 409);
            }
        }
        foreach (['order_date', 'expected_date'] as $dateKey) {
            if (($data[$dateKey] ?? '') !== '' && !preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$data[$dateKey])) {
                Response::error("{$dateKey} must be YYYY-MM-DD", 422);
            }
        }
        if (isset($data['other_charges']) && (float)$data['other_charges'] < 0) {
            Response::error('other_charges cannot be negative', 422);
        }
        if (isset($data['reverse_charge'])) {
            $data['reverse_charge'] = filter_var($data['reverse_charge'], FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
        }

        if ($creating && empty($data['vendor_state'])) {
            $vendor = Vendor::findById((int)$data['vendor_id']);
            $data['vendor_state'] = $vendor['state'] ?? '';
            if (empty($data['vendor_gstin'])) {
                $data['vendor_gstin'] = $vendor['gst_number'] ?? $vendor['gstin'] ?? '';
            }
            if (empty($data['payment_terms'])) {
                $data['payment_terms'] = $vendor['payment_terms'] ?? '';
            }
        }

        return $creating ? $data : array_intersect_key($data, $provided);
    }

    private function ensureUniquePoNumber(string $poNumber, ?int $exceptId = null): void
    {
        if (trim($poNumber) === '') {
            Response::error('po_number cannot be empty', 422);
        }
        $sql = 'SELECT po_id FROM purchase_orders WHERE po_number = ?';
        $params = [$poNumber];
        if ($exceptId !== null) {
            $sql .= ' AND po_id <> ?';
            $params[] = $exceptId;
        }
        $sql .= ' LIMIT 1';
        if (Database::fetch($sql, $params)) {
            Response::error('PO number already exists', 409);
        }
    }

    private function uploadedReceiptPhoto(): ?array
    {
        foreach (['delivery_photo', 'photo', 'document'] as $key) {
            if (isset($_FILES[$key]) && is_array($_FILES[$key]) && (int)($_FILES[$key]['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
                return $_FILES[$key];
            }
        }
        return null;
    }

    private function itemsPayload(mixed $value, int $prId): array
    {
        if ((!is_array($value) || empty($value)) && $prId > 0) {
            $pr = PurchaseRequest::findById($prId);
            $value = array_map(fn(array $item): array => [
                'description' => $item['description'],
                'product_id' => $item['product_id'],
                'quantity' => $item['quantity'],
                'unit' => $item['unit'],
                'unit_price' => $item['est_unit_price'] ?? 0,
                'gst_rate' => 0,
            ], $pr['items'] ?? []);
        }

        if (!is_array($value) || empty($value)) {
            Response::error('At least one PO item is required', 422);
        }

        $items = [];
        foreach ($value as $index => $item) {
            if (!is_array($item)) {
                Response::error("Item {$index} must be an object", 422);
            }
            $description = trim((string)($item['description'] ?? ''));
            $quantity = (float)($item['quantity'] ?? 0);
            $unitPrice = (float)($item['unit_price'] ?? 0);
            $gstRate = (float)($item['gst_rate'] ?? 0);
            if ($description === '' || $quantity <= 0 || $unitPrice < 0 || $gstRate < 0) {
                Response::error("Item {$index} has invalid description, quantity, price, or GST", 422);
            }
            $productId = isset($item['product_id']) && $item['product_id'] !== '' ? (int)$item['product_id'] : null;
            if ($productId !== null && !Database::fetch('SELECT product_id FROM products WHERE product_id = ? LIMIT 1', [$productId])) {
                Response::error("Item {$index} product not found", 422);
            }

            $items[] = [
                'description' => substr($description, 0, 255),
                'product_id' => $productId,
                'hsn_code' => substr(trim((string)($item['hsn_code'] ?? '')), 0, 20),
                'quantity' => $quantity,
                'unit' => substr(trim((string)($item['unit'] ?? 'Nos')) ?: 'Nos', 0, 20),
                'unit_price' => $unitPrice,
                'gst_rate' => $gstRate,
                'sort_order' => (int)($item['sort_order'] ?? $index),
            ];
        }

        return $items;
    }

    private function receiptLinesPayload(mixed $value, array $po): array
    {
        if (!is_array($value) || empty($value)) {
            Response::error('At least one receipt item is required', 422);
        }
        $poItems = [];
        foreach ($po['items'] as $item) {
            $poItems[(int)$item['item_id']] = $item;
        }

        $lines = [];
        foreach ($value as $index => $line) {
            if (!is_array($line)) {
                Response::error("Receipt item {$index} must be an object", 422);
            }
            $poItemId = (int)($line['po_item_id'] ?? $line['item_id'] ?? 0);
            $quantity = (float)($line['quantity'] ?? 0);
            if (!isset($poItems[$poItemId])) {
                Response::error("Receipt item {$index} does not belong to this PO", 422);
            }
            if ($quantity <= 0) {
                Response::error("Receipt item {$index} quantity must be greater than 0", 422);
            }
            $outstanding = (float)$poItems[$poItemId]['outstanding_qty'];
            if ($quantity > $outstanding + 0.0005) {
                Response::error("Receipt item {$index} exceeds outstanding quantity {$outstanding}", 409);
            }
            $lines[] = [
                'po_item_id' => $poItemId,
                'product_id' => $poItems[$poItemId]['product_id'],
                'quantity' => $quantity,
                'unit_cost' => (float)$poItems[$poItemId]['unit_price'],
            ];
        }

        return $lines;
    }

    private function poOrFail(int $id): array
    {
        if ($id <= 0) {
            Response::error('Invalid purchase order ID', 400);
        }
        $po = PurchaseOrder::findById($id);
        if (!$po) {
            Response::error('Purchase order not found', 404);
        }
        return $po;
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
