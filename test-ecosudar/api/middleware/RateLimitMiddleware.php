<?php
declare(strict_types=1);

class RateLimitMiddleware
{
    private const CLEANUP_PROBABILITY = 100; // probabilistic global cleanup 1/100 requests

    /**
     * General rate limiter: 100 req / 60 s per IP.
     */
    public static function handle(): void
    {
        self::check(
            self::clientIp(),
            'general',
            RATE_LIMIT_REQUESTS,
            RATE_LIMIT_WINDOW
        );
    }

    /**
     * Strict limiter for auth/login: 5 attempts / 15 min per IP.
     */
    public static function loginLimit(): void
    {
        self::check(
            self::clientIp(),
            'login',
            RATE_LIMIT_LOGIN_MAX,
            RATE_LIMIT_LOGIN_WINDOW
        );
    }

    /**
     * Strict limiter for auth/register: 3 attempts / 60 min per IP.
     */
    public static function registerLimit(): void
    {
        self::check(
            self::clientIp(),
            'register',
            RATE_LIMIT_REGISTER_MAX,
            RATE_LIMIT_REGISTER_WINDOW
        );
    }

    private static function check(string $ip, string $bucket, int $max, int $window): void
    {
        $windowStart = time() - $window;

        // Probabilistic global cleanup — no cron needed on shared hosting
        if (random_int(1, self::CLEANUP_PROBABILITY) === 1) {
            Database::execute('DELETE FROM rate_limits WHERE created_at < ?', [$windowStart]);
        }

        // Clean this IP + bucket
        Database::execute(
            'DELETE FROM rate_limits WHERE ip = ? AND bucket = ? AND created_at < ?',
            [$ip, $bucket, $windowStart]
        );

        $count = Database::count(
            'SELECT COUNT(*) AS cnt FROM rate_limits WHERE ip = ? AND bucket = ? AND created_at >= ?',
            [$ip, $bucket, $windowStart]
        );

        if ($count >= $max) {
            header('Retry-After: ' . $window);
            header('X-RateLimit-Limit: ' . $max);
            header('X-RateLimit-Remaining: 0');
            header('X-RateLimit-Reset: ' . (time() + $window));
            Response::error('Too many requests. Please slow down.', 429);
        }

        Database::execute(
            'INSERT INTO rate_limits (ip, bucket, created_at) VALUES (?, ?, ?)',
            [$ip, $bucket, time()]
        );

        $remaining = $max - $count - 1;
        header('X-RateLimit-Limit: ' . $max);
        header('X-RateLimit-Remaining: ' . max(0, $remaining));
        header('X-RateLimit-Reset: ' . (time() + $window));
    }

    private static function clientIp(): string
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
}
