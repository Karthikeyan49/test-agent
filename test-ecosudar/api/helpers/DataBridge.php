<?php
declare(strict_types=1);

/**
 * DataBridge — fetches safe, read-only business data from existing tables
 * to inject as context into the AI chat.
 *
 * Sensitive data explicitly excluded: users.password, tokens, OTPs,
 * audit_log, rate_limits, revoked_tokens, refresh_tokens.
 */
class DataBridge
{
    // Keyword → data-source mapping
    private static array $TRIGGERS = [
        // Products
        'product'    => ['products'],
        'price'      => ['products'],
        'cost'       => ['products'],
        'rate'       => ['products'],
        'how much'   => ['products'],
        'plant'      => ['products'],
        'biogas'     => ['products'],
        'bio'        => ['products'],
        'pellet'     => ['products'],
        'biomass'    => ['products'],
        'gas'        => ['products'],
        'energy'     => ['products'],
        'size'       => ['products'],
        'capacity'   => ['products'],
        'buy'        => ['products'],
        'purchase'   => ['products', 'orders'],
        'available'  => ['products'],
        'sell'       => ['products'],
        'catalogue'  => ['products'],
        'catalog'    => ['products'],
        // Orders
        'order'      => ['orders'],
        'delivery'   => ['orders'],
        'ship'       => ['orders'],
        'dispatch'   => ['orders'],
        'track'      => ['orders'],
        // Customers
        'customer'   => ['customers'],
        'client'     => ['customers'],
        'dealer'     => ['customers'],
        // Employees / HR
        'employee'   => ['employees'],
        'staff'      => ['employees'],
        'team'       => ['employees'],
        'member'     => ['employees'],
        'who work'   => ['employees'],
        'attendance' => ['attendance', 'employees'],
        'present'    => ['attendance'],
        'absent'     => ['attendance'],
        'leave'      => ['attendance'],
        'salary'     => ['payroll', 'employees'],
        'payroll'    => ['payroll'],
        'pay'        => ['payroll'],
        // Finance
        'invoice'    => ['invoices'],
        'bill'       => ['invoices'],
        'payment'    => ['invoices'],
        'expense'    => ['expenses'],
        'spend'      => ['expenses'],
        'finance'    => ['finance'],
        'revenue'    => ['finance'],
        'profit'     => ['finance'],
        'income'     => ['finance'],
        // Knowledge / Policies
        'faq'        => ['faqs'],
        'help'       => ['faqs'],
        'sop'        => ['sops'],
        'procedure'  => ['sops'],
        'process'    => ['sops'],
        'policy'     => ['sops', 'faqs'],
        'guideline'  => ['sops'],
        'warranty'   => ['faqs', 'sops'],
        'return'     => ['faqs'],
        'refund'     => ['faqs'],
        // Operations
        'meeting'    => ['meetings'],
        'schedule'   => ['meetings'],
        'task'       => ['tasks'],
        'pending'    => ['tasks', 'orders'],
        'workflow'   => ['workflows'],
        'query'      => ['queries'],
        'complaint'  => ['queries'],
        'quote'      => ['quotes'],
        'quotation'  => ['quotes'],
        'enquiry'    => ['quotes'],
    ];

    /**
     * Detect relevant data sources from the question text
     * and return combined context string.
     */
    public static function fetchContext(string $question): string
    {
        $lower   = strtolower($question);
        $sources = ['summary', 'products']; // always include summary and product catalogue

        foreach (self::$TRIGGERS as $keyword => $keys) {
            if (str_contains($lower, $keyword)) {
                $sources = array_unique(array_merge($sources, $keys));
            }
        }

        $parts = [];
        foreach ($sources as $source) {
            $data = self::fetch($source);
            if ($data !== '') $parts[] = $data;
        }

        return implode("\n\n", $parts);
    }

    public static function fetchSource(string $source): string
    {
        return self::fetch($source);
    }

    private static function fetch(string $source): string
    {
        try {
            return match ($source) {
                'summary'   => self::summary(),
                'products'  => self::products(),
                'orders'    => self::orders(),
                'customers' => self::customers(),
                'employees' => self::employees(),
                'attendance'=> self::attendance(),
                'payroll'   => self::payroll(),
                'invoices'  => self::invoices(),
                'expenses'  => self::expenses(),
                'finance'   => self::finance(),
                'faqs'      => self::faqs(),
                'sops'      => self::sops(),
                'meetings'  => self::meetings(),
                'tasks'     => self::tasks(),
                'workflows' => self::workflows(),
                'queries'   => self::customerQueries(),
                'quotes'    => self::quotes(),
                default     => '',
            };
        } catch (\Throwable $e) {
            error_log("[DataBridge] $source error: " . $e->getMessage());
            return '';
        }
    }

    // ── Data fetchers ──────────────────────────────────────────────────────────

    private static function summary(): string
    {
        $products  = Database::fetch("SELECT COUNT(*) AS cnt FROM products WHERE is_available = 1")['cnt'] ?? 0;
        $orders    = Database::fetch("SELECT COUNT(*) AS cnt FROM orders")['cnt'] ?? 0;
        $customers = Database::fetch("SELECT COUNT(*) AS cnt FROM users WHERE user_type = 'customer' AND is_active = 1")['cnt'] ?? 0;
        $employees = Database::fetch("SELECT COUNT(*) AS cnt FROM employees WHERE is_active = 1")['cnt'] ?? 0;
        $revenue   = Database::fetch("SELECT COALESCE(SUM(total_amount),0) AS total FROM orders WHERE order_status NOT IN ('cancelled')")['total'] ?? 0;

        return "## Business Summary\n"
            . "- Active products: $products\n"
            . "- Total orders: $orders\n"
            . "- Active customers: $customers\n"
            . "- Active employees: $employees\n"
            . "- Total revenue (non-cancelled orders): ₹" . number_format((float)$revenue, 2);
    }

    private static function products(): string
    {
        $rows = Database::fetchAll(
            "SELECT p.product_name, p.product_type, p.description, p.base_price, p.unit,
                    p.category, p.suitable_for,
                    GROUP_CONCAT(CONCAT(pc.size, ' - ₹', pc.price) ORDER BY pc.price SEPARATOR ', ') AS configs
             FROM products p
             LEFT JOIN product_configurations pc ON pc.product_id = p.product_id AND pc.is_available = 1
             WHERE p.is_available = 1
             GROUP BY p.product_id
             ORDER BY p.category, p.product_name
             LIMIT 50"
        );
        if (!$rows) return '';
        $lines = ["## Products & Pricing"];
        foreach ($rows as $r) {
            $lines[] = "- **{$r['product_name']}** ({$r['product_type']}) | Base: ₹{$r['base_price']}/{$r['unit']}"
                . ($r['configs'] ? " | Sizes: {$r['configs']}" : '')
                . ($r['suitable_for'] ? " | For: {$r['suitable_for']}" : '')
                . ($r['description'] ? "\n  {$r['description']}" : '');
        }
        return implode("\n", $lines);
    }

    private static function orders(): string
    {
        $stats = Database::fetchAll(
            "SELECT order_status, COUNT(*) AS cnt, COALESCE(SUM(total_amount),0) AS total
             FROM orders GROUP BY order_status ORDER BY cnt DESC"
        );
        $recent = Database::fetchAll(
            "SELECT order_number, order_status, total_amount, created_at
             FROM orders ORDER BY created_at DESC LIMIT 10"
        );
        if (!$stats) return '';
        $lines = ["## Orders"];
        foreach ($stats as $s) {
            $lines[] = "- {$s['order_status']}: {$s['cnt']} orders (₹" . number_format((float)$s['total'], 2) . ")";
        }
        $lines[] = "\nRecent orders:";
        foreach ($recent as $r) {
            $lines[] = "- #{$r['order_number']} | {$r['order_status']} | ₹{$r['total_amount']} | {$r['created_at']}";
        }
        return implode("\n", $lines);
    }

    private static function customers(): string
    {
        $stats = Database::fetchAll(
            "SELECT user_type, COUNT(*) AS cnt FROM users WHERE is_active = 1 GROUP BY user_type"
        );
        $cities = Database::fetchAll(
            "SELECT city, COUNT(*) AS cnt FROM users WHERE user_type = 'customer' AND city IS NOT NULL
             GROUP BY city ORDER BY cnt DESC LIMIT 10"
        );
        if (!$stats) return '';
        $lines = ["## Customers"];
        foreach ($stats as $s) $lines[] = "- {$s['user_type']}: {$s['cnt']}";
        if ($cities) {
            $lines[] = "\nTop cities: " . implode(', ', array_map(fn($c) => "{$c['city']} ({$c['cnt']})", $cities));
        }
        return implode("\n", $lines);
    }

    private static function employees(): string
    {
        $rows = Database::fetchAll(
            "SELECT name, designation, department, employment_type, is_active
             FROM employees WHERE is_active = 1
             ORDER BY department, name LIMIT 50"
        );
        if (!$rows) return '';
        $lines = ["## Employees"];
        foreach ($rows as $r) {
            $lines[] = "- {$r['name']} | {$r['designation']} | {$r['department']} | {$r['employment_type']}";
        }
        return implode("\n", $lines);
    }

    private static function attendance(): string
    {
        $today = date('Y-m-d');
        $stats = Database::fetch(
            "SELECT
                SUM(status = 'Present') AS present,
                SUM(status = 'Absent') AS absent,
                SUM(status = 'Half-day') AS half_day,
                SUM(status = 'Leave') AS on_leave
             FROM attendance WHERE date = ?",
            [$today]
        );
        if (!$stats) return '';
        return "## Attendance (Today: $today)\n"
            . "- Present: {$stats['present']}, Absent: {$stats['absent']}, "
            . "Half-day: {$stats['half_day']}, On leave: {$stats['on_leave']}";
    }

    private static function payroll(): string
    {
        $stats = Database::fetch(
            "SELECT COUNT(*) AS cnt, COALESCE(SUM(net_pay),0) AS total,
                    COALESCE(AVG(net_pay),0) AS avg_sal
             FROM payroll WHERE status = 'Paid'"
        );
        $recent = Database::fetchAll(
            "SELECT month, COUNT(*) AS count, SUM(net_pay) AS total
             FROM payroll GROUP BY month ORDER BY month DESC LIMIT 6"
        );
        if (!$stats) return '';
        $lines = ["## Payroll Summary"];
        $lines[] = "- Total paid records: {$stats['cnt']} | Total paid: ₹" . number_format((float)$stats['total'], 2);
        $lines[] = "- Average net salary: ₹" . number_format((float)$stats['avg_sal'], 2);
        foreach ($recent as $r) {
            $lines[] = "- {$r['month']}: {$r['count']} employees | ₹" . number_format((float)$r['total'], 2);
        }
        return implode("\n", $lines);
    }

    private static function invoices(): string
    {
        $stats = Database::fetchAll(
            "SELECT status, COUNT(*) AS cnt, COALESCE(SUM(total),0) AS total
             FROM invoices GROUP BY status"
        );
        if (!$stats) return '';
        $lines = ["## Invoices"];
        foreach ($stats as $s) {
            $lines[] = "- {$s['status']}: {$s['cnt']} invoices (₹" . number_format((float)$s['total'], 2) . ")";
        }
        return implode("\n", $lines);
    }

    private static function expenses(): string
    {
        $stats = Database::fetchAll(
            "SELECT category, COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total
             FROM expenses GROUP BY category ORDER BY total DESC LIMIT 10"
        );
        if (!$stats) return '';
        $lines = ["## Expenses by Category"];
        foreach ($stats as $s) {
            $lines[] = "- {$s['category']}: {$s['cnt']} entries | ₹" . number_format((float)$s['total'], 2);
        }
        return implode("\n", $lines);
    }

    private static function finance(): string
    {
        $stats = Database::fetchAll(
            "SELECT record_type AS type, COUNT(*) AS cnt, COALESCE(SUM(amount),0) AS total
             FROM finance_records GROUP BY record_type"
        );
        if (!$stats) return '';
        $lines = ["## Finance Records"];
        foreach ($stats as $s) {
            $lines[] = "- {$s['type']}: {$s['cnt']} records | ₹" . number_format((float)$s['total'], 2);
        }
        return implode("\n", $lines);
    }

    private static function faqs(): string
    {
        $rows = Database::fetchAll(
            "SELECT question, answer FROM faqs WHERE active = 1 ORDER BY sort_order, faq_id LIMIT 50"
        );
        if (!$rows) return '';
        $lines = ["## FAQs"];
        foreach ($rows as $r) {
            $lines[] = "Q: {$r['question']}\nA: {$r['answer']}";
        }
        return implode("\n\n", $lines);
    }

    private static function sops(): string
    {
        $rows = Database::fetchAll(
            "SELECT s.title, s.department, s.description
             FROM sops s
             ORDER BY s.department, s.title LIMIT 20"
        );
        if (!$rows) return '';
        $lines = ["## SOPs (Standard Operating Procedures)"];
        foreach ($rows as $r) {
            $lines[] = "- **{$r['title']}** [{$r['department']}]"
                . ($r['description'] ? ": {$r['description']}" : '');
        }
        return implode("\n", $lines);
    }

    private static function meetings(): string
    {
        $rows = Database::fetchAll(
            "SELECT title, date, time, location, agenda
             FROM meetings
             WHERE date >= CURDATE()
             ORDER BY date, time LIMIT 10"
        );
        if (!$rows) return '';
        $lines = ["## Upcoming Meetings"];
        foreach ($rows as $r) {
            $lines[] = "- **{$r['title']}** | {$r['date']} {$r['time']}"
                . ($r['location'] ? " | {$r['location']}" : '')
                . ($r['agenda']   ? "\n  Agenda: {$r['agenda']}" : '');
        }
        return implode("\n", $lines);
    }

    private static function tasks(): string
    {
        $stats = Database::fetchAll(
            "SELECT status, COUNT(*) AS cnt FROM tasks GROUP BY status"
        );
        $overdue = Database::fetch(
            "SELECT COUNT(*) AS cnt FROM tasks WHERE due_date < CURDATE() AND status != 'Completed'"
        );
        if (!$stats) return '';
        $lines = ["## Tasks"];
        foreach ($stats as $s) $lines[] = "- {$s['status']}: {$s['cnt']}";
        if ($overdue && $overdue['cnt'] > 0) $lines[] = "- **Overdue: {$overdue['cnt']}**";
        return implode("\n", $lines);
    }

    private static function workflows(): string
    {
        $stats = Database::fetchAll(
            "SELECT type, stage, COUNT(*) AS cnt FROM workflows GROUP BY type, stage ORDER BY type, stage"
        );
        if (!$stats) return '';
        $lines = ["## Workflows"];
        foreach ($stats as $s) $lines[] = "- {$s['type']} | {$s['stage']}: {$s['cnt']}";
        return implode("\n", $lines);
    }

    private static function customerQueries(): string
    {
        $stats = Database::fetchAll(
            "SELECT status, COUNT(*) AS cnt FROM customer_queries GROUP BY status"
        );
        if (!$stats) return '';
        $lines = ["## Customer Queries"];
        foreach ($stats as $s) $lines[] = "- {$s['status']}: {$s['cnt']}";
        return implode("\n", $lines);
    }

    private static function quotes(): string
    {
        $stats = Database::fetchAll(
            "SELECT status, COUNT(*) AS cnt FROM quote_requests GROUP BY status"
        );
        if (!$stats) return '';
        $lines = ["## Quote Requests"];
        foreach ($stats as $s) {
            $lines[] = "- {$s['status']}: {$s['cnt']}";
        }
        return implode("\n", $lines);
    }
}
