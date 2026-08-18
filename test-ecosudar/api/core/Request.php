<?php
declare(strict_types=1);

class Request
{
    private array  $body    = [];
    private array  $query   = [];
    private array  $headers = [];
    private string $method  = '';
    private string $path    = '';

    public array  $params = [];   // {param} captures from router
    public ?array $user   = null; // set by AuthMiddleware after token validation

    private const MAX_BODY_BYTES   = 8 * 1024 * 1024;   // 8 MB — JSON / form bodies
    private const MAX_UPLOAD_BYTES  = 250 * 1024 * 1024; // 250 MB — multipart file uploads
    // (per-file/type limits are still enforced by FileStore::CATEGORY_CONFIG)

    public function __construct()
    {
        $this->method  = strtoupper($_SERVER['REQUEST_METHOD'] ?? 'GET');
        $this->path    = $this->parsePath();
        $this->query   = $_GET;
        $this->headers = $this->parseHeaders();
        $this->body    = $this->parseBody();
    }

    private function parsePath(): string
    {
        $uri  = $_SERVER['REQUEST_URI'] ?? '/';
        $path = parse_url($uri, PHP_URL_PATH) ?? '/';
        $path = preg_replace('#^/api#', '', $path) ?? $path;
        return rtrim($path, '/') ?: '/';
    }

    private function parseHeaders(): array
    {
        $headers = [];
        foreach ($_SERVER as $key => $value) {
            if (str_starts_with($key, 'HTTP_')) {
                $headers[substr($key, 5)] = $value;
            }
        }
        // PHP exposes these without the HTTP_ prefix
        foreach (['CONTENT_TYPE', 'CONTENT_LENGTH'] as $k) {
            if (isset($_SERVER[$k])) {
                $headers[$k] = $_SERVER[$k];
            }
        }
        return $headers;
    }

    private function parseBody(): array
    {
        if (!in_array($this->method, ['POST', 'PUT', 'PATCH', 'DELETE'], true)) {
            return [];
        }

        $contentType = $this->header('CONTENT_TYPE') ?? '';

        // Multipart bodies are file uploads — allow a higher ceiling; everything
        // else (JSON/form) keeps the tight 8 MB guard. FileStore still enforces
        // per-file/type limits, so uploads are not unbounded.
        $isMultipart = str_contains($contentType, 'multipart/form-data');
        $bodyLimit   = $isMultipart ? self::MAX_UPLOAD_BYTES : self::MAX_BODY_BYTES;

        $contentLength = (int)($this->headers['CONTENT_LENGTH'] ?? 0);
        if ($contentLength > $bodyLimit) {
            Response::error('Payload too large', 413);
        }

        if (str_contains($contentType, 'application/json')) {
            $raw = file_get_contents('php://input');
            if ($raw === false || $raw === '') {
                return [];
            }
            if (strlen($raw) > self::MAX_BODY_BYTES) {
                Response::error('Payload too large', 413);
            }
            $data = json_decode($raw, true);
            if ($data === null && json_last_error() !== JSON_ERROR_NONE) {
                Response::error('Invalid JSON: ' . json_last_error_msg(), 400);
            }
            return is_array($data) ? $data : [];
        }

        return $_POST ?? [];
    }

    public function method(): string { return $this->method; }
    public function path(): string   { return $this->path;   }

    // Accepts dashes or underscores, case-insensitive
    public function header(string $name): ?string
    {
        $key = strtoupper(str_replace('-', '_', $name));
        return $this->headers[$key] ?? null;
    }

    public function bearerToken(): ?string
    {
        // 1. Check Authorization header (preferred)
        $auth = $this->header('AUTHORIZATION') ?? '';
        if (preg_match('/^Bearer\s+(.+)$/i', $auth, $m)) {
            return trim($m[1]);
        }
        // 2. Fallback: ?token= query param (for <img> tags that can't send headers)
        $queryToken = $this->query('token');
        if ($queryToken !== null && is_string($queryToken) && $queryToken !== '') {
            return trim($queryToken);
        }
        return null;
    }

    public function input(string $key, mixed $default = null): mixed
    {
        return $this->body[$key] ?? $default;
    }

    public function only(array $keys): array
    {
        return array_intersect_key($this->body, array_flip($keys));
    }

    /** The full parsed request body (JSON or form fields). */
    public function all(): array
    {
        return is_array($this->body) ? $this->body : [];
    }

    public function query(string $key, mixed $default = null): mixed
    {
        return $this->query[$key] ?? $default;
    }

    public function param(string $key, mixed $default = null): mixed
    {
        return $this->params[$key] ?? $default;
    }

    public function ip(): string
    {
        $forwarded = $_SERVER['HTTP_X_FORWARDED_FOR'] ?? null;
        if ($forwarded) {
            $ip = trim(explode(',', $forwarded)[0]);
            if (filter_var($ip, FILTER_VALIDATE_IP)) {
                return $ip;
            }
        }
        return $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
    }

    public static function sanitize(string $value): string
    {
        // Strip HTML tags (defense-in-depth against stored scripts) and control
        // characters, then trim — but do NOT HTML-encode. This is a JSON API: the
        // React client escapes on render and the PDF renderer prints text literally,
        // so htmlspecialchars() here only mangled input ("L & T" -> "L &amp; T") and
        // re-encoded it on every save, making entities like "&amp;" impossible to remove.
        $value = strip_tags($value);
        $value = preg_replace('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/', '', $value) ?? $value;
        return trim($value);
    }
}
