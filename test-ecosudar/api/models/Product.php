<?php
declare(strict_types=1);

class Product
{
    /**
     * Get all products with optional filters + pagination.
     */
    public static function all(array $filters = [], int $page = 1, int $limit = 10): array
    {
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['type'])) {
            $where[] = 'product_type = ?';
            $params[] = $filters['type'];
        }

        // is_available filter: default shows only available
        $isAvailable = $filters['is_available'] ?? 'true';
        if ($isAvailable !== 'all') {
            $where[] = 'is_available = ?';
            $params[] = ($isAvailable === 'false') ? 0 : 1;
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM products WHERE $whereClause", $params);
        $offset = ($page - 1) * $limit;

        $rows = Database::fetchAll(
            "SELECT product_id, product_name, product_type, description, base_price, unit, category, tag, tag_color, suitable_for, image_url,
                    gcv, ash_content, moisture_content, is_available, created_at, updated_at
             FROM products WHERE $whereClause ORDER BY product_id ASC LIMIT ? OFFSET ?",
            [...$params, $limit, $offset]
        );

        foreach ($rows as &$r) {
            $r['is_available'] = (bool) $r['is_available'];
            $r['base_price'] = (float) $r['base_price'];
            $r['configurations'] = Database::fetchAll(
                'SELECT config_id, size, purpose, sub_purpose, price FROM product_configurations WHERE product_id = ? AND is_available = 1 ORDER BY size, purpose',
                [$r['product_id']]
            );
        }

        return ['rows' => $rows, 'total' => $total];
    }

    public static function findById(int $id): ?array
    {
        $row = Database::fetch(
            'SELECT product_id, product_name, product_type, description, base_price, unit, category, tag, tag_color, suitable_for, image_url,
                    gcv, ash_content, moisture_content, is_available, created_at, updated_at
             FROM products WHERE product_id = ? LIMIT 1',
            [$id]
        );
        if (!$row) {
            return null;
        }
        $row['is_available'] = (bool) $row['is_available'];
        $row['base_price'] = (float) $row['base_price'];
        $row['configurations'] = Database::fetchAll(
            'SELECT config_id, size, purpose, sub_purpose, price FROM product_configurations WHERE product_id = ? AND is_available = 1 ORDER BY size, purpose',
            [$row['product_id']]
        );
        return $row;
    }

    /**
     * @throws AppException
     */
    public static function findActiveOrFail(int $id): array
    {
        $product = self::findById($id);
        if (!$product || !$product['is_available']) {
            throw new AppException('Product not found or inactive', 404);
        }
        return $product;
    }

    /**
     * Get configurations with optional size/purpose filters.
     * Supports: ?size=8mm  ?purpose=...  ?is_available=true|false|all
     */
    public static function getConfigurations(int $productId, array $filters = []): array
    {
        $where = ['product_id = ?'];
        $params = [$productId];

        if (!empty($filters['size'])) {
            $where[] = 'size = ?';
            $params[] = $filters['size'];
        }

        if (!empty($filters['purpose'])) {
            $where[] = 'purpose = ?';
            $params[] = $filters['purpose'];
        }

        // Default: only available configs
        $avail = $filters['is_available'] ?? 'true';
        if ($avail !== 'all') {
            $where[] = 'is_available = ?';
            $params[] = ($avail === 'false') ? 0 : 1;
        }

        $rows = Database::fetchAll(
            'SELECT config_id, product_id, size, purpose, price, is_available, created_at
             FROM product_configurations
             WHERE ' . implode(' AND ', $where) . '
             ORDER BY size ASC, purpose ASC',
            $params
        );

        foreach ($rows as &$r) {
            $r['is_available'] = (bool) $r['is_available'];
            $r['price'] = (float) $r['price'];
        }
        return $rows;
    }

    /**
     * Get the price for a specific product + size (falls back to base_price).
     * Returns: ['price' => float, 'source' => 'config'|'base_price', 'config_id' => int|null]
     */
    public static function getPriceBySize(int $productId, string $size, ?string $purpose = null): ?array
    {
        $where = ['pc.product_id = ?', 'pc.size = ?', 'pc.is_available = 1'];
        $params = [$productId, $size];

        if ($purpose !== null) {
            $where[] = 'pc.purpose = ?';
            $params[] = $purpose;
        }

        $row = Database::fetch(
            'SELECT pc.config_id, pc.price, pc.size, pc.purpose
             FROM product_configurations pc
             WHERE ' . implode(' AND ', $where) . '
             ORDER BY pc.config_id ASC LIMIT 1',
            $params
        );

        if ($row) {
            return [
                'config_id' => (int) $row['config_id'],
                'size' => $row['size'],
                'purpose' => $row['purpose'],
                'price' => (float) $row['price'],
                'source' => 'config',
            ];
        }

        // Fallback: return base_price from product
        $product = self::findById($productId);
        if (!$product) {
            return null;
        }
        return [
            'config_id' => null,
            'size' => $size,
            'purpose' => $purpose,
            'price' => $product['base_price'],
            'source' => 'base_price',
        ];
    }

    /**
     * Get all unique sizes available for a product.
     */
    public static function getAvailableSizes(int $productId): array
    {
        $rows = Database::fetchAll(
            'SELECT DISTINCT size
             FROM product_configurations
             WHERE product_id = ? AND is_available = 1
             ORDER BY size ASC',
            [$productId]
        );
        return array_column($rows, 'size');
    }

    // ─── Admin: Configuration CRUD ────────────────────────────────────────────

    public static function getConfigById(int $configId): ?array
    {
        $row = Database::fetch(
            'SELECT config_id, product_id, size, purpose, price, is_available, created_at
             FROM product_configurations WHERE config_id = ? LIMIT 1',
            [$configId]
        );
        if (!$row)
            return null;
        $row['is_available'] = (bool) $row['is_available'];
        $row['price'] = (float) $row['price'];
        return $row;
    }

    /**
     * @throws AppException
     */
    public static function createConfig(int $productId, string $size, string $purpose, float $price): int
    {
        // Prevent duplicate size+purpose for same product
        $existing = Database::fetch(
            'SELECT config_id FROM product_configurations WHERE product_id = ? AND size = ? AND purpose = ? LIMIT 1',
            [$productId, $size, $purpose]
        );
        if ($existing) {
            throw new AppException('A configuration for this product/size/purpose already exists', 409);
        }

        return Database::insert(
            'INSERT INTO product_configurations (product_id, size, purpose, price, is_available, created_at)
             VALUES (?, ?, ?, ?, 1, NOW())',
            [$productId, $size, $purpose, $price]
        );
    }

    /**
     * @throws AppException
     */
    public static function updateConfig(int $configId, array $data): void
    {
        $allowed = ['size', 'purpose', 'price', 'is_available'];
        $fields = [];
        $values = [];

        foreach ($allowed as $field) {
            if (!array_key_exists($field, $data))
                continue;
            if ($field === 'price') {
                $fields[] = 'price = ?';
                $values[] = (float) $data['price'];
            } elseif ($field === 'is_available') {
                $fields[] = 'is_available = ?';
                $values[] = (int) filter_var($data['is_available'], FILTER_VALIDATE_BOOLEAN);
            } else {
                $fields[] = "$field = ?";
                $values[] = trim((string) $data[$field]);
            }
        }

        if (empty($fields)) {
            throw new AppException('No valid fields to update', 400);
        }

        $values[] = $configId;
        Database::execute(
            'UPDATE product_configurations SET ' . implode(', ', $fields) . ' WHERE config_id = ?',
            $values
        );
    }

    public static function deleteConfig(int $configId): void
    {
        Database::execute(
            'DELETE FROM product_configurations WHERE config_id = ?',
            [$configId]
        );
    }

    public static function findConfig(int $configId, int $productId): ?array
    {
        $row = Database::fetch(
            'SELECT config_id, product_id, size, purpose, sub_purpose, price, is_available
             FROM product_configurations
             WHERE config_id = ? AND product_id = ? AND is_available = TRUE LIMIT 1',
            [$configId, $productId]
        );
        if (!$row) {
            return null;
        }
        $row['is_available'] = (bool) $row['is_available'];
        $row['price'] = (float) $row['price'];
        return $row;
    }
    
    /**
     * Get distinct sub_purpose values from product_configurations table
     * 
     * @param mixed $productId Optional product_id filter (accepts string or int)
     * @param string|null $size Optional size filter
     * @param string|null $purpose Optional purpose filter
     * @return array Array of distinct sub_purpose strings
     */
    public static function getSubPurposes($productId = null, ?string $size = null, ?string $purpose = null): array
    {
        $where  = ['1=1'];
        $params = [];
        
        // Cast product_id to int if provided
        if ($productId !== null && $productId !== '') {
            $productIdInt = (int)$productId;
            if ($productIdInt > 0) {
                $where[]  = 'product_id = ?';
                $params[] = $productIdInt;
            }
        }
        
        if ($size !== null && $size !== '') {
            $where[]  = 'size = ?';
            $params[] = $size;
        }
        
        if ($purpose !== null && $purpose !== '') {
            $where[]  = 'purpose = ?';
            $params[] = $purpose;
        }
        
        // Filter out NULL and empty sub_purpose values
        $where[] = 'sub_purpose IS NOT NULL';
        $where[] = "sub_purpose != ''";
        
        $whereClause = implode(' AND ', $where);
        
        $rows = Database::fetchAll(
            "SELECT DISTINCT sub_purpose 
             FROM product_configurations
             WHERE {$whereClause}
             ORDER BY sub_purpose ASC",
            $params
        );
        
        return array_column($rows, 'sub_purpose');
    }
}
