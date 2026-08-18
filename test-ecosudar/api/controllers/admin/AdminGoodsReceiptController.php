<?php
declare(strict_types=1);

class AdminGoodsReceiptController
{
    public function index(Request $request): void
    {
        $result = PurchaseOrder::receiptList(
            ['po_id' => $request->query('po_id')],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 20)
        );
        Response::paginated($result['rows'], $result['pagination']);
    }

    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid goods receipt ID', 400);
        }
        $row = PurchaseOrder::receipt($id);
        if (!$row) {
            Response::error('Goods receipt not found', 404);
        }
        $receipts = PurchaseOrder::receipts((int)$row['po_id']);
        foreach ($receipts as $receipt) {
            if ((int)$receipt['grn_id'] === $id) {
                Response::success(PurchaseOrder::formatReceiptDetail($receipt));
            }
        }
        Response::error('Goods receipt not found', 404);
    }

    public function void(Request $request): void
    {
        $id = (int)$request->param('id');
        $reason = trim((string)$request->input('reason', ''));
        if ($id <= 0) {
            Response::error('Invalid goods receipt ID', 400);
        }
        if ($reason === '') {
            Response::error('Void reason is required', 422);
        }

        Database::beginTransaction();
        try {
            PurchaseOrder::voidReceipt($id, (int)($request->user['user_id'] ?? 0), $reason);
            Database::execute(
                'INSERT INTO audit_log (user_id, action, table_name, record_id, new_value, ip_address, created_at)
                 VALUES (?, "grn_voided", "goods_receipts", ?, ?, ?, NOW())',
                [
                    isset($request->user['user_id']) ? (int)$request->user['user_id'] : null,
                    $id,
                    json_encode(['reason' => $reason], JSON_UNESCAPED_UNICODE),
                    $request->ip(),
                ]
            );
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('GRN void error: ' . $e->getMessage());
            Response::error('Could not void goods receipt', 500);
        }

        Response::success(null, 'Goods receipt voided');
    }
}
