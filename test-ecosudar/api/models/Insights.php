<?php
declare(strict_types=1);

class Insights
{
    /**
     * Get aggregated sales data for AI analysis
     */
    public static function getSalesData(): array
    {
        // Revenue trend (last 30 days) with growth rate
        $revenueTrend = Database::fetchAll(
            "SELECT DATE(created_at) as date, 
                    SUM(total_amount) as revenue, 
                    COUNT(*) as orders,
                    AVG(total_amount) as avg_order_value,
                    SUM(CASE WHEN order_status = 'delivered' THEN 1 ELSE 0 END) as delivered,
                    SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END) as cancelled,
                    SUM(CASE WHEN payment_status = 'paid' THEN total_amount ELSE 0 END) as paid_revenue
             FROM orders 
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY DATE(created_at)
             ORDER BY date DESC"
        );
        
        // Customer analysis
        $customerAnalysis = Database::fetchAll(
            "SELECT u.user_type, u.city, u.state,
                    COUNT(DISTINCT o.order_id) as total_orders,
                    SUM(o.total_amount) as total_spent,
                    AVG(o.total_amount) as avg_order_value,
                    MAX(o.created_at) as last_order_date,
                    DATEDIFF(NOW(), MAX(o.created_at)) as days_since_last_order
             FROM users u
             JOIN orders o ON u.user_id = o.user_id
             WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
             GROUP BY u.user_id, u.user_type, u.city, u.state
             ORDER BY total_spent DESC
             LIMIT 20"
        );
        
        // Overdue invoices with customer details
        $overdueInvoices = Database::fetchAll(
            "SELECT i.invoice_number, i.customer_name, i.total as amount, 
                    i.due_date, i.customer_state,
                    DATEDIFF(NOW(), i.due_date) as days_overdue,
                    o.order_number, o.payment_method
             FROM invoices i
             LEFT JOIN orders o ON i.order_id = o.order_id
             WHERE i.status <> 'Cancelled' AND i.payment_status <> 'paid' AND i.due_date < NOW()
             ORDER BY days_overdue DESC
             LIMIT 10"
        );
        
        // Top products with detailed metrics
        $topProducts = Database::fetchAll(
            "SELECT p.product_name as name, 
                    p.product_type,
                    p.base_price,
                    COUNT(DISTINCT oi.order_id) as order_count,
                    SUM(oi.quantity) as total_quantity,
                    SUM(oi.total_price) as revenue,
                    AVG(oi.unit_price) as avg_selling_price,
                    COUNT(DISTINCT o.user_id) as unique_customers
             FROM order_items oi
             JOIN products p ON oi.product_id = p.product_id
             JOIN orders o ON oi.order_id = o.order_id
             WHERE o.created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY p.product_id, p.product_name, p.product_type, p.base_price
             ORDER BY revenue DESC 
             LIMIT 10"
        );
        
        // Order status breakdown
        $orderStatusBreakdown = Database::fetchAll(
            "SELECT order_status, payment_status,
                    COUNT(*) as count,
                    SUM(total_amount) as total_value,
                    AVG(total_amount) as avg_value
             FROM orders
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY order_status, payment_status"
        );
        
        // Geographic distribution
        $geographicDistribution = Database::fetchAll(
            "SELECT delivery_state, delivery_city,
                    COUNT(*) as orders,
                    SUM(total_amount) as revenue,
                    AVG(delivery_fee) as avg_delivery_fee
             FROM orders
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
               AND delivery_state IS NOT NULL
             GROUP BY delivery_state, delivery_city
             ORDER BY revenue DESC
             LIMIT 15"
        );
        
        // Summary metrics with comparisons
        $summary = Database::fetch(
            "SELECT 
                COUNT(*) as total_orders,
                SUM(total_amount) as total_revenue,
                AVG(total_amount) as avg_order_value,
                SUM(CASE WHEN order_status = 'delivered' THEN 1 ELSE 0 END) as completed_orders,
                SUM(CASE WHEN order_status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_orders,
                SUM(CASE WHEN payment_status = 'paid' THEN 1 ELSE 0 END) as paid_orders,
                COUNT(DISTINCT user_id) as unique_customers,
                SUM(delivery_fee) as total_delivery_fees
             FROM orders 
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
        );
        
        // Previous month comparison
        $previousMonth = Database::fetch(
            "SELECT 
                COUNT(*) as total_orders,
                SUM(total_amount) as total_revenue
             FROM orders 
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 60 DAY)
               AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY)"
        );
        
        return [
            'revenue_trend' => $revenueTrend,
            'customer_analysis' => $customerAnalysis,
            'overdue_invoices' => $overdueInvoices,
            'top_products' => $topProducts,
            'order_status_breakdown' => $orderStatusBreakdown,
            'geographic_distribution' => $geographicDistribution,
            'summary' => $summary,
            'previous_month' => $previousMonth,
        ];
    }
    
    /**
     * Get aggregated expenses data for AI analysis
     */
    public static function getExpensesData(): array
    {
        // Expenses by category with trends
        $byCategory = Database::fetchAll(
            "SELECT category, 
                    SUM(amount) as total, 
                    COUNT(*) as count,
                    AVG(amount) as avg_amount,
                    MIN(amount) as min_amount,
                    MAX(amount) as max_amount,
                    MIN(expense_date) as first_expense,
                    MAX(expense_date) as last_expense
             FROM expenses 
             WHERE expense_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY category 
             ORDER BY total DESC"
        );
        
        // Vendor analysis with payment modes
        $byVendor = Database::fetchAll(
            "SELECT vendor, 
                    SUM(amount) as total, 
                    COUNT(*) as transactions,
                    AVG(amount) as avg_transaction,
                    GROUP_CONCAT(DISTINCT payment_mode) as payment_modes,
                    GROUP_CONCAT(DISTINCT category) as categories
             FROM expenses 
             WHERE expense_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY vendor 
             ORDER BY total DESC 
             LIMIT 10"
        );
        
        // Daily expense trend
        $dailyTrend = Database::fetchAll(
            "SELECT DATE(expense_date) as date,
                    SUM(amount) as total,
                    COUNT(*) as transactions,
                    AVG(amount) as avg_amount
             FROM expenses
             WHERE expense_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY DATE(expense_date)
             ORDER BY date DESC"
        );
        
        // Payment mode distribution
        $paymentModes = Database::fetchAll(
            "SELECT payment_mode,
                    COUNT(*) as count,
                    SUM(amount) as total,
                    AVG(amount) as avg_amount
             FROM expenses
             WHERE expense_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY payment_mode
             ORDER BY total DESC"
        );
        
        // Month-over-month comparison
        $momComparison = Database::fetch(
            "SELECT 
                SUM(CASE WHEN expense_date >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN amount ELSE 0 END) as current_month,
                SUM(CASE WHEN expense_date >= DATE_SUB(NOW(), INTERVAL 60 DAY) AND expense_date < DATE_SUB(NOW(), INTERVAL 30 DAY) THEN amount ELSE 0 END) as previous_month,
                COUNT(CASE WHEN expense_date >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as current_month_count,
                COUNT(CASE WHEN expense_date >= DATE_SUB(NOW(), INTERVAL 60 DAY) AND expense_date < DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) as previous_month_count
             FROM expenses"
        );
        
        // Summary
        $summary = Database::fetch(
            "SELECT 
                COUNT(*) as total_expenses,
                SUM(amount) as total_amount,
                AVG(amount) as avg_expense,
                MIN(amount) as min_expense,
                MAX(amount) as max_expense,
                COUNT(DISTINCT vendor) as unique_vendors,
                COUNT(DISTINCT category) as unique_categories
             FROM expenses 
             WHERE expense_date >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
        );
        
        return [
            'by_category' => $byCategory,
            'by_vendor' => $byVendor,
            'daily_trend' => $dailyTrend,
            'payment_modes' => $paymentModes,
            'mom_comparison' => $momComparison,
            'summary' => $summary,
        ];
    }
    
    /**
     * Get aggregated employee data for AI analysis
     */
    public static function getEmployeesData(): array
    {
        // Attendance rate by employee with salary info
        $attendanceByEmployee = Database::fetchAll(
            "SELECT e.name, e.department, e.designation, e.base_salary,
                    COUNT(CASE WHEN a.status = 'Present' THEN 1 END) as present_days,
                    COUNT(CASE WHEN a.status = 'Half-day' THEN 1 END) as half_days,
                    COUNT(CASE WHEN a.status = 'Absent' THEN 1 END) as absent_days,
                    COUNT(CASE WHEN a.status = 'Leave' THEN 1 END) as leave_days,
                    COUNT(*) as total_days,
                    (COUNT(CASE WHEN a.status = 'Present' THEN 1 END) * 100.0 / COUNT(*)) as attendance_rate,
                    AVG(a.hours_worked) as avg_hours_worked,
                    SUM(a.hours_worked) as total_hours_worked
             FROM employees e
             LEFT JOIN attendance a ON e.employee_key = a.employee_key
             WHERE a.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
               AND e.is_active = 1
             GROUP BY e.employee_id, e.name, e.department, e.designation, e.base_salary
             ORDER BY attendance_rate ASC"
        );
        
        // Overtime analysis with cost implications
        $overtime = Database::fetchAll(
            "SELECT e.name, e.department, e.base_salary,
                    SUM(a.hours_worked) as total_hours,
                    SUM(CASE WHEN a.hours_worked > 8 THEN a.hours_worked - 8 ELSE 0 END) as overtime_hours,
                    COUNT(DISTINCT a.date) as days_worked,
                    AVG(a.hours_worked) as avg_daily_hours
             FROM employees e
             JOIN attendance a ON e.employee_key = a.employee_key
             WHERE a.date >= DATE_SUB(NOW(), INTERVAL 7 DAY)
               AND e.is_active = 1
             GROUP BY e.employee_id, e.name, e.department, e.base_salary
             HAVING total_hours > 48
             ORDER BY overtime_hours DESC"
        );
        
        // Department-wise analysis
        $byDepartment = Database::fetchAll(
            "SELECT e.department,
                    COUNT(DISTINCT e.employee_id) as employee_count,
                    AVG(e.base_salary) as avg_salary,
                    SUM(e.base_salary) as total_salary_cost,
                    AVG(CASE WHEN a.status = 'Present' THEN 100 ELSE 0 END) as avg_attendance,
                    AVG(a.hours_worked) as avg_hours_worked
             FROM employees e
             LEFT JOIN attendance a ON e.employee_key = a.employee_key
             WHERE a.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
               AND e.is_active = 1
             GROUP BY e.department
             ORDER BY employee_count DESC"
        );
        
        // Recent payroll summary
        $payrollSummary = Database::fetchAll(
            "SELECT p.month, p.status,
                    COUNT(*) as employee_count,
                    SUM(p.base_salary) as total_base_salary,
                    SUM(p.earned_salary) as total_earned_salary,
                    SUM(p.net_pay) as total_net_pay,
                    AVG(p.present_days) as avg_present_days,
                    SUM(p.deductions) as total_deductions
             FROM payroll p
             WHERE p.month >= DATE_FORMAT(DATE_SUB(NOW(), INTERVAL 3 MONTH), '%Y-%m')
             GROUP BY p.month, p.status
             ORDER BY p.month DESC"
        );
        
        // Summary
        $summary = Database::fetch(
            "SELECT 
                COUNT(DISTINCT e.employee_id) as total_employees,
                COUNT(DISTINCT CASE WHEN e.is_active = 1 THEN e.employee_id END) as active_employees,
                AVG(CASE WHEN a.status = 'Present' THEN 100 ELSE 0 END) as overall_attendance,
                SUM(CASE WHEN a.status = 'Half-day' THEN 1 ELSE 0 END) as total_half_days,
                SUM(CASE WHEN a.status = 'Absent' THEN 1 ELSE 0 END) as total_absences,
                AVG(a.hours_worked) as avg_hours_worked,
                SUM(e.base_salary) as total_salary_cost
             FROM employees e
             LEFT JOIN attendance a ON e.employee_key = a.employee_key
             WHERE a.date >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
        );
        
        return [
            'attendance_by_employee' => $attendanceByEmployee,
            'overtime' => $overtime,
            'by_department' => $byDepartment,
            'payroll_summary' => $payrollSummary,
            'summary' => $summary,
        ];
    }
    
    /**
     * Get aggregated production data for AI analysis
     */
    public static function getProductionData(): array
    {
        // SOP status distribution with details
        $sopStatus = Database::fetchAll(
            "SELECT sv.status, s.department,
                    COUNT(*) as count,
                    GROUP_CONCAT(s.title SEPARATOR '; ') as sop_titles
             FROM sops s
             JOIN sop_versions sv ON s.current_version_id = sv.version_id
             GROUP BY sv.status, s.department"
        );
        
        // Workflow analysis by type and stage
        $workflowAnalysis = Database::fetchAll(
            "SELECT type, stage, priority,
                    COUNT(*) as count,
                    AVG(DATEDIFF(NOW(), created_at)) as avg_age_days,
                    SUM(amount) as total_amount
             FROM workflows
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 90 DAY)
             GROUP BY type, stage, priority
             ORDER BY count DESC"
        );
        
        // Workflow bottlenecks with requester info
        $workflowBottlenecks = Database::fetchAll(
            "SELECT w.title, w.type, w.stage, w.priority,
                    DATEDIFF(NOW(), w.created_at) as days_pending,
                    w.amount,
                    w.due_date,
                    u1.name as requester_name,
                    u2.name as approver_name
             FROM workflows w
             LEFT JOIN users u1 ON w.requester_id = u1.user_id
             LEFT JOIN users u2 ON w.approver_id = u2.user_id
             WHERE w.stage = 'Pending' 
             AND DATEDIFF(NOW(), w.created_at) > 7
             ORDER BY days_pending DESC
             LIMIT 10"
        );
        
        // Task completion stats by assignee
        $taskStats = Database::fetchAll(
            "SELECT status, priority,
                    COUNT(*) as count,
                    AVG(CASE WHEN completed_at IS NOT NULL 
                        THEN DATEDIFF(completed_at, created_at) 
                        ELSE NULL END) as avg_completion_days,
                    SUM(CASE WHEN due_date < NOW() AND status != 'Completed' THEN 1 ELSE 0 END) as overdue_count
             FROM tasks 
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY status, priority
             ORDER BY count DESC"
        );
        
        // Task assignee performance
        $taskAssigneePerformance = Database::fetchAll(
            "SELECT assignee_id,
                    COUNT(*) as total_tasks,
                    SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed_tasks,
                    SUM(CASE WHEN status = 'In Progress' THEN 1 ELSE 0 END) as in_progress_tasks,
                    SUM(CASE WHEN due_date < NOW() AND status != 'Completed' THEN 1 ELSE 0 END) as overdue_tasks,
                    AVG(CASE WHEN completed_at IS NOT NULL 
                        THEN DATEDIFF(completed_at, created_at) 
                        ELSE NULL END) as avg_completion_days
             FROM tasks
             WHERE created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             GROUP BY assignee_id
             ORDER BY completed_tasks DESC"
        );
        
        // Meeting frequency and attendance
        $meetingStats = Database::fetch(
            "SELECT
                COUNT(*) as total_meetings,
                AVG((SELECT COUNT(*) FROM meeting_attendees ma WHERE ma.meeting_id = m.meeting_id)) as avg_attendees,
                COUNT(DISTINCT DATE(date)) as meeting_days
             FROM meetings m
             WHERE date >= DATE_SUB(NOW(), INTERVAL 30 DAY)"
        );
        
        // Recent meetings
        $recentMeetings = Database::fetchAll(
            "SELECT title, date, time, location,
                    (SELECT COUNT(*) FROM meeting_attendees ma WHERE ma.meeting_id = m.meeting_id) as attendee_count,
                    JSON_LENGTH(action_items) as action_item_count
             FROM meetings m
             WHERE date >= DATE_SUB(NOW(), INTERVAL 30 DAY)
             ORDER BY date DESC
             LIMIT 10"
        );
        
        // Summary
        $summary = [
            'sop_status' => $sopStatus,
            'workflow_analysis' => $workflowAnalysis,
            'workflow_bottlenecks' => $workflowBottlenecks,
            'task_stats' => $taskStats,
            'task_assignee_performance' => $taskAssigneePerformance,
            'meeting_stats' => $meetingStats,
            'recent_meetings' => $recentMeetings,
        ];
        
        return $summary;
    }
    
    /**
     * Get data for a specific category
     */
    public static function getData(string $category): array
    {
        switch ($category) {
            case 'sales':
                return self::getSalesData();
            case 'expenses':
                return self::getExpensesData();
            case 'employees':
                return self::getEmployeesData();
            case 'production':
                return self::getProductionData();
            default:
                throw new Exception('Invalid category: ' . $category);
        }
    }
}