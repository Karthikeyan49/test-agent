<?php
declare(strict_types=1);

class AdminPaymentController
{
    public function index(Request $request): void
    {
        $result = Payment::all(
            [
                'direction' => $request->query('direction'),
                'status' => $request->query('status'),
                'invoice_id' => $request->query('invoice_id'),
                'po_id' => $request->query('po_id'),
                'vendor_id' => $request->query('vendor_id'),
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

    public function show(Request $request): void
    {
        $payment = Payment::findById((int)$request->param('id'));
        if (!$payment) {
            Response::error('Payment not found', 404);
        }
        Response::success($payment);
    }

    public function store(Request $request): void
    {
        $this->postPayment($request, null, null);
    }

    public function storeForInvoice(Request $request): void
    {
        $invoiceId = (int)$request->param('id');
        if ($invoiceId <= 0) {
            Response::error('Invalid invoice ID', 400);
        }
        $this->postPayment($request, $invoiceId, null);
    }

    public function storeForPurchaseOrder(Request $request): void
    {
        $poId = (int)$request->param('id');
        if ($poId <= 0) {
            Response::error('Invalid purchase order ID', 400);
        }
        $this->postPayment($request, null, $poId);
    }

    public function invoicePayments(Request $request): void
    {
        $invoiceId = (int)$request->param('id');
        if ($invoiceId <= 0) {
            Response::error('Invalid invoice ID', 400);
        }
        if (!Database::fetch('SELECT invoice_id FROM invoices WHERE invoice_id = ? LIMIT 1', [$invoiceId])) {
            Response::error('Invoice not found', 404);
        }
        Response::success([
            'invoice' => Payment::refreshInvoice($invoiceId),
            'payments' => array_map([Payment::class, 'format'], Payment::invoicePayments($invoiceId)),
        ]);
    }

    public function poPayments(Request $request): void
    {
        $poId = (int)$request->param('id');
        if ($poId <= 0) {
            Response::error('Invalid purchase order ID', 400);
        }
        if (!Database::fetch('SELECT po_id FROM purchase_orders WHERE po_id = ? LIMIT 1', [$poId])) {
            Response::error('Purchase order not found', 404);
        }
        Response::success([
            'purchase_order' => Payment::refreshPurchaseOrder($poId),
            'payments' => array_map([Payment::class, 'format'], Payment::poPayments($poId)),
        ]);
    }

    public function void(Request $request): void
    {
        $id = (int)$request->param('id');
        $payment = Payment::findById($id);
        if (!$payment) {
            Response::error('Payment not found', 404);
        }
        if ($payment['status'] !== 'posted') {
            Response::error('Payment is already voided', 409);
        }

        $reason = trim((string)$request->input('reason', ''));
        if ($reason === '') {
            Response::error('reason is required', 422);
        }

        Database::beginTransaction();
        try {
            Payment::void($id, $this->actorId($request), Request::sanitize($reason));
            Payment::refreshRelated($payment['invoice_id'], $payment['po_id']);
            $this->audit($request, 'payment_voided', 'payments', $id, $payment, ['reason' => $reason]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Payment void error: ' . $e->getMessage());
            Response::error('Could not void payment', 500);
        }

        Response::success(Payment::findById($id), 'Payment voided');
    }

    public function receipt(Request $request): void
    {
        $payment = Payment::findById((int)$request->param('id'));
        if (!$payment) {
            Response::error('Payment not found', 404);
        }

        $target = null;
        if ($payment['invoice_id']) {
            $target = Database::fetch(
                'SELECT i.invoice_number, i.customer_name, i.customer_gstin, i.customer_state, i.total, i.amount_paid, i.payment_status
                 FROM invoices i WHERE i.invoice_id = ? LIMIT 1',
                [$payment['invoice_id']]
            );
        } elseif ($payment['po_id']) {
            $target = Database::fetch(
                'SELECT po.po_number, po.total, po.payment_status, v.name AS vendor_name, v.gstin AS vendor_gstin
                 FROM purchase_orders po
                 JOIN vendors v ON v.vendor_id = po.vendor_id
                 WHERE po.po_id = ? LIMIT 1',
                [$payment['po_id']]
            );
        }

        Response::success([
            'payment' => $payment,
            'target' => $target,
        ], 'Receipt data retrieved');
    }

    public function receivablesAgeing(Request $request): void
    {
        Response::success(Payment::receivablesAgeing($request->query('as_of')));
    }

    private function postPayment(Request $request, ?int $forcedInvoiceId, ?int $forcedPoId): void
    {
        $data = $this->payload($request, $forcedInvoiceId, $forcedPoId);

        Database::beginTransaction();
        try {
            $data['payment_number'] = NumberSequence::next('PAY');
            $data['created_by'] = $this->actorId($request);
            $paymentId = Payment::create($data);
            Payment::refreshRelated($data['invoice_id'] ?: null, $data['po_id'] ?: null);
            $this->audit($request, 'payment_posted', 'payments', $paymentId, null, $data);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Payment post error: ' . $e->getMessage());
            Response::error('Could not post payment', 500);
        }

        Response::success(Payment::findById($paymentId), 'Payment posted', 201);
    }

    private function payload(Request $request, ?int $forcedInvoiceId, ?int $forcedPoId): array
    {
        $direction = strtolower(trim((string)$request->input('direction', $forcedInvoiceId ? 'in' : ($forcedPoId ? 'out' : ''))));
        if (!in_array($direction, Payment::DIRECTIONS, true)) {
            Response::error('direction must be one of: ' . implode(', ', Payment::DIRECTIONS), 422);
        }

        $mode = trim((string)$request->input('payment_mode', ''));
        if (!in_array($mode, Payment::MODES, true)) {
            Response::error('payment_mode must be one of: ' . implode(', ', Payment::MODES), 422);
        }

        $amount = round((float)$request->input('amount', 0), 2);
        if ($amount <= 0) {
            Response::error('amount must be greater than 0', 422);
        }

        $invoiceId = $forcedInvoiceId ?: (int)$request->input('invoice_id', 0);
        $poId = $forcedPoId ?: (int)$request->input('po_id', 0);
        $userId = (int)$request->input('user_id', 0);
        $vendorId = (int)$request->input('vendor_id', 0);

        if (!$invoiceId && !$poId && !$userId && !$vendorId) {
            Response::error('Provide at least one of invoice_id, po_id, user_id, or vendor_id', 422);
        }
        if ($invoiceId && $poId) {
            Response::error('A payment cannot target both invoice_id and po_id', 422);
        }

        if ($invoiceId) {
            $invoice = Database::fetch(
                'SELECT i.invoice_id, i.order_id, i.total, COALESCE(i.amount_paid, 0) AS amount_paid, o.user_id
                 FROM invoices i
                 LEFT JOIN orders o ON o.order_id = i.order_id
                 WHERE i.invoice_id = ? LIMIT 1',
                [$invoiceId]
            );
            if (!$invoice) {
                Response::error('Invoice not found', 404);
            }
            $fresh = Payment::refreshInvoice($invoiceId);
            $userId = $userId ?: (int)($invoice['user_id'] ?? 0);
            $allowOverpayment = (bool)$request->input('allow_overpayment', false);
            if ($direction === 'in' && !$allowOverpayment && $amount - $fresh['balance_due'] > 0.005) {
                Response::error('Payment exceeds invoice balance due', 422);
            }
            if ($direction === 'out' && $amount - $fresh['amount_paid'] > 0.005) {
                Response::error('Refund exceeds amount paid on this invoice', 422);
            }
        }

        if ($poId) {
            $po = Database::fetch('SELECT po_id, vendor_id FROM purchase_orders WHERE po_id = ? LIMIT 1', [$poId]);
            if (!$po) {
                Response::error('Purchase order not found', 404);
            }
            $fresh = Payment::refreshPurchaseOrder($poId);
            $vendorId = $vendorId ?: (int)$po['vendor_id'];
            $allowOverpayment = (bool)$request->input('allow_overpayment', false);
            if ($direction === 'out' && !$allowOverpayment && $amount - $fresh['balance_due'] > 0.005) {
                Response::error('Payment exceeds purchase order balance due', 422);
            }
            if ($direction === 'in' && $amount - $fresh['amount_paid'] > 0.005) {
                Response::error('Vendor refund exceeds amount paid on this purchase order', 422);
            }
        }

        if ($userId && !Database::fetch('SELECT user_id FROM users WHERE user_id = ? LIMIT 1', [$userId])) {
            Response::error('User not found', 404);
        }
        if ($vendorId && !Database::fetch('SELECT vendor_id FROM vendors WHERE vendor_id = ? LIMIT 1', [$vendorId])) {
            Response::error('Vendor not found', 404);
        }

        return [
            'direction' => $direction,
            'invoice_id' => $invoiceId ?: null,
            'po_id' => $poId ?: null,
            'user_id' => $userId ?: null,
            'vendor_id' => $vendorId ?: null,
            'amount' => $amount,
            'payment_mode' => $mode,
            'reference_no' => $request->input('reference_no') ? Request::sanitize((string)$request->input('reference_no')) : null,
            'paid_on' => Payment::validDateOrDefault($request->input('paid_on'), date('Y-m-d')),
            'notes' => $request->input('notes') ? Request::sanitize((string)$request->input('notes')) : null,
        ];
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
