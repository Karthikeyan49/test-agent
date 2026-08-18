<?php
declare(strict_types=1);

class PurchaseRequest
{
    public const STATUSES = ['draft', 'submitted', 'approved', 'rejected', 'converted', 'closed'];
    public const PRIORITIES = ['low', 'normal', 'high', 'urgent'];

    public static function all(array $filters, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['status']) && in_array($filters['status'], self::STATUSES, true)) {
            $where[] = 'pr.status = ?';
            $params[] = $filters['status'];
        }
        if (!empty($filters['department'])) {
            $where[] = 'pr.department = ?';
            $params[] = $filters['department'];
        }
        if (!empty($filters['from'])) {
            $where[] = 'DATE(pr.created_at) >= ?';
            $params[] = $filters['from'];
        }
        if (!empty($filters['to'])) {
            $where[] = 'DATE(pr.created_at) <= ?';
            $params[] = $filters['to'];
        }
        if (!empty($filters['search'])) {
            $like = '%' . trim((string)$filters['search']) . '%';
            $where[] = '(pr.pr_number LIKE ? OR pr.department LIKE ? OR pr.notes LIKE ?)';
            array_push($params, $like, $like, $like);
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM purchase_requests pr WHERE $whereClause", $params);
        $rows = Database::fetchAll(
            "SELECT pr.*,
                    requester.name AS requested_by_name,
                    approver.name AS approved_by_name,
                    COUNT(pri.item_id) AS item_count,
                    COALESCE(SUM(pri.quantity * COALESCE(pri.est_unit_price, 0)), 0) AS estimated_total
             FROM purchase_requests pr
             LEFT JOIN users requester ON requester.user_id = pr.requested_by
             LEFT JOIN users approver ON approver.user_id = pr.approved_by
             LEFT JOIN purchase_request_items pri ON pri.pr_id = pr.pr_id
             WHERE $whereClause
             GROUP BY pr.pr_id
             ORDER BY pr.created_at DESC, pr.pr_id DESC
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
            "SELECT pr.*,
                    requester.name AS requested_by_name,
                    approver.name AS approved_by_name,
                    rejecter.name AS rejected_by_name
             FROM purchase_requests pr
             LEFT JOIN users requester ON requester.user_id = pr.requested_by
             LEFT JOIN users approver ON approver.user_id = pr.approved_by
             LEFT JOIN users rejecter ON rejecter.user_id = pr.rejected_by
             WHERE pr.pr_id = ?
             LIMIT 1",
            [$id]
        );

        if (!$row) {
            return null;
        }

        $row['items'] = self::items($id);
        return self::formatDetail($row);
    }

    public static function create(array $data, array $items): int
    {
        $id = Database::insert(
            'INSERT INTO purchase_requests
                (pr_number, requested_by, department, need_by_date, priority, status, notes, created_at)
             VALUES (?, ?, ?, ?, ?, "draft", ?, NOW())',
            [
                $data['pr_number'],
                $data['requested_by'],
                $data['department'] ?: null,
                $data['need_by_date'] ?: null,
                $data['priority'],
                $data['notes'] ?: null,
            ]
        );

        self::replaceItems($id, $items);
        return $id;
    }

    public static function updateDraft(int $id, array $data, ?array $items): void
    {
        $fields = [];
        $params = [];
        foreach (['department', 'need_by_date', 'priority', 'notes'] as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $fields[] = "$field = ?";
            $params[] = $data[$field] ?: null;
        }

        if (!empty($fields)) {
            $params[] = $id;
            Database::execute(
                'UPDATE purchase_requests SET ' . implode(', ', $fields) . ', updated_at = NOW() WHERE pr_id = ?',
                $params
            );
        }

        if ($items !== null) {
            self::replaceItems($id, $items);
        }
    }

    public static function transition(int $id, string $status, ?int $actorId = null, ?string $reason = null): void
    {
        if ($status === 'approved') {
            Database::execute(
                'UPDATE purchase_requests
                 SET status = "approved", approved_by = ?, approved_at = NOW(), rejected_by = NULL,
                     rejected_at = NULL, rejection_reason = NULL, updated_at = NOW()
                 WHERE pr_id = ?',
                [$actorId, $id]
            );
            return;
        }

        if ($status === 'rejected') {
            Database::execute(
                'UPDATE purchase_requests
                 SET status = "rejected", rejected_by = ?, rejected_at = NOW(), rejection_reason = ?,
                     approved_by = NULL, approved_at = NULL, updated_at = NOW()
                 WHERE pr_id = ?',
                [$actorId, $reason, $id]
            );
            return;
        }

        Database::execute(
            'UPDATE purchase_requests SET status = ?, updated_at = NOW() WHERE pr_id = ?',
            [$status, $id]
        );
    }

    public static function deleteDraft(int $id): void
    {
        Database::execute('DELETE FROM purchase_requests WHERE pr_id = ?', [$id]);
    }

    public static function items(int $id): array
    {
        return Database::fetchAll(
            'SELECT pri.*, p.product_name
             FROM purchase_request_items pri
             LEFT JOIN products p ON p.product_id = pri.product_id
             WHERE pri.pr_id = ?
             ORDER BY pri.sort_order ASC, pri.item_id ASC',
            [$id]
        );
    }

    private static function replaceItems(int $id, array $items): void
    {
        Database::execute('DELETE FROM purchase_request_items WHERE pr_id = ?', [$id]);
        foreach ($items as $index => $item) {
            Database::execute(
                'INSERT INTO purchase_request_items
                    (pr_id, description, product_id, quantity, unit, est_unit_price, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?)',
                [
                    $id,
                    $item['description'],
                    $item['product_id'] ?: null,
                    $item['quantity'],
                    $item['unit'],
                    $item['est_unit_price'],
                    $item['sort_order'] ?? $index,
                ]
            );
        }
    }

    private static function formatSummary(array $row): array
    {
        return [
            'pr_id' => (int)$row['pr_id'],
            'id' => (string)$row['pr_id'],
            'pr_number' => $row['pr_number'],
            'requested_by' => $row['requested_by'] ? (int)$row['requested_by'] : null,
            'requested_by_name' => $row['requested_by_name'] ?? null,
            'department' => $row['department'],
            'need_by_date' => $row['need_by_date'],
            'priority' => $row['priority'],
            'status' => $row['status'],
            'notes' => $row['notes'],
            'approved_by' => $row['approved_by'] ? (int)$row['approved_by'] : null,
            'approved_by_name' => $row['approved_by_name'] ?? null,
            'approved_at' => $row['approved_at'],
            'item_count' => (int)($row['item_count'] ?? 0),
            'estimated_total' => (float)($row['estimated_total'] ?? 0),
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
    }

    private static function formatDetail(array $row): array
    {
        $formatted = self::formatSummary($row + ['item_count' => count($row['items'] ?? []), 'estimated_total' => 0]);
        $formatted['rejected_by'] = $row['rejected_by'] ? (int)$row['rejected_by'] : null;
        $formatted['rejected_by_name'] = $row['rejected_by_name'] ?? null;
        $formatted['rejected_at'] = $row['rejected_at'];
        $formatted['rejection_reason'] = $row['rejection_reason'];
        $formatted['items'] = array_map([self::class, 'formatItem'], $row['items'] ?? []);
        $formatted['estimated_total'] = array_reduce(
            $formatted['items'],
            fn(float $sum, array $item): float => $sum + ($item['quantity'] * (float)($item['est_unit_price'] ?? 0)),
            0.0
        );

        return $formatted;
    }

    private static function formatItem(array $row): array
    {
        return [
            'item_id' => (int)$row['item_id'],
            'id' => (string)$row['item_id'],
            'pr_id' => (int)$row['pr_id'],
            'description' => $row['description'],
            'product_id' => $row['product_id'] ? (int)$row['product_id'] : null,
            'product_name' => $row['product_name'] ?? null,
            'quantity' => (float)$row['quantity'],
            'unit' => $row['unit'],
            'est_unit_price' => $row['est_unit_price'] !== null ? (float)$row['est_unit_price'] : null,
            'sort_order' => (int)$row['sort_order'],
        ];
    }
}
