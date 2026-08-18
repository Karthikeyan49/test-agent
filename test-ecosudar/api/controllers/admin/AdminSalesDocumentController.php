<?php
declare(strict_types=1);

class AdminSalesDocumentController
{
    public function index(Request $request): void
    {
        $result = SalesDocument::all(
            [
                'document_type' => $request->query('document_type') ?: $request->query('type'),
                'status' => $request->query('status'),
                'user_id' => $request->query('user_id'),
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
        $items = $this->itemsPayload($request->input('items', []));

        Database::beginTransaction();
        try {
            $data['document_number'] = NumberSequence::next(SalesDocument::NUMBER_PREFIX[$data['document_type']] ?? 'DOC');
            $data['created_by'] = $this->actorId($request) ?: null;
            $id = SalesDocument::create($data, $items);
            $this->audit($request, 'sales_document_created', 'sales_documents', $id, null, $data);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Sales document create error: ' . $e->getMessage());
            Response::error('Could not create sales document', 500);
        }

        Response::success(SalesDocument::findById($id), 'Sales document created', 201);
    }

    public function show(Request $request): void
    {
        Response::success($this->documentOrFail((int)$request->param('id')));
    }

    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = $this->documentOrFail($id);
        if (!in_array($existing['status'], ['draft', 'sent'], true)) {
            Response::error('Only draft or sent sales documents can be edited', 409);
        }

        $data = $this->headerPayload($request, false);
        $items = $request->input('items') !== null ? $this->itemsPayload($request->input('items')) : null;
        if (empty($data) && $items === null) {
            Response::error('Provide at least one field to update', 400);
        }

        Database::beginTransaction();
        try {
            SalesDocument::updateEditable($id, $data, $items);
            $this->audit($request, 'sales_document_updated', 'sales_documents', $id, $existing, ['header' => $data, 'items_changed' => $items !== null]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Sales document update error: ' . $e->getMessage());
            Response::error('Could not update sales document', 500);
        }

        Response::success(SalesDocument::findById($id), 'Sales document updated');
    }

    public function send(Request $request): void
    {
        $this->transition($request, ['draft'], 'sent', 'sales_document_sent');
    }

    public function accept(Request $request): void
    {
        $this->transition($request, ['draft', 'sent'], 'accepted', 'sales_document_accepted');
    }

    public function reject(Request $request): void
    {
        $this->transition($request, ['draft', 'sent'], 'rejected', 'sales_document_rejected');
    }

    public function cancel(Request $request): void
    {
        $this->transition($request, ['draft', 'sent', 'accepted', 'rejected', 'expired'], 'cancelled', 'sales_document_cancelled');
    }

    public function convert(Request $request): void
    {
        $id = (int)$request->param('id');
        $doc = $this->documentOrFail($id);
        $type = (string)$doc['document_type'];
        // `target` disambiguates when a document can convert to more than one thing:
        // quotation → sales_order | proforma;  sales_order → delivery_challan | invoice.
        $target = strtolower((string)($request->input('target') ?? $request->query('target') ?? ''));
        $actor = $this->actorId($request);

        Database::beginTransaction();
        try {
            if ($type === 'quotation' && $target === 'sales_order') {
                $newId = SalesDocument::convertQuotationToSalesOrder($id, $actor);
                $this->audit($request, 'quotation_converted_to_sales_order', 'sales_documents', $id, $doc, ['sales_order_id' => $newId]);
                Database::commit();
                Response::success(SalesDocument::findById($newId), 'Quotation converted to sales order');
                return;
            }
            if ($type === 'quotation') {
                $newId = SalesDocument::convertQuotationToProforma($id, $actor);
                $this->audit($request, 'quotation_converted_to_proforma', 'sales_documents', $id, $doc, ['proforma_id' => $newId]);
                Database::commit();
                Response::success(SalesDocument::findById($newId), 'Quotation converted to proforma');
                return;
            }
            if ($type === 'sales_order' && $target === 'delivery_challan') {
                $newId = SalesDocument::convertSalesOrderToDeliveryChallan($id, $actor);
                $this->audit($request, 'sales_order_dispatched', 'sales_documents', $id, $doc, ['delivery_challan_id' => $newId]);
                Database::commit();
                Response::success(SalesDocument::findById($newId), 'Delivery challan created — finished stock dispatched');
                return;
            }
            if ($type === 'sales_order') {
                $invoiceId = SalesDocument::convertSalesOrderToInvoice($id);
                $this->audit($request, 'sales_order_invoiced', 'sales_documents', $id, $doc, ['invoice_id' => $invoiceId]);
                Database::commit();
                Response::success(Database::fetch('SELECT * FROM invoices WHERE invoice_id = ? LIMIT 1', [$invoiceId]), 'Sales order invoiced');
                return;
            }

            // proforma → invoice (default / legacy path)
            $invoiceId = SalesDocument::convertProformaToInvoice($id);
            $this->audit($request, 'proforma_converted_to_invoice', 'sales_documents', $id, $doc, ['invoice_id' => $invoiceId]);
            Database::commit();
            Response::success(Database::fetch('SELECT * FROM invoices WHERE invoice_id = ? LIMIT 1', [$invoiceId]), 'Proforma converted to invoice');
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Sales document convert error: ' . $e->getMessage());
            Response::error('Could not convert sales document', 500);
        }
    }

    public function documentData(Request $request): void
    {
        $doc = $this->documentOrFail((int)$request->param('id'));
        Response::success(['sales_document' => $doc], 'Document data retrieved');
    }

    private function transition(Request $request, array $allowedFrom, string $to, string $action): void
    {
        $id = (int)$request->param('id');
        $doc = $this->documentOrFail($id);
        if (!in_array($doc['status'], $allowedFrom, true)) {
            Response::error('Invalid document status transition', 409);
        }

        SalesDocument::transition($id, $to);
        $this->audit($request, $action, 'sales_documents', $id, ['status' => $doc['status']], ['status' => $to]);
        Response::success(SalesDocument::findById($id), 'Sales document status updated');
    }

    private function headerPayload(Request $request, bool $creating): array
    {
        $keys = [
            'document_type', 'source_quote_id', 'user_id', 'customer_name', 'customer_email',
            'customer_phone', 'customer_gstin', 'customer_state', 'customer_address',
            'customer_city', 'customer_pincode', 'customer_country', 'seller_state',
            'document_date', 'valid_until', 'due_date', 'payment_terms', 'place_of_supply',
            'ship_to', 'subject', 'delivery_fee', 'discount', 'terms', 'notes',
        ];
        $data = $request->only($keys);
        foreach ($data as $key => $value) {
            $data[$key] = is_string($value) ? trim($value) : $value;
        }

        if ($creating) {
            $data += [
                'document_type' => '',
                'source_quote_id' => null,
                'source_document_id' => null,
                'user_id' => null,
                'customer_name' => '',
                'customer_email' => '',
                'customer_phone' => '',
                'customer_gstin' => '',
                'customer_state' => '',
                'customer_address' => '',
                'customer_city' => '',
                'customer_pincode' => '',
                'customer_country' => '',
                'seller_state' => 'Tamil Nadu',
                'document_date' => date('Y-m-d'),
                'valid_until' => null,
                'due_date' => null,
                'payment_terms' => '',
                'place_of_supply' => '',
                'ship_to' => '',
                'subject' => '',
                'delivery_fee' => 0,
                'discount' => 0,
                'terms' => '',
                'notes' => '',
            ];
        }

        if (isset($data['document_type'])) {
            $data['document_type'] = strtolower((string)$data['document_type']);
            if (!in_array($data['document_type'], SalesDocument::TYPES, true)) {
                Response::error('document_type must be one of: ' . implode(', ', SalesDocument::TYPES), 422);
            }
        } elseif ($creating) {
            Response::error('document_type is required', 422);
        }

        if (!empty($data['source_quote_id'])) {
            $this->mergeQuoteRequest($data, (int)$data['source_quote_id']);
        }

        if ($creating && trim((string)$data['customer_name']) === '') {
            Response::error('customer_name is required', 422);
        }

        if (!empty($data['user_id']) && !Database::fetch('SELECT user_id FROM users WHERE user_id = ? LIMIT 1', [(int)$data['user_id']])) {
            Response::error('User not found', 404);
        }

        foreach (['document_date', 'valid_until', 'due_date'] as $dateField) {
            if (array_key_exists($dateField, $data) && $data[$dateField] !== null && trim((string)$data[$dateField]) !== '') {
                $data[$dateField] = Payment::validDateOrDefault((string)$data[$dateField], date('Y-m-d'));
            }
        }

        foreach (['customer_name', 'customer_email', 'customer_phone', 'customer_gstin', 'customer_state',
            'customer_address', 'customer_city', 'customer_pincode', 'customer_country', 'seller_state',
            'payment_terms', 'place_of_supply', 'ship_to', 'subject', 'terms', 'notes'] as $field) {
            if (isset($data[$field]) && is_string($data[$field])) {
                $data[$field] = Request::sanitize($data[$field]);
            }
        }

        if (array_key_exists('delivery_fee', $data)) {
            $data['delivery_fee'] = max(0.0, (float)$data['delivery_fee']);
        }
        if (array_key_exists('discount', $data)) {
            $data['discount'] = max(0.0, (float)$data['discount']);
        }

        return $data;
    }

    private function itemsPayload(mixed $items): array
    {
        if (!is_array($items) || empty($items)) {
            Response::error('items must be a non-empty array', 422);
        }

        $clean = [];
        foreach ($items as $idx => $item) {
            if (!is_array($item)) {
                Response::error("items[$idx] must be an object", 422);
            }
            $productId = !empty($item['product_id']) ? (int)$item['product_id'] : null;
            if ($productId && !Database::fetch('SELECT product_id FROM products WHERE product_id = ? LIMIT 1', [$productId])) {
                Response::error("items[$idx].product_id was not found", 404);
            }
            $description = trim((string)($item['description'] ?? ''));
            $quantity = (float)($item['quantity'] ?? 0);
            $unitPrice = (float)($item['unit_price'] ?? 0);
            $gstRate = (float)($item['gst_rate'] ?? 0);
            if ($description === '') {
                Response::error("items[$idx].description is required", 422);
            }
            if ($quantity <= 0) {
                Response::error("items[$idx].quantity must be greater than 0", 422);
            }
            if ($unitPrice < 0) {
                Response::error("items[$idx].unit_price cannot be negative", 422);
            }
            if (!in_array((int)$gstRate, [0, 5, 12, 18, 28], true)) {
                Response::error("items[$idx].gst_rate must be one of 0, 5, 12, 18, 28", 422);
            }

            $clean[] = [
                'product_id' => $productId,
                'description' => Request::sanitize($description),
                'hsn_code' => isset($item['hsn_code']) ? Request::sanitize((string)$item['hsn_code']) : null,
                'quantity' => $quantity,
                'unit' => isset($item['unit']) && trim((string)$item['unit']) !== '' ? Request::sanitize((string)$item['unit']) : 'Nos',
                'unit_price' => $unitPrice,
                'gst_rate' => $gstRate,
                'sort_order' => (int)($item['sort_order'] ?? ($idx + 1)),
            ];
        }

        return $clean;
    }

    private function mergeQuoteRequest(array &$data, int $quoteId): void
    {
        $quote = Database::fetch('SELECT * FROM quotes WHERE quote_id = ? LIMIT 1', [$quoteId]);
        if (!$quote) {
            Response::error('Source quote request not found', 404);
        }
        $data['user_id'] = ($data['user_id'] ?? null) ?: ($quote['user_id'] ?? null);
        $data['customer_name'] = ($data['customer_name'] ?? '') ?: ($quote['name'] ?? '');
        $data['customer_email'] = ($data['customer_email'] ?? '') ?: ($quote['email'] ?? '');
        $data['customer_phone'] = ($data['customer_phone'] ?? '') ?: ($quote['phone'] ?? '');
        $data['subject'] = ($data['subject'] ?? '') ?: ('Quote request ' . ($quote['quote_number'] ?? '#' . $quoteId));
        $data['notes'] = ($data['notes'] ?? '') ?: ($quote['message'] ?? '');
    }

    private function documentOrFail(int $id): array
    {
        if ($id <= 0) {
            Response::error('Invalid sales document ID', 400);
        }
        $doc = SalesDocument::findById($id);
        if (!$doc) {
            Response::error('Sales document not found', 404);
        }

        return $doc;
    }

    private function actorId(Request $request): int
    {
        return isset($request->user['user_id']) ? (int)$request->user['user_id'] : 0;
    }

    private function audit(Request $request, string $action, string $table, int $id, mixed $before, mixed $after): void
    {
        Database::execute(
            'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $this->actorId($request) ?: null,
                $action,
                $table,
                $id,
                $before !== null ? json_encode($before) : null,
                $after !== null ? json_encode($after) : null,
                $request->ip(),
            ]
        );
    }
}
