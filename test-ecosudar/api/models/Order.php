<?php
declare(strict_types=1);
// kjahkj
class Order
{
    public const STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'out for delivery', 'delivered', 'cancelled', 'returned'];
    public const CANCELLABLE = ['pending', 'confirmed'];

    /**
     * Create an order with multiple items inside a transaction.
     *
     * $items = [
     *   ['product_id' => 1, 'config_id' => 2, 'quantity' => 100, 'unit_price' => 9.00, 'size' => '8mm', 'purpose' => 'Boiler']
     * ]
     *
     * @throws AppException
     */
    public static function create(int $userId, array $items, array $meta = []): int
    {
        $db = Database::getInstance();
        try {
            $db->beginTransaction();

            // Generate order number: ES + YYYYMMDD + 4-digit sequence
            $prefix      = Database::fetch("SELECT setting_value FROM settings WHERE setting_key = 'order_prefix'")['setting_value'] ?? 'ES';
            $count       = Database::count('SELECT COUNT(*) AS cnt FROM orders');
            $orderNumber = $prefix . date('Ymd') . str_pad((string)($count + 1), 4, '0', STR_PAD_LEFT);

            // Delivery fee from settings
            // Changed to 0 as per requirements so orders do not have unexpected charges.
            $deliveryFee = 0;

            // Calculate total from items
            $itemsTotal = array_reduce($items, fn($carry, $item) => $carry + ((float)$item['unit_price'] * (int)$item['quantity']), 0.0);
            $totalAmount = $itemsTotal + $deliveryFee;

            $orderId = Database::insert(
                'INSERT INTO orders
                    (user_id, order_number, total_amount, delivery_fee, order_status, payment_status,
                     payment_method, delivery_address, delivery_city, delivery_state, delivery_pincode, notes, created_at)
                 VALUES (?, ?, ?, ?, "pending", "pending", ?, ?, ?, ?, ?, ?, NOW())',
                [
                    $userId,
                    $orderNumber,
                    $totalAmount,
                    $deliveryFee,
                    $meta['payment_method']   ?? null,
                    $meta['delivery_address'] ?? null,
                    $meta['delivery_city']    ?? null,
                    $meta['delivery_state']   ?? null,
                    $meta['delivery_pincode'] ?? null,
                    $meta['notes']            ?? null,
                ]
            );

            foreach ($items as $item) {
                Database::execute(
                    'INSERT INTO order_items
                        (order_id, product_id, config_id, quantity, unit_price, total_price, size, purpose, sub_purpose, created_at)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                    [
                        $orderId,
                        (int)$item['product_id'],
                        isset($item['config_id']) ? (int)$item['config_id'] : null,
                        (int)$item['quantity'],
                        (float)$item['unit_price'],
                        (float)$item['unit_price'] * (int)$item['quantity'],
                        $item['size']    ?? null,
                        $item['purpose'] ?? null,
                        $item['sub_purpose'] ?? null,
                    ]
                );
            }

            // Audit log
            Database::execute(
                'INSERT INTO audit_log (user_id, action, table_name, record_id, new_value, ip_address, created_at)
                 VALUES (?, "ORDER_CREATED", "orders", ?, ?, ?, NOW())',
                [$userId, $orderId, $orderNumber, $_SERVER['REMOTE_ADDR'] ?? null]
            );

            $db->commit();
            return $orderId;

        } catch (AppException $e) {
            $db->rollBack();
            throw $e;
        } catch (Throwable $e) {
            $db->rollBack();
            error_log('[Order::create] ' . $e->getMessage());
            throw new AppException('Failed to create order', 500);
        }
    }

    /**
     * Get a single order with its items and customer info.
     */
    public static function findById(int $orderId): ?array
    {
        $order = Database::fetch(
            'SELECT o.order_id, o.order_number, o.total_amount, o.delivery_fee, o.order_status,
                    o.payment_status, o.payment_method, o.tracking_number, o.cancel_reason, o.refund_status,
                    o.delivery_address, o.delivery_city, o.delivery_state, o.delivery_pincode,
                    o.notes, o.created_at, o.updated_at,
                    u.user_id, u.name AS customer_name, u.email, u.phone, u.company_name
             FROM orders o
             JOIN users u ON o.user_id = u.user_id
             WHERE o.order_id = ? LIMIT 1',
            [$orderId]
        );

        if (!$order) {
            return null;
        }

        $order['items'] = self::getItems($orderId);
        $order['total_amount']  = (float)$order['total_amount'];
        $order['delivery_fee']  = (float)$order['delivery_fee'];
        return $order;
    }

    /**
     * Scoped to owner — 404 if order belongs to another user.
     */
    public static function findForUser(int $orderId, int $userId): ?array
    {
        $order = Database::fetch(
            'SELECT o.order_id, o.order_number, o.total_amount, o.delivery_fee, o.order_status,
                    o.payment_status, o.tracking_number, o.cancel_reason, o.refund_status,
                    o.delivery_address, o.delivery_city, o.delivery_state,
                    o.delivery_pincode, o.notes, o.created_at, o.updated_at
             FROM orders o
             WHERE o.order_id = ? AND o.user_id = ? LIMIT 1',
            [$orderId, $userId]
        );

        if (!$order) {
            return null;
        }

        $order['items'] = self::getItems($orderId);
        $order['total_amount'] = (float)$order['total_amount'];
        $order['delivery_fee'] = (float)$order['delivery_fee'];
        return $order;
    }

    /**
     * Paginated orders for a user with optional status filter and sort.
     */
    public static function forUser(int $userId, array $filters = [], int $page = 1, int $limit = 10): array
    {
        $where  = ['o.user_id = ?'];
        $params = [$userId];

        if (!empty($filters['status'])) {
            $where[]  = 'o.order_status = ?';
            $params[] = strtolower($filters['status']);
        }

        $allowedSort  = ['order_date' => 'o.created_at', 'total_amount' => 'o.total_amount', 'order_status' => 'o.order_status'];
        $sortField    = $allowedSort[$filters['sort'] ?? 'order_date'] ?? 'o.created_at';
        $sortDir      = strtoupper($filters['order'] ?? 'desc') === 'ASC' ? 'ASC' : 'DESC';

        $whereClause = implode(' AND ', $where);
        $total       = Database::count("SELECT COUNT(*) AS cnt FROM orders o WHERE $whereClause", $params);
        $offset      = ($page - 1) * $limit;

        $rows = Database::fetchAll(
            "SELECT o.order_id, o.order_number, o.total_amount, o.delivery_fee, o.order_status,
                    o.payment_status, o.payment_method, o.tracking_number, o.cancel_reason, o.refund_status,
                    o.delivery_address, o.delivery_city, o.delivery_state, o.delivery_pincode,
                    o.notes, o.created_at, o.updated_at,
                    COUNT(oi.item_id) AS total_items
             FROM orders o
             LEFT JOIN order_items oi ON o.order_id = oi.order_id
             WHERE $whereClause
             GROUP BY o.order_id
             ORDER BY $sortField $sortDir
             LIMIT ? OFFSET ?",
            [...$params, $limit, $offset]
        );

        foreach ($rows as &$r) {
            $r['total_amount'] = (float)$r['total_amount'];
            $r['delivery_fee'] = (float)$r['delivery_fee'];
            $r['total_items']  = (int)$r['total_items'];
            $r['items'] = self::getItems((int)$r['order_id']);
        }

        return ['rows' => $rows, 'total' => $total];
    }

    /**
     * Get all orders (admin) with pagination.
     */
    public static function all(array $filters = [], int $page = 1, int $limit = 10): array
    {
        $where  = ['1=1'];
        $params = [];

        if (!empty($filters['status'])) {
            $where[]  = 'o.order_status = ?';
            $params[] = strtolower($filters['status']);
        }

        $whereClause = implode(' AND ', $where);
        $total       = Database::count("SELECT COUNT(*) AS cnt FROM orders o WHERE $whereClause", $params);
        $offset      = ($page - 1) * $limit;

        $rows = Database::fetchAll(
            "SELECT o.order_id, o.order_number, o.total_amount, o.delivery_fee, o.order_status,
                    o.payment_status, o.payment_method, o.tracking_number, o.cancel_reason, o.refund_status,
                    o.created_at, u.name AS customer_name, u.email, u.phone, u.company_name,
                    COUNT(oi.item_id) AS total_items
             FROM orders o
             JOIN users u ON o.user_id = u.user_id
             LEFT JOIN order_items oi ON o.order_id = oi.order_id
             WHERE $whereClause
             GROUP BY o.order_id
             ORDER BY o.created_at DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, $offset]
        );

        foreach ($rows as &$r) {
            $r['total_amount'] = (float)$r['total_amount'];
            $r['delivery_fee'] = (float)$r['delivery_fee'];
            $r['total_items']  = (int)$r['total_items'];
        }

        return ['rows' => $rows, 'total' => $total];
    }

    /**
     * @throws AppException
     */
    public static function updateStatus(int $orderId, string $newStatus, ?string $trackingNumber = null, ?string $cancelReason = null): void
    {
        $order = Database::fetch('SELECT order_status FROM orders WHERE order_id = ? LIMIT 1', [$orderId]);
        if (!$order) {
            throw new AppException('Order not found', 404);
        }

        $sets   = ['order_status = ?', 'updated_at = NOW()'];
        $params = [strtolower($newStatus)];

        if ($trackingNumber !== null && strtolower($newStatus) === 'shipped') {
            $sets[]   = 'tracking_number = ?';
            $params[] = $trackingNumber;
        }

        if ($cancelReason !== null && strtolower($newStatus) === 'cancelled') {
            $sets[]   = 'cancel_reason = ?';
            $params[] = $cancelReason;
        }

        if (in_array(strtolower($newStatus), ['cancelled', 'returned'], true)) {
            $sets[]   = 'refund_status = ?';
            $params[] = 'Initiated';
        }

        $params[] = $orderId;
        Database::execute('UPDATE orders SET ' . implode(', ', $sets) . ' WHERE order_id = ?', $params);

        Database::execute(
            'INSERT INTO audit_log (action, table_name, record_id, old_value, new_value, ip_address, created_at)
             VALUES ("ORDER_STATUS_UPDATED", "orders", ?, ?, ?, ?, NOW())',
            [$orderId, $order['order_status'], $newStatus, $_SERVER['REMOTE_ADDR'] ?? null]
        );
    }

    /**
     * @throws AppException
     */
    public static function updateRefundStatus(int $orderId, string $refundStatus): void
    {
        $allowed = ['N/A', 'Initiated', 'Processed'];
        if (!in_array($refundStatus, $allowed, true)) {
            throw new AppException('Invalid refund status', 422);
        }

        $order = Database::fetch('SELECT order_id FROM orders WHERE order_id = ? LIMIT 1', [$orderId]);
        if (!$order) {
            throw new AppException('Order not found', 404);
        }

        Database::execute(
            'UPDATE orders SET refund_status = ?, updated_at = NOW() WHERE order_id = ?',
            [$refundStatus, $orderId]
        );
    }

    private static function getItems(int $orderId): array
    {
        $items = Database::fetchAll(
            'SELECT oi.item_id, oi.product_id, oi.config_id, oi.quantity, oi.unit_price,
                    oi.total_price, oi.size, oi.purpose, oi.sub_purpose,
                    p.product_name, p.product_type
             FROM order_items oi
             JOIN products p ON oi.product_id = p.product_id
             WHERE oi.order_id = ?',
            [$orderId]
        );
        foreach ($items as &$item) {
            $item['unit_price']  = (float)$item['unit_price'];
            $item['total_price'] = (float)$item['total_price'];
        }
        return $items;
    }
}
