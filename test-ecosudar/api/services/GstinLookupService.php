<?php
declare(strict_types=1);

class GstinLookupService
{
    public const STATE_MAP = [
        '01' => 'Jammu & Kashmir',   '02' => 'Himachal Pradesh',
        '03' => 'Punjab',            '04' => 'Chandigarh',
        '05' => 'Uttarakhand',       '06' => 'Haryana',
        '07' => 'Delhi',             '08' => 'Rajasthan',
        '09' => 'Uttar Pradesh',     '10' => 'Bihar',
        '11' => 'Sikkim',            '12' => 'Arunachal Pradesh',
        '13' => 'Nagaland',          '14' => 'Manipur',
        '15' => 'Mizoram',           '16' => 'Tripura',
        '17' => 'Meghalaya',         '18' => 'Assam',
        '19' => 'West Bengal',       '20' => 'Jharkhand',
        '21' => 'Odisha',            '22' => 'Chhattisgarh',
        '23' => 'Madhya Pradesh',    '24' => 'Gujarat',
        '25' => 'Daman & Diu',       '26' => 'Dadra & Nagar Haveli',
        '27' => 'Maharashtra',       '28' => 'Andhra Pradesh',
        '29' => 'Karnataka',         '30' => 'Goa',
        '31' => 'Lakshadweep',       '32' => 'Kerala',
        '33' => 'Tamil Nadu',        '34' => 'Puducherry',
        '35' => 'Andaman & Nicobar', '36' => 'Telangana',
        '37' => 'Andhra Pradesh',    '38' => 'Ladakh',
        '97' => 'Other Territory',   '99' => 'Centre Jurisdiction',
    ];

    public static function lookup(string $gstin, ?string $sellerState = null): array
    {
        $gstin = self::normalizeGstin($gstin);
        if (!self::isValidGstin($gstin)) {
            throw new InvalidArgumentException('Invalid GSTIN format');
        }

        $stateCode = substr($gstin, 0, 2);
        $fallbackState = self::stateFromCode($stateCode);
        $lookup = self::fetchFromGovPortal($gstin);
        $remote = $lookup['data'];

        $state = self::firstNonEmpty($remote['state'] ?? '', $fallbackState);
        $sellerState = self::firstNonEmpty($sellerState, self::companyStateFromSettings(), 'Tamil Nadu');
        $isInterState = self::sameState($state, $sellerState) ? false : true;
        $status = self::normalizeStatus($remote['status'] ?? '');

        return [
            'gstin'          => $gstin,
            'company_name'   => self::firstNonEmpty($remote['trade_name'] ?? '', $remote['legal_name'] ?? ''),
            'trade_name'     => $remote['trade_name'] ?? '',
            'legal_name'     => $remote['legal_name'] ?? '',
            'address'        => $remote['address'] ?? '',
            'address_line'   => $remote['address_line'] ?? '',
            'city'           => $remote['city'] ?? '',
            'state'          => $state,
            'state_code'     => $stateCode,
            'pincode'        => $remote['pincode'] ?? '',
            'status'         => $status,
            'is_active'      => $status === 'Unknown' ? null : strcasecmp($status, 'Active') === 0,
            'seller_state'   => $sellerState,
            'tax_type'       => $isInterState ? 'IGST' : 'CGST+SGST',
            'is_inter_state' => $isInterState,
            'source'         => !empty($remote) ? 'gst_portal' : 'gstin_state_code',
            'lookup_status'  => !empty($remote) ? 'ok' : 'fallback',
            'lookup_error'   => !empty($remote) ? '' : $lookup['error'],
            'remote_status'  => $lookup['http_status'],
            'remote_type'    => $lookup['content_type'],
        ];
    }

    public static function normalizeGstin(string $gstin): string
    {
        return strtoupper(preg_replace('/\s+/', '', trim($gstin)) ?? '');
    }

    public static function isValidGstin(string $gstin): bool
    {
        return preg_match('/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/', $gstin) === 1;
    }

    public static function stateFromCode(string $code): string
    {
        return self::STATE_MAP[$code] ?? '';
    }

    private static function fetchFromGovPortal(string $gstin): array
    {
        if (!function_exists('curl_init')) {
            return self::lookupResult([], 'PHP cURL extension is not available');
        }

        $url = 'https://gst.gov.in/commonapi/search?' . http_build_query([
            'action' => 'searchTaxpayer',
            'gstin'  => $gstin,
        ]);

        $ch = curl_init();
        curl_setopt_array($ch, [
            CURLOPT_URL            => $url,
            CURLOPT_RETURNTRANSFER => true,
            CURLOPT_TIMEOUT        => 10,
            CURLOPT_FOLLOWLOCATION => true,
            CURLOPT_SSL_VERIFYPEER => false,
            CURLOPT_SSL_VERIFYHOST => false,
            CURLOPT_HTTPHEADER     => [
                'Accept: application/json, text/plain, */*',
                'Accept-Language: en-US,en;q=0.9',
                'Cache-Control: no-cache',
                'Referer: https://www.gst.gov.in/',
                'Origin: https://www.gst.gov.in',
                'User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            ],
        ]);

        $raw = curl_exec($ch);
        $error = curl_error($ch);
        $code = (int)curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $contentType = (string)curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
        curl_close($ch);

        if (!is_string($raw) || $raw === '' || $code !== 200) {
            return self::lookupResult([], self::httpErrorMessage($code, $error, $raw), $code, $contentType);
        }

        if (!str_contains(strtolower($contentType), 'json')) {
            return self::lookupResult([], self::nonJsonMessage($raw), $code, $contentType);
        }

        $data = json_decode($raw, true);
        if (!is_array($data)) {
            return self::lookupResult([], 'GST portal returned invalid JSON', $code, $contentType);
        }

        $info = $data['taxpayerInfo'] ?? $data['data']['taxpayerInfo'] ?? $data['data'] ?? null;
        if (!is_array($info)) {
            return self::lookupResult([], 'GST portal JSON did not include taxpayerInfo', $code, $contentType);
        }

        return self::lookupResult(self::parseTaxpayerInfo($gstin, $info), '', $code, $contentType);
    }

    private static function parseTaxpayerInfo(string $gstin, array $info): array
    {
        $addr = $info['pradr']['addr'] ?? $info['principalPlaceOfBusiness']['addr'] ?? [];
        $addr = is_array($addr) ? $addr : [];

        $stateCode = substr($gstin, 0, 2);
        $state = self::normalizeState(self::firstNonEmpty(
            $addr['stcd'] ?? '',
            $info['stcd'] ?? '',
            self::stateFromCode($stateCode)
        ));

        $city = self::firstNonEmpty($addr['city'] ?? '', $addr['dst'] ?? '', $addr['loc'] ?? '');
        $pincode = self::firstNonEmpty($addr['pncd'] ?? '', $addr['pincode'] ?? '');
        $lineParts = self::uniqueNonEmpty([
            $addr['bno'] ?? '',
            $addr['bnm'] ?? '',
            $addr['flno'] ?? '',
            $addr['st'] ?? '',
            $addr['loc'] ?? '',
        ]);
        $addressLine = implode(', ', $lineParts);
        $fullAddress = implode(', ', self::uniqueNonEmpty([
            ...$lineParts,
            $city,
            $addr['dst'] ?? '',
            $state,
            $pincode,
        ]));

        return [
            'trade_name'   => self::firstNonEmpty($info['tradeNam'] ?? '', $info['tradeName'] ?? ''),
            'legal_name'   => self::firstNonEmpty($info['lgnm'] ?? '', $info['legalName'] ?? ''),
            'address'      => $fullAddress,
            'address_line' => $addressLine,
            'city'         => $city,
            'state'        => $state,
            'pincode'      => (string)$pincode,
            'status'       => self::firstNonEmpty($info['sts'] ?? '', $info['status'] ?? ''),
        ];
    }

    private static function companyStateFromSettings(): string
    {
        if (!class_exists('Database')) {
            return '';
        }

        try {
            $rows = Database::fetchAll(
                "SELECT setting_key, setting_value FROM settings WHERE setting_key IN ('company_state', 'gstin')"
            );
        } catch (Throwable) {
            return '';
        }

        $settings = [];
        foreach ($rows as $row) {
            $settings[(string)$row['setting_key']] = (string)$row['setting_value'];
        }

        if (!empty($settings['company_state'])) {
            return trim($settings['company_state']);
        }

        $companyGstin = self::normalizeGstin($settings['gstin'] ?? '');
        if (self::isValidGstin($companyGstin)) {
            return self::stateFromCode(substr($companyGstin, 0, 2));
        }

        return '';
    }

    private static function normalizeStatus(string $status): string
    {
        $status = trim($status);
        if ($status === '') {
            return 'Unknown';
        }

        return strcasecmp($status, 'active') === 0 ? 'Active' : 'Inactive';
    }

    private static function lookupResult(
        array $data,
        string $error = '',
        int $httpStatus = 0,
        string $contentType = ''
    ): array {
        return [
            'data'         => $data,
            'error'        => $error,
            'http_status'  => $httpStatus,
            'content_type' => $contentType,
        ];
    }

    private static function httpErrorMessage(int $code, string $curlError, mixed $raw): string
    {
        if ($curlError !== '') {
            return 'GST portal request failed: ' . $curlError;
        }

        $body = trim(strip_tags(substr((string)$raw, 0, 240)));
        return 'GST portal returned HTTP ' . $code . ($body !== '' ? ': ' . $body : '');
    }

    private static function nonJsonMessage(string $raw): string
    {
        $body = trim(preg_replace('/\s+/', ' ', strip_tags(substr($raw, 0, 500))) ?? '');
        if (stripos($body, 'request rejected') !== false) {
            return 'GST portal rejected the server-side lookup request';
        }

        return 'GST portal returned non-JSON response' . ($body !== '' ? ': ' . $body : '');
    }

    private static function normalizeState(string $state): string
    {
        $state = trim($state);
        if (isset(self::STATE_MAP[$state])) {
            return self::STATE_MAP[$state];
        }

        return $state;
    }

    private static function sameState(string $left, string $right): bool
    {
        return self::stateKey($left) !== '' && self::stateKey($left) === self::stateKey($right);
    }

    private static function stateKey(string $state): string
    {
        return strtolower(preg_replace('/[^a-z0-9]+/i', '', $state) ?? '');
    }

    private static function firstNonEmpty(mixed ...$values): string
    {
        foreach ($values as $value) {
            $value = trim((string)($value ?? ''));
            if ($value !== '') {
                return $value;
            }
        }

        return '';
    }

    private static function uniqueNonEmpty(array $values): array
    {
        $seen = [];
        $out = [];
        foreach ($values as $value) {
            $value = trim((string)($value ?? ''));
            if ($value === '') {
                continue;
            }

            $key = strtolower($value);
            if (isset($seen[$key])) {
                continue;
            }

            $seen[$key] = true;
            $out[] = $value;
        }

        return $out;
    }
}
