<?php
declare(strict_types=1);

class DealerWorkspaceController
{
    public function profile(Request $request): void
    {
        Response::success(DealerNetwork::dealerDetail($this->dealerId($request)));
    }

    public function dashboard(Request $request): void
    {
        Response::success(DealerNetwork::dealerDashboard($this->dealerId($request)));
    }

    public function customers(Request $request): void
    {
        $result = DealerNetwork::dealerCustomers(
            [
                'dealer_id' => $this->dealerId($request),
                'link_status' => $request->query('link_status'),
                'search' => $request->query('search'),
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 20)
        );
        Response::paginated($result['rows'], $result['pagination']);
    }

    public function storeCustomer(Request $request): void
    {
        $data = $this->customerPayload($request, true);
        $data['dealer_id'] = $this->dealerId($request);
        $data['created_by'] = $this->dealerId($request);

        Database::beginTransaction();
        try {
            $created = DealerNetwork::createDealerCustomer($data);
            $this->audit($request, 'dealer_customer_created', 'dealer_customers', (int)$created['customer']['dealer_customer_id'], null, $created);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Dealer customer create error: ' . $e->getMessage());
            Response::error('Could not create dealer customer', 500);
        }

        Response::success($created, 'Dealer customer created', 201);
    }

    public function updateCustomer(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = DealerNetwork::dealerCustomer($id);
        if (!$existing) {
            Response::error('Dealer customer not found', 404);
        }
        if ((int)$existing['dealer_id'] !== $this->dealerId($request)) {
            Response::error('Forbidden', 403);
        }
        $data = $this->customerPayload($request, false);
        if (empty($data)) {
            Response::error('Provide at least one field to update', 400);
        }
        $updated = DealerNetwork::updateDealerCustomer($id, $this->dealerId($request), $data);
        $this->audit($request, 'dealer_customer_updated', 'dealer_customers', $id, $existing, $updated);
        Response::success($updated, 'Dealer customer updated');
    }

    public function priceList(Request $request): void
    {
        $dealerCustomerId = $request->query('dealer_customer_id') ? (int)$request->query('dealer_customer_id') : null;
        Response::success(DealerNetwork::effectivePrices($this->dealerId($request), $dealerCustomerId));
    }

    public function storeOrder(Request $request): void
    {
        $dealerCustomerId = (int)$request->input('dealer_customer_id', 0);
        $dealerCustomer = DealerNetwork::dealerCustomer($dealerCustomerId);
        if (!$dealerCustomer || (int)$dealerCustomer['dealer_id'] !== $this->dealerId($request)) {
            Response::error('Dealer customer not found for this dealer', 404);
        }
        if (!$dealerCustomer['customer_id'] || $dealerCustomer['link_status'] !== 'linked') {
            Response::error('Dealer customer must be linked to a registered customer before placing orders', 409);
        }

        $inputItems = $request->input('items');
        if (!is_array($inputItems) || empty($inputItems)) {
            Response::error('items array is required', 422);
        }

        $items = [];
        foreach ($inputItems as $idx => $item) {
            if (!is_array($item)) {
                Response::error("items[$idx] must be an object", 422);
            }
            $productId = (int)($item['product_id'] ?? 0);
            $configId = isset($item['config_id']) ? (int)$item['config_id'] : null;
            $quantity = (int)($item['quantity'] ?? 0);
            if ($productId <= 0 || $quantity <= 0) {
                Response::error("items[$idx] requires product_id and positive quantity", 422);
            }
            try {
                Product::findActiveOrFail($productId);
            } catch (AppException $e) {
                Response::error($e->getMessage(), $e->getCode());
            }
            $size = $item['size'] ?? null;
            $purpose = $item['purpose'] ?? null;
            $subPurpose = $item['sub_purpose'] ?? null;
            if ($configId) {
                $config = Product::findConfig($configId, $productId);
                if (!$config) {
                    Response::error('Configuration not found or inactive for this product', 404);
                }
                $size = $size ?? $config['size'];
                $purpose = $purpose ?? $config['purpose'];
            }
            $price = DealerNetwork::resolvePriceForCustomer((int)$dealerCustomer['customer_id'], $productId, $configId);
            if (!$price) {
                Response::error('Could not resolve dealer price', 422);
            }
            $items[] = [
                'product_id' => $productId,
                'config_id' => $configId,
                'quantity' => $quantity,
                'unit_price' => (float)$price['price'],
                'size' => $size,
                'purpose' => $purpose,
                'sub_purpose' => $subPurpose,
            ];
        }

        $meta = $request->only(['payment_method', 'delivery_address', 'delivery_city', 'delivery_state', 'delivery_pincode', 'notes']);
        if (empty($meta['delivery_address'])) {
            $meta['delivery_address'] = $dealerCustomer['address'] ?? null;
            $meta['delivery_city'] = $dealerCustomer['city'] ?? null;
            $meta['delivery_state'] = $dealerCustomer['state'] ?? null;
            $meta['delivery_pincode'] = $dealerCustomer['pincode'] ?? null;
        }

        try {
            $orderId = Order::create((int)$dealerCustomer['customer_id'], $items, $meta);
        } catch (AppException $e) {
            Response::error($e->getMessage(), $e->getCode());
        }
        $this->audit($request, 'dealer_order_created', 'orders', $orderId, null, ['dealer_customer_id' => $dealerCustomerId]);
        Response::success(Order::findById($orderId), 'Dealer order created', 201);
    }

    private function customerPayload(Request $request, bool $creating): array
    {
        $data = $request->only(['name', 'phone', 'email', 'gstin', 'address', 'city', 'state', 'pincode', 'price_list_id']);
        if ($creating && trim((string)($data['name'] ?? '')) === '') {
            Response::error('name is required', 422);
        }
        foreach (['name', 'phone', 'email', 'gstin', 'address', 'city', 'state', 'pincode'] as $field) {
            if (array_key_exists($field, $data)) {
                $data[$field] = $data[$field] !== null ? Request::sanitize(trim((string)$data[$field])) : null;
            }
        }
        if (array_key_exists('price_list_id', $data)) {
            $data['price_list_id'] = $data['price_list_id'] ? (int)$data['price_list_id'] : null;
        }

        return $data;
    }

    private function dealerId(Request $request): int
    {
        return isset($request->user['user_id']) ? (int)$request->user['user_id'] : 0;
    }

    private function audit(Request $request, string $action, string $table, int $id, mixed $before, mixed $after): void
    {
        Database::execute(
            'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $this->dealerId($request) ?: null,
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
