<?php
declare(strict_types=1);

/**
 * Purchase Items catalog — the reusable master of things bought from vendors.
 * A Purchase Order line can pick an item from here and auto-fill its rate + GST;
 * editing the rate here is the single source of truth reflected everywhere.
 */
class PurchaseItem
{
    public static function all(array $filters, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['1=1'];
        $params = [];

        if (($filters['active'] ?? null) !== null && $filters['active'] !== '') {
            $where[] = 'is_active = ?';
            $params[] = filter_var($filters['active'], FILTER_VALIDATE_BOOLEAN) ? 1 : 0;
        }
        if (!empty($filters['category'])) {
            $where[] = 'category = ?';
            $params[] = trim((string)$filters['category']);
        }
        if (!empty($filters['search'])) {
            $like = '%' . trim((string)$filters['search']) . '%';
            $where[] = '(item_code LIKE ? OR name LIKE ? OR category LIKE ? OR hsn_code LIKE ?)';
            array_push($params, $like, $like, $like, $like);
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM purchase_items WHERE $whereClause", $params);
        $rows = Database::fetchAll(
            "SELECT * FROM purchase_items WHERE $whereClause ORDER BY is_active DESC, name ASC LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        return [
            'rows' => array_map([self::class, 'format'], $rows),
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => (int)ceil($total / max(1, $limit)),
            ],
        ];
    }

    public static function findById(int $id): ?array
    {
        $row = Database::fetch('SELECT * FROM purchase_items WHERE purchase_item_id = ? LIMIT 1', [$id]);
        return $row ? self::format($row) : null;
    }

    public static function create(array $data): int
    {
        $id = Database::insert(
            'INSERT INTO purchase_items
                (item_code, name, specification, category, item_type, unit, rate, gst_rate, hsn_code, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())',
            [
                ($data['item_code'] ?? '') !== '' ? $data['item_code'] : null,
                $data['name'],
                ($data['specification'] ?? '') !== '' ? $data['specification'] : null,
                ($data['category'] ?? '') !== '' ? $data['category'] : null,
                self::normalizeType($data['item_type'] ?? null),
                ($data['unit'] ?? '') !== '' ? $data['unit'] : 'nos',
                (float)($data['rate'] ?? 0),
                (float)($data['gst_rate'] ?? 18),
                ($data['hsn_code'] ?? '') !== '' ? $data['hsn_code'] : null,
            ]
        );

        if (empty($data['item_code'])) {
            Database::execute(
                'UPDATE purchase_items SET item_code = ? WHERE purchase_item_id = ?',
                ['PI-' . str_pad((string)$id, 4, '0', STR_PAD_LEFT), $id]
            );
        }

        return $id;
    }

    public static function update(int $id, array $data): void
    {
        $fields = [];
        $params = [];
        $allowed = ['item_code', 'name', 'specification', 'category', 'item_type', 'unit', 'rate', 'gst_rate', 'hsn_code', 'is_active'];

        foreach ($allowed as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $fields[] = "$field = ?";
            if ($field === 'is_active') {
                $params[] = (int)(bool)$data[$field];
            } elseif ($field === 'item_type') {
                $params[] = self::normalizeType($data[$field]);
            } elseif ($field === 'rate' || $field === 'gst_rate') {
                $params[] = (float)($data[$field] ?: 0);
            } else {
                $params[] = ($data[$field] !== '' && $data[$field] !== null) ? $data[$field] : null;
            }
        }

        if (empty($fields)) {
            return;
        }

        $params[] = $id;
        Database::execute(
            'UPDATE purchase_items SET ' . implode(', ', $fields) . ', updated_at = NOW() WHERE purchase_item_id = ?',
            $params
        );
    }

    /**
     * Valid item types: 'stock' (finished/tradeable goods), 'raw_material' (production
     * input), 'pellet' (finished pellets bought in). Anything else falls back to 'stock'.
     * Drives where received goods post: stock/pellet → finished stock, raw_material → raw stock.
     */
    public static function normalizeType(mixed $value): string
    {
        $v = strtolower(trim((string)$value));
        $v = str_replace([' ', '-'], '_', $v);
        if ($v === 'raw_material') return 'raw_material';
        if ($v === 'pellet' || $v === 'pellets' || $v === 'finished') return 'pellet';
        return 'stock';
    }

    public static function deactivate(int $id): void
    {
        Database::execute('UPDATE purchase_items SET is_active = 0, updated_at = NOW() WHERE purchase_item_id = ?', [$id]);
    }

    public static function existsByCode(string $code, ?int $excludeId = null): bool
    {
        $code = trim($code);
        if ($code === '') {
            return false;
        }
        $sql = 'SELECT purchase_item_id FROM purchase_items WHERE item_code = ?';
        $params = [$code];
        if ($excludeId !== null) {
            $sql .= ' AND purchase_item_id != ?';
            $params[] = $excludeId;
        }
        $sql .= ' LIMIT 1';
        return Database::fetch($sql, $params) !== null;
    }

    public static function format(array $row): array
    {
        return [
            'purchase_item_id' => (int)$row['purchase_item_id'],
            'id' => (string)$row['purchase_item_id'],
            'item_code' => $row['item_code'],
            'name' => $row['name'],
            'specification' => $row['specification'] ?? null,
            'category' => $row['category'] ?? null,
            'item_type' => self::normalizeType($row['item_type'] ?? null),
            'unit' => $row['unit'] ?? 'nos',
            'rate' => isset($row['rate']) ? (float)$row['rate'] : 0.0,
            'gst_rate' => isset($row['gst_rate']) ? (float)$row['gst_rate'] : 18.0,
            'hsn_code' => $row['hsn_code'] ?? null,
            'is_active' => (bool)$row['is_active'],
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }
}
