<?php
declare(strict_types=1);

class StatisticsController
{
    // ─── GET /statistics/orders ──────────────────────────────────────────────

    public function orders(Request $request): void
    {
        $stats = Database::fetch(
            "SELECT
                COUNT(*)                                              AS total_orders,
                SUM(total_amount)                                     AS total_revenue,
                AVG(total_amount)                                     AS avg_order_value,
                SUM(CASE WHEN order_status = 'pending'    THEN 1 ELSE 0 END) AS pending_count,
                SUM(CASE WHEN order_status = 'confirmed'  THEN 1 ELSE 0 END) AS confirmed_count,
                SUM(CASE WHEN order_status = 'processing' THEN 1 ELSE 0 END) AS processing_count,
                SUM(CASE WHEN order_status = 'shipped'    THEN 1 ELSE 0 END) AS shipped_count,
                SUM(CASE WHEN order_status = 'delivered'  THEN 1 ELSE 0 END) AS delivered_count,
                SUM(CASE WHEN order_status = 'cancelled'  THEN 1 ELSE 0 END) AS cancelled_count,
                SUM(CASE WHEN payment_status = 'paid'     THEN 1 ELSE 0 END) AS paid_count,
                SUM(CASE WHEN payment_status = 'pending'  THEN 1 ELSE 0 END) AS payment_pending_count,
                SUM(CASE WHEN DATE(created_at) = CURDATE() THEN 1 ELSE 0 END) AS today_orders,
                SUM(CASE WHEN WEEK(created_at)  = WEEK(NOW())  AND YEAR(created_at)  = YEAR(NOW())  THEN 1 ELSE 0 END) AS week_orders,
                SUM(CASE WHEN MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at)  = YEAR(NOW())  THEN 1 ELSE 0 END) AS month_orders
             FROM orders"
        );

        // Daily breakdown — last 30 days
        $daily = Database::fetchAll(
            "SELECT DATE(created_at) AS order_date,
                    COUNT(*)         AS order_count,
                    SUM(total_amount) AS revenue
             FROM orders
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY DATE(created_at)
             ORDER BY order_date DESC"
        );

        // Top products by order volume
        $topProducts = Database::fetchAll(
            "SELECT p.product_id, p.product_name, p.product_type,
                    SUM(oi.quantity)    AS total_quantity,
                    COUNT(oi.item_id)   AS times_ordered,
                    SUM(oi.total_price) AS total_revenue
             FROM order_items oi
             JOIN products p ON oi.product_id = p.product_id
             GROUP BY p.product_id
             ORDER BY total_quantity DESC
             LIMIT 5"
        );

        foreach ($daily as &$d) {
            $d['revenue']     = (float)$d['revenue'];
            $d['order_count'] = (int)$d['order_count'];
        }
        foreach ($topProducts as &$tp) {
            $tp['total_quantity'] = (int)$tp['total_quantity'];
            $tp['times_ordered']  = (int)$tp['times_ordered'];
            $tp['total_revenue']  = (float)$tp['total_revenue'];
        }

        // Cast numerics in summary
        $stats['total_orders']          = (int)($stats['total_orders'] ?? 0);
        $stats['total_revenue']         = (float)($stats['total_revenue'] ?? 0);
        $stats['avg_order_value']       = round((float)($stats['avg_order_value'] ?? 0), 2);
        foreach (['pending_count','confirmed_count','processing_count','shipped_count',
                  'delivered_count','cancelled_count','paid_count','payment_pending_count',
                  'today_orders','week_orders','month_orders'] as $k) {
            $stats[$k] = (int)($stats[$k] ?? 0);
        }

        Response::success([
            'summary'      => $stats,
            'daily'        => $daily,
            'top_products' => $topProducts,
        ]);
    }

    // ─── GET /statistics/overview ────────────────────────────────────────────

    public function overview(Request $request): void
    {
        $orders = Database::fetch(
            "SELECT COUNT(*) AS total_orders,
                    SUM(total_amount) AS total_revenue,
                    SUM(CASE WHEN order_status = 'pending'   THEN 1 ELSE 0 END) AS pending_orders,
                    SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled_orders
             FROM orders"
        );

        // Revenue from paid manual invoices (no linked order, so order revenue isn't double-counted)
        $invoiceRevenue = (float)(Database::fetch(
            "SELECT COALESCE(SUM(total), 0) AS v
             FROM invoices WHERE payment_status = 'paid' AND order_id IS NULL"
        )['v'] ?? 0);

        $users = Database::fetch(
            "SELECT COUNT(*) AS total,
                    SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END) AS active
             FROM users
             WHERE user_type != 'admin'"
        );

        $products  = Database::fetch('SELECT COUNT(*) AS total FROM products WHERE is_available = 1');
        $employees = Database::fetch('SELECT COUNT(*) AS total FROM employees WHERE is_active = 1');

        $tasks = Database::fetch(
            "SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status = 'Pending'     THEN 1 ELSE 0 END) AS pending,
                    SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
                    SUM(CASE WHEN status = 'Completed'   THEN 1 ELSE 0 END) AS completed,
                    SUM(CASE WHEN due_date < CURDATE() AND status != 'Completed' THEN 1 ELSE 0 END) AS overdue
             FROM tasks"
        );

        Response::success([
            'orders' => [
                'total'     => (int)($orders['total_orders']      ?? 0),
                'revenue'   => (float)($orders['total_revenue']   ?? 0) + $invoiceRevenue,
                'pending'   => (int)($orders['pending_orders']    ?? 0),
                'cancelled' => (int)($orders['cancelled_orders']  ?? 0),
            ],
            'users'     => [
                'total'  => (int)($users['total']  ?? 0),
                'active' => (int)($users['active'] ?? 0),
            ],
            'products'  => (int)($products['total']  ?? 0),
            'employees' => (int)($employees['total'] ?? 0),
            'tasks'     => [
                'total'      => (int)($tasks['total']       ?? 0),
                'pending'    => (int)($tasks['pending']     ?? 0),
                'inProgress' => (int)($tasks['in_progress'] ?? 0),
                'completed'  => (int)($tasks['completed']   ?? 0),
                'overdue'    => (int)($tasks['overdue']     ?? 0),
            ],
        ]);
    }

    // ─── GET /statistics/employees ────────────────────────────────────────────

    public function employees(Request $request): void
    {
        $total = Database::fetch('SELECT COUNT(*) AS total FROM employees WHERE is_active = 1');

        $todayPresent = Database::fetch(
            "SELECT COUNT(*) AS present
             FROM attendance
             WHERE date = CURDATE() AND status IN ('Present', 'Half-day')"
        );

        $byDept = Database::fetchAll(
            "SELECT department, COUNT(*) AS count
             FROM employees
             WHERE is_active = 1
             GROUP BY department
             ORDER BY count DESC"
        );

        foreach ($byDept as &$row) {
            $row['count'] = (int)$row['count'];
        }

        Response::success([
            'total'        => (int)($total['total']             ?? 0),
            'presentToday' => (int)($todayPresent['present']    ?? 0),
            'byDepartment' => $byDept,
        ]);
    }

    // ─── GET /statistics/tasks ────────────────────────────────────────────────

    public function tasks(Request $request): void
    {
        $stats = Database::fetch(
            "SELECT COUNT(*) AS total,
                    SUM(CASE WHEN status = 'Pending'     THEN 1 ELSE 0 END) AS pending,
                    SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) AS in_progress,
                    SUM(CASE WHEN status = 'Completed'   THEN 1 ELSE 0 END) AS completed,
                    SUM(CASE WHEN due_date < CURDATE() AND status != 'Completed' THEN 1 ELSE 0 END) AS overdue
             FROM tasks"
        );

        foreach ($stats as &$v) {
            $v = (int)$v;
        }

        Response::success($stats);
    }

    // ─── GET /statistics/sales ────────────────────────────────────────────────

    public function sales(Request $request): void
    {
        // 30-day daily breakdown (units sold)
        $daily = Database::fetchAll(
            "SELECT DATE(o.created_at)  AS sale_date,
                    COUNT(oi.item_id)   AS items_sold,
                    SUM(oi.quantity)    AS units_sold,
                    SUM(oi.total_price) AS total_sales
               FROM orders o
               JOIN order_items oi ON o.order_id = oi.order_id
              WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
                AND o.order_status NOT IN ('cancelled')
              GROUP BY DATE(o.created_at)
              ORDER BY sale_date DESC"
        );

        foreach ($daily as &$d) {
            $d['items_sold']  = (int)$d['items_sold'];
            $d['units_sold']  = (int)$d['units_sold'];
            $d['total_sales'] = (float)$d['total_sales'];
        }

        // Monthly rollup — last 12 months
        $monthly = Database::fetchAll(
            "SELECT DATE_FORMAT(o.created_at, '%Y-%m') AS month,
                    COUNT(o.order_id)                  AS orders,
                    SUM(o.total_amount)                AS total_sales
               FROM orders o
              WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
                AND o.order_status NOT IN ('cancelled')
              GROUP BY DATE_FORMAT(o.created_at, '%Y-%m')
              ORDER BY month DESC"
        );

        foreach ($monthly as &$m) {
            $m['orders']      = (int)$m['orders'];
            $m['total_sales'] = (float)$m['total_sales'];
        }

        $summary = Database::fetch(
            "SELECT COUNT(*)                 AS total_orders,
                    SUM(total_amount)        AS total_sales,
                    AVG(total_amount)        AS avg_order_value
               FROM orders
              WHERE order_status NOT IN ('cancelled')"
        );

        Response::success([
            'summary' => [
                'totalOrders'   => (int)($summary['total_orders']    ?? 0),
                'totalSales'    => (float)($summary['total_sales']    ?? 0),
                'avgOrderValue' => round((float)($summary['avg_order_value'] ?? 0), 2),
            ],
            'daily'   => $daily,
            'monthly' => $monthly,
        ]);
    }

    // ─── GET /statistics/revenue ──────────────────────────────────────────────

    public function revenue(Request $request): void
    {
        $summary = Database::fetch(
            "SELECT SUM(total_amount) AS lifetime,
                    SUM(CASE WHEN DATE(created_at) = CURDATE() THEN total_amount ELSE 0 END) AS today,
                    SUM(CASE WHEN WEEK(created_at) = WEEK(NOW()) AND YEAR(created_at) = YEAR(NOW()) THEN total_amount ELSE 0 END) AS this_week,
                    SUM(CASE WHEN MONTH(created_at) = MONTH(NOW()) AND YEAR(created_at) = YEAR(NOW()) THEN total_amount ELSE 0 END) AS this_month,
                    SUM(CASE WHEN YEAR(created_at) = YEAR(NOW()) THEN total_amount ELSE 0 END) AS this_year
               FROM orders
              WHERE order_status NOT IN ('cancelled')"
        );

        $monthly = Database::fetchAll(
            "SELECT DATE_FORMAT(created_at, '%Y-%m') AS month,
                    SUM(total_amount)                AS revenue,
                    COUNT(*)                         AS orders
               FROM orders
              WHERE created_at >= DATE_SUB(NOW(), INTERVAL 12 MONTH)
                AND order_status NOT IN ('cancelled')
              GROUP BY DATE_FORMAT(created_at, '%Y-%m')
              ORDER BY month DESC"
        );

        $paymentMix = Database::fetchAll(
            "SELECT payment_status,
                    COUNT(*)          AS orders,
                    SUM(total_amount) AS amount
               FROM orders
              GROUP BY payment_status"
        );

        foreach ($monthly as &$m) {
            $m['revenue'] = (float)$m['revenue'];
            $m['orders']  = (int)$m['orders'];
        }
        foreach ($paymentMix as &$p) {
            $p['orders'] = (int)$p['orders'];
            $p['amount'] = (float)$p['amount'];
        }

        Response::success([
            'summary' => [
                'lifetime'  => (float)($summary['lifetime']   ?? 0),
                'today'     => (float)($summary['today']      ?? 0),
                'thisWeek'  => (float)($summary['this_week']  ?? 0),
                'thisMonth' => (float)($summary['this_month'] ?? 0),
                'thisYear'  => (float)($summary['this_year']  ?? 0),
            ],
            'monthly'    => $monthly,
            'paymentMix' => $paymentMix,
        ]);
    }

    // ─── GET /statistics/customers ────────────────────────────────────────────

    public function customers(Request $request): void
    {
        $summary = Database::fetch(
            "SELECT COUNT(*)                                              AS total,
                    SUM(CASE WHEN is_active = 1 THEN 1 ELSE 0 END)        AS active,
                    SUM(CASE WHEN user_type = 'customer' THEN 1 ELSE 0 END) AS customers,
                    SUM(CASE WHEN user_type = 'dealer'   THEN 1 ELSE 0 END) AS dealers,
                    SUM(CASE WHEN DATE(created_at) = CURDATE()               THEN 1 ELSE 0 END) AS new_today,
                    SUM(CASE WHEN MONTH(created_at) = MONTH(NOW())
                              AND YEAR(created_at) = YEAR(NOW())               THEN 1 ELSE 0 END) AS new_this_month
               FROM users
              WHERE user_type != 'admin'"
        );

        // Top customers by order value
        $topCustomers = Database::fetchAll(
            "SELECT u.user_id, u.name, u.email, u.phone, u.user_type,
                    COUNT(o.order_id)   AS total_orders,
                    SUM(o.total_amount) AS lifetime_value
               FROM users u
               JOIN orders o ON o.user_id = u.user_id
              WHERE o.order_status NOT IN ('cancelled')
              GROUP BY u.user_id
              ORDER BY lifetime_value DESC
              LIMIT 10"
        );

        foreach ($topCustomers as &$c) {
            $c['user_id']        = (int)$c['user_id'];
            $c['total_orders']   = (int)$c['total_orders'];
            $c['lifetime_value'] = (float)$c['lifetime_value'];
        }

        Response::success([
            'summary' => [
                'total'        => (int)($summary['total']          ?? 0),
                'active'       => (int)($summary['active']         ?? 0),
                'customers'    => (int)($summary['customers']      ?? 0),
                'dealers'      => (int)($summary['dealers']        ?? 0),
                'newToday'     => (int)($summary['new_today']      ?? 0),
                'newThisMonth' => (int)($summary['new_this_month'] ?? 0),
            ],
            'topCustomers' => $topCustomers,
        ]);
    }

    // ─── GET /statistics/active-orders ───────────────────────────────────────

    public function activeOrders(Request $request): void
    {
        $rows = Database::fetchAll(
            "SELECT o.order_id, o.order_number, o.order_status, o.payment_status,
                    o.total_amount, o.created_at,
                    u.name AS customer_name, u.email, u.phone,
                    COUNT(oi.item_id) AS total_items
             FROM orders o
             JOIN users u ON o.user_id = u.user_id
             LEFT JOIN order_items oi ON o.order_id = oi.order_id
             WHERE o.order_status NOT IN ('delivered', 'cancelled')
             GROUP BY o.order_id
             ORDER BY o.created_at DESC"
        );

        foreach ($rows as &$r) {
            $r['total_amount'] = (float)$r['total_amount'];
            $r['total_items']  = (int)$r['total_items'];
        }

        $summary = Database::fetch(
            "SELECT
                COUNT(*) AS total_active,
                SUM(CASE WHEN order_status = 'pending'    THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN order_status = 'confirmed'  THEN 1 ELSE 0 END) AS confirmed,
                SUM(CASE WHEN order_status = 'processing' THEN 1 ELSE 0 END) AS processing,
                SUM(CASE WHEN order_status = 'shipped'    THEN 1 ELSE 0 END) AS shipped
             FROM orders
             WHERE order_status NOT IN ('delivered', 'cancelled')"
        );

        foreach ($summary as &$v) {
            $v = (int)$v;
        }

        Response::success([
            'summary' => $summary,
            'orders'  => $rows,
        ]);
    }
}
