<?php
declare(strict_types=1);

class SalesDocument
{
    public const TYPES = ['quotation', 'proforma', 'delivery_challan', 'sales_order'];

    /** Document-number prefix per type (used by NumberSequence). */
    public const NUMBER_PREFIX = [
        'quotation'        => 'QTN',
        'proforma'         => 'PFI',
        'delivery_challan' => 'DC',
        'sales_order'      => 'SO',
    ];
    public const STATUSES = ['draft', 'sent', 'accepted', 'rejected', 'expired', 'converted', 'cancelled'];

    public static function all(array $filters, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['document_type']) && in_array($filters['document_type'], self::TYPES, true)) {
            $where[] = 'sd.document_type = ?';
            $params[] = $filters['document_type'];
        }
        if (!empty($filters['status']) && in_array($filters['status'], self::STATUSES, true)) {
            $where[] = 'sd.status = ?';
            $params[] = $filters['status'];
        }
        if (!empty($filters['user_id'])) {
            $where[] = 'sd.user_id = ?';
            $params[] = (int)$filters['user_id'];
        }
        if (!empty($filters['from'])) {
            $where[] = 'sd.document_date >= ?';
            $params[] = $filters['from'];
        }
        if (!empty($filters['to'])) {
            $where[] = 'sd.document_date <= ?';
            $params[] = $filters['to'];
        }
        if (!empty($filters['search'])) {
            $like = '%' . trim((string)$filters['search']) . '%';
            $where[] = '(sd.document_number LIKE ? OR sd.customer_name LIKE ? OR sd.customer_email LIKE ? OR sd.customer_phone LIKE ? OR sd.customer_gstin LIKE ?)';
            array_push($params, $like, $like, $like, $like, $like);
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count("SELECT COUNT(*) AS cnt FROM sales_documents sd WHERE $whereClause", $params);
        $rows = Database::fetchAll(
            "SELECT sd.*, inv.invoice_number, converted.document_number AS converted_document_number
             FROM sales_documents sd
             LEFT JOIN invoices inv ON inv.invoice_id = sd.invoice_id
             LEFT JOIN sales_documents converted ON converted.document_id = sd.converted_document_id
             WHERE $whereClause
             ORDER BY sd.document_date DESC, sd.document_id DESC
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
            "SELECT sd.*, inv.invoice_number, converted.document_number AS converted_document_number
             FROM sales_documents sd
             LEFT JOIN invoices inv ON inv.invoice_id = sd.invoice_id
             LEFT JOIN sales_documents converted ON converted.document_id = sd.converted_document_id
             WHERE sd.document_id = ?
             LIMIT 1",
            [$id]
        );
        if (!$row) {
            return null;
        }
        $row['items'] = self::items($id);

        return self::formatDetail($row);
    }

    public static function raw(int $id): ?array
    {
        return Database::fetch('SELECT * FROM sales_documents WHERE document_id = ? LIMIT 1', [$id]);
    }

    public static function items(int $id): array
    {
        return Database::fetchAll(
            'SELECT sdi.*, p.product_name
             FROM sales_document_items sdi
             LEFT JOIN products p ON p.product_id = sdi.product_id
             WHERE sdi.document_id = ?
             ORDER BY sdi.sort_order ASC, sdi.item_id ASC',
            [$id]
        );
    }

    public static function create(array $data, array $items): int
    {
        $totals = self::totals($items, $data);
        $id = Database::insert(
            'INSERT INTO sales_documents
                (document_type, document_number, source_quote_id, source_document_id, user_id,
                 customer_name, customer_email, customer_phone, customer_gstin, customer_state,
                 customer_address, customer_city, customer_pincode, customer_country, seller_state,
                 document_date, valid_until, due_date, payment_terms, place_of_supply, ship_to, subject,
                 subtotal, gst_rate, gst_amount, cgst_amount, sgst_amount, igst_amount, delivery_fee,
                 discount, total, status, terms, notes, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "draft", ?, ?, ?, NOW())',
            [
                $data['document_type'],
                $data['document_number'],
                $data['source_quote_id'] ?: null,
                $data['source_document_id'] ?: null,
                $data['user_id'] ?: null,
                $data['customer_name'],
                $data['customer_email'] ?: null,
                $data['customer_phone'] ?: null,
                $data['customer_gstin'] ?: null,
                $data['customer_state'] ?: null,
                $data['customer_address'] ?: null,
                $data['customer_city'] ?: null,
                $data['customer_pincode'] ?: null,
                $data['customer_country'] ?: null,
                $data['seller_state'] ?: 'Tamil Nadu',
                $data['document_date'],
                $data['valid_until'] ?: null,
                $data['due_date'] ?: null,
                $data['payment_terms'] ?: null,
                $data['place_of_supply'] ?: null,
                $data['ship_to'] ?: null,
                $data['subject'] ?: null,
                $totals['subtotal'],
                $totals['gst_rate'],
                $totals['gst_amount'],
                $totals['cgst_amount'],
                $totals['sgst_amount'],
                $totals['igst_amount'],
                $totals['delivery_fee'],
                $totals['discount'],
                $totals['total'],
                $data['terms'] ?: null,
                $data['notes'] ?: null,
                $data['created_by'] ?? null,
            ]
        );
        self::replaceItems($id, $items);

        return $id;
    }

    public static function updateEditable(int $id, array $data, ?array $items): void
    {
        if ($items !== null) {
            self::replaceItems($id, $items);
        }

        $needsTotals = $items !== null || array_intersect(array_keys($data), ['customer_state', 'seller_state', 'delivery_fee', 'discount']);
        if ($needsTotals) {
            $current = self::raw($id) ?: [];
            $currentItems = $items ?? self::items($id);
            $totals = self::totals($currentItems, $data + $current);
            $data = $data + [
                'subtotal' => $totals['subtotal'],
                'gst_rate' => $totals['gst_rate'],
                'gst_amount' => $totals['gst_amount'],
                'cgst_amount' => $totals['cgst_amount'],
                'sgst_amount' => $totals['sgst_amount'],
                'igst_amount' => $totals['igst_amount'],
                'delivery_fee' => $totals['delivery_fee'],
                'discount' => $totals['discount'],
                'total' => $totals['total'],
            ];
        }

        $allowed = [
            'source_quote_id', 'user_id', 'customer_name', 'customer_email', 'customer_phone',
            'customer_gstin', 'customer_state', 'customer_address', 'customer_city',
            'customer_pincode', 'customer_country', 'seller_state', 'document_date',
            'valid_until', 'due_date', 'payment_terms', 'place_of_supply', 'ship_to',
            'subject', 'subtotal', 'gst_rate', 'gst_amount', 'cgst_amount', 'sgst_amount',
            'igst_amount', 'delivery_fee', 'discount', 'total', 'terms', 'notes',
        ];
        $sets = [];
        $params = [];
        foreach ($allowed as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $sets[] = "$field = ?";
            $params[] = self::emptyToNull($data[$field]);
        }

        if (!empty($sets)) {
            $params[] = $id;
            Database::execute(
                'UPDATE sales_documents SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE document_id = ?',
                $params
            );
        }
    }

    public static function transition(int $id, string $status): void
    {
        Database::execute('UPDATE sales_documents SET status = ?, updated_at = NOW() WHERE document_id = ?', [$status, $id]);
    }

    public static function convertQuotationToProforma(int $quotationId, int $actorId): int
    {
        $source = self::raw($quotationId);
        if (!$source || $source['document_type'] !== 'quotation') {
            Response::error('Quotation not found', 404);
        }
        if (!in_array($source['status'], ['sent', 'accepted'], true)) {
            Response::error('Only sent or accepted quotations can be converted', 409);
        }
        if (!empty($source['converted_document_id'])) {
            Response::error('Quotation is already converted', 409);
        }

        $items = self::items($quotationId);
        $data = $source;
        $data['document_type'] = 'proforma';
        $data['document_number'] = NumberSequence::next('PFI');
        $data['source_document_id'] = $quotationId;
        $data['created_by'] = $actorId ?: null;
        $data['document_date'] = date('Y-m-d');
        $newId = self::create($data, $items);
        Database::execute(
            'UPDATE sales_documents
             SET status = "converted", converted_document_id = ?, updated_at = NOW()
             WHERE document_id = ?',
            [$newId, $quotationId]
        );

        return $newId;
    }

    public static function convertProformaToInvoice(int $proformaId): int
    {
        $doc = self::raw($proformaId);
        if (!$doc || $doc['document_type'] !== 'proforma') {
            Response::error('Proforma invoice not found', 404);
        }
        if (!in_array($doc['status'], ['sent', 'accepted'], true)) {
            Response::error('Only sent or accepted proformas can be converted to invoice', 409);
        }
        if (!empty($doc['invoice_id'])) {
            Response::error('Proforma is already converted to invoice', 409);
        }

        $invoiceId = self::createInvoiceFromDoc($doc);
        Database::execute(
            'UPDATE sales_documents
             SET status = "converted", invoice_id = ?, updated_at = NOW()
             WHERE document_id = ?',
            [$invoiceId, $proformaId]
        );

        return $invoiceId;
    }

    /** Create an invoice (+ its line items) from any sales-document row. Returns the new invoice_id. */
    private static function createInvoiceFromDoc(array $doc): int
    {
        $invoiceNumber = NumberSequence::next('INV');
        $invoiceId = Database::insert(
            'INSERT INTO invoices
                (invoice_number, order_id, customer_name, customer_gstin, customer_state,
                 customer_address, customer_city, customer_pincode, customer_country, seller_state,
                 due_date, invoice_date, payment_terms, place_of_supply, ship_to, subject,
                 subtotal, gst_rate, gst_amount, cgst_amount, sgst_amount, igst_amount,
                 delivery_fee, discount, total, status, payment_method, payment_status,
                 amount_paid, notes, created_at)
             VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "Sent", NULL, "unpaid", 0.00, ?, NOW())',
            [
                $invoiceNumber,
                $doc['customer_name'],
                $doc['customer_gstin'] ?: null,
                $doc['customer_state'] ?: null,
                $doc['customer_address'] ?: null,
                $doc['customer_city'] ?: null,
                $doc['customer_pincode'] ?: null,
                $doc['customer_country'] ?: null,
                $doc['seller_state'] ?: 'Tamil Nadu',
                $doc['due_date'] ?: null,
                $doc['document_date'],
                $doc['payment_terms'] ?: null,
                $doc['place_of_supply'] ?: null,
                $doc['ship_to'] ?: null,
                $doc['subject'] ?: null,
                $doc['subtotal'],
                $doc['gst_rate'],
                $doc['gst_amount'],
                $doc['cgst_amount'],
                $doc['sgst_amount'],
                $doc['igst_amount'],
                $doc['delivery_fee'],
                $doc['discount'],
                $doc['total'],
                $doc['notes'] ?: null,
            ]
        );

        foreach (self::items((int)$doc['document_id']) as $item) {
            Database::insert(
                'INSERT INTO invoice_items
                    (invoice_id, description, hsn_code, quantity, unit, unit_price, gst_rate, line_total, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $invoiceId,
                    $item['description'],
                    $item['hsn_code'] ?: null,
                    $item['quantity'],
                    $item['unit'] ?: 'Nos',
                    $item['unit_price'],
                    $item['gst_rate'],
                    $item['line_total'],
                    $item['sort_order'],
                ]
            );
        }

        return $invoiceId;
    }

    /** Quotation → Sales Order. Copies the lines; marks the quotation converted. */
    public static function convertQuotationToSalesOrder(int $quotationId, int $actorId): int
    {
        $source = self::raw($quotationId);
        if (!$source || $source['document_type'] !== 'quotation') {
            Response::error('Quotation not found', 404);
        }
        if (!in_array($source['status'], ['sent', 'accepted'], true)) {
            Response::error('Only sent or accepted quotations can be converted', 409);
        }
        if (!empty($source['converted_document_id'])) {
            Response::error('Quotation is already converted', 409);
        }

        $items = self::items($quotationId);
        $data = $source;
        $data['document_type'] = 'sales_order';
        $data['document_number'] = NumberSequence::next('SO');
        $data['source_document_id'] = $quotationId;
        $data['created_by'] = $actorId ?: null;
        $data['document_date'] = date('Y-m-d');
        $newId = self::create($data, $items);
        Database::execute(
            'UPDATE sales_documents SET status = "converted", converted_document_id = ?, updated_at = NOW() WHERE document_id = ?',
            [$newId, $quotationId]
        );

        return $newId;
    }

    /** Sales Order → Tax Invoice. Does not move stock — the delivery challan does. */
    public static function convertSalesOrderToInvoice(int $soId): int
    {
        $doc = self::raw($soId);
        if (!$doc || $doc['document_type'] !== 'sales_order') {
            Response::error('Sales order not found', 404);
        }
        if (!in_array($doc['status'], ['sent', 'accepted', 'converted'], true)) {
            Response::error('Only sent, accepted or fulfilled sales orders can be invoiced', 409);
        }
        if (!empty($doc['invoice_id'])) {
            Response::error('Sales order is already invoiced', 409);
        }

        $invoiceId = self::createInvoiceFromDoc($doc);
        Database::execute(
            'UPDATE sales_documents SET invoice_id = ?, updated_at = NOW() WHERE document_id = ?',
            [$invoiceId, $soId]
        );

        return $invoiceId;
    }

    /**
     * Sales Order → Delivery Challan. This is where finished stock actually leaves:
     * posts an OUT stock movement and decrements products.stock_quantity per line
     * (the "stock moves only when a sale happens" rule). One challan per sales order.
     */
    public static function convertSalesOrderToDeliveryChallan(int $soId, int $actorId): int
    {
        $source = self::raw($soId);
        if (!$source || $source['document_type'] !== 'sales_order') {
            Response::error('Sales order not found', 404);
        }
        if (!in_array($source['status'], ['sent', 'accepted', 'converted'], true)) {
            Response::error('Only sent or accepted sales orders can be dispatched', 409);
        }
        if (Database::fetch('SELECT document_id FROM sales_documents WHERE document_type = "delivery_challan" AND source_document_id = ? LIMIT 1', [$soId])) {
            Response::error('A delivery challan already exists for this sales order', 409);
        }

        $items = self::items($soId);
        $data = $source;
        $data['document_type'] = 'delivery_challan';
        $data['document_number'] = NumberSequence::next('DC');
        $data['source_document_id'] = $soId;
        $data['created_by'] = $actorId ?: null;
        $data['document_date'] = date('Y-m-d');

        // Atomicity is owned by the controller's transaction around convert().
        $challanId = self::create($data, $items);
        $date = date('Y-m-d');
        foreach ($items as $it) {
            $pid = (int)($it['product_id'] ?? 0);
            $qty = (float)($it['quantity'] ?? 0);
            if ($pid <= 0 || $qty <= 0) continue;
            Database::insert(
                'INSERT INTO stock_movements (product_id, movement_type, source, quantity, reference, movement_date, created_by)
                 VALUES (?, "out", "order", ?, ?, ?, ?)',
                [$pid, $qty, $data['document_number'], $date, $actorId ?: null]
            );
            Database::execute('UPDATE products SET stock_quantity = GREATEST(stock_quantity - ?, 0) WHERE product_id = ?', [$qty, $pid]);
        }

        return $challanId;
    }

    public static function totals(array $items, array $data): array
    {
        $subtotal = 0.0;
        $gstTotal = 0.0;
        foreach ($items as $item) {
            $lineTotal = round((float)$item['quantity'] * (float)$item['unit_price'], 2);
            $subtotal += $lineTotal;
            $gstTotal += round($lineTotal * ((float)($item['gst_rate'] ?? 0) / 100), 2);
        }

        $discount = max(0.0, round((float)($data['discount'] ?? 0), 2));
        $deliveryFee = max(0.0, round((float)($data['delivery_fee'] ?? 0), 2));
        $taxable = max(0.0, $subtotal - $discount);
        $discountFactor = $subtotal > 0 ? $taxable / $subtotal : 1.0;
        $adjustedGst = round($gstTotal * $discountFactor, 2);

        $customerState = strtolower(trim((string)($data['customer_state'] ?? '')));
        $sellerState = strtolower(trim((string)($data['seller_state'] ?? 'Tamil Nadu')));
        $interState = $customerState !== '' && $sellerState !== '' && $customerState !== $sellerState;

        $cgst = $sgst = $igst = 0.0;
        if ($interState) {
            $igst = $adjustedGst;
        } else {
            $cgst = round($adjustedGst / 2, 2);
            $sgst = round($adjustedGst - $cgst, 2);
        }

        return [
            'subtotal' => round($subtotal, 2),
            'gst_rate' => $taxable > 0 ? round(($adjustedGst / $taxable) * 100, 2) : 0.0,
            'gst_amount' => $adjustedGst,
            'cgst_amount' => $cgst,
            'sgst_amount' => $sgst,
            'igst_amount' => $igst,
            'delivery_fee' => $deliveryFee,
            'discount' => $discount,
            'total' => round($taxable + $adjustedGst + $deliveryFee, 2),
        ];
    }

    public static function formatSummary(array $row): array
    {
        return [
            'document_id' => (int)$row['document_id'],
            'id' => (string)$row['document_id'],
            'document_type' => $row['document_type'],
            'document_number' => $row['document_number'],
            'source_quote_id' => $row['source_quote_id'] ? (int)$row['source_quote_id'] : null,
            'source_document_id' => $row['source_document_id'] ? (int)$row['source_document_id'] : null,
            'converted_document_id' => $row['converted_document_id'] ? (int)$row['converted_document_id'] : null,
            'converted_document_number' => $row['converted_document_number'] ?? null,
            'invoice_id' => $row['invoice_id'] ? (int)$row['invoice_id'] : null,
            'invoice_number' => $row['invoice_number'] ?? null,
            'user_id' => $row['user_id'] ? (int)$row['user_id'] : null,
            'customer_name' => $row['customer_name'],
            'customer_email' => $row['customer_email'],
            'customer_phone' => $row['customer_phone'],
            'customer_gstin' => $row['customer_gstin'],
            'customer_state' => $row['customer_state'],
            'seller_state' => $row['seller_state'],
            'document_date' => $row['document_date'],
            'valid_until' => $row['valid_until'],
            'due_date' => $row['due_date'],
            'subtotal' => (float)$row['subtotal'],
            'gst_rate' => (float)$row['gst_rate'],
            'gst_amount' => (float)$row['gst_amount'],
            'cgst_amount' => (float)$row['cgst_amount'],
            'sgst_amount' => (float)$row['sgst_amount'],
            'igst_amount' => (float)$row['igst_amount'],
            'delivery_fee' => (float)$row['delivery_fee'],
            'discount' => (float)$row['discount'],
            'total' => (float)$row['total'],
            'status' => $row['status'],
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
    }

    public static function formatDetail(array $row): array
    {
        $out = self::formatSummary($row);
        foreach ([
            'customer_address', 'customer_city', 'customer_pincode', 'customer_country',
            'payment_terms', 'place_of_supply', 'ship_to', 'subject', 'terms', 'notes',
        ] as $field) {
            $out[$field] = $row[$field] ?? null;
        }
        $out['items'] = array_map([self::class, 'formatItem'], $row['items'] ?? []);

        return $out;
    }

    public static function formatItem(array $row): array
    {
        return [
            'item_id' => (int)$row['item_id'],
            'id' => (string)$row['item_id'],
            'document_id' => (int)$row['document_id'],
            'product_id' => $row['product_id'] ? (int)$row['product_id'] : null,
            'product_name' => $row['product_name'] ?? null,
            'description' => $row['description'],
            'hsn_code' => $row['hsn_code'],
            'quantity' => (float)$row['quantity'],
            'unit' => $row['unit'],
            'unit_price' => (float)$row['unit_price'],
            'gst_rate' => (float)$row['gst_rate'],
            'line_total' => (float)$row['line_total'],
            'sort_order' => (int)$row['sort_order'],
        ];
    }

    private static function replaceItems(int $id, array $items): void
    {
        Database::execute('DELETE FROM sales_document_items WHERE document_id = ?', [$id]);
        foreach ($items as $idx => $item) {
            Database::insert(
                'INSERT INTO sales_document_items
                    (document_id, product_id, description, hsn_code, quantity, unit, unit_price, gst_rate, line_total, sort_order)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
                [
                    $id,
                    $item['product_id'] ?: null,
                    $item['description'],
                    $item['hsn_code'] ?: null,
                    $item['quantity'],
                    $item['unit'] ?: 'Nos',
                    $item['unit_price'],
                    $item['gst_rate'],
                    round((float)$item['quantity'] * (float)$item['unit_price'], 2),
                    $item['sort_order'] ?? ($idx + 1),
                ]
            );
        }
    }

    private static function emptyToNull(mixed $value): mixed
    {
        return is_string($value) && trim($value) === '' ? null : $value;
    }
}
