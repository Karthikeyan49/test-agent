<?php
declare(strict_types=1);

class JWT
{
    public static function encodeAccess(array $payload): string
    {
        return self::encode($payload, JWT_ACCESS_EXPIRY);
    }

    public static function encodeRefresh(array $payload): string
    {
        return self::encode($payload, JWT_REFRESH_EXPIRY);
    }

    public static function encode(array $payload, int $expiry): string
    {
        $now = time();
        $payload = array_merge([
            'jti' => bin2hex(random_bytes(16))
        ], $payload, [
            'iat' => $now,
            'exp' => $now + $expiry,
            'nbf' => $now,
        ]);

        $header    = self::b64url(json_encode(['alg' => 'HS256', 'typ' => 'JWT']));
        $body      = self::b64url(json_encode($payload));
        $signature = self::sign("$header.$body");

        return "$header.$body.$signature";
    }

    public static function decode(string $token): ?array
    {
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }

        [$header, $body, $signature] = $parts;

        if (!hash_equals(self::sign("$header.$body"), $signature)) {
            return null;
        }

        $payload = json_decode(self::b64urlDecode($body), true);
        if (!is_array($payload)) {
            return null;
        }

        if (isset($payload['exp']) && $payload['exp'] < time()) {
            return null; // expired
        }

        if (isset($payload['nbf']) && $payload['nbf'] > time()) {
            return null; // not yet valid
        }

        return $payload;
    }

    private static function sign(string $data): string
    {
        return self::b64url(hash_hmac('sha256', $data, JWT_SECRET, true));
    }

    private static function b64url(string $data): string
    {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function b64urlDecode(string $data): string
    {
        return base64_decode(strtr($data, '-_', '+/'));
    }
}
