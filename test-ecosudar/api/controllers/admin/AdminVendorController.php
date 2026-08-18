<?php
declare(strict_types=1);

class AdminVendorController
{
    public function index(Request $request): void
    {
        $result = Vendor::all(
            [
                'search' => $request->query('search'),
                'active' => $request->query('active', $request->query('is_active')),
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 20)
        );

        Response::paginated($result['rows'], $result['pagination']);
    }

    public function show(Request $request): void
    {
        $vendor = $this->vendorOrFail((int)$request->param('id'));
        $vendor['summary'] = $this->summary((int)$vendor['vendor_id']);

        Response::success($vendor);
    }

    public function store(Request $request): void
    {
        $data = $this->payload($request, true);
        $duplicates = Vendor::duplicateHints($data['name'], $data['gstin']);

        Database::beginTransaction();
        try {
            $id = Vendor::create($data);
            $this->audit($request, 'vendor_created', 'vendors', $id, null, ['name' => $data['name']]);
            Database::commit();
        } catch (PDOException $e) {
            Database::rollBack();
            $this->handleDbError($e);
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Vendor create error: ' . $e->getMessage());
            Response::error('Could not create vendor', 500);
        }

        $vendor = Vendor::findById($id);
        $vendor['duplicate_hints'] = $duplicates;
        Response::success($vendor, 'Vendor created', 201);
    }

    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = $this->vendorOrFail($id);
        $data = $this->payload($request, false, $id);
        if (empty($data)) {
            Response::error('Provide at least one field to update', 400);
        }

        Database::beginTransaction();
        try {
            Vendor::update($id, $data);
            $this->audit($request, 'vendor_updated', 'vendors', $id, $existing, $data);
            Database::commit();
        } catch (PDOException $e) {
            Database::rollBack();
            $this->handleDbError($e);
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Vendor update error: ' . $e->getMessage());
            Response::error('Could not update vendor', 500);
        }

        Response::success(Vendor::findById($id), 'Vendor updated');
    }

    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = $this->vendorOrFail($id);

        Vendor::deactivate($id);
        $this->audit($request, 'vendor_deactivated', 'vendors', $id, ['is_active' => $existing['is_active']], ['is_active' => false]);

        Response::success(null, 'Vendor deactivated');
    }

    public function performance(Request $request): void
    {
        $id = (int)$request->param('id');
        $vendor = $this->vendorOrFail($id);

        Response::success([
            'vendor' => $vendor,
            'spend_total' => $this->tableExists('purchase_orders')
                ? (float)Database::fetch('SELECT COALESCE(SUM(total), 0) AS total FROM purchase_orders WHERE vendor_id = ?', [$id])['total']
                : 0.0,
            'purchase_orders' => $this->tableExists('purchase_orders')
                ? Database::count('SELECT COUNT(*) AS cnt FROM purchase_orders WHERE vendor_id = ?', [$id])
                : 0,
            'receipts' => $this->tableExists('goods_receipts') && $this->tableExists('purchase_orders')
                ? Database::count('SELECT COUNT(*) AS cnt FROM goods_receipts gr JOIN purchase_orders po ON po.po_id = gr.po_id WHERE po.vendor_id = ?', [$id])
                : 0,
        ]);
    }

    private function payload(Request $request, bool $creating, ?int $vendorId = null): array
    {
        $keys = [
            'vendor_code', 'name', 'gstin', 'contact_name', 'phone', 'email', 'address',
            'city', 'state', 'pincode', 'payment_terms', 'notes', 'is_active',
            // Extended (Zoho-style) fields
            'salutation', 'first_name', 'last_name', 'company_name', 'mobile', 'pan',
            'msme_registered', 'opening_balance',
            'billing_attention', 'billing_country', 'billing_street2', 'billing_phone', 'billing_fax',
            'shipping_attention', 'shipping_country', 'shipping_street1', 'shipping_street2',
            'shipping_city', 'shipping_state', 'shipping_pincode', 'shipping_phone', 'shipping_fax',
            'bank_account_holder', 'bank_name', 'bank_account_number', 'bank_ifsc',
        ];
        $provided = $request->only($keys);
        $data = $provided;

        if ($creating && trim((string)($data['name'] ?? '')) === '') {
            Response::error('Vendor name is required', 422);
        }

        foreach ($data as $key => $value) {
            if ($key === 'is_active' || $key === 'msme_registered') {
                $data[$key] = filter_var($value, FILTER_VALIDATE_BOOLEAN);
                continue;
            }
            if ($key === 'opening_balance') {
                $data[$key] = (float)$value;
                continue;
            }
            $data[$key] = trim((string)$value);
        }

        if ($creating) {
            $data += [
            'vendor_code' => '',
            'name' => '',
            'gstin' => '',
            'contact_name' => '',
            'phone' => '',
            'email' => '',
            'address' => '',
            'city' => '',
            'state' => '',
            'pincode' => '',
            'payment_terms' => '',
            'notes' => '',
            ];
        }

        if (($data['vendor_code'] ?? '') !== '' && Vendor::existsByCode($data['vendor_code'], $vendorId)) {
            Response::error('Vendor code already exists', 409);
        }
        if (($data['gstin'] ?? '') !== '') {
            $data['gstin'] = strtoupper($data['gstin']);
            if (!preg_match('/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/', $data['gstin'])) {
                Response::error('GSTIN is invalid', 422);
            }
        }
        if (($data['email'] ?? '') !== '' && !filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
            Response::error('Email is invalid', 422);
        }

        return $creating ? array_intersect_key($data, array_flip($keys)) : array_intersect_key($data, $provided);
    }

    private function vendorOrFail(int $id): array
    {
        if ($id <= 0) {
            Response::error('Invalid vendor ID', 400);
        }

        $vendor = Vendor::findById($id);
        if (!$vendor) {
            Response::error('Vendor not found', 404);
        }

        return $vendor;
    }

    private function summary(int $vendorId): array
    {
        return [
            'purchase_requests' => $this->tableExists('purchase_requests')
                ? Database::count('SELECT COUNT(*) AS cnt FROM purchase_requests WHERE status IN ("submitted","approved")')
                : 0,
            'purchase_orders' => $this->tableExists('purchase_orders')
                ? Database::count('SELECT COUNT(*) AS cnt FROM purchase_orders WHERE vendor_id = ?', [$vendorId])
                : 0,
        ];
    }

    private function tableExists(string $table): bool
    {
        return Database::fetch(
            'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
            [$table]
        ) !== null;
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

    private function handleDbError(PDOException $e): void
    {
        error_log('Vendor DB error: ' . $e->getMessage());
        if ($e->getCode() === '23000') {
            Response::error('Vendor code must be unique', 409);
        }
        Response::error('Vendor database operation failed', 500);
    }
}
