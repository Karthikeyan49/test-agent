<?php
declare(strict_types=1);

class PurchaseOrder
{
    public const STATUSES = ['draft', 'issued', 'partially_received', 'received', 'billed', 'paid', 'cancelled', 'short_closed'];

    public static function all(array $filters, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['status']) && in_array($filters['status'], self::STATUSES, true)) {
            $where[] = 'po.status = ?';
            $params[] = $filters['status'];
        }
        if (!empty($filters['vendor_id'])) {
            $where[] = 'po.vendor_id = ?';
            $params[] = (int)$filters['vendor_id'];
        }
        if (!empty($filters['from'])) {
            $where[] = 'po.order_date >= ?';
            $params[] = $filters['from'];
        }
        if (!empty($filters['to'])) {
            $where[] = 'po.order_date <= ?';
            $params[] = $filters['to'];
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM purchase_orders po WHERE $whereClause", $params);
        $rows = Database::fetchAll(
            "SELECT po.*, v.name AS vendor_name, v.vendor_code
             FROM purchase_orders po
             JOIN vendors v ON v.vendor_id = po.vendor_id
             WHERE $whereClause
             ORDER BY po.created_at DESC, po.po_id DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        return [
            'rows' => array_map([self::class, 'formatSummary'], $rows),
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
        $row = Database::fetch(
            "SELECT po.*, v.name AS vendor_name, v.vendor_code
             FROM purchase_orders po
             JOIN vendors v ON v.vendor_id = po.vendor_id
             WHERE po.po_id = ?
             LIMIT 1",
            [$id]
        );
        if (!$row) {
            return null;
        }

        $row['items'] = self::items($id);
        $row['receipts'] = self::receipts($id);

        return self::formatDetail($row);
    }

    public static function create(array $data, array $items): int
    {
        $totals = self::totals($items, (float)$data['other_charges']);
        $id = Database::insert(
            'INSERT INTO purchase_orders
                (po_number, reference_number, vendor_id, pr_id, order_date, expected_date, shipment_preference,
                 deliver_to_type, deliver_to_name, deliver_to_address, payment_terms, seller_state, vendor_state,
                 vendor_gstin, gst_treatment, reverse_charge, subtotal, tax_amount, other_charges, total,
                 status, payment_status, notes, terms_conditions, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "draft", "unpaid", ?, ?, ?, NOW())',
            [
                $data['po_number'],
                $data['reference_number'] ?: null,
                $data['vendor_id'],
                $data['pr_id'] ?: null,
                $data['order_date'],
                $data['expected_date'] ?: null,
                $data['shipment_preference'] ?: null,
                $data['deliver_to_type'] ?: null,
                $data['deliver_to_name'] ?: null,
                $data['deliver_to_address'] ?: null,
                $data['payment_terms'] ?: null,
                $data['seller_state'] ?: null,
                $data['vendor_state'] ?: null,
                $data['vendor_gstin'] ?: null,
                $data['gst_treatment'] ?: null,
                (int)($data['reverse_charge'] ?? 0),
                $totals['subtotal'],
                $totals['tax_amount'],
                $totals['other_charges'],
                $totals['total'],
                $data['notes'] ?: null,
                $data['terms_conditions'] ?: null,
                $data['created_by'] ?? null,
            ]
        );

        self::replaceItems($id, $items);
        return $id;
    }

    public static function updateDraft(int $id, array $data, ?array $items): void
    {
        if ($items !== null) {
            self::replaceItems($id, $items);
        }
        if ($items !== null || array_key_exists('other_charges', $data)) {
            $currentItems = self::itemsRaw($id);
            $totals = self::totals($currentItems, (float)($data['other_charges'] ?? self::raw($id)['other_charges']));
            $data['subtotal'] = $totals['subtotal'];
            $data['tax_amount'] = $totals['tax_amount'];
            $data['other_charges'] = $totals['other_charges'];
            $data['total'] = $totals['total'];
        }

        $fields = [];
        $params = [];
        foreach ([
            'po_number', 'reference_number', 'vendor_id', 'pr_id', 'order_date', 'expected_date',
            'shipment_preference', 'deliver_to_type', 'deliver_to_name', 'deliver_to_address',
            'payment_terms', 'seller_state', 'vendor_state', 'vendor_gstin', 'gst_treatment',
            'reverse_charge', 'subtotal', 'tax_amount', 'other_charges', 'total', 'notes', 'terms_conditions',
        ] as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $fields[] = "$field = ?";
            $params[] = in_array($field, [
                'pr_id', 'reference_number', 'expected_date', 'shipment_preference', 'deliver_to_type',
                'deliver_to_name', 'deliver_to_address', 'payment_terms', 'seller_state', 'vendor_state',
                'vendor_gstin', 'gst_treatment', 'notes', 'terms_conditions',
            ], true) && $data[$field] === ''
                ? null
                : $data[$field];
        }

        if (!empty($fields)) {
            $params[] = $id;
            Database::execute(
                'UPDATE purchase_orders SET ' . implode(', ', $fields) . ', updated_at = NOW() WHERE po_id = ?',
                $params
            );
        }
    }

    public static function transition(int $id, string $status): void
    {
        Database::execute('UPDATE purchase_orders SET status = ?, updated_at = NOW() WHERE po_id = ?', [$status, $id]);
    }

    public static function createReceipt(int $poId, array $data, array $lines): int
    {
        $grnId = Database::insert(
            'INSERT INTO goods_receipts
                (grn_number, po_id, received_on, received_by, status, notes, created_at)
             VALUES (?, ?, ?, ?, "posted", ?, NOW())',
            [
                $data['grn_number'],
                $poId,
                $data['received_on'],
                $data['received_by'] ?? null,
                $data['notes'] ?: null,
            ]
        );

        foreach ($lines as $line) {
            // Lock the PO line and re-verify outstanding inside the transaction so two
            // concurrent receipts on the same line can't both pass the pre-check and over-receive.
            $current = Database::fetch(
                'SELECT quantity, received_qty, description, unit FROM purchase_order_items WHERE item_id = ? AND po_id = ? FOR UPDATE',
                [$line['po_item_id'], $poId]
            );
            if (!$current) {
                Response::error('Receipt item does not belong to this PO', 422);
            }
            $outstanding = (float)$current['quantity'] - (float)$current['received_qty'];
            if ($line['quantity'] > $outstanding + 0.0005) {
                Response::error('Receipt quantity exceeds outstanding (' . $outstanding . ') for a PO line', 409);
            }

            Database::execute(
                'INSERT INTO goods_receipt_items (grn_id, po_item_id, quantity, unit_cost)
                 VALUES (?, ?, ?, ?)',
                [$grnId, $line['po_item_id'], $line['quantity'], $line['unit_cost']]
            );
            Database::execute(
                'UPDATE purchase_order_items
                 SET received_qty = received_qty + ?
                 WHERE item_id = ?',
                [$line['quantity'], $line['po_item_id']]
            );

            // Push the received goods into the right stock home, routed by the catalog
            // item type (matched by name). Same transaction, so stock and the receipt
            // commit together or not at all.
            $itemName = (string)($current['description'] ?? '');
            Inventory::receiveIn(
                $itemName,
                Inventory::itemTypeByName($itemName),
                (float)$line['quantity'],
                $current['unit'] ?? null,
                (string)($data['grn_number'] ?? 'GRN'),
                (string)($data['received_on'] ?? date('Y-m-d')),
                $data['received_by'] ?? null
            );
        }

        self::refreshReceiptStatus($poId);
        return $grnId;
    }

    public static function voidReceipt(int $grnId, int $actorId, string $reason): void
    {
        $receipt = self::receipt($grnId);
        if (!$receipt) {
            Response::error('Goods receipt not found', 404);
        }
        if ($receipt['status'] !== 'posted') {
            Response::error('Goods receipt is already voided', 409);
        }

        $items = Database::fetchAll(
            "SELECT gri.*, poi.product_id, poi.unit_price, poi.description, poi.unit
             FROM goods_receipt_items gri
             JOIN purchase_order_items poi ON poi.item_id = gri.po_item_id
             WHERE gri.grn_id = ?",
            [$grnId]
        );

        foreach ($items as $item) {
            Database::execute(
                'UPDATE purchase_order_items
                 SET received_qty = GREATEST(0, received_qty - ?)
                 WHERE item_id = ?',
                [(float)$item['quantity'], (int)$item['po_item_id']]
            );

            // Reverse the stock this line added on receipt, so voiding restores the true count.
            $itemName = (string)($item['description'] ?? '');
            Inventory::receiveReverse(
                $itemName,
                Inventory::itemTypeByName($itemName),
                (float)$item['quantity'],
                'VOID ' . (string)($receipt['grn_number'] ?? 'GRN'),
                date('Y-m-d'),
                $actorId
            );
        }

        Database::execute(
            'UPDATE goods_receipts
             SET status = "void", voided_by = ?, voided_at = NOW(), void_reason = ?
             WHERE grn_id = ?',
            [$actorId, $reason, $grnId]
        );
        self::refreshReceiptStatus((int)$receipt['po_id']);
    }

    public static function raw(int $id): ?array
    {
        return Database::fetch('SELECT * FROM purchase_orders WHERE po_id = ? LIMIT 1', [$id]);
    }

    public static function itemsRaw(int $id): array
    {
        return Database::fetchAll('SELECT * FROM purchase_order_items WHERE po_id = ? ORDER BY sort_order ASC, item_id ASC', [$id]);
    }

    public static function items(int $id): array
    {
        return Database::fetchAll(
            'SELECT poi.*, p.product_name
             FROM purchase_order_items poi
             LEFT JOIN products p ON p.product_id = poi.product_id
             WHERE poi.po_id = ?
             ORDER BY poi.sort_order ASC, poi.item_id ASC',
            [$id]
        );
    }

    public static function receipt(int $grnId): ?array
    {
        return Database::fetch('SELECT * FROM goods_receipts WHERE grn_id = ? LIMIT 1', [$grnId]);
    }

    public static function receipts(int $poId): array
    {
        $rows = Database::fetchAll(
            'SELECT gr.*, u.name AS received_by_name
             FROM goods_receipts gr
             LEFT JOIN users u ON u.user_id = gr.received_by
             WHERE gr.po_id = ?
             ORDER BY gr.created_at DESC, gr.grn_id DESC',
            [$poId]
        );

        foreach ($rows as &$row) {
            $row['items'] = Database::fetchAll(
                'SELECT gri.*, poi.description, poi.product_id
                 FROM goods_receipt_items gri
                 JOIN purchase_order_items poi ON poi.item_id = gri.po_item_id
                 WHERE gri.grn_id = ?',
                [(int)$row['grn_id']]
            );
        }

        return $rows;
    }

    public static function receiptList(array $filters, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['1=1'];
        $params = [];
        if (!empty($filters['po_id'])) {
            $where[] = 'gr.po_id = ?';
            $params[] = (int)$filters['po_id'];
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM goods_receipts gr WHERE $whereClause", $params);
        $rows = Database::fetchAll(
            "SELECT gr.*, po.po_number, v.name AS vendor_name
             FROM goods_receipts gr
             JOIN purchase_orders po ON po.po_id = gr.po_id
             JOIN vendors v ON v.vendor_id = po.vendor_id
             WHERE $whereClause
             ORDER BY gr.created_at DESC, gr.grn_id DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        return [
            'rows' => array_map([self::class, 'formatReceiptSummary'], $rows),
            'pagination' => [
                'page' => $page,
                'limit' => $limit,
                'total' => $total,
                'total_pages' => (int)ceil($total / $limit),
            ],
        ];
    }

    public static function refreshReceiptStatus(int $poId): void
    {
        $row = Database::fetch(
            'SELECT COUNT(*) AS cnt,
                    SUM(CASE WHEN received_qty > 0 THEN 1 ELSE 0 END) AS received_lines,
                    SUM(CASE WHEN received_qty + 0.0005 >= quantity THEN 1 ELSE 0 END) AS complete_lines
             FROM purchase_order_items
             WHERE po_id = ?',
            [$poId]
        );
        $count = (int)($row['cnt'] ?? 0);
        $receivedLines = (int)($row['received_lines'] ?? 0);
        $completeLines = (int)($row['complete_lines'] ?? 0);
        $status = $receivedLines === 0 ? 'issued' : ($count > 0 && $completeLines === $count ? 'received' : 'partially_received');

        Database::execute('UPDATE purchase_orders SET status = ?, updated_at = NOW() WHERE po_id = ?', [$status, $poId]);
    }

    public static function totals(array $items, float $otherCharges): array
    {
        $subtotal = 0.0;
        $tax = 0.0;
        foreach ($items as $item) {
            $lineTotal = round((float)$item['quantity'] * (float)$item['unit_price'], 2);
            $subtotal += $lineTotal;
            $tax += round($lineTotal * ((float)($item['gst_rate'] ?? 0) / 100), 2);
        }

        return [
            'subtotal' => round($subtotal, 2),
            'tax_amount' => round($tax, 2),
            'other_charges' => round($otherCharges, 2),
            'total' => round($subtotal + $tax + $otherCharges, 0),
        ];
    }

    public static function formatSummary(array $row): array
    {
        return [
            'po_id' => (int)$row['po_id'],
            'id' => (string)$row['po_id'],
            'po_number' => $row['po_number'],
            'reference_number' => $row['reference_number'] ?? null,
            'vendor_id' => (int)$row['vendor_id'],
            'vendor_name' => $row['vendor_name'] ?? null,
            'vendor_code' => $row['vendor_code'] ?? null,
            'pr_id' => $row['pr_id'] ? (int)$row['pr_id'] : null,
            'order_date' => $row['order_date'],
            'expected_date' => $row['expected_date'],
            'shipment_preference' => $row['shipment_preference'] ?? null,
            'deliver_to_type' => $row['deliver_to_type'] ?? null,
            'deliver_to_name' => $row['deliver_to_name'] ?? null,
            'deliver_to_address' => $row['deliver_to_address'] ?? null,
            'payment_terms' => $row['payment_terms'] ?? null,
            'seller_state' => $row['seller_state'],
            'vendor_state' => $row['vendor_state'],
            'vendor_gstin' => $row['vendor_gstin'] ?? null,
            'gst_treatment' => $row['gst_treatment'] ?? null,
            'reverse_charge' => (bool)($row['reverse_charge'] ?? false),
            'subtotal' => (float)$row['subtotal'],
            'tax_amount' => (float)$row['tax_amount'],
            'other_charges' => (float)$row['other_charges'],
            'total' => (float)$row['total'],
            'status' => $row['status'],
            'payment_status' => $row['payment_status'],
            'notes' => $row['notes'],
            'terms_conditions' => $row['terms_conditions'] ?? null,
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
            'billed_expense_id' => $row['billed_expense_id'] ? (int)$row['billed_expense_id'] : null,
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
    }

    public static function formatDetail(array $row): array
    {
        $formatted = self::formatSummary($row);
        $formatted['items'] = array_map([self::class, 'formatItem'], $row['items'] ?? []);
        $formatted['receipts'] = array_map([self::class, 'formatReceiptDetail'], $row['receipts'] ?? []);

        return $formatted;
    }

    public static function formatItem(array $row): array
    {
        return [
            'item_id' => (int)$row['item_id'],
            'id' => (string)$row['item_id'],
            'po_id' => (int)$row['po_id'],
            'description' => $row['description'],
            'product_id' => $row['product_id'] ? (int)$row['product_id'] : null,
            'product_name' => $row['product_name'] ?? null,
            'hsn_code' => $row['hsn_code'],
            'quantity' => (float)$row['quantity'],
            'received_qty' => (float)$row['received_qty'],
            'outstanding_qty' => max(0, (float)$row['quantity'] - (float)$row['received_qty']),
            'unit' => $row['unit'],
            'unit_price' => (float)$row['unit_price'],
            'gst_rate' => (float)$row['gst_rate'],
            'line_total' => (float)$row['line_total'],
            'sort_order' => (int)$row['sort_order'],
        ];
    }

    public static function formatReceiptSummary(array $row): array
    {
        return [
            'grn_id' => (int)$row['grn_id'],
            'id' => (string)$row['grn_id'],
            'grn_number' => $row['grn_number'],
            'po_id' => (int)$row['po_id'],
            'po_number' => $row['po_number'] ?? null,
            'vendor_name' => $row['vendor_name'] ?? null,
            'received_on' => $row['received_on'],
            'received_by' => $row['received_by'] ? (int)$row['received_by'] : null,
            'received_by_name' => $row['received_by_name'] ?? null,
            'status' => $row['status'],
            'notes' => $row['notes'],
            'voided_by' => $row['voided_by'] ? (int)$row['voided_by'] : null,
            'voided_at' => $row['voided_at'],
            'void_reason' => $row['void_reason'],
            'created_at' => $row['created_at'],
        ];
    }

    public static function formatReceiptDetail(array $row): array
    {
        $formatted = self::formatReceiptSummary($row);
        $formatted['items'] = array_map(function (array $item): array {
            return [
                'item_id' => (int)$item['item_id'],
                'grn_id' => (int)$item['grn_id'],
                'po_item_id' => (int)$item['po_item_id'],
                'description' => $item['description'] ?? null,
                'product_id' => $item['product_id'] ? (int)$item['product_id'] : null,
                'quantity' => (float)$item['quantity'],
                'unit_cost' => $item['unit_cost'] !== null ? (float)$item['unit_cost'] : null,
            ];
        }, $row['items'] ?? []);

        return $formatted;
    }

    private static function replaceItems(int $id, array $items): void
    {
        Database::execute('DELETE FROM purchase_order_items WHERE po_id = ?', [$id]);
        foreach ($items as $index => $item) {
            $lineTotal = round((float)$item['quantity'] * (float)$item['unit_price'], 2);
            Database::execute(
                'INSERT INTO purchase_order_items
                    (po_id, purchase_item_id, description, product_id, hsn_code, quantity, received_qty, unit, unit_price, gst_rate, line_total, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)',
                [
                    $id,
                    $item['purchase_item_id'] ?: null,
                    $item['description'],
                    $item['product_id'] ?: null,
                    $item['hsn_code'] ?: null,
                    $item['quantity'],
                    $item['unit'],
                    $item['unit_price'],
                    $item['gst_rate'],
                    $lineTotal,
                    $item['sort_order'] ?? $index,
                ]
            );
        }
    }
}
