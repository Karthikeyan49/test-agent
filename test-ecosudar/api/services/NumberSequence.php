<?php
declare(strict_types=1);

class NumberSequence
{
    private const DOCUMENTS = [
        'PR' => [
            'label' => 'Purchase Request',
            'prefix_key' => 'pr_prefix',
            'padding_key' => 'pr_padding',
            'period_key' => 'pr_period_policy',
            'prefix' => 'PR',
            'period_policy' => 'yearly',
        ],
        'PO' => [
            'label' => 'Purchase Order',
            'prefix_key' => 'po_prefix',
            'padding_key' => 'po_padding',
            'period_key' => 'po_period_policy',
            'prefix' => 'PO',
            'period_policy' => 'yearly',
        ],
        'GRN' => [
            'label' => 'Goods Receipt',
            'prefix_key' => 'grn_prefix',
            'padding_key' => 'grn_padding',
            'period_key' => 'grn_period_policy',
            'prefix' => 'GRN',
            'period_policy' => 'yearly',
        ],
        'QTN' => [
            'label' => 'Quotation',
            'prefix_key' => 'quotation_prefix',
            'padding_key' => 'quotation_padding',
            'period_key' => 'quotation_period_policy',
            'prefix' => 'QTN',
            'period_policy' => 'yearly',
        ],
        'PFI' => [
            'label' => 'Proforma Invoice',
            'prefix_key' => 'proforma_prefix',
            'padding_key' => 'proforma_padding',
            'period_key' => 'proforma_period_policy',
            'prefix' => 'PFI',
            'period_policy' => 'yearly',
        ],
        'PAY' => [
            'label' => 'Payment / Receipt',
            'prefix_key' => 'payment_prefix',
            'padding_key' => 'payment_padding',
            'period_key' => 'payment_period_policy',
            'prefix' => 'PAY',
            'period_policy' => 'yearly',
        ],
        'CERT' => [
            'label' => 'Test Certificate',
            'prefix_key' => 'certificate_prefix',
            'padding_key' => 'certificate_padding',
            'period_key' => 'certificate_period_policy',
            'prefix' => 'CERT',
            'period_policy' => 'yearly',
        ],
        'ADJ' => [
            'label' => 'Stock Adjustment',
            'prefix_key' => 'adjustment_prefix',
            'padding_key' => 'adjustment_padding',
            'period_key' => 'adjustment_period_policy',
            'prefix' => 'ADJ',
            'period_policy' => 'yearly',
        ],
        'BUD' => [
            'label' => 'Budget',
            'prefix_key' => 'budget_prefix',
            'padding_key' => 'budget_padding',
            'period_key' => 'budget_period_policy',
            'prefix' => 'BUD',
            'period_policy' => 'financial_year',
        ],
        'INV' => [
            'label' => 'Invoice',
            'prefix_key' => 'invoice_prefix',
            'padding_key' => 'invoice_padding',
            'period_key' => 'invoice_period_policy',
            'prefix' => 'INV',
            'period_policy' => 'yearly',
        ],
        'ORD' => [
            'label' => 'Order',
            'prefix_key' => 'order_prefix',
            'padding_key' => 'order_padding',
            'period_key' => 'order_period_policy',
            'prefix' => 'ES',
            'period_policy' => 'yearly',
        ],
    ];

    private const VALID_PERIOD_POLICIES = ['yearly', 'monthly', 'continuous', 'financial_year'];

    public static function next(string $docType, ?DateTimeInterface $now = null): string
    {
        $allocation = self::allocate($docType, $now);
        return $allocation['document_number'];
    }

    public static function allocate(string $docType, ?DateTimeInterface $now = null): array
    {
        $docType = self::normalizeDocType($docType);
        $config = self::documentConfig($docType);
        $now = self::clock($now);
        $settings = self::settingsMap();
        $policy = self::periodPolicy($config, $settings);
        $period = self::periodForPolicy($policy, $now);

        // LAST_INSERT_ID(2) on the initial insert seeds next_value=2 AND sets the session's
        // last_insert_id to 2 — so the read-back below works even when an earlier
        // auto-increment INSERT ran in this same connection. The ON DUPLICATE path bumps and
        // sets it to next_value+1. Either way last_insert_id == (allocated sequence + 1).
        Database::execute(
            'INSERT INTO document_sequences (doc_type, period, next_value)
             VALUES (?, ?, LAST_INSERT_ID(2))
             ON DUPLICATE KEY UPDATE next_value = LAST_INSERT_ID(next_value + 1)',
            [$docType, $period]
        );

        $sequenceValue = max(1, (int)Database::getInstance()->lastInsertId() - 1);

        return [
            'doc_type' => $docType,
            'period' => $period,
            'sequence_value' => $sequenceValue,
            'document_number' => self::format($docType, $period, $sequenceValue, $config, $settings),
        ];
    }

    public static function preview(string $docType, ?DateTimeInterface $now = null): string
    {
        $docType = self::normalizeDocType($docType);
        $config = self::documentConfig($docType);
        $now = self::clock($now);
        $settings = self::settingsMap();
        $period = self::periodForPolicy(self::periodPolicy($config, $settings), $now);
        $row = Database::fetch(
            'SELECT next_value FROM document_sequences WHERE doc_type = ? AND period = ? LIMIT 1',
            [$docType, $period]
        );
        $nextValue = max(1, (int)($row['next_value'] ?? 1));

        return self::format($docType, $period, $nextValue, $config, $settings);
    }

    public static function settingsSummary(?array $settings = null): array
    {
        $settings ??= self::settingsMap();
        $out = [];

        foreach (self::DOCUMENTS as $docType => $config) {
            $out[$docType] = [
                'doc_type' => $docType,
                'label' => $config['label'],
                'prefix_key' => $config['prefix_key'],
                'padding_key' => $config['padding_key'],
                'period_key' => $config['period_key'],
                'prefix' => self::prefix($config, $settings),
                'padding' => self::padding($config, $settings),
                'period_policy' => self::periodPolicy($config, $settings),
            ];
        }

        return $out;
    }

    public static function isSupportedDocType(string $docType): bool
    {
        return array_key_exists(self::normalizeDocType($docType), self::DOCUMENTS);
    }

    public static function validPeriodPolicies(): array
    {
        return self::VALID_PERIOD_POLICIES;
    }

    private static function format(
        string $docType,
        string $period,
        int $sequenceValue,
        array $config,
        array $settings
    ): string {
        $prefix = self::prefix($config, $settings);
        $number = str_pad((string)$sequenceValue, self::padding($config, $settings), '0', STR_PAD_LEFT);

        if (self::periodPolicy($config, $settings) === 'continuous') {
            return "{$prefix}-{$number}";
        }

        return "{$prefix}-{$period}-{$number}";
    }

    private static function normalizeDocType(string $docType): string
    {
        return strtoupper(trim($docType));
    }

    private static function documentConfig(string $docType): array
    {
        if (!array_key_exists($docType, self::DOCUMENTS)) {
            Response::error('Unsupported document type: ' . $docType, 422);
        }

        return self::DOCUMENTS[$docType];
    }

    private static function settingsMap(): array
    {
        $rows = Database::fetchAll('SELECT setting_key, setting_value FROM settings');
        $map = [];
        foreach ($rows as $row) {
            $map[(string)$row['setting_key']] = (string)($row['setting_value'] ?? '');
        }

        return $map;
    }

    private static function prefix(array $config, array $settings): string
    {
        $raw = (string)($settings[$config['prefix_key']] ?? $config['prefix']);
        $prefix = preg_replace('/[^A-Z0-9]/', '', strtoupper(trim($raw))) ?: $config['prefix'];

        return substr($prefix, 0, 12);
    }

    private static function padding(array $config, array $settings): int
    {
        $value = (int)($settings[$config['padding_key']] ?? 4);

        return max(2, min(8, $value));
    }

    private static function periodPolicy(array $config, array $settings): string
    {
        $policy = strtolower(trim((string)($settings[$config['period_key']] ?? $config['period_policy'])));

        return in_array($policy, self::VALID_PERIOD_POLICIES, true) ? $policy : $config['period_policy'];
    }

    private static function periodForPolicy(string $policy, DateTimeInterface $now): string
    {
        return match ($policy) {
            'monthly' => $now->format('Y-m'),
            'continuous' => 'GLOBAL',
            'financial_year' => self::financialYear($now),
            default => $now->format('Y'),
        };
    }

    private static function financialYear(DateTimeInterface $now): string
    {
        $year = (int)$now->format('Y');
        if ((int)$now->format('n') >= 4) {
            $year++;
        }

        return 'FY' . $year;
    }

    private static function clock(?DateTimeInterface $now): DateTimeInterface
    {
        return $now ?? new DateTimeImmutable('now');
    }
}
