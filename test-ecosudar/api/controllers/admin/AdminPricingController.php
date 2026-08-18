<?php
declare(strict_types=1);

/**
 * Admin Pricing Controller — manages product_configurations (size-based pricing)
 *
 * GET    /admin/products/{id}/configurations          — list all configs for a product
 * POST   /admin/products/{id}/configurations          — add a new size/purpose/price config
 * PUT    /admin/products/{id}/configurations/{cid}   — update price, size, purpose, availability
 * DELETE /admin/products/{id}/configurations/{cid}   — delete a configuration
 */
class AdminPricingController
{
    // ─── GET /admin/products/{id}/configurations ──────────────────────────────

    public function index(Request $request): void
    {
        $productId = (int)$request->param('id');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }

        $product = Product::findById($productId);
        if (!$product) {
            Response::error('Product not found', 404);
        }

        // Admin sees ALL configs (including unavailable) by default
        $isAvail = $request->query('is_available', 'all');
        $configs = Product::getConfigurations($productId, [
            'size'         => $request->query('size'),
            'purpose'      => $request->query('purpose'),
            'is_available' => $isAvail,
        ]);

        Response::success([
            'product'        => $product,
            'configurations' => $configs,
            'total'          => count($configs),
        ]);
    }

    // ─── POST /admin/products/{id}/configurations ─────────────────────────────

    public function store(Request $request): void
    {
        $productId = (int)$request->param('id');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }

        $product = Product::findById($productId);
        if (!$product) {
            Response::error('Product not found', 404);
        }

        Validator::make($request->only(['size', 'purpose', 'price']), [
            'size'    => 'required|string|max:50',
            'purpose' => 'required|string|max:100',
            'price'   => 'required|numeric',
        ])->validate();

        $size    = trim((string)$request->input('size'));
        $purpose = trim((string)$request->input('purpose'));
        $price   = (float)$request->input('price');

        if ($price <= 0) {
            Response::error('Price must be greater than 0', 400);
        }

        try {
            $configId = Product::createConfig($productId, $size, $purpose, $price);
        } catch (AppException $e) {
            Response::error($e->getMessage(), $e->getCode());
        }

        $config = Product::getConfigById($configId);
        Response::success($config, 'Configuration created successfully', 201);
    }

    // ─── PUT /admin/products/{id}/configurations/{cid} ───────────────────────

    public function update(Request $request): void
    {
        $productId = (int)$request->param('id');
        $configId  = (int)$request->param('cid');

        if ($productId <= 0 || $configId <= 0) {
            Response::error('Invalid product or configuration ID', 400);
        }

        $config = Product::getConfigById($configId);
        if (!$config || (int)$config['product_id'] !== $productId) {
            Response::error('Configuration not found for this product', 404);
        }

        $allowed = ['size', 'purpose', 'price', 'is_available'];
        $input   = $request->only($allowed);

        if (empty($input)) {
            Response::error('Provide at least one field to update (size, purpose, price, is_available)', 400);
        }

        Validator::make($input, [
            'size'    => 'string|max:50',
            'purpose' => 'string|max:100',
            'price'   => 'numeric',
        ])->validate();

        if (isset($input['price']) && (float)$input['price'] <= 0) {
            Response::error('Price must be greater than 0', 400);
        }

        try {
            Product::updateConfig($configId, $input);
        } catch (AppException $e) {
            Response::error($e->getMessage(), $e->getCode());
        }

        $updated = Product::getConfigById($configId);
        Response::success($updated, 'Configuration updated successfully');
    }

    // ─── DELETE /admin/products/{id}/configurations/{cid} ────────────────────

    public function destroy(Request $request): void
    {
        $productId = (int)$request->param('id');
        $configId  = (int)$request->param('cid');

        if ($productId <= 0 || $configId <= 0) {
            Response::error('Invalid product or configuration ID', 400);
        }

        $config = Product::getConfigById($configId);
        if (!$config || (int)$config['product_id'] !== $productId) {
            Response::error('Configuration not found for this product', 404);
        }

        Product::deleteConfig($configId);
        Response::success(null, 'Configuration deleted successfully');
    }
}
