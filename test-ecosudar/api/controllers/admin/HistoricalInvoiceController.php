<?php
declare(strict_types=1);

/**
 * Historical (Past) Invoice Controller
 * GET /admin/historical-invoices — list past invoices imported via Data Upload.
 *
 * These live in the separate `historical_invoices` table (never the live `invoices`
 * table). Rows are returned in the same shape the Invoices page already understands,
 * with the real `invoice_date` aliased into `created_at` so the existing UI mapper
 * shows / sorts by the historical bill date rather than the import time.
 */
class HistoricalInvoiceController
{
    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(200, max(1, (int)$request->query('limit', 20)));

        $where  = ['1=1'];
        $params = [];

        $status = $request->query('status');
        if ($status) {
            $where[]  = 'status = ?';
            $params[] = $status;
        }
        if ($from = $request->query('from_date')) {
            $where[]  = 'invoice_date >= ?';
            $params[] = $from;
        }
        if ($to = $request->query('to_date')) {
            $where[]  = 'invoice_date <= ?';
            $params[] = $to;
        }
        if ($search = trim((string)$request->query('search', ''))) {
            $where[]  = '(invoice_number LIKE ? OR customer_name LIKE ?)';
            $params[] = '%' . $search . '%';
            $params[] = '%' . $search . '%';
        }

        $whereClause = implode(' AND ', $where);

        // Revenue sum excludes Cancelled/void invoices; the row count still covers
        // every invoice so the list + pagination keep showing cancelled bills.
        $agg = Database::fetch(
            "SELECT COUNT(*) AS cnt,
                    COALESCE(SUM(CASE WHEN LOWER(status) = 'cancelled' THEN 0 ELSE total END), 0) AS sum_total
             FROM historical_invoices WHERE $whereClause",
            $params
        );
        $total    = (int)($agg['cnt'] ?? 0);
        $sumTotal = (float)($agg['sum_total'] ?? 0);
        $offset   = ($page - 1) * $limit;

        $rows = Database::fetchAll(
            "SELECT historical_invoice_id AS invoice_id,
                    invoice_number,
                    NULL AS order_id,
                    customer_name,
                    customer_gstin,
                    customer_state,
                    customer_address,
                    COALESCE(seller_state, 'Tamil Nadu') AS seller_state,
                    invoice_date,
                    due_date,
                    invoice_date AS created_at,
                    subtotal, gst_rate, gst_amount,
                    COALESCE(cgst_amount, 0) AS cgst_amount,
                    COALESCE(sgst_amount, 0) AS sgst_amount,
                    COALESCE(igst_amount, 0) AS igst_amount,
                    delivery_fee, 0 AS discount, total,
                    status, payment_method, notes
             FROM historical_invoices
             WHERE $whereClause
             ORDER BY invoice_date DESC, historical_invoice_id DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, $offset]
        );

        // Attach line items for the page's invoices in one query (shape matches the UI).
        $ids = array_column($rows, 'invoice_id');
        $itemsByInvoice = [];
        if ($ids) {
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $itemRows = Database::fetchAll(
                "SELECT item_id, historical_invoice_id, description, hsn_code,
                        quantity, unit, unit_price, gst_rate, line_total, sort_order
                 FROM historical_invoice_items
                 WHERE historical_invoice_id IN ($placeholders)
                 ORDER BY sort_order ASC, item_id ASC",
                array_map('intval', $ids)
            );
            foreach ($itemRows as $it) {
                $itemsByInvoice[(int)$it['historical_invoice_id']][] = [
                    'item_id'    => (int)$it['item_id'],
                    'description'=> $it['description'],
                    'hsn_code'   => $it['hsn_code'],
                    'quantity'   => (float)$it['quantity'],
                    'unit'       => $it['unit'],
                    'unit_price' => (float)$it['unit_price'],
                    'gst_rate'   => (float)$it['gst_rate'],
                    'line_total' => (float)$it['line_total'],
                    'sort_order' => (int)$it['sort_order'],
                ];
            }
        }

        foreach ($rows as &$r) {
            $r['subtotal']     = (float)$r['subtotal'];
            $r['gst_rate']     = (float)($r['gst_rate'] ?? 0);
            $r['gst_amount']   = (float)$r['gst_amount'];
            $r['cgst_amount']  = (float)$r['cgst_amount'];
            $r['sgst_amount']  = (float)$r['sgst_amount'];
            $r['igst_amount']  = (float)$r['igst_amount'];
            $r['delivery_fee'] = (float)$r['delivery_fee'];
            $r['total']        = (float)$r['total'];
            $r['items']        = $itemsByInvoice[(int)$r['invoice_id']] ?? [];
            $r['item_count']   = count($r['items']);
        }
        unset($r);

        Response::paginated($rows, [
            'page'         => $page,
            'limit'        => $limit,
            'total'        => $total,
            'total_pages'  => (int)ceil($total / $limit),
            'total_amount' => $sumTotal,
        ]);
    }
}
