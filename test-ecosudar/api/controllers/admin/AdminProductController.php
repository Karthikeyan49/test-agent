<?php
declare(strict_types=1);

/**
 * Admin Product Controller
 * POST   /admin/products       — Create a new product
 * PUT    /admin/products/{id}  — Update any product field
 * DELETE /admin/products/{id}  — Soft-delete a product
 */
class AdminProductController
{
    // ─── POST /admin/products ─────────────────────────────────────────────────

    public function store(Request $request): void
    {
        Validator::make($request->only(['product_name', 'product_type', 'base_price']), [
            'product_name' => 'required|string|max:200',
            'product_type' => 'required|string|max:50',
            'base_price'   => 'required|numeric',
        ])->validate();

        $data = $request->only([
            'product_name', 'product_type', 'description', 'base_price', 'unit',
            'gcv', 'ash_content', 'moisture_content', 'category',
            'tag', 'tag_color', 'suitable_for', 'image_url', 'is_available', 'configurations',
        ]);

        $isAvail = isset($data['is_available'])
            ? (int)filter_var($data['is_available'], FILTER_VALIDATE_BOOLEAN)
            : 1;

        Database::beginTransaction();
        try {
            $productId = Database::insert(
                'INSERT INTO products
                    (product_name, product_type, description, base_price, unit,
                     gcv, ash_content, moisture_content, category,
                     tag, tag_color, suitable_for, image_url, is_available, created_at)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
                [
                    Request::sanitize($data['product_name']),
                    strtolower(trim($data['product_type'])),
                    $data['description']      ?? null,
                    (float)$data['base_price'],
                    $data['unit']             ?? 'kg',
                    $data['gcv']              ?? null,
                    $data['ash_content']      ?? null,
                    $data['moisture_content'] ?? null,
                    $data['category']         ?? null,
                    $data['tag']              ?? null,
                    $data['tag_color']        ?? null,
                    $data['suitable_for']     ?? null,
                    $data['image_url']        ?? null,
                    $isAvail,
                ]
            );

            // Handle product configurations list
            if (!empty($data['configurations']) && is_array($data['configurations'])) {
                foreach ($data['configurations'] as $config) {
                    if (empty($config['size'])) {
                        continue;
                    }
                    Database::execute(
                        'INSERT INTO product_configurations (product_id, size, purpose, sub_purpose, price, is_available, created_at) VALUES (?, ?, ?, ?, ?, 1, NOW())',
                        [
                            $productId,
                            Request::sanitize((string)$config['size']),
                            !empty($config['purpose']) ? Request::sanitize((string)$config['purpose']) : null,
                            !empty($config['sub_purpose']) ? Request::sanitize((string)$config['sub_purpose']) : null,
                            (float)($config['price'] ?? 0)
                        ]
                    );
                }
            }
            Database::commit();
        } catch (\Throwable $e) {
            Database::rollBack();
            throw $e;
        }

        $product = Product::findById($productId);
        Response::success($product, 'Product created successfully', 201);
    }

    // ─── PUT /admin/products/{id} ─────────────────────────────────────────────

    public function update(Request $request): void
    {
        $productId = (int)$request->param('id');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }

        $product = Product::findById($productId);
        if (!$product) {
            Response::error('Product not found', 404);
        }

        $allowed = [
            'product_name', 'product_type', 'description', 'base_price', 'unit',
            'gcv', 'ash_content', 'moisture_content', 'category',
            'tag', 'tag_color', 'suitable_for', 'image_url', 'is_available',
        ];

        $input = $request->only([
            'product_name', 'product_type', 'description', 'base_price', 'unit',
            'gcv', 'ash_content', 'moisture_content', 'category',
            'tag', 'tag_color', 'suitable_for', 'image_url', 'is_available', 'configurations',
        ]);
        
        $fields = [];
        $values = [];

        foreach ($allowed as $field) {
            if (!array_key_exists($field, $input)) {
                continue;
            }
            if ($field === 'is_available') {
                $fields[] = 'is_available = ?';
                $values[] = (int)filter_var($input[$field], FILTER_VALIDATE_BOOLEAN);
            } elseif ($field === 'base_price') {
                $fields[] = 'base_price = ?';
                $values[] = (float)$input[$field];
            } else {
                $fields[] = "$field = ?";
                $values[] = Request::sanitize((string)$input[$field]);
            }
        }

        Database::beginTransaction();
        try {
            if (!empty($fields)) {
                $values[] = $productId;
                Database::execute(
                    'UPDATE products SET ' . implode(', ', $fields) . ', updated_at = NOW() WHERE product_id = ?',
                    $values
                );
            }

            if (isset($input['configurations']) && is_array($input['configurations'])) {
                Database::execute('DELETE FROM product_configurations WHERE product_id = ?', [$productId]);

                foreach ($input['configurations'] as $config) {
                    if (empty($config['size'])) {
                        continue;
                    }
                    Database::execute(
                        'INSERT INTO product_configurations (product_id, size, purpose, sub_purpose, price, is_available, created_at) VALUES (?, ?, ?, ?, ?, 1, NOW())',
                        [
                            $productId,
                            Request::sanitize((string)$config['size']),
                            !empty($config['purpose']) ? Request::sanitize((string)$config['purpose']) : null,
                            !empty($config['sub_purpose']) ? Request::sanitize((string)$config['sub_purpose']) : null,
                            (float)($config['price'] ?? 0)
                        ]
                    );
                }
            }
            Database::commit();
        } catch (\Throwable $e) {
            Database::rollBack();
            Response::error('Update failed: ' . $e->getMessage() . ' (line ' . $e->getLine() . ' in ' . basename($e->getFile()) . ')', 500);
        }

        Response::success(Product::findById($productId), 'Product updated successfully');
    }

    // ─── DELETE /admin/products/{id} ──────────────────────────────────────────

    public function destroy(Request $request): void
    {
        $productId = (int)$request->param('id');
        if ($productId <= 0) {
            Response::error('Invalid product ID', 400);
        }

        $product = Product::findById($productId);
        if (!$product) {
            Response::error('Product not found', 404);
        }

        // Remove all configurations for this product
        Database::execute(
            'DELETE FROM product_configurations WHERE product_id = ?',
            [$productId]
        );

        // Soft-delete: mark unavailable and flag deleted
        Database::execute(
            'UPDATE products SET is_available = 0, is_deleted = 1, updated_at = NOW() WHERE product_id = ?',
            [$productId]
        );

        Response::success(null, 'Product deleted successfully');
    }
}
