<?php
declare(strict_types=1);

class Vendor
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

        if (!empty($filters['search'])) {
            $like = '%' . trim((string)$filters['search']) . '%';
            $where[] = '(vendor_code LIKE ? OR name LIKE ? OR gstin LIKE ? OR phone LIKE ?)';
            array_push($params, $like, $like, $like, $like);
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM vendors WHERE $whereClause", $params);
        $rows = Database::fetchAll(
            "SELECT *
             FROM vendors
             WHERE $whereClause
             ORDER BY is_active DESC, name ASC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        return [
            'rows' => array_map([self::class, 'format'], $rows),
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => (int)ceil($total / $limit),
            ],
        ];
    }

    public static function findById(int $id): ?array
    {
        $row = Database::fetch('SELECT * FROM vendors WHERE vendor_id = ? LIMIT 1', [$id]);

        return $row ? self::format($row) : null;
    }

    public static function create(array $data): int
    {
        $id = Database::insert(
            'INSERT INTO vendors
                (vendor_code, name, gstin, contact_name, phone, email, address, city, state, pincode, payment_terms, notes, is_active, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())',
            [
                $data['vendor_code'] ?: null,
                $data['name'],
                $data['gstin'] ?: null,
                $data['contact_name'] ?: null,
                $data['phone'] ?: null,
                $data['email'] ?: null,
                $data['address'] ?: null,
                $data['city'] ?: null,
                $data['state'] ?: null,
                $data['pincode'] ?: null,
                $data['payment_terms'] ?: null,
                $data['notes'] ?: null,
            ]
        );

        if (empty($data['vendor_code'])) {
            Database::execute(
                'UPDATE vendors SET vendor_code = ? WHERE vendor_id = ?',
                ['VND-' . str_pad((string)$id, 4, '0', STR_PAD_LEFT), $id]
            );
        }

        // Apply any extended (Zoho-style) fields present in the payload.
        self::update($id, $data);

        return $id;
    }

    public static function update(int $id, array $data): void
    {
        $fields = [];
        $params = [];
        $allowed = [
            'vendor_code', 'name', 'gstin', 'contact_name', 'phone', 'email', 'address',
            'city', 'state', 'pincode', 'payment_terms', 'notes', 'is_active',
            // Extended (Zoho-style) fields
            'salutation', 'first_name', 'last_name', 'company_name', 'mobile', 'pan',
            'msme_registered', 'opening_balance',
            'billing_attention', 'billing_country', 'billing_street2', 'billing_phone', 'billing_fax',
            'shipping_attention', 'shipping_country', 'shipping_street1', 'shipping_street2',
            'shipping_city', 'shipping_state', 'shipping_pincode', 'shipping_phone', 'shipping_fax',
            'bank_account_holder', 'bank_name', 'bank_account_number', 'bank_ifsc',
        ];

        foreach ($allowed as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $fields[] = "$field = ?";
            if ($field === 'is_active' || $field === 'msme_registered') {
                $params[] = (int)(bool)$data[$field];
            } elseif ($field === 'opening_balance') {
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
            'UPDATE vendors SET ' . implode(', ', $fields) . ', updated_at = NOW() WHERE vendor_id = ?',
            $params
        );
    }

    public static function deactivate(int $id): void
    {
        Database::execute('UPDATE vendors SET is_active = 0, updated_at = NOW() WHERE vendor_id = ?', [$id]);
    }

    public static function existsByCode(string $code, ?int $excludeId = null): bool
    {
        $code = trim($code);
        if ($code === '') {
            return false;
        }

        $sql = 'SELECT vendor_id FROM vendors WHERE vendor_code = ?';
        $params = [$code];
        if ($excludeId !== null) {
            $sql .= ' AND vendor_id != ?';
            $params[] = $excludeId;
        }
        $sql .= ' LIMIT 1';

        return Database::fetch($sql, $params) !== null;
    }

    public static function duplicateHints(string $name, ?string $gstin, ?int $excludeId = null): array
    {
        $where = [];
        $params = [];
        if ($gstin) {
            $where[] = 'UPPER(gstin) = ?';
            $params[] = strtoupper($gstin);
        }
        if ($name !== '') {
            $where[] = 'LOWER(name) = ?';
            $params[] = strtolower($name);
        }
        if (empty($where)) {
            return [];
        }

        $sql = 'SELECT vendor_id, vendor_code, name, gstin FROM vendors WHERE (' . implode(' OR ', $where) . ')';
        if ($excludeId !== null) {
            $sql .= ' AND vendor_id != ?';
            $params[] = $excludeId;
        }
        $sql .= ' LIMIT 5';

        return Database::fetchAll($sql, $params);
    }

    public static function format(array $row): array
    {
        return [
            'vendor_id' => (int)$row['vendor_id'],
            'id' => (string)$row['vendor_id'],
            'vendor_code' => $row['vendor_code'],
            'name' => $row['name'],
            'gstin' => $row['gstin'],
            'contact_name' => $row['contact_name'],
            'phone' => $row['phone'],
            'email' => $row['email'],
            'address' => $row['address'],
            'city' => $row['city'],
            'state' => $row['state'],
            'pincode' => $row['pincode'],
            'payment_terms' => $row['payment_terms'],
            'notes' => $row['notes'] ?? null,
            // Extended (Zoho-style) fields
            'salutation'          => $row['salutation'] ?? null,
            'first_name'          => $row['first_name'] ?? null,
            'last_name'           => $row['last_name'] ?? null,
            'company_name'        => $row['company_name'] ?? null,
            'mobile'              => $row['mobile'] ?? null,
            'pan'                 => $row['pan'] ?? null,
            'msme_registered'     => isset($row['msme_registered']) ? (bool)$row['msme_registered'] : false,
            'opening_balance'     => isset($row['opening_balance']) ? (float)$row['opening_balance'] : 0,
            'billing_attention'   => $row['billing_attention'] ?? null,
            'billing_country'     => $row['billing_country'] ?? null,
            'billing_street2'     => $row['billing_street2'] ?? null,
            'billing_phone'       => $row['billing_phone'] ?? null,
            'billing_fax'         => $row['billing_fax'] ?? null,
            'shipping_attention'  => $row['shipping_attention'] ?? null,
            'shipping_country'    => $row['shipping_country'] ?? null,
            'shipping_street1'    => $row['shipping_street1'] ?? null,
            'shipping_street2'    => $row['shipping_street2'] ?? null,
            'shipping_city'       => $row['shipping_city'] ?? null,
            'shipping_state'      => $row['shipping_state'] ?? null,
            'shipping_pincode'    => $row['shipping_pincode'] ?? null,
            'shipping_phone'      => $row['shipping_phone'] ?? null,
            'shipping_fax'        => $row['shipping_fax'] ?? null,
            'bank_account_holder' => $row['bank_account_holder'] ?? null,
            'bank_name'           => $row['bank_name'] ?? null,
            'bank_account_number' => $row['bank_account_number'] ?? null,
            'bank_ifsc'           => $row['bank_ifsc'] ?? null,
            'is_active' => (bool)$row['is_active'],
            'created_at' => $row['created_at'] ?? null,
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }
}
