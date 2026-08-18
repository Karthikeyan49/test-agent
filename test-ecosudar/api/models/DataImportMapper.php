<?php
declare(strict_types=1);

class DataImportMapper
{
    public static function modules(): array
    {
        return [
            'vendors' => self::module('Vendors', 'vendors', ['name'], [
                'vendor_code' => '', 'name' => 'ABC Suppliers', 'gstin' => '33ABCDE1234F1Z5',
                'contact_name' => 'Ravi', 'phone' => '9876543210', 'email' => 'vendor@example.com',
                'address' => 'Address', 'city' => 'Chennai', 'state' => 'Tamil Nadu',
                'pincode' => '600001', 'payment_terms' => '30 days', 'notes' => '',
            ], 'GSTIN or name'),
            'customers' => self::module('Customers / Dealers', 'customers', ['name', 'phone'], [
                'name' => 'Customer Name', 'phone' => '9876543210', 'email' => 'customer@example.com',
                'user_type' => 'customer', 'company_name' => 'Company', 'address' => 'Address',
                'city' => 'Chennai', 'state' => 'Tamil Nadu', 'pincode' => '600001',
                'gst_number' => '33ABCDE1234F1Z5', 'udyam_number' => '',
            ], 'phone'),
            'products' => self::module('Products', 'products', ['product_name', 'product_type', 'base_price'], [
                'product_name' => '6mm Biomass Pellet', 'product_type' => 'pellet',
                'description' => 'Product description', 'base_price' => '18.50', 'unit' => 'kg',
                'category' => 'Pellets', 'gcv' => '4200', 'ash_content' => '5',
                'moisture_content' => '8', 'is_available' => '1',
            ], 'product_name'),
            'expenses' => self::module('Expenses', 'expenses', ['expense_date', 'category', 'vendor', 'amount'], [
                'expense_code' => 'EXP-OLD-001', 'expense_date' => '2026-04-01',
                'category' => 'Raw Material', 'vendor' => 'ABC Suppliers',
                'description' => 'Historical purchase', 'amount' => '1000',
                'payment_mode' => 'Bank Transfer', 'bill_url' => '',
            ], 'expense_code or date+vendor+amount'),
            'employees' => self::module('Employees', 'employee_master', ['employee_key', 'name', 'phone'], [
                'employee_key' => 'EMP-001', 'name' => 'Employee Name', 'phone' => '9876543210',
                'email' => 'employee@example.com', 'department' => 'Production',
                'designation' => 'Operator', 'employment_type' => 'permanent',
                'base_salary' => '18000', 'joined_at' => '2026-04-01',
            ], 'employee_key'),
            'attendance_punches' => self::module('Attendance Punches / TMS', 'attendance_punch', ['employee_key', 'timestamp'], [
                'employee_key' => 'EMP-001', 'timestamp' => '2026-04-01 09:00:00',
                'direction' => 'in', 'punch_id' => 'DEVICE-0001',
            ], 'employee_key + timestamp'),
            'tms_tasks' => self::module('Task Status (TMS)', 'tms_task', ['employee_key', 'task_date', 'status'], [
                'employee_key' => 'EMP-001', 'task_date' => '2026-04-01',
                'task' => 'Daily route delivery', 'status' => 'Yes',
            ], 'employee_key + task_date + task'),
            'historical_invoices' => self::module('Historical Invoices', 'historical_invoices', ['invoice_number', 'customer_name', 'total'], [
                'invoice_number' => 'OLD-INV-001', 'invoice_date' => '2026-04-01',
                'customer_name' => 'Customer Name', 'customer_gstin' => '33ABCDE1234F1Z5',
                'customer_state' => 'Tamil Nadu', 'customer_address' => 'Address',
                'subtotal' => '1000', 'gst_rate' => '18', 'gst_amount' => '180',
                'total' => '1180', 'status' => 'Unpaid', 'payment_method' => 'Bank Transfer',
                'notes' => 'Historical invoice',
                // Line item (one row per line; repeat invoice_number for multi-line invoices)
                'item_name' => 'Product / item name', 'item_hsn' => '44014900',
                'item_quantity' => '1', 'item_unit' => 'Nos',
                'item_price' => '1000', 'item_total' => '1000',
            ], 'invoice_number'),
        ];
    }

    public static function moduleInfo(string $module): array
    {
        $module = self::normalizeModule($module);
        $modules = self::modules();
        if (!isset($modules[$module])) {
            Response::error('Unsupported import module', 404);
        }
        return $modules[$module];
    }

    public static function createJob(string $module, array $file, ?int $actorId): array
    {
        $info = self::moduleInfo($module);
        return ImportEngine::createJob($info['job_module'], $file, $actorId);
    }

    /**
     * AI-assisted column mapping. PRIVACY: only the source column TITLES (header row)
     * and our own target schema are sent to the AI — never any data rows — so no
     * customer/business data leaves the system. Returns a validated source→field map.
     */
    public static function aiSuggestMapping(string $module, int $jobId): array
    {
        $info = self::moduleInfo($module);
        $job = ImportEngine::getJob($jobId);
        $headers = array_values(array_filter(array_map('strval', (array)($job['headers'] ?? [])), fn($h) => $h !== ''));
        if (empty($headers)) {
            Response::error('No column titles found in the uploaded file', 422);
        }

        // Target fields described by name + our OWN example value (not user data) as a meaning hint.
        $targetFields = array_map(fn(array $f): array => [
            'field'    => $f['name'],
            'required' => (bool)$f['required'],
            'example'  => (string)$f['sample'],
        ], $info['fields']);

        $system = 'You map spreadsheet column titles exported from other business software to a target ERP schema. '
            . 'You are given ONLY the source column titles (no data rows) and the target fields with example values. '
            . 'Return STRICT JSON: an object mapping each source column title to the single best target field name, '
            . 'or omit a source column entirely when no field fits. Use ONLY the provided target field names. No prose, no markdown.';

        $user = json_encode([
            'module'         => $info['label'],
            'target_fields'  => $targetFields,
            'source_columns' => $headers,
            'guidance'       => 'Match by meaning, e.g. "Customer Name"->name, "Mobile"/"Phone No"->phone, '
                . '"GST No"/"GSTIN"->gst_number, "Amount"/"Total"->amount. Output {"<source column>":"<target field>"}.',
        ], JSON_UNESCAPED_UNICODE);

        try {
            $resp = GroqAPI::chat([
                ['role' => 'system', 'content' => $system],
                ['role' => 'user', 'content' => (string)$user],
            ], 'llama-3.3-70b-versatile', 0.1);
            $raw = GroqAPI::extractJSON($resp);
        } catch (\Throwable $e) {
            error_log('AI column mapping failed: ' . $e->getMessage());
            Response::error('AI mapping is unavailable right now — you can still map columns manually.', 502);
        }

        // Validate: keep only mappings whose source matches a real header and target is a known field.
        $validFields = array_map(fn(array $f) => $f['name'], $info['fields']);
        $mapping = [];
        foreach ((array)$raw as $src => $target) {
            $target = is_string($target) ? trim($target) : '';
            if ($target === '' || !in_array($target, $validFields, true)) {
                continue;
            }
            foreach ($headers as $h) {
                if (strcasecmp($h, (string)$src) === 0) {
                    $mapping[$h] = $target;
                    break;
                }
            }
        }

        $mappedTargets = array_values($mapping);
        return [
            'mapping'           => $mapping,
            'source_columns'    => $headers,
            'target_fields'     => $validFields,
            'required_fields'   => $info['required_fields'],
            'unmapped_required' => array_values(array_diff($info['required_fields'], $mappedTargets)),
        ];
    }

    public static function template(string $module): array
    {
        $info = self::moduleInfo($module);
        $headers = array_keys($info['sample']);
        $handle = fopen('php://temp', 'r+');
        fputcsv($handle, $headers);
        fputcsv($handle, array_values($info['sample']));
        rewind($handle);
        $content = stream_get_contents($handle) ?: '';
        fclose($handle);

        return [
            'filename' => $module . '-import-template.csv',
            'content' => $content,
        ];
    }

    public static function dryRun(string $module, int $jobId, array $mapping): array
    {
        $info = self::moduleInfo($module);
        if ($module === 'employees') {
            return HrImport::dryRunEmployees($jobId, $mapping);
        }
        if ($module === 'attendance_punches') {
            return HrImport::dryRunAttendance($jobId, $mapping);
        }

        ImportEngine::dryRun($jobId, $mapping, $info['required_fields']);
        self::validateRows($jobId, $module);
        return ImportEngine::getJob($jobId, true);
    }

    public static function commit(string $module, int $jobId, ?int $actorId): array
    {
        $info = self::moduleInfo($module);
        self::assertJobModule($jobId, (string)$info['job_module']);

        if ($module === 'employees') {
            return HrImport::commitEmployees($jobId);
        }
        if ($module === 'attendance_punches') {
            return HrImport::commitAttendance($jobId);
        }

        $rows = Database::fetchAll(
            'SELECT row_id, `row_number`, raw_json FROM import_job_rows WHERE job_id = ? AND status = "valid" ORDER BY `row_number` ASC',
            [$jobId]
        );
        if (!$rows) {
            Response::error('No valid rows to import', 422);
        }

        $summary = ['created' => 0, 'updated' => 0, 'skipped' => 0];
        Database::beginTransaction();
        try {
            foreach ($rows as $row) {
                $result = self::commitRow($module, self::mapped($row), $jobId, $actorId);
                $summary[$result] = ($summary[$result] ?? 0) + 1;
                Database::execute('UPDATE import_job_rows SET status = "imported", error_text = NULL WHERE row_id = ?', [(int)$row['row_id']]);
            }
            Database::execute('UPDATE import_jobs SET status = "committed", updated_at = NOW() WHERE job_id = ?', [$jobId]);
            self::audit($actorId, 'import_committed', 'import_jobs', $jobId, null, ['module' => $module, 'summary' => $summary]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            Database::execute('UPDATE import_jobs SET status = "failed", updated_at = NOW() WHERE job_id = ?', [$jobId]);
            error_log("Import commit failed for {$module}: " . $e->getMessage());
            Response::error('Import commit failed', 500);
        }

        $job = ImportEngine::getJob($jobId, true);
        $job['commit_summary'] = $summary;
        return $job;
    }

    private static function commitRow(string $module, array $mapped, int $jobId, ?int $actorId): string
    {
        return match ($module) {
            'vendors' => self::commitVendor($mapped),
            'customers' => self::commitCustomer($mapped, $actorId),
            'products' => self::commitProduct($mapped),
            'expenses' => self::commitExpense($mapped, $actorId),
            'historical_invoices' => self::commitHistoricalInvoice($mapped, $jobId),
            'tms_tasks' => self::commitTmsTask($mapped, $jobId),
            default => 'skipped',
        };
    }

    private static function validateRows(int $jobId, string $module): void
    {
        $rows = Database::fetchAll(
            'SELECT row_id, raw_json, status FROM import_job_rows WHERE job_id = ? ORDER BY `row_number` ASC',
            [$jobId]
        );
        $total = 0;
        $valid = 0;
        $errors = 0;
        foreach ($rows as $row) {
            $total++;
            if ((string)$row['status'] !== 'valid') {
                $errors++;
                continue;
            }
            $rowErrors = self::validateMappedRow($module, self::mapped($row));
            if ($rowErrors) {
                $errors++;
                Database::execute(
                    'UPDATE import_job_rows SET status = "invalid", error_text = ? WHERE row_id = ?',
                    [implode('; ', $rowErrors), (int)$row['row_id']]
                );
            } else {
                $valid++;
            }
        }
        Database::execute(
            'UPDATE import_jobs SET total_rows = ?, valid_rows = ?, error_rows = ?, updated_at = NOW() WHERE job_id = ?',
            [$total, $valid, $errors, $jobId]
        );
    }

    private static function validateMappedRow(string $module, array $mapped): array
    {
        $errors = [];
        foreach (self::moduleInfo($module)['required_fields'] as $field) {
            if (self::value($mapped, $field) === '') {
                $errors[] = "{$field} is required";
            }
        }
        foreach (['expense_date', 'invoice_date', 'task_date'] as $field) {
            $value = self::value($mapped, $field);
            if ($value !== '' && !self::validDate($value)) {
                $errors[] = "{$field} must be YYYY-MM-DD";
            }
        }
        foreach (['amount', 'base_price', 'quantity', 'unit_cost', 'subtotal', 'gst_rate', 'gst_amount', 'total', 'item_quantity', 'item_price', 'item_total'] as $field) {
            $value = self::value($mapped, $field);
            if ($value !== '' && !is_numeric($value)) {
                $errors[] = "{$field} must be numeric";
            }
        }
        if ($module === 'customers') {
            $type = strtolower(self::value($mapped, 'user_type') ?: 'customer');
            if (!in_array($type, ['customer', 'dealer'], true)) {
                $errors[] = 'user_type must be customer or dealer';
            }
        }
        if ($module === 'expenses') {
            $mode = self::value($mapped, 'payment_mode') ?: 'Cash';
            if (!in_array($mode, ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Card'], true)) {
                $errors[] = 'payment_mode is invalid';
            }
        }
        if ($module === 'historical_invoices') {
            $status = self::value($mapped, 'status') ?: 'Unpaid';
            if (!in_array($status, ['Draft', 'Sent', 'Paid', 'Unpaid', 'Overdue', 'Cancelled'], true)) {
                $errors[] = 'status is invalid';
            }
        }
        return $errors;
    }

    private static function commitVendor(array $m): string
    {
        $gstin = strtoupper(self::value($m, 'gstin'));
        $name = self::value($m, 'name');
        $existing = $gstin !== ''
            ? Database::fetch('SELECT * FROM vendors WHERE UPPER(gstin) = ? LIMIT 1', [$gstin])
            : Database::fetch('SELECT * FROM vendors WHERE LOWER(name) = ? LIMIT 1', [strtolower($name)]);
        $v = static fn(string $field, ?string $column = null): string => self::valueFor($m, $field, $existing, $column);
        $data = [
            'vendor_code' => $v('vendor_code'),
            'name' => $name,
            'gstin' => $gstin,
            'contact_name' => $v('contact_name'),
            'phone' => $v('phone'),
            'email' => strtolower($v('email')),
            'address' => $v('address'),
            'city' => $v('city'),
            'state' => $v('state'),
            'pincode' => $v('pincode'),
            'payment_terms' => $v('payment_terms'),
            'notes' => $v('notes'),
            'is_active' => 1,
        ];
        if ($existing) {
            Vendor::update((int)$existing['vendor_id'], $data);
            return 'updated';
        }
        Vendor::create($data);
        return 'created';
    }

    private static function commitCustomer(array $m, ?int $actorId): string
    {
        $phone = self::value($m, 'phone');
        $existing = Database::fetch('SELECT * FROM users WHERE phone = ? LIMIT 1', [$phone]);
        $v = static fn(string $field, ?string $column = null): string => self::valueFor($m, $field, $existing, $column);
        $email = strtolower($v('email'));
        if ($email === '') {
            $email = preg_replace('/\D+/', '', $phone) . '@import.ecosudar.local';
        }
        $data = [
            'name' => self::value($m, 'name'),
            'email' => $email,
            'phone' => $phone,
            'user_type' => strtolower($v('user_type') ?: 'customer'),
            'company_name' => $v('company_name'),
            'address' => $v('address'),
            'city' => $v('city'),
            'state' => $v('state'),
            'pincode' => $v('pincode'),
            'gst_number' => strtoupper($v('gst_number')),
            'udyam_number' => $v('udyam_number'),
        ];
        if ($existing) {
            Database::execute(
                'UPDATE users
                 SET name = ?, email = ?, user_type = ?, company_name = ?, address = ?, city = ?,
                     state = ?, pincode = ?, gst_number = ?, udyam_number = ?, is_active = 1,
                     approval_status = "approved", approved_by = COALESCE(approved_by, ?), updated_at = NOW()
                 WHERE user_id = ?',
                [
                    $data['name'], $data['email'], $data['user_type'], $data['company_name'] ?: null,
                    $data['address'] ?: null, $data['city'] ?: null, $data['state'] ?: null,
                    $data['pincode'] ?: null, $data['gst_number'] ?: null, $data['udyam_number'] ?: null,
                    $actorId, (int)$existing['user_id'],
                ]
            );
            return 'updated';
        }
        Database::insert(
            'INSERT INTO users
                (name, email, phone, password_hash, user_type, company_name, address, city, state,
                 pincode, gst_number, udyam_number, is_active, approval_status, approved_at, approved_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, "approved", NOW(), ?, NOW())',
            [
                $data['name'], $data['email'], $data['phone'],
                password_hash(bin2hex(random_bytes(12)), PASSWORD_DEFAULT),
                $data['user_type'], $data['company_name'] ?: null, $data['address'] ?: null,
                $data['city'] ?: null, $data['state'] ?: null, $data['pincode'] ?: null,
                $data['gst_number'] ?: null, $data['udyam_number'] ?: null, $actorId,
            ]
        );
        return 'created';
    }

    private static function commitProduct(array $m): string
    {
        $name = self::value($m, 'product_name');
        $existing = Database::fetch('SELECT * FROM products WHERE LOWER(product_name) = ? LIMIT 1', [strtolower($name)]);
        $v = static fn(string $field, ?string $column = null): string => self::valueFor($m, $field, $existing, $column);
        $params = [
            $name,
            strtolower(self::value($m, 'product_type') ?: $v('product_type')),
            $v('description') ?: null,
            (float)(self::value($m, 'base_price') ?: $v('base_price')),
            $v('unit') ?: 'kg',
            $v('gcv') ?: null,
            $v('ash_content') ?: null,
            $v('moisture_content') ?: null,
            $v('category') ?: null,
            self::boolValue(self::value($m, 'is_available') !== '' ? self::value($m, 'is_available') : ($v('is_available') ?: '1')) ? 1 : 0,
        ];
        if ($existing) {
            Database::execute(
                'UPDATE products
                 SET product_name = ?, product_type = ?, description = ?, base_price = ?, unit = ?,
                     gcv = ?, ash_content = ?, moisture_content = ?, category = ?, is_available = ?, updated_at = NOW()
                 WHERE product_id = ?',
                [...$params, (int)$existing['product_id']]
            );
            return 'updated';
        }
        Database::insert(
            'INSERT INTO products
                (product_name, product_type, description, base_price, unit, gcv, ash_content,
                 moisture_content, category, is_available, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            $params
        );
        return 'created';
    }

    private static function commitExpense(array $m, ?int $actorId): string
    {
        $code = self::value($m, 'expense_code');
        $date = self::value($m, 'expense_date');
        $vendor = self::value($m, 'vendor');
        $amount = round((float)self::value($m, 'amount'), 2);
        $existing = $code !== ''
            ? Database::fetch('SELECT * FROM expenses WHERE expense_code = ? LIMIT 1', [$code])
            : Database::fetch('SELECT * FROM expenses WHERE expense_date = ? AND vendor = ? AND amount = ? LIMIT 1', [$date, $vendor, $amount]);
        $v = static fn(string $field, ?string $column = null): string => self::valueFor($m, $field, $existing, $column);
        if ($code === '') {
            $count = Database::count('SELECT COUNT(*) AS cnt FROM expenses');
            $code = 'EXP-' . str_pad((string)($count + 1), 4, '0', STR_PAD_LEFT);
        }
        $params = [
            $code, $date, self::value($m, 'category') ?: $v('category'), $vendor,
            $v('description') ?: null, $amount,
            self::value($m, 'payment_mode') ?: ($v('payment_mode') ?: 'Cash'), $v('bill_url') ?: null, $actorId,
        ];
        if ($existing) {
            Database::execute(
                'UPDATE expenses
                 SET expense_code = ?, expense_date = ?, category = ?, vendor = ?, description = ?,
                     amount = ?, payment_mode = ?, bill_url = ?, created_by = COALESCE(created_by, ?), updated_at = NOW()
                 WHERE expense_id = ?',
                [...$params, (int)$existing['expense_id']]
            );
            return 'updated';
        }
        Database::insert(
            'INSERT INTO expenses
                (expense_code, expense_date, category, vendor, description, amount, payment_mode, bill_url, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            $params
        );
        return 'created';
    }

    /**
     * TMS task status — daily per-employee task completion.
     * status "Yes/Y/1/true/done/completed" → green (completed); anything else → red.
     * Re-uploading the same employee+date+task updates the existing mark (no dupes).
     */
    private static function commitTmsTask(array $m, int $jobId): string
    {
        $employeeKey = self::value($m, 'employee_key');
        $date        = self::value($m, 'task_date');
        $task        = self::value($m, 'task');
        $raw         = strtolower(self::value($m, 'status'));
        $completed   = in_array($raw, ['1', 'true', 'yes', 'y', 'done', 'completed', 'green', 'ok'], true) ? 1 : 0;
        $status      = $completed ? 'green' : 'red';

        $existing = Database::fetch(
            'SELECT tms_task_id FROM tms_tasks WHERE employee_key = ? AND task_date = ? AND task = ? LIMIT 1',
            [$employeeKey, $date, $task]
        );
        if ($existing) {
            Database::execute(
                'UPDATE tms_tasks SET completed = ?, status = ?, import_job_id = ?, updated_at = NOW() WHERE tms_task_id = ?',
                [$completed, $status, $jobId, (int)$existing['tms_task_id']]
            );
            return 'updated';
        }
        Database::insert(
            'INSERT INTO tms_tasks (employee_key, task_date, task, completed, status, import_job_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NOW())',
            [$employeeKey, $date, $task, $completed, $status, $jobId]
        );
        return 'created';
    }

    /**
     * Historical (past) invoices are written to a SEPARATE `historical_invoices` table —
     * never to the live `invoices` table — so migrated legacy billing data stays isolated
     * from order-linked invoices, GST filing and receivables. The real bill date is stored
     * in `invoice_date` so the Invoices "Past" view can filter/sort by the actual date.
     */
    private static function commitHistoricalInvoice(array $m, int $jobId): string
    {
        $number = self::value($m, 'invoice_number');
        $existing = Database::fetch('SELECT * FROM historical_invoices WHERE invoice_number = ? LIMIT 1', [$number]);
        $v = static fn(string $field, ?string $column = null): string => self::valueFor($m, $field, $existing, $column);
        $subtotal = round((float)(self::value($m, 'subtotal') ?: $v('subtotal') ?: self::value($m, 'total')), 2);
        $gstRate = round((float)(self::value($m, 'gst_rate') ?: $v('gst_rate') ?: 0), 2);
        $total = round((float)(self::value($m, 'total') ?: $v('total')), 2);
        $gstInput = self::value($m, 'gst_amount');
        $gstAmount = round($gstInput !== '' ? (float)$gstInput : (float)($v('gst_amount') ?: max(0, $total - $subtotal)), 2);
        $invoiceDate = self::value($m, 'invoice_date') ?: $v('invoice_date') ?: date('Y-m-d');
        $dueDate = self::value($m, 'due_date') ?: ($v('due_date') ?: null);
        $status = self::value($m, 'status') ?: ($v('status') ?: 'Unpaid');
        $params = [
            $number, $invoiceDate, $dueDate,
            $v('customer_name') ?: null, strtoupper($v('customer_gstin')) ?: null,
            $v('customer_state') ?: null, $v('customer_address') ?: null,
            $subtotal, $gstRate, $gstAmount, 0, 0, $gstAmount, 0, $total,
            $status, $v('payment_method') ?: null, $v('notes') ?: null, $jobId,
        ];
        if ($existing) {
            $invoiceId = (int)$existing['historical_invoice_id'];
            Database::execute(
                'UPDATE historical_invoices
                 SET invoice_number = ?, invoice_date = ?, due_date = ?, customer_name = ?, customer_gstin = ?,
                     customer_state = ?, customer_address = ?, subtotal = ?, gst_rate = ?, gst_amount = ?,
                     cgst_amount = ?, sgst_amount = ?, igst_amount = ?, delivery_fee = ?, total = ?,
                     status = ?, payment_method = ?, notes = ?, import_job_id = ?, updated_at = NOW()
                 WHERE historical_invoice_id = ?',
                [...$params, $invoiceId]
            );
            self::commitHistoricalInvoiceItem($m, $invoiceId, $gstRate);
            return 'updated';
        }
        $invoiceId = (int)Database::insert(
            'INSERT INTO historical_invoices
                (invoice_number, invoice_date, due_date, customer_name, customer_gstin, customer_state,
                 customer_address, subtotal, gst_rate, gst_amount, cgst_amount, sgst_amount, igst_amount,
                 delivery_fee, total, status, payment_method, notes, import_job_id, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            $params
        );
        self::commitHistoricalInvoiceItem($m, $invoiceId, $gstRate);
        return 'created';
    }

    /**
     * Upsert a single line item for a historical invoice. One CSV row = one line item;
     * to record a multi-line invoice, repeat the invoice_number across rows with
     * different item columns. Idempotent on (invoice_id, description) so re-importing
     * the same file updates the line rather than duplicating it.
     */
    private static function commitHistoricalInvoiceItem(array $m, int $invoiceId, float $invoiceGstRate): void
    {
        $description = self::value($m, 'item_name');
        if ($description === '' || $invoiceId <= 0) {
            return; // no item columns mapped — invoice-level totals only
        }
        $quantity = round((float)(self::value($m, 'item_quantity') ?: '1'), 3);
        $unit     = self::value($m, 'item_unit') ?: 'Nos';
        $hsn      = self::value($m, 'item_hsn') ?: null;
        $gstRate  = round((float)(self::value($m, 'item_gst_rate') ?: (string)$invoiceGstRate), 2);
        $lineTotalInput = self::value($m, 'item_total');
        $unitPrice = round((float)(self::value($m, 'item_price') ?: '0'), 2);
        $lineTotal = round($lineTotalInput !== '' ? (float)$lineTotalInput : $quantity * $unitPrice, 2);
        if ($unitPrice <= 0 && $quantity > 0 && $lineTotal > 0) {
            $unitPrice = round($lineTotal / $quantity, 2); // back-fill unit price from line total
        }
        Database::execute(
            'INSERT INTO historical_invoice_items
                (historical_invoice_id, description, hsn_code, quantity, unit, unit_price, gst_rate, line_total, sort_order)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0)
             ON DUPLICATE KEY UPDATE
                hsn_code = VALUES(hsn_code), quantity = VALUES(quantity), unit = VALUES(unit),
                unit_price = VALUES(unit_price), gst_rate = VALUES(gst_rate), line_total = VALUES(line_total)',
            [$invoiceId, $description, $hsn, $quantity, $unit, $unitPrice, $gstRate, $lineTotal]
        );
    }

    private static function resolveProduct(array $m): ?array
    {
        $id = (int)self::value($m, 'product_id');
        if ($id > 0) {
            return Database::fetch('SELECT product_id, product_name FROM products WHERE product_id = ? LIMIT 1', [$id]);
        }
        $name = self::value($m, 'product_name');
        return $name === '' ? null : Database::fetch('SELECT product_id, product_name FROM products WHERE LOWER(product_name) = ? LIMIT 1', [strtolower($name)]);
    }

    private static function assertJobModule(int $jobId, string $jobModule): void
    {
        $job = Database::fetch('SELECT module, status FROM import_jobs WHERE job_id = ? LIMIT 1', [$jobId]);
        if (!$job) {
            Response::error('Import job not found', 404);
        }
        if ((string)$job['module'] !== $jobModule) {
            Response::error('Import job does not match requested module', 422);
        }
        if ((string)$job['status'] !== 'dry_run') {
            Response::error('Run dry-run validation before commit', 422);
        }
    }

    private static function mapped(array $row): array
    {
        $raw = json_decode((string)($row['raw_json'] ?? '{}'), true);
        return is_array($raw) && isset($raw['mapped']) && is_array($raw['mapped']) ? $raw['mapped'] : [];
    }

    private static function value(array $mapped, string $key): string
    {
        return trim((string)($mapped[$key] ?? ''));
    }

    private static function valueFor(array $mapped, string $field, ?array $existing, ?string $column = null): string
    {
        if (array_key_exists($field, $mapped)) {
            return trim((string)$mapped[$field]);
        }
        if ($existing === null) {
            return '';
        }
        return trim((string)($existing[$column ?? $field] ?? ''));
    }

    private static function boolValue(string $value): bool
    {
        return in_array(strtolower(trim($value)), ['1', 'true', 'yes', 'on', 'available', 'active'], true);
    }

    private static function validDate(string $value): bool
    {
        return (bool)(preg_match('/^\d{4}-\d{2}-\d{2}$/', $value) && strtotime($value));
    }

    private static function normalizeModule(string $module): string
    {
        return strtolower(trim($module));
    }

    private static function module(string $label, string $jobModule, array $required, array $sample, string $naturalKey): array
    {
        $fields = [];
        foreach ($sample as $field => $value) {
            $fields[] = [
                'name' => $field,
                'required' => in_array($field, $required, true),
                'sample' => $value,
            ];
        }
        return [
            'label' => $label,
            'job_module' => $jobModule,
            'required_fields' => $required,
            'natural_key' => $naturalKey,
            'fields' => $fields,
            'sample' => $sample,
        ];
    }

    private static function audit(?int $actorId, string $action, string $table, int $recordId, mixed $before, mixed $after): void
    {
        Database::execute(
            'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, NULL, NOW())',
            [
                $actorId,
                $action,
                $table,
                $recordId,
                $before !== null ? json_encode($before) : null,
                $after !== null ? json_encode($after) : null,
            ]
        );
    }
}
