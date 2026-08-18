<?php
declare(strict_types=1);

class AdminTestCertificateController
{
    public function index(Request $request): void
    {
        $result = TestCertificate::all(
            [
                'status' => $request->query('status'),
                'invoice_id' => $request->query('invoice_id'),
                'product_id' => $request->query('product_id'),
                'from' => $request->query('from'),
                'to' => $request->query('to'),
                'search' => $request->query('search'),
            ],
            (int)$request->query('page', 1),
            (int)$request->query('limit', 20)
        );
        Response::paginated($result['rows'], $result['pagination']);
    }

    public function store(Request $request): void
    {
        $data = $this->payload($request, true);

        Database::beginTransaction();
        try {
            $data['certificate_number'] = NumberSequence::next('CERT');
            $data['issued_by'] = $this->actorId($request) ?: null;
            $id = TestCertificate::create($data);
            $this->audit($request, 'test_certificate_created', 'test_certificates', $id, null, $data);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Test certificate create error: ' . $e->getMessage());
            Response::error('Could not create test certificate', 500);
        }

        Response::success(TestCertificate::findById($id), 'Test certificate created', 201);
    }

    public function show(Request $request): void
    {
        Response::success($this->certificateOrFail((int)$request->param('id')));
    }

    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $existing = $this->certificateOrFail($id);
        if ($existing['status'] !== 'draft') {
            Response::error('Only draft certificates can be edited', 409);
        }

        $data = $this->payload($request, false);
        if (empty($data)) {
            Response::error('Provide at least one field to update', 400);
        }

        Database::beginTransaction();
        try {
            TestCertificate::updateDraft($id, $data);
            $this->audit($request, 'test_certificate_updated', 'test_certificates', $id, $existing, $data);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Test certificate update error: ' . $e->getMessage());
            Response::error('Could not update test certificate', 500);
        }

        Response::success(TestCertificate::findById($id), 'Test certificate updated');
    }

    public function uploadDocument(Request $request): void
    {
        $id = (int)$request->param('id');
        $certificate = $this->certificateOrFail($id);
        if ($certificate['status'] === 'void') {
            Response::error('Cannot upload document for a void certificate', 409);
        }
        if (empty($_FILES['document'])) {
            Response::error('document file is required', 422);
        }

        Database::beginTransaction();
        try {
            $stored = FileStore::put('certificate', $_FILES['document'], 'certificates');
            $attachmentId = FileStore::createAttachment('test_certificate', $id, 'certificate', $stored, $this->actorId($request) ?: null);
            TestCertificate::attach($id, $attachmentId);
            if ((bool)$request->input('issue', false) && $certificate['status'] === 'draft') {
                TestCertificate::issue($id, $this->actorId($request));
            }
            $this->audit($request, 'test_certificate_document_uploaded', 'test_certificates', $id, $certificate, ['attachment_id' => $attachmentId]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Test certificate upload error: ' . $e->getMessage());
            Response::error('Could not upload certificate document', 500);
        }

        Response::success(TestCertificate::findById($id), 'Certificate document uploaded');
    }

    public function downloadDocument(Request $request): void
    {
        $certificate = $this->certificateOrFail((int)$request->param('id'));
        if (!$certificate['attachment_id']) {
            Response::error('Certificate document not uploaded', 404);
        }
        $attachment = Database::fetch(
            'SELECT * FROM attachments WHERE attachment_id = ? AND entity_type = "test_certificate" LIMIT 1',
            [$certificate['attachment_id']]
        );
        if (!$attachment) {
            Response::error('Certificate attachment not found', 404);
        }

        FileStore::stream(
            (string)$attachment['file_path'],
            $attachment['original_name'] ?: ($certificate['certificate_number'] . '.pdf'),
            $attachment['mime_type'] ?: null,
            true
        );
    }

    public function issue(Request $request): void
    {
        $id = (int)$request->param('id');
        $certificate = $this->certificateOrFail($id);
        if ($certificate['status'] !== 'draft') {
            Response::error('Only draft certificates can be issued', 409);
        }

        TestCertificate::issue($id, $this->actorId($request));
        $this->audit($request, 'test_certificate_issued', 'test_certificates', $id, ['status' => 'draft'], ['status' => 'issued']);
        Response::success(TestCertificate::findById($id), 'Test certificate issued');
    }

    public function void(Request $request): void
    {
        $id = (int)$request->param('id');
        $certificate = $this->certificateOrFail($id);
        if ($certificate['status'] === 'void') {
            Response::error('Certificate is already void', 409);
        }
        $reason = trim((string)$request->input('reason', ''));
        if ($reason === '') {
            Response::error('reason is required', 422);
        }

        TestCertificate::void($id, $this->actorId($request), Request::sanitize($reason));
        $this->audit($request, 'test_certificate_voided', 'test_certificates', $id, $certificate, ['reason' => $reason]);
        Response::success(TestCertificate::findById($id), 'Test certificate voided');
    }

    public function certificateData(Request $request): void
    {
        Response::success(['certificate' => $this->certificateOrFail((int)$request->param('id'))], 'Certificate data retrieved');
    }

    private function payload(Request $request, bool $creating): array
    {
        $keys = [
            'invoice_id', 'invoice_item_id', 'product_id', 'batch_no', 'certificate_type',
            'sample_date', 'issue_date', 'parameters', 'parameters_json', 'result_summary',
        ];
        $raw = $request->only($keys);
        $data = [];

        if ($creating) {
            $raw += [
                'invoice_id' => null,
                'invoice_item_id' => null,
                'product_id' => null,
                'batch_no' => '',
                'certificate_type' => 'quality',
                'sample_date' => null,
                'issue_date' => date('Y-m-d'),
                'parameters' => null,
                'result_summary' => '',
            ];
        }

        foreach (['invoice_id', 'invoice_item_id', 'product_id'] as $field) {
            if (array_key_exists($field, $raw)) {
                $data[$field] = $raw[$field] ? (int)$raw[$field] : null;
            }
        }
        if (!empty($data['invoice_id']) && !Database::fetch('SELECT invoice_id FROM invoices WHERE invoice_id = ? LIMIT 1', [$data['invoice_id']])) {
            Response::error('Invoice not found', 404);
        }
        if (!empty($data['invoice_item_id'])) {
            $item = Database::fetch('SELECT invoice_id FROM invoice_items WHERE item_id = ? LIMIT 1', [$data['invoice_item_id']]);
            if (!$item) {
                Response::error('Invoice item not found', 404);
            }
            if (!empty($data['invoice_id']) && (int)$item['invoice_id'] !== (int)$data['invoice_id']) {
                Response::error('invoice_item_id does not belong to invoice_id', 422);
            }
        }
        if (!empty($data['product_id']) && !Database::fetch('SELECT product_id FROM products WHERE product_id = ? LIMIT 1', [$data['product_id']])) {
            Response::error('Product not found', 404);
        }

        foreach (['batch_no', 'certificate_type', 'result_summary'] as $field) {
            if (array_key_exists($field, $raw)) {
                $data[$field] = Request::sanitize(trim((string)$raw[$field]));
            }
        }
        if ($creating && empty($data['certificate_type'])) {
            $data['certificate_type'] = 'quality';
        }
        foreach (['sample_date', 'issue_date'] as $field) {
            if (array_key_exists($field, $raw)) {
                $data[$field] = $raw[$field] ? Payment::validDateOrDefault((string)$raw[$field], date('Y-m-d')) : null;
            }
        }
        if ($creating && empty($data['issue_date'])) {
            $data['issue_date'] = date('Y-m-d');
        }
        if (array_key_exists('parameters_json', $raw) || array_key_exists('parameters', $raw)) {
            $data['parameters_json'] = TestCertificate::encodeParameters($raw['parameters_json'] ?? $raw['parameters'] ?? null);
        }

        return $data;
    }

    private function certificateOrFail(int $id): array
    {
        if ($id <= 0) {
            Response::error('Invalid certificate ID', 400);
        }
        $certificate = TestCertificate::findById($id);
        if (!$certificate) {
            Response::error('Test certificate not found', 404);
        }

        return $certificate;
    }

    private function actorId(Request $request): int
    {
        return isset($request->user['user_id']) ? (int)$request->user['user_id'] : 0;
    }

    private function audit(Request $request, string $action, string $table, int $id, mixed $before, mixed $after): void
    {
        Database::execute(
            'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $this->actorId($request) ?: null,
                $action,
                $table,
                $id,
                $before !== null ? json_encode($before) : null,
                $after !== null ? json_encode($after) : null,
                $request->ip(),
            ]
        );
    }
}
