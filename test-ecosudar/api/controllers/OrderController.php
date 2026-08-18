<?php
declare(strict_types=1);

class OrderController
{   //a
    // ─── GET /orders  (admin: all orders) ────────────────────────────────────

    public function index(Request $request): void
    {
        $page    = max(1, (int)$request->query('page', 1));
        $limit   = min(100, max(1, (int)$request->query('limit', 10)));
        $filters = ['status' => $request->query('status')];

        $result = Order::all($filters, $page, $limit);
        $total  = $result['total'];

        Response::paginated($result['rows'], [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $total,
            'total_pages' => (int)ceil($total / $limit),
        ]);
    }

    // ─── POST /orders ────────────────────────────────────────────────────────

    public function store(Request $request): void
    {
        $inputItems = $request->input('items');
        if (!is_array($inputItems) || empty($inputItems)) {
            Response::error('items array is required and must contain at least one item', 422);
        }

        $items = [];
        foreach ($inputItems as $item) {
            Validator::make($item, [
                'product_id' => 'required|integer',
                'quantity'   => 'required|integer|min:1',
            ])->validate();

            $productId = (int)$item['product_id'];
            $configId  = isset($item['config_id']) ? (int)$item['config_id'] : null;
            $quantity  = (int)$item['quantity'];

            try {
                $product = Product::findActiveOrFail($productId);
            } catch (AppException $e) {
                Response::error($e->getMessage(), $e->getCode());
            }

            $unitPrice = isset($item['unit_price']) ? (float)$item['unit_price'] : $product['base_price'];
            $size = $item['size'] ?? null;
            $purpose = $item['purpose'] ?? null;
            $subPurpose = $item['sub_purpose'] ?? null;

            if ($configId !== null) {
                $config = Product::findConfig($configId, $productId);
                if (!$config) {
                    Response::error('Configuration not found or inactive for this product', 404);
                }
                // Do NOT override price with config price if frontend provided it
                if (!isset($item['unit_price'])) {
                    $unitPrice = $config['price'];
                }
                $size = $size ?? $config['size'];
                $purpose = $purpose ?? $config['purpose'];
                $subPurpose = $subPurpose ?? ($config['sub_purpose'] ?? null);
            }

            if (!isset($item['unit_price'])) {
                $resolved = DealerNetwork::resolvePriceForCustomer((int)$request->user['user_id'], $productId, $configId);
                if ($resolved && ($resolved['source'] ?? '') === 'dealer_price_list') {
                    $unitPrice = (float)$resolved['price'];
                }
            }

            $items[] = [
                'product_id' => $productId,
                'config_id'  => $configId,
                'quantity'   => $quantity,
                'unit_price' => $unitPrice,
                'size'       => $size,
                'purpose'    => $purpose,
                'sub_purpose'=> $subPurpose,
            ];
        }

        $meta = $request->only([
            'payment_method', 'delivery_address', 'delivery_city',
            'delivery_state', 'delivery_pincode', 'notes',
        ]);

        // Fall back to user's registered address if not provided
        if (empty($meta['delivery_address'])) {
            $meta['delivery_address'] = $request->user['address']  ?? null;
            $meta['delivery_city']    = $request->user['city']     ?? null;
            $meta['delivery_state']   = $request->user['state']    ?? null;
            $meta['delivery_pincode'] = $request->user['pincode']  ?? null;
        }

        try {
            $orderId = Order::create((int)$request->user['user_id'], $items, $meta);
        } catch (AppException $e) {
            Response::error($e->getMessage(), $e->getCode());
        }

        $order = Order::findForUser($orderId, (int)$request->user['user_id']);
        Response::success($order, 'Order created successfully', 201);
    }

    // ─── GET /orders/{id} ───────────────────────────────────────────────────

    public function show(Request $request): void
    {
        $orderId = (int)$request->param('id');
        if ($orderId <= 0) {
            Response::error('Invalid order ID', 400);
        }

        $order = Order::findById($orderId);
        if (!$order) {
            Response::error('Order not found', 404);
        }

        // Admins can view any order; regular users only their own
        $isAdmin = ($request->user['user_type'] ?? '') === 'admin';
        if (!$isAdmin && (int)$order['user_id'] !== (int)$request->user['user_id']) {
            Response::error('Forbidden', 403);
        }

        Response::success($order);
    }

    // ─── PUT /orders/{id}/status ─────────────────────────────────────────────

    public function updateStatus(Request $request): void
    {
        $orderId = (int)$request->param('id');
        if ($orderId <= 0) {
            Response::error('Invalid order ID', 400);
        }

        Validator::make($request->only(['order_status']), [
            'order_status' => 'required|in:' . implode(',', Order::STATUSES),
        ])->validate();

        $newStatus      = $request->input('order_status');
        $trackingNumber = $newStatus === 'shipped'
            ? (trim((string)($request->input('tracking_number') ?? '')) ?: null)
            : null;
        $cancelReason   = $newStatus === 'cancelled'
            ? (trim((string)($request->input('cancel_reason') ?? '')) ?: null)
            : null;

        try {
            Order::updateStatus($orderId, $newStatus, $trackingNumber, $cancelReason);
        } catch (AppException $e) {
            Response::error($e->getMessage(), $e->getCode());
        }

        $data = [];

        // Auto-generate the tax invoice once an order is confirmed (and keep it in
        // sync through delivery). generateForOrder() is idempotent, so re-running it
        // on later transitions never creates a duplicate.
        if (in_array($request->input('order_status'), ['confirmed', 'delivered'], true)) {
            try {
                $inv = AdminInvoiceController::generateForOrder($orderId);
                if ($inv) {
                    $data['invoice_generated'] = true;
                    $data['invoice_number']    = $inv['invoice_number'];
                }
            } catch (\Throwable $e) {
                error_log('[updateStatus] Invoice generation failed: ' . $e->getMessage());
            }
        }

        // Dispatch deducts finished-goods stock (idempotent per order).
        if ($request->input('order_status') === 'shipped') {
            try {
                Inventory::deductForOrder($orderId, isset($request->user['user_id']) ? (int)$request->user['user_id'] : null);
            } catch (\Throwable $e) {
                error_log('[updateStatus] Stock deduction failed: ' . $e->getMessage());
            }
        }

        // Cancelling or returning a dispatched order puts the finished goods back
        // (idempotent — only reverses a real prior deduction, and only once).
        if (in_array($request->input('order_status'), ['cancelled', 'returned'], true)) {
            try {
                Inventory::restoreForOrder($orderId, isset($request->user['user_id']) ? (int)$request->user['user_id'] : null);
            } catch (\Throwable $e) {
                error_log('[updateStatus] Stock restore failed: ' . $e->getMessage());
            }
        }

        Response::success($data ?: null, 'Order status updated successfully');
    }

    // ─── PUT /orders/{id}/payment ─────────────────────────────────────────────

    public function updatePayment(Request $request): void
    {
        $orderId = (int)$request->param('id');
        if ($orderId <= 0) {
            Response::error('Invalid order ID', 400);
        }

        $paymentMethod = $request->input('payment_method');
        if (!$paymentMethod) {
            Response::error('payment_method is required', 422);
        }

        $allowed = ['pending', 'cod', 'upi', 'online', 'net_banking', 'wallet'];
        if (!in_array(strtolower($paymentMethod), $allowed, true)) {
            Response::error('Invalid payment_method value', 422);
        }

        Database::execute(
            'UPDATE orders SET payment_method = ?, updated_at = NOW() WHERE order_id = ?',
            [strtolower($paymentMethod), $orderId]
        );

        Response::success(null, 'Payment method updated successfully');
    }
    public function updatePaymentStatus(Request $request): void
    {
        $orderId = (int)$request->param('id');
        if ($orderId <= 0) {
            Response::error('Invalid order ID', 400);
        }

        $status = $request->input('payment_status');
        if (!$status) {
            Response::error('payment_status is required', 422);
        }

        $allowed = ['pending', 'paid', 'failed', 'refunded'];
        if (!in_array(strtolower($status), $allowed, true)) {
            Response::error('Invalid payment_status value', 422);
        }

        Database::execute(
            'UPDATE orders SET payment_status = ?, updated_at = NOW() WHERE order_id = ?',
            [strtolower($status), $orderId]
        );

        $data = [];
        if (strtolower($status) === 'paid') {
            try {
                $inv = AdminInvoiceController::generateForOrder($orderId);
                if ($inv) {
                    $data['invoice_generated'] = true;
                    $data['invoice_number']    = $inv['invoice_number'];
                }
            } catch (\Throwable $e) {
                error_log('[updatePaymentStatus] Invoice generation failed: ' . $e->getMessage());
            }
        }

        Response::success($data ?: null, 'Payment status updated successfully');
    }

    // ─── PUT /orders/{id}/refund-status ──────────────────────────────────────

    public function updateRefundStatus(Request $request): void
    {
        $orderId = (int)$request->param('id');
        if ($orderId <= 0) {
            Response::error('Invalid order ID', 400);
        }

        $refundStatus = trim((string)($request->input('refund_status') ?? ''));
        if ($refundStatus === '') {
            Response::error('refund_status is required', 422);
        }

        try {
            Order::updateRefundStatus($orderId, $refundStatus);
        } catch (AppException $e) {
            Response::error($e->getMessage(), $e->getCode());
        }

        Response::success(null, 'Refund status updated successfully');
    }
}
