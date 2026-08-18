<?php
declare(strict_types=1);

/**
 * Invoice line-item catalog — backed by the unified `products` table.
 * (The old standalone `invoice_products` table was merged into `products`;
 *  billing-only entries live there as product_type='other', is_available=0.)
 *
 * GET    /admin/invoice-products          — list catalog entries (id/name/hsn/price/gst/unit)
 * POST   /admin/invoice-products          — create or update by name (upsert)
 * PUT    /admin/invoice-products/{id}     — update a specific entry
 * DELETE /admin/invoice-products/{id}     — soft-delete an entry
 *
 * The response shape is kept identical to the legacy endpoint so the invoice
 * UI keeps working unchanged: { id, name, hsn_code, unit_price, gst_rate, unit }.
 */
class AdminInvoiceProductController
{
    // Map a products row to the legacy invoice-product JSON shape.
    private const SELECT = "SELECT product_id AS id, product_name AS name, hsn_code,
                                   base_price AS unit_price, COALESCE(gst_rate, 18) AS gst_rate,
                                   unit, created_at, updated_at
                              FROM products";

    public function index(Request $request): void
    {
        $rows = Database::fetchAll(
            self::SELECT . ' WHERE is_deleted = 0 ORDER BY product_name ASC'
        );
        Response::success($rows);
    }

    // Create or update by name (upsert so duplicates don't pile up).
    public function store(Request $request): void
    {
        $name     = trim(Request::sanitize((string)($request->input('name') ?? '')));
        $hsn      = trim((string)($request->input('hsn_code')  ?? ''));
        $price    = (float)($request->input('unit_price') ?? 0);
        $gstRate  = (int)($request->input('gst_rate')    ?? 18);
        $unit     = trim((string)($request->input('unit') ?? ''));

        if ($name === '') Response::error('Product name is required', 422);
        if (!in_array($gstRate, [0, 5, 12, 18, 28], true)) {
            Response::error('gst_rate must be one of 0, 5, 12, 18, 28', 422);
        }

        $existing = Database::fetch(
            'SELECT product_id, is_available FROM products WHERE product_name = ? AND is_deleted = 0 LIMIT 1',
            [$name]
        );

        if ($existing) {
            // Enrich billing metadata (hsn/gst/unit) on any match, but only overwrite
            // base_price for billing-only items so storefront prices are never clobbered.
            Database::execute(
                'UPDATE products
                    SET hsn_code = ?, gst_rate = ?, unit = ?,
                        base_price = IF(is_available = 0, ?, base_price),
                        updated_at = NOW()
                  WHERE product_id = ?',
                [$hsn ?: null, $gstRate, $unit ?: null, $price, $existing['product_id']]
            );
            $row = Database::fetch(self::SELECT . ' WHERE product_id = ? LIMIT 1', [$existing['product_id']]);
            Response::success($row, 'Invoice product updated', 200);
        } else {
            $id = Database::insert(
                "INSERT INTO products (product_name, product_type, base_price, unit, hsn_code, gst_rate, is_available, is_deleted, created_at)
                 VALUES (?, 'other', ?, ?, ?, ?, 0, 0, NOW())",
                [$name, $price, $unit ?: null, $hsn ?: null, $gstRate]
            );
            $row = Database::fetch(self::SELECT . ' WHERE product_id = ? LIMIT 1', [$id]);
            Response::success($row, 'Invoice product created', 201);
        }
    }

    public function update(Request $request): void
    {
        $id  = (int)$request->param('id');
        $row = Database::fetch('SELECT product_id, is_available FROM products WHERE product_id = ? AND is_deleted = 0 LIMIT 1', [$id]);
        if (!$row) Response::error('Invoice product not found', 404);

        $name    = trim(Request::sanitize((string)($request->input('name') ?? '')));
        $hsn     = trim((string)($request->input('hsn_code')  ?? ''));
        $price   = (float)($request->input('unit_price') ?? 0);
        $gstRate = (int)($request->input('gst_rate')    ?? 18);
        $unit    = trim((string)($request->input('unit') ?? ''));

        if ($name === '') Response::error('Product name is required', 422);

        // An explicit edit updates base_price unconditionally (the admin is changing this entry).
        Database::execute(
            'UPDATE products
                SET product_name = ?, hsn_code = ?, base_price = ?, gst_rate = ?, unit = ?, updated_at = NOW()
              WHERE product_id = ?',
            [$name, $hsn ?: null, $price, $gstRate, $unit ?: null, $id]
        );
        Response::success(
            Database::fetch(self::SELECT . ' WHERE product_id = ? LIMIT 1', [$id]),
            'Invoice product updated'
        );
    }

    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if (!Database::fetch('SELECT product_id FROM products WHERE product_id = ? AND is_deleted = 0 LIMIT 1', [$id])) {
            Response::error('Invoice product not found', 404);
        }
        // Soft-delete (matches AdminProductController) — invoice_items.product_id FK is ON DELETE SET NULL,
        // and soft-delete keeps historical invoice line references intact.
        Database::execute('UPDATE products SET is_deleted = 1, is_available = 0, updated_at = NOW() WHERE product_id = ?', [$id]);
        Response::success(null, 'Invoice product deleted');
    }
}
