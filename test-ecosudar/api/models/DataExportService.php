<?php
declare(strict_types=1);

class DataExportService
{
    public static function modules(): array
    {
        return [
            'vendors' => self::definition('Vendors', 'vendors', [
                'vendor_id', 'vendor_code', 'name', 'gstin', 'contact_name', 'phone', 'email',
                'city', 'state', 'pincode', 'payment_terms', 'is_active', 'created_at',
            ], 'created_at', 'is_active'),
            'customers' => self::definition('Customers', 'users', [
                'user_id', 'name', 'email', 'phone', 'user_type', 'company_name', 'city', 'state',
                'pincode', 'gst_number', 'udyam_number', 'is_active', 'approval_status', 'created_at',
            ], 'created_at', 'approval_status', "user_type IN ('customer','dealer')"),
            'products' => self::definition('Products', 'products', [
                'product_id', 'product_name', 'product_type', 'base_price', 'unit', 'category',
                'gcv', 'ash_content', 'moisture_content', 'is_available', 'created_at',
            ], 'created_at', 'is_available'),
            'orders' => self::definition('Orders', 'orders', [
                'order_id', 'order_number', 'user_id', 'total_amount', 'delivery_fee',
                'order_status', 'payment_status', 'payment_method', 'created_at',
            ], 'created_at', 'order_status'),
            'invoices' => self::definition('Invoices', 'invoices', [
                'invoice_id', 'invoice_number', 'order_id', 'customer_name', 'customer_gstin',
                'customer_state', 'subtotal', 'gst_rate', 'gst_amount', 'total', 'status', 'created_at',
            ], 'created_at', 'status'),
            'payments' => self::definition('Payments', 'payments', [
                'payment_id', 'payment_number', 'direction', 'invoice_id', 'po_id', 'amount',
                'payment_mode', 'reference_no', 'paid_on', 'status', 'created_at',
            ], 'paid_on', 'status'),
            'expenses' => self::definition('Expenses', 'expenses', [
                'expense_id', 'expense_code', 'expense_date', 'category', 'vendor',
                'description', 'amount', 'payment_mode', 'created_at',
            ], 'expense_date', null),
            'employees' => self::definition('Employees', 'employees', [
                'employee_id', 'employee_key', 'name', 'email', 'phone', 'department',
                'designation', 'employment_type', 'base_salary', 'joined_at', 'is_active',
            ], 'joined_at', 'is_active'),
            'attendance' => self::definition('Attendance', 'attendance', [
                'attendance_id', 'employee_key', 'date', 'shift_id', 'check_in', 'check_out',
                'hours_worked', 'scheduled_hours', 'late_minutes', 'overtime_hours', 'status', 'source',
            ], 'date', 'status'),
            'payroll' => self::definition('Payroll', 'payroll', [
                'payroll_id', 'employee_key', 'month', 'working_days', 'present_days',
                'base_salary', 'earned_salary', 'net_pay', 'status', 'generated_at',
            ], 'generated_at', 'status'),
            'purchase_orders' => self::definition('Purchase Orders', 'purchase_orders', [
                'po_id', 'po_number', 'vendor_id', 'order_date', 'expected_date',
                'subtotal', 'tax_amount', 'total', 'status', 'payment_status', 'created_at',
            ], 'order_date', 'status'),
            'compliance' => [
                'label' => 'Employee Compliance',
                'table' => 'employee_compliance',
                'columns' => ['compliance_id', 'employee_key', 'employee_name', 'type', 'provider', 'policy_number', 'coverage_amount', 'premium', 'start_date', 'expiry_date', 'status', 'created_at'],
                'date_column' => 'expiry_date',
                'status_column' => 'status',
                'base_sql' => 'SELECT c.compliance_id, c.employee_key, e.name AS employee_name, c.type, c.provider,
                                      c.policy_number, c.coverage_amount, c.premium, c.start_date,
                                      c.expiry_date, c.status, c.created_at
                               FROM employee_compliance c
                               JOIN employees e ON e.employee_key = c.employee_key',
            ],
            'meetings' => self::definition('Meetings', 'meetings', [
                'meeting_id', 'title', 'date', 'time', 'location', 'agenda', 'notes', 'created_at',
            ], 'date', null),
        ];
    }

    public static function moduleInfo(string $module): array
    {
        $module = strtolower(trim($module));
        $modules = self::modules();
        if (!isset($modules[$module])) {
            Response::error('Unsupported export module', 404);
        }
        return $modules[$module];
    }

    public static function streamModule(string $module, array $filters, string $format): void
    {
        $format = strtolower($format ?: 'csv');
        if (!in_array($format, ['csv', 'xlsx', 'xls', 'json'], true)) {
            Response::error('format must be csv, xlsx, xls, or json', 422);
        }
        $info = self::moduleInfo($module);
        self::assertTableExists((string)$info['table']);

        if ($format === 'json') {
            $rows = self::rows($info, $filters);
            Response::success(['module' => $module, 'rows' => $rows, 'count' => count($rows)]);
        }

        $delimiter = in_array($format, ['xlsx', 'xls'], true) ? "\t" : ',';
        $extension = in_array($format, ['xlsx', 'xls'], true) ? 'xls' : 'csv';
        $mime = $extension === 'xls' ? 'application/vnd.ms-excel' : 'text/csv';

        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        header_remove('Content-Type');
        header('Content-Type: ' . $mime . '; charset=UTF-8');
        header('Content-Disposition: attachment; filename="' . self::safeFilename($module) . '-' . date('Ymd-His') . '.' . $extension . '"');
        header('Cache-Control: private, no-store, max-age=0');

        $out = fopen('php://output', 'w');
        fputcsv($out, $info['columns'], $delimiter);
        foreach (self::rowGenerator($info, $filters) as $row) {
            fputcsv($out, self::orderedRow($row, $info['columns']), $delimiter);
        }
        fclose($out);
        exit;
    }

    public static function streamAll(array $filters = []): void
    {
        $entries = [];
        foreach (self::modules() as $module => $info) {
            if (!self::tableExists((string)$info['table'])) {
                continue;
            }
            $entries[$module . '.csv'] = self::csvContent($info, $filters);
        }
        self::streamZip($entries, 'ecosudar-full-export-' . date('Ymd-His') . '.zip');
    }

    public static function csvContent(array $info, array $filters = []): string
    {
        $handle = fopen('php://temp', 'r+');
        fputcsv($handle, $info['columns']);
        foreach (self::rowGenerator($info, $filters) as $row) {
            fputcsv($handle, self::orderedRow($row, $info['columns']));
        }
        rewind($handle);
        $content = stream_get_contents($handle) ?: '';
        fclose($handle);
        return $content;
    }

    private static function rows(array $info, array $filters): array
    {
        return iterator_to_array(self::rowGenerator($info, $filters), false);
    }

    private static function rowGenerator(array $info, array $filters): Generator
    {
        [$sql, $params] = self::queryFor($info, $filters);
        $stmt = Database::query($sql, $params);
        while ($row = $stmt->fetch()) {
            yield $row;
        }
    }

    private static function queryFor(array $info, array $filters): array
    {
        $where = [];
        $params = [];
        if (!empty($info['base_where'])) {
            $where[] = (string)$info['base_where'];
        }
        if (!empty($filters['from']) && !empty($info['date_column'])) {
            $where[] = $info['date_column'] . ' >= ?';
            $params[] = $filters['from'];
        }
        if (!empty($filters['to']) && !empty($info['date_column'])) {
            $where[] = $info['date_column'] . ' <= ?';
            $params[] = $filters['to'];
        }
        if (!empty($filters['status']) && !empty($info['status_column'])) {
            $where[] = $info['status_column'] . ' = ?';
            $params[] = $filters['status'];
        }

        $base = $info['base_sql'] ?? ('SELECT ' . implode(', ', array_map(fn($col) => "`{$col}`", $info['columns'])) . ' FROM ' . $info['table']);
        $sql = 'SELECT * FROM (' . $base . ') export_src';
        if ($where) {
            $sql .= ' WHERE ' . implode(' AND ', $where);
        }
        if (!empty($info['date_column'])) {
            $sql .= ' ORDER BY ' . $info['date_column'] . ' DESC';
        }
        return [$sql, $params];
    }

    private static function orderedRow(array $row, array $columns): array
    {
        $out = [];
        foreach ($columns as $column) {
            $value = $row[$column] ?? '';
            if (is_string($value)) {
                $value = html_entity_decode($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
            }
            $out[] = $value;
        }
        return $out;
    }

    private static function streamZip(array $entries, string $filename): void
    {
        $central = '';
        $offset = 0;
        $tmp = fopen('php://temp', 'w+');
        foreach ($entries as $name => $content) {
            $name = str_replace('\\', '/', $name);
            [$dosTime, $dosDate] = self::dosTimeDate();
            $crc = crc32($content);
            $size = strlen($content);
            $local = pack('VvvvvvVVVvv', 0x04034b50, 20, 0, 0, $dosTime, $dosDate, $crc, $size, $size, strlen($name), 0) . $name;
            fwrite($tmp, $local);
            fwrite($tmp, $content);
            $central .= pack('VvvvvvvVVVvvvvvVV', 0x02014b50, 20, 20, 0, 0, $dosTime, $dosDate, $crc, $size, $size, strlen($name), 0, 0, 0, 0, 0, $offset) . $name;
            $offset += strlen($local) + $size;
        }
        $centralOffset = $offset;
        fwrite($tmp, $central);
        $centralSize = strlen($central);
        $count = count($entries);
        fwrite($tmp, pack('VvvvvVVv', 0x06054b50, 0, 0, $count, $count, $centralSize, $centralOffset, 0));
        rewind($tmp);

        while (ob_get_level() > 0) {
            ob_end_clean();
        }
        header_remove('Content-Type');
        header('Content-Type: application/zip');
        header('Content-Disposition: attachment; filename="' . addcslashes($filename, '"\\') . '"');
        header('Cache-Control: private, no-store, max-age=0');
        fpassthru($tmp);
        fclose($tmp);
        exit;
    }

    private static function dosTimeDate(): array
    {
        $time = getdate();
        $dosTime = (($time['hours'] & 0x1f) << 11) | (($time['minutes'] & 0x3f) << 5) | (intdiv((int)$time['seconds'], 2) & 0x1f);
        $dosDate = ((($time['year'] - 1980) & 0x7f) << 9) | (($time['mon'] & 0x0f) << 5) | ($time['mday'] & 0x1f);
        return [(int)$dosTime, (int)$dosDate];
    }

    private static function definition(string $label, string $table, array $columns, ?string $dateColumn, ?string $statusColumn, ?string $baseWhere = null): array
    {
        return [
            'label' => $label,
            'table' => $table,
            'columns' => $columns,
            'date_column' => $dateColumn,
            'status_column' => $statusColumn,
            'base_where' => $baseWhere,
        ];
    }

    private static function assertTableExists(string $table): void
    {
        if (!self::tableExists($table)) {
            Response::error("Export table {$table} is not available. Run the related migration first.", 422);
        }
    }

    private static function tableExists(string $table): bool
    {
        return Database::fetch(
            'SELECT 1 FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ? LIMIT 1',
            [$table]
        ) !== null;
    }

    private static function safeFilename(string $value): string
    {
        $value = strtolower(trim($value));
        $value = preg_replace('/[^a-z0-9_-]+/', '-', $value) ?: 'export';
        return trim($value, '-');
    }
}
