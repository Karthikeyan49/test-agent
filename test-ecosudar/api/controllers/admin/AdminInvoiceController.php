<?php
declare(strict_types=1);

/**
 * Admin Invoice Controller
 * GET /admin/invoices          — List invoices with filters
 * GET /admin/invoices/{id}     — Get single invoice
 * POST /admin/invoices         — Auto-generate invoice for an order
 * GET /admin/invoices/{id}/download — Stream plain-text invoice (PDF lib not available on shared host)
 */
class AdminInvoiceController
{
    /**
     * Next invoice number (e.g. INV-2026-0032), derived from the highest existing
     * invoice NUMBER for the current year — NOT from MAX(invoice_id). The auto-
     * increment id keeps climbing across deletions, so basing the number on it made
     * the sequence jump/skip after any invoice was deleted. Reading the max numeric
     * suffix keeps the numbering continuous no matter what is deleted.
     */
    private static function nextInvoiceNumber(): string
    {
        $prefix = trim((string)(Database::fetch(
            "SELECT setting_value FROM settings WHERE setting_key = 'invoice_prefix'"
        )['setting_value'] ?? 'INV')) ?: 'INV';
        $year = date('Y');
        $maxNum = (int)(Database::fetch(
            "SELECT MAX(CAST(SUBSTRING_INDEX(invoice_number, '-', -1) AS UNSIGNED)) AS n
             FROM invoices WHERE invoice_number LIKE ?",
            [$prefix . '-' . $year . '-%']
        )['n'] ?? 0);
        return $prefix . '-' . $year . '-' . str_pad((string)($maxNum + 1), 4, '0', STR_PAD_LEFT);
    }

    // ─── GET /admin/invoices ──────────────────────────────────────────────────

    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(200, max(1, (int)$request->query('limit', 20)));

        $where  = ['1=1'];
        $params = [];

        if ($orderId = (int)$request->query('order_id')) {
            $where[]  = 'i.order_id = ?';
            $params[] = $orderId;
        }
        if ($userId = (int)$request->query('user_id')) {
            $where[]  = 'o.user_id = ?';
            $params[] = $userId;
        }
        // `status` filters the document lifecycle; payment-state values are routed to payment_status
        // (the two axes were split — see the invoices status/payment_status normalization).
        $status = $request->query('status');
        if ($status) {
            $lifecycle = ['Draft', 'Sent', 'Cancelled'];
            $paymentStates = ['paid', 'unpaid', 'partial', 'overdue', 'pending', 'refunded'];
            $s = (string)$status;
            $sLower = strtolower($s);
            if (in_array($s, $lifecycle, true) || in_array(ucfirst($sLower), $lifecycle, true)) {
                $where[]  = 'i.status = ?';
                $params[] = ucfirst($sLower);
            } elseif (in_array($sLower, $paymentStates, true)) {
                $where[]  = 'i.payment_status = ?';
                $params[] = $sLower;
            }
        }
        if ($from = $request->query('from_date')) {
            $where[]  = 'i.created_at >= ?';
            $params[] = $from . ' 00:00:00';
        }
        if ($to = $request->query('to_date')) {
            $where[]  = 'i.created_at <= ?';
            $params[] = $to . ' 23:59:59';
        }

        $whereClause = implode(' AND ', $where);

        // LEFT JOIN so standalone GST invoices (order_id = NULL) also appear
        $total  = Database::count(
            "SELECT COUNT(*) AS cnt
             FROM invoices i
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users  u ON u.user_id  = o.user_id
             WHERE $whereClause",
            $params
        );
        $offset = ($page - 1) * $limit;

        $rows = Database::fetchAll(
            "SELECT i.invoice_id, i.invoice_number, i.order_id,
                    o.order_number,
                    COALESCE(i.customer_name, u.name)              AS customer_name,
                    COALESCE(i.payment_method, o.payment_method)   AS payment_method,
                    COALESCE(i.customer_gstin, u.gst_number)       AS customer_gstin,
                    COALESCE(i.customer_state, o.delivery_state, u.state) AS customer_state,
                    COALESCE(i.customer_address, o.delivery_address, u.address) AS customer_address,
                    i.customer_city,
                    i.customer_pincode,
                    i.customer_country,
                    COALESCE(i.seller_state, 'Tamil Nadu')         AS seller_state,
                    u.gst_number                                   AS order_customer_gstin,
                    o.order_status,
                    COALESCE(i.payment_status, o.payment_status)   AS payment_status,
                    i.due_date, i.invoice_date, i.payment_terms, i.place_of_supply, i.ship_to, i.subject,
                    i.subtotal, i.gst_rate, i.gst_amount,
                    COALESCE(i.cgst_amount, 0)  AS cgst_amount,
                    COALESCE(i.sgst_amount, 0)  AS sgst_amount,
                    COALESCE(i.igst_amount, 0)  AS igst_amount,
                    i.delivery_fee, COALESCE(i.discount, 0) AS discount, i.total,
                    COALESCE(i.amount_paid, 0) AS amount_paid,
                    GREATEST(i.total - COALESCE(i.amount_paid, 0), 0) AS balance_due,
                    i.status, i.notes, i.created_at,
                    (SELECT COUNT(*) FROM invoice_items ii WHERE ii.invoice_id = i.invoice_id) AS item_count
             FROM invoices i
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users  u ON u.user_id  = o.user_id
             WHERE $whereClause
             ORDER BY i.created_at DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, $offset]
        );

        foreach ($rows as &$r) {
            $r['subtotal']     = (float)$r['subtotal'];
            $r['gst_rate']     = (float)($r['gst_rate'] ?? 0);
            $r['gst_amount']   = (float)$r['gst_amount'];
            $r['cgst_amount']  = (float)$r['cgst_amount'];
            $r['sgst_amount']  = (float)$r['sgst_amount'];
            $r['igst_amount']  = (float)$r['igst_amount'];
            $r['delivery_fee'] = (float)$r['delivery_fee'];
            $r['total']        = (float)$r['total'];
            $r['amount_paid']  = (float)$r['amount_paid'];
            $r['balance_due']  = (float)$r['balance_due'];
        }

        Response::paginated($rows, [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $total,
            'total_pages' => (int)ceil($total / $limit),
        ]);
    }

    // ─── POST /admin/invoices — manually generate invoice for an order ────────

    public function store(Request $request): void
    {
        Validator::make($request->only(['order_id']), [
            'order_id' => 'required|integer',
        ])->validate();

        $orderId = (int)$request->input('order_id');
        if (!Database::fetch('SELECT order_id FROM orders WHERE order_id = ? LIMIT 1', [$orderId])) {
            Response::error('Order not found', 404);
        }

        $existing = Database::fetch('SELECT invoice_id, invoice_number FROM invoices WHERE order_id = ? LIMIT 1', [$orderId]);
        if ($existing) {
            Response::error('Invoice already exists for this order: ' . $existing['invoice_number'], 409);
        }

        $invoice = self::generateForOrder($orderId);
        Response::success($invoice, 'Invoice created successfully', 201);
    }

    // ─── Shared helper: create-or-sync an order invoice ─────────────────────
    public static function generateForOrder(int $orderId): ?array
    {
        $existing = Database::fetch(
            'SELECT invoice_id FROM invoices WHERE order_id = ? LIMIT 1', [$orderId]
        );

        $order = Database::fetch('SELECT * FROM orders WHERE order_id = ? LIMIT 1', [$orderId]);
        if (!$order) return null;

        // If invoice already exists, sync its payment_status + payment_method with the order
        // (the document `status` lifecycle is left untouched).
        if ($existing) {
            $newPaymentStatus = $order['payment_status'] === 'paid' ? 'paid' : 'unpaid';
            Database::execute(
                'UPDATE invoices SET payment_status = ?, payment_method = ?, updated_at = NOW()
                 WHERE invoice_id = ?',
                [$newPaymentStatus, $order['payment_method'], $existing['invoice_id']]
            );
            return Database::fetch(
                'SELECT * FROM invoices WHERE invoice_id = ? LIMIT 1', [$existing['invoice_id']]
            );
        }

        $gstRate   = (float)(Database::fetch("SELECT setting_value FROM settings WHERE setting_key = 'gst_rate'")['setting_value'] ?? 18);
        $invNumber = self::nextInvoiceNumber();

        $subtotal  = (float)$order['total_amount'] - (float)$order['delivery_fee'];
        $gstAmount = round($subtotal * $gstRate / 100, 2);
        $total     = round($subtotal + $gstAmount + (float)$order['delivery_fee'], 2);

        $invoiceId = Database::insert(
            'INSERT INTO invoices (invoice_number, order_id, subtotal, gst_rate, gst_amount, delivery_fee, total, status, payment_status, payment_method, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $invNumber, $orderId, $subtotal, $gstRate, $gstAmount,
                (float)$order['delivery_fee'], $total,
                'Sent',
                $order['payment_status'] === 'paid' ? 'paid' : 'unpaid',
                $order['payment_method'],
            ]
        );

        // ── Populate invoice_items from order_items ──────────────────────────
        $orderItems = Database::fetchAll(
            "SELECT oi.quantity, oi.unit_price,
                    CONCAT(p.product_name, COALESCE(CONCAT(' - ', pc.size), '')) AS description,
                    '' AS hsn_code,
                    oi.item_id AS sort_order
             FROM order_items oi
             JOIN products p ON p.product_id = oi.product_id
             LEFT JOIN product_configurations pc ON pc.config_id = oi.config_id
             WHERE oi.order_id = ?",
            [$orderId]
        );

        foreach ($orderItems as $sort => $oi) {
            $qty       = (float)$oi['quantity'];
            $price     = (float)$oi['unit_price'];
            $lineTotal = round($qty * $price, 2);
            Database::insert(
                'INSERT INTO invoice_items (invoice_id, description, hsn_code, quantity, unit_price, gst_rate, line_total, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                [$invoiceId, $oi['description'], $oi['hsn_code'], $qty, $price, $gstRate, $lineTotal, $sort + 1]
            );
        }
        // ────────────────────────────────────────────────────────────────────

        return Database::fetch('SELECT * FROM invoices WHERE invoice_id = ? LIMIT 1', [$invoiceId]);
    }

    // ─── GET /admin/invoices/{id} — single invoice with line items ──────────
    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid invoice ID', 400);
        }

        $inv = Database::fetch(
            "SELECT i.*, o.order_number,
                    o.delivery_address, o.delivery_city, o.delivery_state, o.delivery_pincode,
                    u.name AS order_customer_name, u.gst_number AS order_customer_gstin,
                    u.company_name AS order_company_name,
                    u.address AS order_customer_address, u.city AS order_customer_city,
                    u.state AS order_customer_state, u.pincode AS order_customer_pincode
             FROM invoices i
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users  u ON u.user_id  = o.user_id
             WHERE i.invoice_id = ? LIMIT 1",
            [$id]
        );
        if (!$inv) {
            Response::error('Invoice not found', 404);
        }

        $items = Database::fetchAll(
            'SELECT item_id, description, hsn_code, quantity, unit, unit_price, gst_rate, line_total, sort_order
             FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC, item_id ASC',
            [$id]
        );

        // Fallback for order-based invoices without invoice_items rows
        if (empty($items) && !empty($inv['order_id'])) {
            $orderItems = Database::fetchAll(
                "SELECT oi.item_id AS item_id,
                        CONCAT(p.product_name, COALESCE(CONCAT(' - ', pc.size), '')) AS description,
                        '' AS hsn_code,
                        oi.quantity, oi.unit_price, ? AS gst_rate,
                        (oi.quantity * oi.unit_price) AS line_total,
                        oi.item_id AS sort_order
                 FROM order_items oi
                 JOIN products p ON p.product_id = oi.product_id
                 LEFT JOIN product_configurations pc ON pc.config_id = oi.config_id
                 WHERE oi.order_id = ?",
                [(float)$inv['gst_rate'], (int)$inv['order_id']]
            );
            foreach ($orderItems as $oi) {
                $items[] = $oi;
            }
        }

        foreach ($items as &$it) {
            $it['quantity']   = (float)$it['quantity'];
            $it['unit_price'] = (float)$it['unit_price'];
            $it['gst_rate']   = (float)$it['gst_rate'];
            $it['line_total'] = (float)$it['line_total'];
        }
        $inv['amount_paid'] = (float)($inv['amount_paid'] ?? 0);
        $inv['balance_due'] = max(0.0, (float)($inv['total'] ?? 0) - $inv['amount_paid']);
        foreach (['subtotal','gst_amount','cgst_amount','sgst_amount','igst_amount','delivery_fee','total','gst_rate'] as $f) {
            if (isset($inv[$f])) $inv[$f] = (float)$inv[$f];
        }
        $inv['customer_name'] = $inv['customer_name'] ?: ($inv['order_customer_name'] ?? null);
        $inv['customer_gstin'] = $inv['customer_gstin'] ?: ($inv['order_customer_gstin'] ?? null);
        $inv['customer_state'] = $inv['customer_state']
            ?: ($inv['delivery_state'] ?? null)
            ?: ($inv['order_customer_state'] ?? null);
        $inv['customer_address'] = $inv['customer_address']
            ?: ($inv['delivery_address'] ?? null)
            ?: ($inv['order_customer_address'] ?? null);
        $inv['seller_state'] = $inv['seller_state'] ?: 'Tamil Nadu';
        $inv['items'] = $items;
        Response::success($inv);
    }

    // ─── POST /admin/invoices/gst — standalone GST invoice with line items ──
    public function storeGst(Request $request): void
    {
        $required = ['customer_name', 'customer_state', 'seller_state', 'items'];
        foreach ($required as $key) {
            if (!$request->input($key)) {
                Response::error("`$key` is required", 422);
            }
        }

        $items = $request->input('items');
        if (!is_array($items) || empty($items)) {
            Response::error('`items` must be a non-empty array', 422);
        }

        $customerState = trim((string)$request->input('customer_state'));
        $sellerState   = trim((string)$request->input('seller_state'));
        $interState    = strtolower($customerState) !== strtolower($sellerState);

        $subtotal = 0.0;
        $gstTotal = 0.0;
        $cleanItems = [];
        foreach ($items as $idx => $it) {
            $desc   = trim((string)($it['description'] ?? ''));
            $qty    = (float)($it['quantity']   ?? 0);
            $price  = (float)($it['unit_price'] ?? 0);
            $rate   = (float)($it['gst_rate']   ?? 0);
            $hsn    = trim((string)($it['hsn_code'] ?? ''));
            $unit   = trim((string)($it['unit'] ?? '')) ?: 'Nos';
            if ($desc === '') Response::error("items[$idx].description is required", 422);
            if ($qty   <= 0) Response::error("items[$idx].quantity must be > 0", 422);
            if ($price <  0) Response::error("items[$idx].unit_price cannot be negative", 422);
            if (!in_array((int)$rate, [0, 5, 12, 18, 28], true)) {
                Response::error("items[$idx].gst_rate must be one of 0, 5, 12, 18, 28", 422);
            }
            $lineSub    = round($qty * $price, 2);
            $lineTax    = round($lineSub * $rate / 100, 2);
            $subtotal  += $lineSub;
            $gstTotal  += $lineTax;
            $cleanItems[] = compact('desc', 'qty', 'unit', 'price', 'rate', 'hsn', 'lineSub') + ['sort' => $idx + 1];
        }

        // Discount reduces the taxable value — GST is applied on (subtotal − discount)
        $deliveryFee    = (float)($request->input('delivery_fee') ?? 0);
        $discountAmount = max(0.0, (float)($request->input('discount') ?? 0));
        $taxable        = max(0.0, $subtotal - $discountAmount);
        $discountFactor = $subtotal > 0 ? $taxable / $subtotal : 1.0;
        $adjustedGst    = round($gstTotal * $discountFactor, 2);

        $cgst = $sgst = $igst = 0.0;
        if ($interState) {
            $igst = $adjustedGst;
        } else {
            $cgst = round($adjustedGst / 2, 2);
            $sgst = $adjustedGst - $cgst;
        }
        $total   = round($taxable + $adjustedGst + $deliveryFee);  // round off to whole rupee
        $avgRate = $taxable > 0 ? round(($adjustedGst / $taxable) * 100, 2) : 0;

        // Split the two axes: `status` is lifecycle-only; a legacy payment value sent as
        // status falls back into payment_status when no explicit payment_status is given.
        $reqStatus  = strtolower((string)($request->input('status') ?: 'draft'));
        $lifecycle  = ['draft' => 'Draft', 'sent' => 'Sent', 'cancelled' => 'Cancelled'];
        $statusVal  = $lifecycle[$reqStatus] ?? 'Draft';
        $paymentVal = $request->input('payment_status') ?: 'unpaid';
        if (!isset($lifecycle[$reqStatus])
            && in_array($reqStatus, ['paid', 'unpaid', 'partial', 'overdue', 'pending', 'refunded'], true)
            && !$request->input('payment_status')) {
            $paymentVal = $reqStatus;
        }

        $invNumber = self::nextInvoiceNumber();

        Database::beginTransaction();
        try {
            $invoiceId = Database::insert(
                'INSERT INTO invoices
                    (invoice_number, order_id, customer_name, customer_gstin, customer_state,
                     customer_address, customer_city, customer_pincode, customer_country,
                     seller_state, due_date, subtotal, gst_rate, gst_amount, cgst_amount, sgst_amount, igst_amount,
                     delivery_fee, discount, total, status, payment_method, payment_status, notes, created_at)
                 VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                [
                    $invNumber,
                    Request::sanitize((string)$request->input('customer_name')),
                    $request->input('customer_gstin') ?: null,
                    $customerState,
                    $request->input('customer_address') ? Request::sanitize((string)$request->input('customer_address')) : null,
                    $request->input('customer_city')    ? Request::sanitize((string)$request->input('customer_city'))    : null,
                    $request->input('customer_pincode') ? trim((string)$request->input('customer_pincode'))              : null,
                    $request->input('customer_country') ? Request::sanitize((string)$request->input('customer_country')) : null,
                    $sellerState,
                    $request->input('due_date') ?: null,
                    $subtotal,
                    $avgRate,
                    $adjustedGst,
                    $cgst, $sgst, $igst,
                    $deliveryFee,
                    $discountAmount,
                    $total,
                    $statusVal,
                    $request->input('payment_method') ?: null,
                    $paymentVal,
                    $request->input('notes') ? Request::sanitize((string)$request->input('notes')) : null,
                ]
            );

            foreach ($cleanItems as $it) {
                Database::insert(
                    'INSERT INTO invoice_items (invoice_id, description, hsn_code, quantity, unit, unit_price, gst_rate, line_total, sort_order)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                    [$invoiceId, $it['desc'], $it['hsn'] ?: null, $it['qty'], $it['unit'], $it['price'], $it['rate'], $it['lineSub'], $it['sort']]
                );
            }
            Database::commit();
        } catch (\Throwable $e) {
            Database::rollback();
            Response::error('Failed to create invoice: ' . $e->getMessage(), 500);
        }

        $created = Database::fetch('SELECT * FROM invoices WHERE invoice_id = ? LIMIT 1', [$invoiceId]);
        Response::success($created, 'GST invoice created successfully', 201);
    }

    // ─── PUT /admin/invoices/{id} — update header fields + optional line items ─
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid invoice ID', 400);
        }
        $existing = Database::fetch(
            'SELECT invoice_id, customer_state, seller_state FROM invoices WHERE invoice_id = ? LIMIT 1',
            [$id]
        );
        if (!$existing) {
            Response::error('Invoice not found', 404);
        }

        $allowed = ['customer_name', 'customer_gstin', 'customer_state',
                    'customer_address', 'customer_city', 'customer_pincode', 'customer_country',
                    'seller_state', 'due_date', 'delivery_fee', 'discount', 'status', 'payment_method', 'payment_status', 'notes',
                    'invoice_number', 'invoice_date', 'payment_terms', 'place_of_supply', 'ship_to', 'subject'];
        $sets   = [];
        $params = [];
        foreach ($allowed as $col) {
            $val = $request->input($col);
            if ($val === null) continue;
            if ($col === 'status') {
                // `status` is lifecycle-only now. A legacy client sending a payment value
                // (paid/unpaid/…) is redirected to payment_status instead of erroring.
                $lifecycle = ['Draft', 'Sent', 'Cancelled'];
                $paymentStates = ['paid', 'unpaid', 'partial', 'overdue', 'pending', 'refunded'];
                $sLower = strtolower((string)$val);
                $asLifecycle = ucfirst($sLower);
                if (in_array($asLifecycle, $lifecycle, true)) {
                    $sets[]   = 'status = ?';
                    $params[] = $asLifecycle;
                } elseif (in_array($sLower, $paymentStates, true)) {
                    if ($request->input('payment_status') === null) {
                        $sets[]   = 'payment_status = ?';
                        $params[] = $sLower;
                    }
                } else {
                    Response::error('Invalid status; must be one of: Draft, Sent, Cancelled', 422);
                }
                continue;
            }
            // Empty date strings must become NULL, not '' (invalid DATE)
            if (($col === 'invoice_date' || $col === 'due_date') && trim((string)$val) === '') {
                $sets[]   = "$col = NULL";
                continue;
            }
            $sets[]   = "$col = ?";
            $params[] = in_array($col, ['customer_name','customer_address','notes','ship_to','subject','place_of_supply'], true)
                ? Request::sanitize((string)$val) : $val;
        }

        // ── Optional: replace line items and recompute invoice amounts ─────────
        $newItems   = $request->input('items');
        $hasItems   = is_array($newItems) && !empty($newItems);
        $cleanItems = [];

        if ($hasItems) {
            foreach ($newItems as $idx => $it) {
                $desc  = trim((string)($it['description'] ?? ''));
                $qty   = (float)($it['quantity']   ?? 0);
                $price = (float)($it['unit_price'] ?? 0);
                $rate  = (float)($it['gst_rate']   ?? 0);
                $hsn   = trim((string)($it['hsn_code'] ?? ''));
                $unit  = trim((string)($it['unit'] ?? '')) ?: 'Nos';
                if ($desc === '') Response::error("items[$idx].description is required", 422);
                if ($qty   <= 0) Response::error("items[$idx].quantity must be > 0", 422);
                if ($price <  0) Response::error("items[$idx].unit_price cannot be negative", 422);
                if (!in_array((int)$rate, [0, 5, 12, 18, 28], true)) {
                    Response::error("items[$idx].gst_rate must be one of 0, 5, 12, 18, 28", 422);
                }
                $lineSub      = round($qty * $price, 2);
                $cleanItems[] = compact('desc', 'qty', 'unit', 'price', 'rate', 'hsn', 'lineSub') + ['sort' => $idx + 1];
            }

            // Determine inter/intra state (prefer newly submitted state values)
            $customerState = $request->input('customer_state') ?? $existing['customer_state'] ?? 'Tamil Nadu';
            $sellerState   = $request->input('seller_state')   ?? $existing['seller_state']   ?? 'Tamil Nadu';
            $interState    = strtolower((string)$customerState) !== strtolower((string)$sellerState);

            $subtotal = $gstTotal = 0.0;
            foreach ($cleanItems as $it) {
                $subtotal += $it['lineSub'];
                $gstTotal += round($it['lineSub'] * $it['rate'] / 100, 2);
            }

            $existingFull    = Database::fetch('SELECT delivery_fee, discount FROM invoices WHERE invoice_id = ? LIMIT 1', [$id]);
            $deliveryFee     = $request->input('delivery_fee') !== null
                ? (float)$request->input('delivery_fee')
                : (float)($existingFull['delivery_fee'] ?? 0);
            $discountAmount  = $request->input('discount') !== null
                ? max(0.0, (float)$request->input('discount'))
                : (float)($existingFull['discount'] ?? 0);

            // GST applied on taxable amount (subtotal − discount)
            $taxable         = max(0.0, $subtotal - $discountAmount);
            $discountFactor  = $subtotal > 0 ? $taxable / $subtotal : 1.0;
            $adjustedGst     = round($gstTotal * $discountFactor, 2);

            $cgst = $sgst = $igst = 0.0;
            if ($interState) $igst = $adjustedGst;
            else { $cgst = round($adjustedGst / 2, 2); $sgst = $adjustedGst - $cgst; }

            $total   = round($taxable + $adjustedGst + $deliveryFee);  // round off to whole rupee
            $avgRate = $taxable > 0 ? round(($adjustedGst / $taxable) * 100, 2) : 0;

            $sets[] = 'subtotal = ?';    $params[] = $subtotal;
            $sets[] = 'gst_rate = ?';    $params[] = $avgRate;
            $sets[] = 'gst_amount = ?';  $params[] = $adjustedGst;
            $sets[] = 'cgst_amount = ?'; $params[] = $cgst;
            $sets[] = 'sgst_amount = ?'; $params[] = $sgst;
            $sets[] = 'igst_amount = ?'; $params[] = $igst;
            $sets[] = 'total = ?';       $params[] = $total;
        }

        if (empty($sets)) {
            Response::error('Provide at least one field to update', 400);
        }

        $sets[]   = 'updated_at = NOW()';
        $params[] = $id;

        if ($hasItems) {
            Database::beginTransaction();
            try {
                Database::execute('UPDATE invoices SET ' . implode(', ', $sets) . ' WHERE invoice_id = ?', $params);
                Database::execute('DELETE FROM invoice_items WHERE invoice_id = ?', [$id]);
                foreach ($cleanItems as $it) {
                    Database::insert(
                        'INSERT INTO invoice_items (invoice_id, description, hsn_code, quantity, unit, unit_price, gst_rate, line_total, sort_order)
                         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                        [$id, $it['desc'], $it['hsn'] ?: null, $it['qty'], $it['unit'], $it['price'], $it['rate'], $it['lineSub'], $it['sort']]
                    );
                }
                Database::commit();
            } catch (\Throwable $e) {
                Database::rollback();
                Response::error('Failed to update invoice: ' . $e->getMessage(), 500);
            }
        } else {
            Database::execute('UPDATE invoices SET ' . implode(', ', $sets) . ' WHERE invoice_id = ?', $params);
        }

        $row = Database::fetch('SELECT * FROM invoices WHERE invoice_id = ? LIMIT 1', [$id]);
        Response::success($row, 'Invoice updated successfully');
    }

    // ─── DELETE /admin/invoices/{id} ─────────────────────────────────────────
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid invoice ID', 400);
        }
        $existing = Database::fetch('SELECT invoice_id FROM invoices WHERE invoice_id = ? LIMIT 1', [$id]);
        if (!$existing) {
            Response::error('Invoice not found', 404);
        }
        Database::execute('DELETE FROM invoices WHERE invoice_id = ?', [$id]);
        Response::success(null, 'Invoice deleted successfully');
    }

    // ─── GET /admin/invoices/{id}/download ───────────────────────────────────

    // ─── E-way bill (Option A — portal-assisted) ─────────────────────────────
    public function ewayBill(Request $request): void
    {
        $id = (int)$request->param('id');
        $row = Database::fetch('SELECT * FROM eway_bills WHERE invoice_id = ? LIMIT 1', [$id]);
        Response::success($row ?: null, 'E-way bill');
    }

    public function saveEwayBill(Request $request): void
    {
        $id = (int)$request->param('id');
        if (!Database::fetch('SELECT invoice_id FROM invoices WHERE invoice_id = ? LIMIT 1', [$id])) {
            Response::error('Invoice not found', 404);
        }
        $cols = ['supply_type', 'sub_supply', 'doc_type', 'trans_mode', 'vehicle_no', 'vehicle_type',
                 'transporter_id', 'transporter_name', 'transport_doc_no', 'transport_doc_date', 'distance_km',
                 'from_gstin', 'from_name', 'from_addr', 'from_place', 'from_pincode', 'from_state',
                 'to_place', 'to_pincode', 'ewb_no', 'ewb_date', 'valid_until', 'notes'];
        $dateCols = ['transport_doc_date', 'ewb_date', 'valid_until'];
        $data = [];
        foreach ($cols as $c) {
            $v = $request->input($c);
            if (in_array($c, $dateCols, true))   $data[$c] = ($v !== null && trim((string)$v) !== '') ? $v : null;
            elseif ($c === 'distance_km')         $data[$c] = (int)$v;
            else                                  $data[$c] = ($v === '' || $v === null) ? null : Request::sanitize((string)$v);
        }
        if (Database::fetch('SELECT eway_id FROM eway_bills WHERE invoice_id = ? LIMIT 1', [$id])) {
            $sets = []; $params = [];
            foreach ($cols as $c) { $sets[] = "$c = ?"; $params[] = $data[$c]; }
            $params[] = $id;
            Database::execute('UPDATE eway_bills SET ' . implode(', ', $sets) . ' WHERE invoice_id = ?', $params);
        } else {
            $fields = array_merge(['invoice_id'], $cols);
            $ph = implode(', ', array_fill(0, count($fields), '?'));
            $params = [$id];
            foreach ($cols as $c) { $params[] = $data[$c]; }
            Database::insert('INSERT INTO eway_bills (' . implode(', ', $fields) . ') VALUES (' . $ph . ')', $params);
        }
        Response::success(Database::fetch('SELECT * FROM eway_bills WHERE invoice_id = ? LIMIT 1', [$id]), 'E-way bill saved');
    }

    public function download(Request $request): void
    {
        $invoiceId = (int)$request->param('id');
        $invoice   = Database::fetch(
            'SELECT i.*,
                    o.order_number, o.delivery_address, o.delivery_city, o.delivery_state, o.delivery_pincode,
                    COALESCE(i.customer_name, u.name)    AS customer_name,
                    COALESCE(i.customer_gstin, u.gst_number) AS gst_number,
                    u.email, u.phone, u.company_name
             FROM invoices i
             LEFT JOIN orders o ON o.order_id = i.order_id
             LEFT JOIN users  u ON u.user_id  = o.user_id
             WHERE i.invoice_id = ? LIMIT 1',
            [$invoiceId]
        );

        if (!$invoice) {
            Response::error('Invoice not found', 404);
        }

        $settings = [];
        $rows = Database::fetchAll('SELECT setting_key, setting_value FROM settings');
        foreach ($rows as $row) {
            $settings[$row['setting_key']] = $row['setting_value'];
        }

        // Build plain-text invoice (no PDF lib needed on shared host)
        $lines   = [];
        $lines[] = str_repeat('=', 60);
        $lines[] = strtoupper($settings['company_name'] ?? 'ECO SUDAR BIO ENERGY LLP');
        $lines[] = $settings['company_address'] ?? '';
        $lines[] = 'GSTIN: ' . ($settings['gstin'] ?? '');
        $lines[] = 'Phone: ' . ($settings['contact_phone'] ?? '');
        $lines[] = str_repeat('=', 60);
        $lines[] = 'INVOICE NUMBER : ' . $invoice['invoice_number'];
        $lines[] = 'ORDER NUMBER   : ' . $invoice['order_number'];
        $lines[] = 'DATE           : ' . date('d-M-Y', strtotime($invoice['created_at']));
        $lines[] = str_repeat('-', 60);
        $lines[] = 'BILL TO';
        $lines[] = $invoice['customer_name'];
        $lines[] = $invoice['company_name'] ?? '';
        $lines[] = $invoice['email'] ?? '';
        $lines[] = $invoice['phone'] ?? '';
        if ($invoice['gst_number']) {
            $lines[] = 'GSTIN: ' . $invoice['gst_number'];
        }
        $lines[] = str_repeat('-', 60);
        // Line items
        $items = Database::fetchAll(
            'SELECT description, quantity, unit_price, line_total FROM invoice_items WHERE invoice_id = ? ORDER BY sort_order ASC, item_id ASC',
            [$invoiceId]
        );
        if ($items) {
            $lines[] = sprintf("%-28s %5s %12s %12s", 'Description', 'Qty', 'Unit Price', 'Total');
            $lines[] = str_repeat('-', 60);
            foreach ($items as $it) {
                $lines[] = sprintf(
                    "%-28s %5s %12s %12s",
                    mb_substr($it['description'], 0, 28),
                    $it['quantity'],
                    '₹' . number_format((float)$it['unit_price'], 2),
                    '₹' . number_format((float)$it['line_total'], 2)
                );
            }
            $lines[] = str_repeat('-', 60);
        }
        $lines[] = sprintf("%-40s %10s", 'Subtotal', '₹' . number_format((float)$invoice['subtotal'], 2));
        $lines[] = sprintf("%-40s %10s", 'GST (' . $invoice['gst_rate'] . '%)', '₹' . number_format((float)$invoice['gst_amount'], 2));
        $lines[] = sprintf("%-40s %10s", 'Delivery Fee', '₹' . number_format((float)$invoice['delivery_fee'], 2));
        $lines[] = str_repeat('-', 60);
        $lines[] = sprintf("%-40s %10s", 'TOTAL', '₹' . number_format((float)$invoice['total'], 2));
        $lines[] = str_repeat('=', 60);
        $lines[] = 'Status: ' . strtoupper($invoice['status']);
        $lines[] = 'Thank you for choosing Eco Sudar Bio Energy!';
        $lines[] = str_repeat('=', 60);

        $content = implode("\n", $lines);

        header('Content-Type: text/plain; charset=UTF-8');
        header('Content-Disposition: attachment; filename="' . $invoice['invoice_number'] . '.txt"');
        header('Content-Length: ' . strlen($content));
        echo $content;
        exit;
    }
}
