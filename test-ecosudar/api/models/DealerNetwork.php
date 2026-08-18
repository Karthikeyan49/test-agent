<?php
declare(strict_types=1);

class DealerNetwork
{
    public const LINK_STATUSES = ['dealer_added', 'linked', 'conflict', 'separate', 'merged'];

    public static function dealers(array $filters, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['u.user_type = "dealer"'];
        $params = [];

        if (($filters['is_active'] ?? '') !== '') {
            $where[] = 'u.is_active = ?';
            $params[] = $filters['is_active'] === 'false' ? 0 : 1;
        }
        if (!empty($filters['search'])) {
            $like = '%' . trim((string)$filters['search']) . '%';
            $where[] = '(u.name LIKE ? OR u.email LIKE ? OR u.phone LIKE ? OR u.company_name LIKE ?)';
            array_push($params, $like, $like, $like, $like);
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM users u WHERE $whereClause", $params);
        $rows = Database::fetchAll(
            "SELECT u.user_id, u.name, u.email, u.phone, u.company_name, u.city, u.state,
                    u.gst_number, u.is_active, u.approval_status, u.created_at,
                    COUNT(DISTINCT dc.dealer_customer_id) AS customer_count,
                    COUNT(DISTINCT dpl.price_list_id) AS price_list_count,
                    COALESCE(SUM(CASE WHEN i.status <> 'Cancelled' THEN i.total ELSE 0 END), 0) AS attributed_sales,
                    COALESCE(SUM(GREATEST(i.total - COALESCE(i.amount_paid, 0), 0)), 0) AS outstanding
             FROM users u
             LEFT JOIN dealer_customers dc ON dc.dealer_id = u.user_id
             LEFT JOIN dealer_price_lists dpl ON dpl.dealer_id = u.user_id AND dpl.is_active = 1
             LEFT JOIN orders o ON o.user_id = dc.customer_id
             LEFT JOIN invoices i ON i.order_id = o.order_id
             WHERE $whereClause
             GROUP BY u.user_id
             ORDER BY u.created_at DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        foreach ($rows as &$row) {
            $row['user_id'] = (int)$row['user_id'];
            $row['is_active'] = (bool)$row['is_active'];
            $row['customer_count'] = (int)$row['customer_count'];
            $row['price_list_count'] = (int)$row['price_list_count'];
            $row['attributed_sales'] = (float)$row['attributed_sales'];
            $row['outstanding'] = (float)$row['outstanding'];
        }

        return ['rows' => $rows, 'pagination' => self::pagination($page, $limit, $total)];
    }

    public static function dealerDetail(int $dealerId): array
    {
        $dealer = self::dealerOrFail($dealerId);
        $dealer['price_lists'] = self::priceLists(['dealer_id' => $dealerId], 1, 100)['rows'];
        $dealer['customers'] = self::dealerCustomers(['dealer_id' => $dealerId], 1, 20)['rows'];
        $dealer['dashboard'] = self::dealerDashboard($dealerId);

        return $dealer;
    }

    public static function dealerDashboard(int $dealerId): array
    {
        self::dealerOrFail($dealerId);
        $monthStart = date('Y-m-01');
        $row = Database::fetch(
            "SELECT COUNT(DISTINCT dc.dealer_customer_id) AS customer_count,
                    COUNT(DISTINCT CASE WHEN dc.link_status = 'conflict' THEN dc.dealer_customer_id END) AS conflict_count,
                    COUNT(DISTINCT o.order_id) AS order_count,
                    COALESCE(SUM(CASE WHEN DATE(o.created_at) >= ? THEN o.total_amount ELSE 0 END), 0) AS month_order_value,
                    COALESCE(SUM(CASE WHEN i.status <> 'Cancelled' THEN i.total ELSE 0 END), 0) AS invoice_value,
                    COALESCE(SUM(GREATEST(i.total - COALESCE(i.amount_paid, 0), 0)), 0) AS outstanding
             FROM dealer_customers dc
             LEFT JOIN orders o ON o.user_id = dc.customer_id
             LEFT JOIN invoices i ON i.order_id = o.order_id
             WHERE dc.dealer_id = ?",
            [$monthStart, $dealerId]
        ) ?: [];
        $recent = Database::fetchAll(
            "SELECT o.order_id, o.order_number, o.total_amount, o.order_status, o.created_at,
                    u.name AS customer_name
             FROM dealer_customers dc
             JOIN orders o ON o.user_id = dc.customer_id
             JOIN users u ON u.user_id = o.user_id
             WHERE dc.dealer_id = ?
             ORDER BY o.created_at DESC
             LIMIT 10",
            [$dealerId]
        );

        return [
            'dealer_id' => $dealerId,
            'customer_count' => (int)($row['customer_count'] ?? 0),
            'conflict_count' => (int)($row['conflict_count'] ?? 0),
            'order_count' => (int)($row['order_count'] ?? 0),
            'month_order_value' => (float)($row['month_order_value'] ?? 0),
            'invoice_value' => (float)($row['invoice_value'] ?? 0),
            'outstanding' => (float)($row['outstanding'] ?? 0),
            'recent_orders' => array_map(function (array $order): array {
                $order['order_id'] = (int)$order['order_id'];
                $order['total_amount'] = (float)$order['total_amount'];
                return $order;
            }, $recent),
        ];
    }

    public static function priceLists(array $filters, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['1=1'];
        $params = [];
        if (!empty($filters['dealer_id'])) {
            $where[] = 'dpl.dealer_id = ?';
            $params[] = (int)$filters['dealer_id'];
        }
        if (($filters['is_active'] ?? '') !== '') {
            $where[] = 'dpl.is_active = ?';
            $params[] = $filters['is_active'] === 'false' ? 0 : 1;
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM dealer_price_lists dpl WHERE $whereClause", $params);
        $rows = Database::fetchAll(
            "SELECT dpl.*, u.name AS dealer_name, COUNT(dpi.price_item_id) AS item_count
             FROM dealer_price_lists dpl
             JOIN users u ON u.user_id = dpl.dealer_id
             LEFT JOIN dealer_price_items dpi ON dpi.price_list_id = dpl.price_list_id
             WHERE $whereClause
             GROUP BY dpl.price_list_id
             ORDER BY dpl.is_default DESC, dpl.created_at DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        return ['rows' => array_map([self::class, 'formatPriceList'], $rows), 'pagination' => self::pagination($page, $limit, $total)];
    }

    public static function priceList(int $id, bool $withItems = true): ?array
    {
        $row = Database::fetch(
            "SELECT dpl.*, u.name AS dealer_name, COUNT(dpi.price_item_id) AS item_count
             FROM dealer_price_lists dpl
             JOIN users u ON u.user_id = dpl.dealer_id
             LEFT JOIN dealer_price_items dpi ON dpi.price_list_id = dpl.price_list_id
             WHERE dpl.price_list_id = ?
             GROUP BY dpl.price_list_id
             LIMIT 1",
            [$id]
        );
        if (!$row) {
            return null;
        }
        $out = self::formatPriceList($row);
        if ($withItems) {
            $out['items'] = self::priceItems($id);
            $out['warnings'] = self::priceWarnings($out['items']);
        }

        return $out;
    }

    public static function createPriceList(array $data): int
    {
        self::dealerOrFail((int)$data['dealer_id']);
        if (!empty($data['is_default'])) {
            Database::execute('UPDATE dealer_price_lists SET is_default = 0 WHERE dealer_id = ?', [(int)$data['dealer_id']]);
        }

        return Database::insert(
            'INSERT INTO dealer_price_lists (dealer_id, name, is_active, is_default, notes, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [
                (int)$data['dealer_id'],
                $data['name'],
                !empty($data['is_active']) ? 1 : 0,
                !empty($data['is_default']) ? 1 : 0,
                $data['notes'] ?: null,
                $data['created_by'] ?? null,
            ]
        );
    }

    public static function updatePriceList(int $id, array $data): void
    {
        $existing = self::priceList($id, false);
        if (!$existing) {
            Response::error('Dealer price list not found', 404);
        }
        if (!empty($data['is_default'])) {
            Database::execute('UPDATE dealer_price_lists SET is_default = 0 WHERE dealer_id = ?', [$existing['dealer_id']]);
        }

        $sets = [];
        $params = [];
        foreach (['name', 'is_active', 'is_default', 'notes'] as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $sets[] = "$field = ?";
            $params[] = in_array($field, ['is_active', 'is_default'], true) ? (int)(bool)$data[$field] : ($data[$field] ?: null);
        }
        if (!empty($sets)) {
            $params[] = $id;
            Database::execute('UPDATE dealer_price_lists SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE price_list_id = ?', $params);
        }
    }

    public static function replacePriceItems(int $priceListId, array $items): array
    {
        $list = self::priceList($priceListId, false);
        if (!$list) {
            Response::error('Dealer price list not found', 404);
        }

        foreach ($items as $item) {
            if (!Product::findById((int)$item['product_id'])) {
                Response::error('Product not found: ' . (string)$item['product_id'], 404);
            }
            if ((float)$item['unit_price'] <= 0) {
                Response::error('unit_price must be greater than 0', 422);
            }
            Database::execute(
                'INSERT INTO dealer_price_items (price_list_id, product_id, unit_price, notes, created_at)
                 VALUES (?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE unit_price = VALUES(unit_price), notes = VALUES(notes), updated_at = NOW()',
                [$priceListId, (int)$item['product_id'], round((float)$item['unit_price'], 2), $item['notes'] ?? null]
            );
        }

        return self::priceItems($priceListId);
    }

    public static function priceItems(int $priceListId): array
    {
        $rows = Database::fetchAll(
            "SELECT dpi.*, p.product_name, p.base_price, p.unit,
                    0 AS avg_cost
             FROM dealer_price_items dpi
             JOIN products p ON p.product_id = dpi.product_id
             WHERE dpi.price_list_id = ?
             ORDER BY p.product_name ASC",
            [$priceListId]
        );

        return array_map([self::class, 'formatPriceItem'], $rows);
    }

    public static function effectivePrices(int $dealerId, ?int $dealerCustomerId = null): array
    {
        $list = self::effectivePriceList($dealerId, $dealerCustomerId);
        $products = Database::fetchAll(
            'SELECT product_id, product_name, base_price, unit, is_available FROM products WHERE is_deleted = 0 ORDER BY product_name ASC'
        );
        $prices = [];
        if ($list) {
            foreach (self::priceItems((int)$list['price_list_id']) as $item) {
                $prices[(int)$item['product_id']] = $item;
            }
        }

        $rows = [];
        foreach ($products as $product) {
            $productId = (int)$product['product_id'];
            $dealerItem = $prices[$productId] ?? null;
            $rows[] = [
                'product_id' => $productId,
                'product_name' => $product['product_name'],
                'base_price' => (float)$product['base_price'],
                'unit' => $product['unit'],
                'is_available' => (bool)$product['is_available'],
                'price_list_id' => $list['price_list_id'] ?? null,
                'unit_price' => $dealerItem ? (float)$dealerItem['unit_price'] : (float)$product['base_price'],
                'source' => $dealerItem ? 'dealer_price_list' : 'product_base_price',
                'below_cost_warning' => $dealerItem['below_cost_warning'] ?? false,
            ];
        }

        return ['price_list' => $list, 'items' => $rows];
    }

    public static function resolvePriceForCustomer(int $customerId, int $productId, ?int $configId = null): ?array
    {
        try {
            $mapping = Database::fetch(
                "SELECT dc.*, dpl.price_list_id AS dealer_default_price_list_id
                 FROM dealer_customers dc
                 LEFT JOIN dealer_price_lists dpl ON dpl.dealer_id = dc.dealer_id AND dpl.is_active = 1 AND dpl.is_default = 1
                 WHERE dc.customer_id = ? AND dc.link_status = 'linked'
                 ORDER BY dc.updated_at DESC, dc.dealer_customer_id DESC
                 LIMIT 1",
                [$customerId]
            );
            if ($mapping) {
                $priceListId = (int)($mapping['price_list_id'] ?: $mapping['dealer_default_price_list_id']);
                if ($priceListId > 0) {
                    $item = Database::fetch(
                        'SELECT unit_price FROM dealer_price_items WHERE price_list_id = ? AND product_id = ? LIMIT 1',
                        [$priceListId, $productId]
                    );
                    if ($item) {
                        return [
                            'price' => (float)$item['unit_price'],
                            'source' => 'dealer_price_list',
                            'price_list_id' => $priceListId,
                            'dealer_id' => (int)$mapping['dealer_id'],
                            'dealer_customer_id' => (int)$mapping['dealer_customer_id'],
                        ];
                    }
                }
            }
        } catch (Throwable $e) {
            error_log('Dealer price resolution skipped: ' . $e->getMessage());
        }

        if ($configId) {
            $config = Product::getConfigById($configId);
            if ($config && (int)$config['product_id'] === $productId) {
                return ['price' => (float)$config['price'], 'source' => 'product_configuration'];
            }
        }
        $product = Product::findById($productId);
        return $product ? ['price' => (float)$product['base_price'], 'source' => 'product_base_price'] : null;
    }

    public static function dealerCustomers(array $filters, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['dealer_id'])) {
            $where[] = 'dc.dealer_id = ?';
            $params[] = (int)$filters['dealer_id'];
        }
        if (!empty($filters['link_status']) && in_array($filters['link_status'], self::LINK_STATUSES, true)) {
            $where[] = 'dc.link_status = ?';
            $params[] = $filters['link_status'];
        }
        if (!empty($filters['search'])) {
            $like = '%' . trim((string)$filters['search']) . '%';
            $where[] = '(dc.name LIKE ? OR dc.phone LIKE ? OR dc.email LIKE ? OR dc.gstin LIKE ?)';
            array_push($params, $like, $like, $like, $like);
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM dealer_customers dc WHERE $whereClause", $params);
        $rows = Database::fetchAll(
            "SELECT dc.*, dealer.name AS dealer_name, customer.name AS linked_customer_name,
                    conflict.name AS conflict_user_name, dpl.name AS price_list_name
             FROM dealer_customers dc
             JOIN users dealer ON dealer.user_id = dc.dealer_id
             LEFT JOIN users customer ON customer.user_id = dc.customer_id
             LEFT JOIN users conflict ON conflict.user_id = dc.conflict_user_id
             LEFT JOIN dealer_price_lists dpl ON dpl.price_list_id = dc.price_list_id
             WHERE $whereClause
             ORDER BY dc.created_at DESC, dc.dealer_customer_id DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        return ['rows' => array_map([self::class, 'formatDealerCustomer'], $rows), 'pagination' => self::pagination($page, $limit, $total)];
    }

    public static function dealerCustomer(int $id): ?array
    {
        $row = Database::fetch(
            "SELECT dc.*, dealer.name AS dealer_name, customer.name AS linked_customer_name,
                    conflict.name AS conflict_user_name, dpl.name AS price_list_name
             FROM dealer_customers dc
             JOIN users dealer ON dealer.user_id = dc.dealer_id
             LEFT JOIN users customer ON customer.user_id = dc.customer_id
             LEFT JOIN users conflict ON conflict.user_id = dc.conflict_user_id
             LEFT JOIN dealer_price_lists dpl ON dpl.price_list_id = dc.price_list_id
             WHERE dc.dealer_customer_id = ?
             LIMIT 1",
            [$id]
        );

        return $row ? self::formatDealerCustomer($row) : null;
    }

    public static function createDealerCustomer(array $data): array
    {
        self::dealerOrFail((int)$data['dealer_id']);
        if (!empty($data['price_list_id']) && !self::priceListBelongsToDealer((int)$data['price_list_id'], (int)$data['dealer_id'])) {
            Response::error('Price list does not belong to this dealer', 422);
        }

        $normalized = self::normalizedIdentity($data);
        $dedupe = self::dedupe($normalized, (int)$data['dealer_id']);
        $status = $dedupe['status'];
        $customerId = $dedupe['customer_id'];
        $conflictUserId = $dedupe['conflict_user_id'];

        $id = Database::insert(
            'INSERT INTO dealer_customers
                (dealer_id, customer_id, price_list_id, name, phone, normalized_phone, email,
                 normalized_email, gstin, normalized_gstin, address, city, state, pincode,
                 link_status, conflict_user_id, resolution_notes, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                (int)$data['dealer_id'],
                $customerId,
                $data['price_list_id'] ?: null,
                $data['name'],
                $data['phone'] ?: null,
                $normalized['phone'],
                $data['email'] ?: null,
                $normalized['email'],
                $data['gstin'] ?: null,
                $normalized['gstin'],
                $data['address'] ?: null,
                $data['city'] ?: null,
                $data['state'] ?: null,
                $data['pincode'] ?: null,
                $status,
                $conflictUserId,
                $dedupe['reason'],
                $data['created_by'] ?? null,
            ]
        );

        return ['customer' => self::dealerCustomer($id), 'dedupe' => $dedupe];
    }

    public static function updateDealerCustomer(int $id, int $dealerId, array $data): array
    {
        $existing = self::dealerCustomer($id);
        if (!$existing) {
            Response::error('Dealer customer not found', 404);
        }
        if ((int)$existing['dealer_id'] !== $dealerId) {
            Response::error('Forbidden', 403);
        }
        if (!empty($data['price_list_id']) && !self::priceListBelongsToDealer((int)$data['price_list_id'], $dealerId)) {
            Response::error('Price list does not belong to this dealer', 422);
        }
        $normalized = self::normalizedIdentity($data + $existing);
        $sets = [];
        $params = [];
        foreach (['name', 'phone', 'email', 'gstin', 'address', 'city', 'state', 'pincode', 'price_list_id'] as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $sets[] = "$field = ?";
            $params[] = $data[$field] ?: null;
        }
        foreach (['normalized_phone' => 'phone', 'normalized_email' => 'email', 'normalized_gstin' => 'gstin'] as $column => $key) {
            $sets[] = "$column = ?";
            $params[] = $normalized[$key];
        }
        $params[] = $id;
        Database::execute('UPDATE dealer_customers SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE dealer_customer_id = ?', $params);

        return self::dealerCustomer($id) ?: [];
    }

    public static function linkDirectRegistration(int $userId): array
    {
        try {
            $user = Database::fetch('SELECT * FROM users WHERE user_id = ? AND user_type = "customer" LIMIT 1', [$userId]);
            if (!$user) {
                return ['status' => 'not_applicable'];
            }
            $normalized = self::normalizedIdentity([
                'phone' => $user['phone'] ?? '',
                'email' => $user['email'] ?? '',
                'gstin' => $user['gst_number'] ?? '',
            ]);
            $matches = self::dealerCustomerMatches($normalized);
            $strong = array_values(array_filter($matches, fn($m) => in_array($m['match_key'], ['phone', 'gstin'], true)));
            if (count($strong) === 1) {
                Database::execute(
                    'UPDATE dealer_customers
                     SET customer_id = ?, link_status = "linked", conflict_user_id = NULL,
                         resolution_notes = "Auto-linked on direct registration", updated_at = NOW()
                     WHERE dealer_customer_id = ?',
                    [$userId, (int)$strong[0]['dealer_customer_id']]
                );
                return ['status' => 'linked', 'dealer_customer_id' => (int)$strong[0]['dealer_customer_id'], 'dealer_id' => (int)$strong[0]['dealer_id']];
            }
            if (count($matches) > 0) {
                foreach ($matches as $match) {
                    Database::execute(
                        'UPDATE dealer_customers
                         SET link_status = "conflict", conflict_user_id = ?, resolution_notes = "Direct registration matched weak or multiple mappings", updated_at = NOW()
                         WHERE dealer_customer_id = ? AND link_status <> "linked"',
                        [$userId, (int)$match['dealer_customer_id']]
                    );
                }
                return ['status' => 'conflict', 'matches' => count($matches)];
            }
        } catch (Throwable $e) {
            error_log('Dealer direct-registration dedupe failed: ' . $e->getMessage());
            return ['status' => 'skipped', 'reason' => 'dealer tables unavailable'];
        }

        return ['status' => 'none'];
    }

    public static function resolveDealerCustomer(int $id, string $action, ?int $customerId, ?string $notes): array
    {
        $row = self::dealerCustomer($id);
        if (!$row) {
            Response::error('Dealer customer not found', 404);
        }
        if ($action === 'link') {
            if (!$customerId || !Database::fetch('SELECT user_id FROM users WHERE user_id = ? AND user_type = "customer" LIMIT 1', [$customerId])) {
                Response::error('Valid customer_id is required to link', 422);
            }
            Database::execute(
                'UPDATE dealer_customers
                 SET customer_id = ?, link_status = "linked", conflict_user_id = NULL, resolution_notes = ?, updated_at = NOW()
                 WHERE dealer_customer_id = ?',
                [$customerId, $notes ?: 'Manually linked', $id]
            );
        } elseif ($action === 'separate') {
            Database::execute(
                'UPDATE dealer_customers
                 SET link_status = "separate", conflict_user_id = NULL, resolution_notes = ?, updated_at = NOW()
                 WHERE dealer_customer_id = ?',
                [$notes ?: 'Kept separate', $id]
            );
        } else {
            Response::error('action must be link or separate', 422);
        }

        return self::dealerCustomer($id) ?: [];
    }

    public static function customerAnalytics(int $customerId): array
    {
        $customer = Database::fetch('SELECT user_id, name, email, phone, company_name FROM users WHERE user_id = ? LIMIT 1', [$customerId]);
        if (!$customer) {
            Response::error('Customer not found', 404);
        }
        $summary = self::calculateCustomerMetrics($customerId);
        $monthly = Database::fetchAll(
            "SELECT DATE_FORMAT(COALESCE(i.invoice_date, DATE(i.created_at)), '%Y-%m') AS month,
                    COUNT(*) AS invoice_count,
                    SUM(i.total) AS total
             FROM invoices i
             LEFT JOIN orders o ON o.order_id = i.order_id
             WHERE o.user_id = ? AND LOWER(i.status) <> 'cancelled'
             GROUP BY DATE_FORMAT(COALESCE(i.invoice_date, DATE(i.created_at)), '%Y-%m')
             ORDER BY month ASC",
            [$customerId]
        );
        foreach ($monthly as &$row) {
            $row['invoice_count'] = (int)$row['invoice_count'];
            $row['total'] = (float)$row['total'];
        }
        $openInvoices = Database::fetchAll(
            "SELECT i.invoice_id, i.invoice_number, COALESCE(i.invoice_date, DATE(i.created_at)) AS invoice_date,
                    i.due_date, i.total, COALESCE(i.amount_paid, 0) AS amount_paid,
                    GREATEST(i.total - COALESCE(i.amount_paid, 0), 0) AS balance_due,
                    i.payment_status
             FROM invoices i
             JOIN orders o ON o.order_id = i.order_id
             WHERE o.user_id = ? AND GREATEST(i.total - COALESCE(i.amount_paid, 0), 0) > 0.005
             ORDER BY COALESCE(i.due_date, i.invoice_date, DATE(i.created_at)) ASC",
            [$customerId]
        );
        foreach ($openInvoices as &$invoice) {
            foreach (['total', 'amount_paid', 'balance_due'] as $field) {
                $invoice[$field] = (float)$invoice[$field];
            }
        }

        return ['customer' => $customer, 'summary' => $summary, 'monthly_purchase' => $monthly, 'open_invoices' => $openInvoices];
    }

    public static function analyticsSummary(int $churnDays = 90, int $limit = 10): array
    {
        $limit = min(50, max(1, $limit));
        return [
            'top_customers' => Database::fetchAll(
                'SELECT cm.*, u.name, u.phone, u.company_name FROM customer_metrics cm JOIN users u ON u.user_id = cm.customer_id ORDER BY cm.total_spend DESC LIMIT ?',
                [$limit]
            ),
            'slow_payers' => Database::fetchAll(
                'SELECT cm.*, u.name, u.phone, u.company_name FROM customer_metrics cm JOIN users u ON u.user_id = cm.customer_id WHERE cm.avg_payment_days IS NOT NULL ORDER BY cm.avg_payment_days DESC LIMIT ?',
                [$limit]
            ),
            'churn_risk' => Database::fetchAll(
                'SELECT cm.*, u.name, u.phone, u.company_name FROM customer_metrics cm JOIN users u ON u.user_id = cm.customer_id WHERE cm.churn_risk = 1 OR (cm.last_order_date IS NOT NULL AND cm.last_order_date < DATE_SUB(CURDATE(), INTERVAL ? DAY)) ORDER BY cm.total_spend DESC LIMIT ?',
                [$churnDays, $limit]
            ),
        ];
    }

    public static function recomputeCustomerMetrics(?int $customerId = null): array
    {
        $where = 'u.user_type = "customer"';
        $params = [];
        if ($customerId) {
            $where .= ' AND u.user_id = ?';
            $params[] = $customerId;
        }
        $users = Database::fetchAll("SELECT u.user_id FROM users u WHERE $where", $params);
        $count = 0;
        foreach ($users as $user) {
            $metrics = self::calculateCustomerMetrics((int)$user['user_id']);
            Database::execute(
                'INSERT INTO customer_metrics
                    (customer_id, total_orders, total_spend, avg_order_value, outstanding,
                     avg_payment_days, last_order_date, last_invoice_date, segment, payment_behavior, churn_risk, updated_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
                 ON DUPLICATE KEY UPDATE
                    total_orders = VALUES(total_orders),
                    total_spend = VALUES(total_spend),
                    avg_order_value = VALUES(avg_order_value),
                    outstanding = VALUES(outstanding),
                    avg_payment_days = VALUES(avg_payment_days),
                    last_order_date = VALUES(last_order_date),
                    last_invoice_date = VALUES(last_invoice_date),
                    segment = VALUES(segment),
                    payment_behavior = VALUES(payment_behavior),
                    churn_risk = VALUES(churn_risk),
                    updated_at = NOW()',
                [
                    (int)$user['user_id'],
                    $metrics['total_orders'],
                    $metrics['total_spend'],
                    $metrics['avg_order_value'],
                    $metrics['outstanding'],
                    $metrics['avg_payment_days'],
                    $metrics['last_order_date'],
                    $metrics['last_invoice_date'],
                    $metrics['segment'],
                    $metrics['payment_behavior'],
                    $metrics['churn_risk'] ? 1 : 0,
                ]
            );
            $count++;
        }

        return ['recomputed' => $count];
    }

    public static function calculateCustomerMetrics(int $customerId): array
    {
        $row = Database::fetch(
            "SELECT COUNT(DISTINCT o.order_id) AS total_orders,
                    COALESCE(SUM(i.total), 0) AS total_spend,
                    COALESCE(SUM(GREATEST(i.total - COALESCE(i.amount_paid, 0), 0)), 0) AS outstanding,
                    MAX(DATE(o.created_at)) AS last_order_date,
                    MAX(COALESCE(i.invoice_date, DATE(i.created_at))) AS last_invoice_date
             FROM orders o
             LEFT JOIN invoices i ON i.order_id = o.order_id AND LOWER(i.status) <> 'cancelled'
             WHERE o.user_id = ?",
            [$customerId]
        ) ?: [];
        $pay = Database::fetch(
            "SELECT AVG(DATEDIFF(p.first_paid_on, COALESCE(i.invoice_date, DATE(i.created_at)))) AS avg_payment_days
             FROM invoices i
             JOIN orders o ON o.order_id = i.order_id
             JOIN (
                SELECT invoice_id, MIN(paid_on) AS first_paid_on
                FROM payments
                WHERE status = 'posted' AND direction = 'in'
                GROUP BY invoice_id
             ) p ON p.invoice_id = i.invoice_id
             WHERE o.user_id = ? AND LOWER(COALESCE(i.payment_status, i.status)) = 'paid'",
            [$customerId]
        ) ?: [];

        $orders = (int)($row['total_orders'] ?? 0);
        $spend = round((float)($row['total_spend'] ?? 0), 2);
        $avgPaymentDays = $pay['avg_payment_days'] !== null ? round((float)$pay['avg_payment_days'], 1) : null;
        $lastOrder = $row['last_order_date'] ?? null;
        $daysSince = $lastOrder ? (int)floor((time() - strtotime($lastOrder)) / 86400) : null;
        $segment = self::segment($orders, $spend, $daysSince);

        return [
            'customer_id' => $customerId,
            'total_orders' => $orders,
            'total_spend' => $spend,
            'avg_order_value' => $orders > 0 ? round($spend / $orders, 2) : 0.0,
            'outstanding' => round((float)($row['outstanding'] ?? 0), 2),
            'avg_payment_days' => $avgPaymentDays,
            'last_order_date' => $lastOrder,
            'last_invoice_date' => $row['last_invoice_date'] ?? null,
            'segment' => $segment,
            'payment_behavior' => self::paymentBehavior($avgPaymentDays),
            'churn_risk' => $daysSince !== null && $daysSince > 90 && $spend > 0,
        ];
    }

    public static function mergeCustomers(int $sourceId, int $targetId): array
    {
        if ($sourceId === $targetId) {
            Response::error('source_id and target_id must be different', 422);
        }
        foreach ([$sourceId, $targetId] as $id) {
            if (!Database::fetch('SELECT user_id FROM users WHERE user_id = ? AND user_type = "customer" LIMIT 1', [$id])) {
                Response::error('Both source_id and target_id must be customers', 422);
            }
        }
        $orders = Database::execute('UPDATE orders SET user_id = ?, updated_at = NOW() WHERE user_id = ?', [$targetId, $sourceId]);
        $quotes = Database::execute('UPDATE quotes SET user_id = ? WHERE user_id = ?', [$targetId, $sourceId]);
        $payments = Database::execute('UPDATE payments SET user_id = ?, updated_at = NOW() WHERE user_id = ?', [$targetId, $sourceId]);
        $mappings = Database::execute(
            'UPDATE dealer_customers SET customer_id = ?, link_status = "linked", resolution_notes = "Merged customer record", updated_at = NOW() WHERE customer_id = ?',
            [$targetId, $sourceId]
        );
        Database::execute('UPDATE users SET is_active = 0, updated_at = NOW() WHERE user_id = ?', [$sourceId]);
        self::recomputeCustomerMetrics($targetId);

        return compact('orders', 'quotes', 'payments', 'mappings') + ['source_id' => $sourceId, 'target_id' => $targetId];
    }

    public static function dealerOrFail(int $dealerId): array
    {
        $dealer = Database::fetch(
            'SELECT user_id, name, email, phone, company_name, address, city, state, pincode, gst_number, is_active, approval_status, created_at
             FROM users WHERE user_id = ? AND user_type = "dealer" LIMIT 1',
            [$dealerId]
        );
        if (!$dealer) {
            Response::error('Dealer not found', 404);
        }
        $dealer['user_id'] = (int)$dealer['user_id'];
        $dealer['is_active'] = (bool)$dealer['is_active'];

        return $dealer;
    }

    public static function normalizePhone(?string $phone): ?string
    {
        $digits = preg_replace('/\D/', '', (string)$phone);
        if ($digits === '') {
            return null;
        }
        if (strlen($digits) > 10) {
            $digits = substr($digits, -10);
        }
        return strlen($digits) >= 7 ? $digits : null;
    }

    public static function normalizeEmail(?string $email): ?string
    {
        $email = strtolower(trim((string)$email));
        return $email !== '' && filter_var($email, FILTER_VALIDATE_EMAIL) ? $email : null;
    }

    public static function normalizeGstin(?string $gstin): ?string
    {
        $gstin = strtoupper(preg_replace('/\s+/', '', (string)$gstin));
        return $gstin !== '' ? $gstin : null;
    }

    private static function normalizedIdentity(array $data): array
    {
        return [
            'phone' => self::normalizePhone($data['phone'] ?? null),
            'email' => self::normalizeEmail($data['email'] ?? null),
            'gstin' => self::normalizeGstin($data['gstin'] ?? ($data['gst_number'] ?? null)),
        ];
    }

    private static function dedupe(array $normalized, int $dealerId): array
    {
        $user = self::matchingUser($normalized);
        if ($user && in_array($user['match_key'], ['phone', 'gstin'], true)) {
            return ['status' => 'linked', 'customer_id' => (int)$user['user_id'], 'conflict_user_id' => null, 'reason' => 'Strong match on ' . $user['match_key']];
        }
        if ($user) {
            return ['status' => 'conflict', 'customer_id' => null, 'conflict_user_id' => (int)$user['user_id'], 'reason' => 'Weak match on email'];
        }
        $matches = self::dealerCustomerMatches($normalized, $dealerId);
        if (!empty($matches)) {
            return ['status' => 'conflict', 'customer_id' => null, 'conflict_user_id' => null, 'reason' => 'Matches existing dealer customer mapping'];
        }

        return ['status' => 'dealer_added', 'customer_id' => null, 'conflict_user_id' => null, 'reason' => null];
    }

    private static function matchingUser(array $normalized): ?array
    {
        if ($normalized['gstin']) {
            $row = Database::fetch('SELECT user_id, "gstin" AS match_key FROM users WHERE gst_number = ? AND user_type = "customer" LIMIT 1', [$normalized['gstin']]);
            if ($row) return $row;
        }
        if ($normalized['phone']) {
            $row = Database::fetch('SELECT user_id, "phone" AS match_key FROM users WHERE phone = ? AND user_type = "customer" LIMIT 1', [$normalized['phone']]);
            if ($row) return $row;
        }
        if ($normalized['email']) {
            return Database::fetch('SELECT user_id, "email" AS match_key FROM users WHERE email = ? AND user_type = "customer" LIMIT 1', [$normalized['email']]);
        }

        return null;
    }

    private static function dealerCustomerMatches(array $normalized, ?int $excludeDealerId = null): array
    {
        $parts = [];
        $params = [];
        foreach (['gstin' => 'normalized_gstin', 'phone' => 'normalized_phone', 'email' => 'normalized_email'] as $key => $column) {
            if ($normalized[$key]) {
                $parts[] = "SELECT dealer_customer_id, dealer_id, '{$key}' AS match_key FROM dealer_customers WHERE {$column} = ?";
                $params[] = $normalized[$key];
            }
        }
        if (empty($parts)) {
            return [];
        }
        $sql = implode(' UNION ALL ', $parts);
        $rows = Database::fetchAll($sql, $params);
        if ($excludeDealerId) {
            $rows = array_values(array_filter($rows, fn($row) => (int)$row['dealer_id'] !== $excludeDealerId));
        }

        return $rows;
    }

    private static function effectivePriceList(int $dealerId, ?int $dealerCustomerId): ?array
    {
        if ($dealerCustomerId) {
            $customer = self::dealerCustomer($dealerCustomerId);
            if (!$customer || (int)$customer['dealer_id'] !== $dealerId) {
                Response::error('Dealer customer not found for this dealer', 404);
            }
            if ($customer['price_list_id']) {
                return self::priceList((int)$customer['price_list_id'], false);
            }
        }
        $row = Database::fetch(
            'SELECT price_list_id FROM dealer_price_lists WHERE dealer_id = ? AND is_active = 1 ORDER BY is_default DESC, created_at DESC LIMIT 1',
            [$dealerId]
        );
        return $row ? self::priceList((int)$row['price_list_id'], false) : null;
    }

    private static function priceListBelongsToDealer(int $priceListId, int $dealerId): bool
    {
        return Database::fetch('SELECT price_list_id FROM dealer_price_lists WHERE price_list_id = ? AND dealer_id = ? LIMIT 1', [$priceListId, $dealerId]) !== null;
    }

    private static function priceWarnings(array $items): array
    {
        return array_values(array_filter($items, fn($item) => !empty($item['below_cost_warning'])));
    }

    private static function formatPriceList(array $row): array
    {
        return [
            'price_list_id' => (int)$row['price_list_id'],
            'id' => (string)$row['price_list_id'],
            'dealer_id' => (int)$row['dealer_id'],
            'dealer_name' => $row['dealer_name'] ?? null,
            'name' => $row['name'],
            'is_active' => (bool)$row['is_active'],
            'is_default' => (bool)$row['is_default'],
            'notes' => $row['notes'],
            'item_count' => (int)($row['item_count'] ?? 0),
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
    }

    private static function formatPriceItem(array $row): array
    {
        $avgCost = (float)($row['avg_cost'] ?? 0);
        $unitPrice = (float)$row['unit_price'];
        return [
            'price_item_id' => (int)$row['price_item_id'],
            'id' => (string)$row['price_item_id'],
            'price_list_id' => (int)$row['price_list_id'],
            'product_id' => (int)$row['product_id'],
            'product_name' => $row['product_name'],
            'base_price' => (float)$row['base_price'],
            'unit' => $row['unit'],
            'unit_price' => $unitPrice,
            'avg_cost' => $avgCost,
            'below_cost_warning' => $avgCost > 0 && $unitPrice < $avgCost,
            'notes' => $row['notes'],
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
    }

    private static function formatDealerCustomer(array $row): array
    {
        return [
            'dealer_customer_id' => (int)$row['dealer_customer_id'],
            'id' => (string)$row['dealer_customer_id'],
            'dealer_id' => (int)$row['dealer_id'],
            'dealer_name' => $row['dealer_name'] ?? null,
            'customer_id' => $row['customer_id'] ? (int)$row['customer_id'] : null,
            'linked_customer_name' => $row['linked_customer_name'] ?? null,
            'price_list_id' => $row['price_list_id'] ? (int)$row['price_list_id'] : null,
            'price_list_name' => $row['price_list_name'] ?? null,
            'name' => $row['name'],
            'phone' => $row['phone'],
            'email' => $row['email'],
            'gstin' => $row['gstin'],
            'address' => $row['address'],
            'city' => $row['city'],
            'state' => $row['state'],
            'pincode' => $row['pincode'],
            'link_status' => $row['link_status'],
            'conflict_user_id' => $row['conflict_user_id'] ? (int)$row['conflict_user_id'] : null,
            'conflict_user_name' => $row['conflict_user_name'] ?? null,
            'resolution_notes' => $row['resolution_notes'],
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
    }

    private static function segment(int $orders, float $spend, ?int $daysSince): string
    {
        if ($orders === 0) {
            return 'Dormant';
        }
        if ($daysSince !== null && $daysSince <= 45 && $orders >= 5 && $spend >= 50000) {
            return 'Champions';
        }
        if ($daysSince !== null && $daysSince <= 90 && $orders >= 3) {
            return 'Loyal';
        }
        if ($daysSince !== null && $daysSince > 90 && $spend > 0) {
            return 'At-risk';
        }

        return 'New';
    }

    private static function paymentBehavior(?float $avgPaymentDays): string
    {
        if ($avgPaymentDays === null) {
            return 'unknown';
        }
        if ($avgPaymentDays <= 7) {
            return 'fast';
        }
        if ($avgPaymentDays <= 30) {
            return 'on_time';
        }

        return 'slow';
    }

    private static function pagination(int $page, int $limit, int $total): array
    {
        return ['page' => $page, 'limit' => $limit, 'total' => $total, 'total_pages' => (int)ceil($total / $limit)];
    }
}
