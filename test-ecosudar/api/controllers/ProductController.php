<?php
declare(strict_types=1);

class ProductController
{
    // ─── GET /products ───────────────────────────────────────────────────────

    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(100, max(1, (int)$request->query('limit', 10)));

        $filters = [
            'type'         => $request->query('type'),
            'is_available' => $request->query('is_available', 'true'),
        ];

        // Validate product_type if provided
        $allowedTypes = ['pellets', 'biomass-stove', 'biomass-burner'];
        if (!empty($filters['type']) && !in_array($filters['type'], $allowedTypes, true)) {
            Response::error('Invalid product type. Allowed: ' . implode(', ', $allowedTypes), 400);
        }

        $result = Product::all($filters, $page, $limit);
        $total  = $result['total'];

        Response::paginated($result['rows'], [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $total,
            'total_pages' => (int)ceil($total / $limit),
        ]);
    }

    // ─── GET /products/{id} ──────────────────────────────────────────────────

    public function show(Request $request): void
    {
        $productId = (int)$request->param('id');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }

        $product = Product::findById($productId);
        if (!$product) {
            Response::error('Product not found', 404);
        }

        // Attach available sizes so the app can show size selection
        $product['available_sizes'] = Product::getAvailableSizes($productId);

        Response::success($product);
    }

    // ─── GET /products/{id}/configurations ────────────────────────────────────
    // Supports query params: ?size=8mm  ?purpose=...  ?is_available=true|false|all

    public function configurations(Request $request): void
    {
        $productId = (int)$request->param('id');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }

        $product = Product::findById($productId);
        if (!$product) {
            Response::error('Product not found', 404);
        }

        $filters = [
            'size'         => $request->query('size'),
            'purpose'      => $request->query('purpose'),
            'is_available' => $request->query('is_available', 'true'),
        ];

        $configs = Product::getConfigurations($productId, $filters);
        Response::success($configs);
    }

    // ─── GET /products/{id}/price?size=8mm[&purpose=...] ─────────────────────
    // Returns the price for a specific size. Falls back to base_price if no
    // configuration exists for that size.

    public function price(Request $request): void
    {
        $productId = (int)$request->param('id');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }

        $size = trim((string)($request->query('size') ?? ''));
        if ($size === '') {
            Response::error('Query param "size" is required (e.g. ?size=8mm)', 400);
        }

        $purpose = $request->query('purpose'); // optional filter

        $product = Product::findById($productId);
        if (!$product || !$product['is_available']) {
            Response::error('Product not found', 404);
        }

        $pricing = Product::getPriceBySize($productId, $size, $purpose ?: null);
        if ($pricing === null) {
            Response::error('Product not found', 404);
        }

        Response::success([
            'product_id'   => $productId,
            'product_name' => $product['product_name'],
            'size'         => $pricing['size'],
            'purpose'      => $pricing['purpose'],
            'config_id'    => $pricing['config_id'],
            'price'        => $pricing['price'],
            'source'       => $pricing['source'], // 'config' or 'base_price'
        ]);
    }

    // ─── GET /products/{id}/sizes ─────────────────────────────────────────────
    // Returns all distinct available sizes for a product.

    public function sizes(Request $request): void
    {
        $productId = (int)$request->param('id');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }

        $product = Product::findById($productId);
        if (!$product) {
            Response::error('Product not found', 404);
        }

        $sizes = Product::getAvailableSizes($productId);

        Response::success([
            'product_id'      => $productId,
            'product_name'    => $product['product_name'],
            'available_sizes' => $sizes,
        ]);
    }

    // ─── GET /products/sub-purposes?product_id=X&size=Y&purpose=Z ────────────
    // Returns distinct sub_purpose values from productconfiguration table
    // All query params are optional filters

    public function subPurposes(Request $request): void
    {
        $productId = $request->query('product_id');
        $size      = $request->query('size');
        $purpose   = $request->query('purpose');

        $subPurposes = Product::getSubPurposes($productId, $size, $purpose);

        Response::success($subPurposes);
    }
}
