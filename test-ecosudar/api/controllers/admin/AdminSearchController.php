<?php
declare(strict_types=1);

/**
 * Admin Global Search Controller
 * GET /admin/search?q=...  — cross-module search for the header GlobalSearch box.
 *
 * Searches the fields staff actually look people up by: names, emails, phone
 * numbers, company names, and document numbers (order / invoice). Returns
 * grouped hits shaped for the frontend SearchGroup/SearchHit contract:
 *   { groups: [ { label, type, items: [ { id, title, subtitle, meta, url } ] } ] }
 */
class AdminSearchController
{
    /** Max hits returned per group. */
    private const PER_GROUP = 6;

    /** Escape LIKE wildcards so user input can't act as a pattern. */
    private static function likeTerm(string $q): string
    {
        $escaped = str_replace(['\\', '%', '_'], ['\\\\', '\\%', '\\_'], $q);
        return '%' . $escaped . '%';
    }

    public function index(Request $request): void
    {
        $q = trim((string)$request->query('q', ''));
        if (mb_strlen($q) < 2) {
            Response::success(['groups' => []], 'Query too short');
        }

        $like = self::likeTerm($q);
        $groups = [];

        // ---- Customers (users.user_type = 'customer') ----
        $customers = Database::fetchAll(
            "SELECT user_id, name, email, phone, company_name, city
               FROM users
              WHERE user_type = 'customer'
                AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR company_name LIKE ?)
              ORDER BY name ASC
              LIMIT " . self::PER_GROUP,
            [$like, $like, $like, $like]
        );
        if ($customers) {
            $groups[] = [
                'label' => 'Customers',
                'type'  => 'customer',
                'items' => array_map(static function (array $r): array {
                    $sub = $r['email'] ?: $r['phone'] ?: '';
                    $meta = trim(($r['company_name'] ?? '') . ($r['city'] ? ' · ' . $r['city'] : ''), ' ·');
                    return [
                        'id'       => (int)$r['user_id'],
                        'title'    => $r['name'] ?? 'Customer',
                        'subtitle' => (string)$sub,
                        'meta'     => $meta,
                        'url'      => '/customers',
                    ];
                }, $customers),
            ];
        }

        // ---- Dealers (users.user_type = 'dealer') ----
        $dealers = Database::fetchAll(
            "SELECT user_id, name, email, phone, company_name, city
               FROM users
              WHERE user_type = 'dealer'
                AND (name LIKE ? OR email LIKE ? OR phone LIKE ? OR company_name LIKE ?)
              ORDER BY name ASC
              LIMIT " . self::PER_GROUP,
            [$like, $like, $like, $like]
        );
        if ($dealers) {
            $groups[] = [
                'label' => 'Dealers',
                'type'  => 'dealer',
                'items' => array_map(static function (array $r): array {
                    $sub = $r['email'] ?: $r['phone'] ?: '';
                    $meta = trim(($r['company_name'] ?? '') . ($r['city'] ? ' · ' . $r['city'] : ''), ' ·');
                    return [
                        'id'       => (int)$r['user_id'],
                        'title'    => $r['name'] ?? 'Dealer',
                        'subtitle' => (string)$sub,
                        'meta'     => $meta,
                        'url'      => '/dealers',
                    ];
                }, $dealers),
            ];
        }

        // ---- Orders (order_number + customer name via users) ----
        $orders = Database::fetchAll(
            "SELECT o.order_id, o.order_number, o.order_status, o.total_amount,
                    u.name AS customer_name
               FROM orders o
               LEFT JOIN users u ON u.user_id = o.user_id
              WHERE o.order_number LIKE ? OR u.name LIKE ? OR u.phone LIKE ?
              ORDER BY o.created_at DESC
              LIMIT " . self::PER_GROUP,
            [$like, $like, $like]
        );
        if ($orders) {
            $groups[] = [
                'label' => 'Orders',
                'type'  => 'order',
                'items' => array_map(static function (array $r): array {
                    return [
                        'id'       => (int)$r['order_id'],
                        'title'    => $r['order_number'] ?? ('Order #' . $r['order_id']),
                        'subtitle' => (string)($r['customer_name'] ?? ''),
                        'meta'     => trim((string)($r['order_status'] ?? '') . ' · ₹' . number_format((float)($r['total_amount'] ?? 0), 2)),
                        'url'      => '/orders',
                    ];
                }, $orders),
            ];
        }

        // ---- Invoices (invoice_number + customer_name) ----
        $invoices = Database::fetchAll(
            "SELECT invoice_id, invoice_number, customer_name, status, total
               FROM invoices
              WHERE invoice_number LIKE ? OR customer_name LIKE ? OR customer_gstin LIKE ?
              ORDER BY created_at DESC
              LIMIT " . self::PER_GROUP,
            [$like, $like, $like]
        );
        if ($invoices) {
            $groups[] = [
                'label' => 'Invoices',
                'type'  => 'invoice',
                'items' => array_map(static function (array $r): array {
                    return [
                        'id'       => (int)$r['invoice_id'],
                        'title'    => $r['invoice_number'] ?? ('Invoice #' . $r['invoice_id']),
                        'subtitle' => (string)($r['customer_name'] ?? ''),
                        'meta'     => trim((string)($r['status'] ?? '') . ' · ₹' . number_format((float)($r['total'] ?? 0), 2)),
                        'url'      => '/invoices',
                    ];
                }, $invoices),
            ];
        }

        // ---- Products (name / hsn / category) ----
        $products = Database::fetchAll(
            "SELECT product_id, product_name, category, product_type, hsn_code
               FROM products
              WHERE is_deleted = 0
                AND (product_name LIKE ? OR hsn_code LIKE ? OR category LIKE ?)
              ORDER BY product_name ASC
              LIMIT " . self::PER_GROUP,
            [$like, $like, $like]
        );
        if ($products) {
            $groups[] = [
                'label' => 'Products',
                'type'  => 'product',
                'items' => array_map(static function (array $r): array {
                    return [
                        'id'       => (int)$r['product_id'],
                        'title'    => $r['product_name'] ?? 'Product',
                        'subtitle' => (string)($r['category'] ?? $r['product_type'] ?? ''),
                        'meta'     => $r['hsn_code'] ? 'HSN ' . $r['hsn_code'] : '',
                        'url'      => '/products',
                    ];
                }, $products),
            ];
        }

        // ---- Employees ----
        $employees = Database::fetchAll(
            "SELECT employee_id, employee_key, name, phone, email, department, designation
               FROM employees
              WHERE name LIKE ? OR employee_key LIKE ? OR phone LIKE ? OR email LIKE ?
              ORDER BY name ASC
              LIMIT " . self::PER_GROUP,
            [$like, $like, $like, $like]
        );
        if ($employees) {
            $groups[] = [
                'label' => 'Employees',
                'type'  => 'employee',
                'items' => array_map(static function (array $r): array {
                    return [
                        'id'       => (int)$r['employee_id'],
                        'title'    => $r['name'] ?? 'Employee',
                        'subtitle' => trim((string)($r['designation'] ?? '') . ($r['department'] ? ' · ' . $r['department'] : ''), ' ·'),
                        'meta'     => (string)($r['phone'] ?? $r['email'] ?? $r['employee_key'] ?? ''),
                        'url'      => '/employees',
                    ];
                }, $employees),
            ];
        }

        // ---- Vendors ----
        $vendors = Database::fetchAll(
            "SELECT vendor_id, name, gstin, phone, city
               FROM vendors
              WHERE name LIKE ? OR gstin LIKE ? OR phone LIKE ?
              ORDER BY name ASC
              LIMIT " . self::PER_GROUP,
            [$like, $like, $like]
        );
        if ($vendors) {
            $groups[] = [
                'label' => 'Vendors',
                'type'  => 'vendor',
                'items' => array_map(static function (array $r): array {
                    return [
                        'id'       => (int)$r['vendor_id'],
                        'title'    => $r['name'] ?? 'Vendor',
                        'subtitle' => (string)($r['gstin'] ?? ''),
                        'meta'     => (string)($r['city'] ?? $r['phone'] ?? ''),
                        'url'      => '/purchase/vendors',
                    ];
                }, $vendors),
            ];
        }

        // ---- Expenses ----
        $expenses = Database::fetchAll(
            "SELECT expense_id, expense_code, category, vendor, description, amount
               FROM expenses
              WHERE expense_code LIKE ? OR category LIKE ? OR vendor LIKE ? OR description LIKE ?
              ORDER BY expense_date DESC
              LIMIT " . self::PER_GROUP,
            [$like, $like, $like, $like]
        );
        if ($expenses) {
            $groups[] = [
                'label' => 'Expenses',
                'type'  => 'expense',
                'items' => array_map(static function (array $r): array {
                    return [
                        'id'       => (int)$r['expense_id'],
                        'title'    => $r['expense_code'] ?: ($r['category'] ?? 'Expense'),
                        'subtitle' => (string)($r['vendor'] ?? $r['category'] ?? ''),
                        'meta'     => '₹' . number_format((float)($r['amount'] ?? 0), 2),
                        'url'      => '/expenses',
                    ];
                }, $expenses),
            ];
        }

        Response::success(['groups' => $groups], 'Search results');
    }
}
