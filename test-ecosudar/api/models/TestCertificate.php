<?php
declare(strict_types=1);

class TestCertificate
{
    public const STATUSES = ['draft', 'issued', 'void'];

    public static function all(array $filters, int $page, int $limit): array
    {
        $page = max(1, $page);
        $limit = min(100, max(1, $limit));
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['status']) && in_array($filters['status'], self::STATUSES, true)) {
            $where[] = 'tc.status = ?';
            $params[] = $filters['status'];
        }
        if (!empty($filters['invoice_id'])) {
            $where[] = 'tc.invoice_id = ?';
            $params[] = (int)$filters['invoice_id'];
        }
        if (!empty($filters['product_id'])) {
            $where[] = 'tc.product_id = ?';
            $params[] = (int)$filters['product_id'];
        }
        if (!empty($filters['from'])) {
            $where[] = 'tc.issue_date >= ?';
            $params[] = $filters['from'];
        }
        if (!empty($filters['to'])) {
            $where[] = 'tc.issue_date <= ?';
            $params[] = $filters['to'];
        }
        if (!empty($filters['search'])) {
            $like = '%' . trim((string)$filters['search']) . '%';
            $where[] = '(tc.certificate_number LIKE ? OR tc.batch_no LIKE ? OR i.invoice_number LIKE ? OR p.product_name LIKE ?)';
            array_push($params, $like, $like, $like, $like);
        }

        $whereClause = implode(' AND ', $where);
        $total = Database::count(
            "SELECT COUNT(*) AS cnt
             FROM test_certificates tc
             LEFT JOIN invoices i ON i.invoice_id = tc.invoice_id
             LEFT JOIN products p ON p.product_id = tc.product_id
             WHERE $whereClause",
            $params
        );
        $rows = Database::fetchAll(
            "SELECT tc.*, i.invoice_number, p.product_name, a.original_name AS attachment_name
             FROM test_certificates tc
             LEFT JOIN invoices i ON i.invoice_id = tc.invoice_id
             LEFT JOIN products p ON p.product_id = tc.product_id
             LEFT JOIN attachments a ON a.attachment_id = tc.attachment_id
             WHERE $whereClause
             ORDER BY tc.issue_date DESC, tc.certificate_id DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, ($page - 1) * $limit]
        );

        return [
            'rows' => array_map([self::class, 'format'], $rows),
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
            "SELECT tc.*, i.invoice_number, p.product_name, a.original_name AS attachment_name,
                    a.file_path AS attachment_path, a.mime_type AS attachment_mime
             FROM test_certificates tc
             LEFT JOIN invoices i ON i.invoice_id = tc.invoice_id
             LEFT JOIN products p ON p.product_id = tc.product_id
             LEFT JOIN attachments a ON a.attachment_id = tc.attachment_id
             WHERE tc.certificate_id = ?
             LIMIT 1",
            [$id]
        );

        return $row ? self::format($row, true) : null;
    }

    public static function raw(int $id): ?array
    {
        return Database::fetch('SELECT * FROM test_certificates WHERE certificate_id = ? LIMIT 1', [$id]);
    }

    public static function create(array $data): int
    {
        return Database::insert(
            'INSERT INTO test_certificates
                (certificate_number, invoice_id, invoice_item_id, product_id, batch_no,
                 certificate_type, sample_date, issue_date, parameters_json, result_summary,
                 status, issued_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, "draft", ?, NOW())',
            [
                $data['certificate_number'],
                $data['invoice_id'] ?: null,
                $data['invoice_item_id'] ?: null,
                $data['product_id'] ?: null,
                $data['batch_no'] ?: null,
                $data['certificate_type'],
                $data['sample_date'] ?: null,
                $data['issue_date'],
                $data['parameters_json'],
                $data['result_summary'] ?: null,
                $data['issued_by'] ?? null,
            ]
        );
    }

    public static function updateDraft(int $id, array $data): void
    {
        $allowed = [
            'invoice_id', 'invoice_item_id', 'product_id', 'batch_no', 'certificate_type',
            'sample_date', 'issue_date', 'parameters_json', 'result_summary',
        ];
        $sets = [];
        $params = [];
        foreach ($allowed as $field) {
            if (!array_key_exists($field, $data)) {
                continue;
            }
            $sets[] = "$field = ?";
            $params[] = is_string($data[$field]) && trim($data[$field]) === '' ? null : $data[$field];
        }
        if (!empty($sets)) {
            $params[] = $id;
            Database::execute(
                'UPDATE test_certificates SET ' . implode(', ', $sets) . ', updated_at = NOW() WHERE certificate_id = ?',
                $params
            );
        }
    }

    public static function attach(int $id, int $attachmentId): void
    {
        Database::execute(
            'UPDATE test_certificates SET attachment_id = ?, updated_at = NOW() WHERE certificate_id = ?',
            [$attachmentId, $id]
        );
    }

    public static function issue(int $id, int $actorId): void
    {
        Database::execute(
            'UPDATE test_certificates SET status = "issued", issued_by = ?, updated_at = NOW() WHERE certificate_id = ?',
            [$actorId ?: null, $id]
        );
    }

    public static function void(int $id, int $actorId, string $reason): void
    {
        Database::execute(
            'UPDATE test_certificates
             SET status = "void", voided_by = ?, voided_at = NOW(), void_reason = ?, updated_at = NOW()
             WHERE certificate_id = ?',
            [$actorId ?: null, $reason, $id]
        );
    }

    public static function format(array $row, bool $detail = false): array
    {
        $out = [
            'certificate_id' => (int)$row['certificate_id'],
            'id' => (string)$row['certificate_id'],
            'certificate_number' => $row['certificate_number'],
            'invoice_id' => $row['invoice_id'] ? (int)$row['invoice_id'] : null,
            'invoice_number' => $row['invoice_number'] ?? null,
            'invoice_item_id' => $row['invoice_item_id'] ? (int)$row['invoice_item_id'] : null,
            'product_id' => $row['product_id'] ? (int)$row['product_id'] : null,
            'product_name' => $row['product_name'] ?? null,
            'batch_no' => $row['batch_no'],
            'certificate_type' => $row['certificate_type'],
            'sample_date' => $row['sample_date'],
            'issue_date' => $row['issue_date'],
            'parameters' => self::decodeParameters($row['parameters_json'] ?? null),
            'result_summary' => $row['result_summary'],
            'status' => $row['status'],
            'attachment_id' => $row['attachment_id'] ? (int)$row['attachment_id'] : null,
            'attachment_name' => $row['attachment_name'] ?? null,
            'issued_by' => $row['issued_by'] ? (int)$row['issued_by'] : null,
            'voided_by' => $row['voided_by'] ? (int)$row['voided_by'] : null,
            'voided_at' => $row['voided_at'],
            'void_reason' => $row['void_reason'],
            'created_at' => $row['created_at'],
            'updated_at' => $row['updated_at'],
        ];
        if ($detail) {
            $out['attachment_path'] = $row['attachment_path'] ?? null;
            $out['attachment_mime'] = $row['attachment_mime'] ?? null;
        }

        return $out;
    }

    public static function encodeParameters(mixed $parameters): ?string
    {
        if ($parameters === null || $parameters === '') {
            return null;
        }
        if (is_string($parameters)) {
            json_decode($parameters, true);
            if (json_last_error() !== JSON_ERROR_NONE) {
                Response::error('parameters must be valid JSON', 422);
            }
            return $parameters;
        }
        if (!is_array($parameters)) {
            Response::error('parameters must be an object or array', 422);
        }

        return json_encode($parameters, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    }

    private static function decodeParameters(?string $json): mixed
    {
        if (!$json) {
            return null;
        }
        $decoded = json_decode($json, true);

        return json_last_error() === JSON_ERROR_NONE ? $decoded : $json;
    }
}
