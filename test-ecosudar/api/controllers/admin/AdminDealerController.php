<?php
declare(strict_types=1);

class AdminDealerController
{
    public function index(Request $request): void
    {
        $result = DealerNetwork::dealers(
            ['is_active' => $request->query('is_active'), 'search' => $request->query('search')],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 20)
        );
        Response::paginated($result['rows'], $result['pagination']);
    }

    public function show(Request $request): void
    {
        Response::success(DealerNetwork::dealerDetail((int)$request->param('id')));
    }

    public function priceLists(Request $request): void
    {
        $result = DealerNetwork::priceLists(
            ['dealer_id' => $request->query('dealer_id'), 'is_active' => $request->query('is_active')],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 20)
        );
        Response::paginated($result['rows'], $result['pagination']);
    }

    public function createPriceList(Request $request): void
    {
        $data = $this->priceListPayload($request, true);
        $data['created_by'] = $this->actorId($request) ?: null;

        Database::beginTransaction();
        try {
            $id = DealerNetwork::createPriceList($data);
            if (is_array($request->input('items'))) {
                DealerNetwork::replacePriceItems($id, $this->priceItemsPayload($request->input('items')));
            }
            $this->audit($request, 'dealer_price_list_created', 'dealer_price_lists', $id, null, $data);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Dealer price list create error: ' . $e->getMessage());
            Response::error('Could not create dealer price list', 500);
        }

        Response::success(DealerNetwork::priceList($id), 'Dealer price list created', 201);
    }

    public function showPriceList(Request $request): void
    {
        $list = DealerNetwork::priceList((int)$request->param('id'));
        if (!$list) {
            Response::error('Dealer price list not found', 404);
        }
        Response::success($list);
    }

    public function updatePriceList(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = DealerNetwork::priceList($id);
        if (!$existing) {
            Response::error('Dealer price list not found', 404);
        }
        $data = $this->priceListPayload($request, false);
        if (empty($data)) {
            Response::error('Provide at least one field to update', 400);
        }
        DealerNetwork::updatePriceList($id, $data);
        $this->audit($request, 'dealer_price_list_updated', 'dealer_price_lists', $id, $existing, $data);
        Response::success(DealerNetwork::priceList($id), 'Dealer price list updated');
    }

    public function updatePriceItems(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = DealerNetwork::priceList($id);
        if (!$existing) {
            Response::error('Dealer price list not found', 404);
        }
        $items = $this->priceItemsPayload($request->input('items', []));
        $updated = DealerNetwork::replacePriceItems($id, $items);
        $this->audit($request, 'dealer_price_items_updated', 'dealer_price_lists', $id, null, ['items' => $items]);
        Response::success(['items' => $updated, 'warnings' => array_values(array_filter($updated, fn($item) => $item['below_cost_warning']))], 'Dealer price items updated');
    }

    public function dealerCustomers(Request $request): void
    {
        $result = DealerNetwork::dealerCustomers(
            [
                'dealer_id' => $request->query('dealer_id'),
                'link_status' => $request->query('link_status'),
                'search' => $request->query('search'),
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 20)
        );
        Response::paginated($result['rows'], $result['pagination']);
    }

    public function conflicts(Request $request): void
    {
        $result = DealerNetwork::dealerCustomers(
            ['link_status' => 'conflict', 'search' => $request->query('search')],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 20)
        );
        Response::paginated($result['rows'], $result['pagination']);
    }

    public function resolveDealerCustomer(Request $request): void
    {
        $id = (int)$request->param('id');
        $action = strtolower(trim((string)$request->input('action', '')));
        $customerId = $request->input('customer_id') ? (int)$request->input('customer_id') : null;
        $notes = $request->input('notes') ? Request::sanitize((string)$request->input('notes')) : null;
        $before = DealerNetwork::dealerCustomer($id);
        $resolved = DealerNetwork::resolveDealerCustomer($id, $action, $customerId, $notes);
        $this->audit($request, 'dealer_customer_resolved', 'dealer_customers', $id, $before, $resolved);
        Response::success($resolved, 'Dealer customer resolved');
    }

    public function mergeCustomers(Request $request): void
    {
        $sourceId = (int)$request->input('source_id', 0);
        $targetId = (int)$request->input('target_id', 0);
        if ($sourceId <= 0 || $targetId <= 0) {
            Response::error('source_id and target_id are required', 422);
        }

        Database::beginTransaction();
        try {
            $result = DealerNetwork::mergeCustomers($sourceId, $targetId);
            $this->audit($request, 'customers_merged', 'users', $targetId, ['source_id' => $sourceId], $result);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Customer merge error: ' . $e->getMessage());
            Response::error('Could not merge customers', 500);
        }

        Response::success($result, 'Customers merged');
    }

    public function customerAnalytics(Request $request): void
    {
        Response::success(DealerNetwork::customerAnalytics((int)$request->param('id')));
    }

    public function analyticsSummary(Request $request): void
    {
        Response::success(DealerNetwork::analyticsSummary(
            (int)$request->query('churn_days', 90),
            (int)$request->query('limit', 10)
        ));
    }

    public function recomputeMetrics(Request $request): void
    {
        $customerId = $request->input('customer_id') ? (int)$request->input('customer_id') : null;
        Response::success(DealerNetwork::recomputeCustomerMetrics($customerId), 'Customer metrics recomputed');
    }

    public function priceSimulation(Request $request): void
    {
        $customerId = (int)$request->query('customer_id', 0);
        $dealerId = (int)$request->query('dealer_id', 0);
        $dealerCustomerId = $request->query('dealer_customer_id') ? (int)$request->query('dealer_customer_id') : null;
        $productId = (int)$request->query('product_id', 0);
        $configId = $request->query('config_id') ? (int)$request->query('config_id') : null;

        if ($customerId && $productId) {
            $price = DealerNetwork::resolvePriceForCustomer($customerId, $productId, $configId);
            Response::success($price);
        }
        if ($dealerId) {
            Response::success(DealerNetwork::effectivePrices($dealerId, $dealerCustomerId));
        }
        Response::error('Provide customer_id+product_id or dealer_id', 422);
    }

    private function priceListPayload(Request $request, bool $creating): array
    {
        $data = $request->only(['dealer_id', 'name', 'is_active', 'is_default', 'notes']);
        if ($creating && empty($data['dealer_id'])) {
            Response::error('dealer_id is required', 422);
        }
        if ($creating && trim((string)($data['name'] ?? '')) === '') {
            Response::error('name is required', 422);
        }
        if (array_key_exists('dealer_id', $data)) {
            $data['dealer_id'] = (int)$data['dealer_id'];
        }
        if (array_key_exists('name', $data)) {
            $data['name'] = Request::sanitize((string)$data['name']);
        }
        if (array_key_exists('notes', $data)) {
            $data['notes'] = $data['notes'] ? Request::sanitize((string)$data['notes']) : null;
        }
        foreach (['is_active', 'is_default'] as $field) {
            if (array_key_exists($field, $data)) {
                $data[$field] = filter_var($data[$field], FILTER_VALIDATE_BOOLEAN);
            } elseif ($creating && $field === 'is_active') {
                $data[$field] = true;
            }
        }

        return $data;
    }

    private function priceItemsPayload(mixed $items): array
    {
        if (!is_array($items) || empty($items)) {
            Response::error('items must be a non-empty array', 422);
        }
        $clean = [];
        foreach ($items as $idx => $item) {
            if (!is_array($item)) {
                Response::error("items[$idx] must be an object", 422);
            }
            $productId = (int)($item['product_id'] ?? 0);
            $price = (float)($item['unit_price'] ?? 0);
            if ($productId <= 0) {
                Response::error("items[$idx].product_id is required", 422);
            }
            if ($price <= 0) {
                Response::error("items[$idx].unit_price must be greater than 0", 422);
            }
            $clean[] = [
                'product_id' => $productId,
                'unit_price' => round($price, 2),
                'notes' => isset($item['notes']) ? Request::sanitize((string)$item['notes']) : null,
            ];
        }
        return $clean;
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
