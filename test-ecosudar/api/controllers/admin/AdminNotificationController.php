<?php
declare(strict_types=1);

class AdminNotificationController
{
    public function index(Request $request): void
    {
        $limit = 10;
        
        // 1. Get recent pending orders
        $orders = Database::fetchAll(
            'SELECT o.order_id, o.order_number, o.total_amount, o.created_at, u.name as customer_name 
             FROM orders o 
             JOIN users u ON o.user_id = u.user_id 
             WHERE o.order_status = "pending" 
             ORDER BY o.created_at DESC LIMIT ?',
            [$limit]
        );

        // 2. Get low stock alerts (assuming products have a stock field)
        // Let's check how products are structured. 
        // If there's no stock field, we will just use pending queries.
        $queries = Database::fetchAll(
            'SELECT q.query_id, substring(q.message, 1, 50) as subject, q.created_at, q.name 
             FROM queries q
             WHERE q.status = "pending" 
             ORDER BY q.created_at DESC LIMIT ?',
            [$limit]
        );

        $notifications = [];
        
        foreach ($orders as $o) {
            $notifications[] = [
                'id' => 'ord_' . $o['order_id'],
                'type' => 'order',
                'message' => 'New order ' . $o['order_number'] . ' received from ' . ($o['customer_name'] ?? 'Guest'),
                'time' => $o['created_at'],
                'read' => false
            ];
        }

        foreach ($queries as $q) {
            $notifications[] = [
                'id' => 'qry_' . $q['query_id'],
                'type' => 'query',
                'message' => 'New support query from ' . $q['name'] . ': ' . $q['subject'] . '...',
                'time' => $q['created_at'],
                'read' => false
            ];
        }

        // Sort by time DESC
        usort($notifications, function($a, $b) {
            return strtotime($b['time']) - strtotime($a['time']);
        });

        Response::success(array_slice($notifications, 0, $limit));
    }
}
