<?php
// ─── Timezone ────────────────────────────────────────────────────────────────
date_default_timezone_set('Asia/Kolkata');

// ─── Environment ──────────────────────────────────────────────────────────────
define('APP_NAME', 'Eco Sudar API');
define('APP_VERSION', '1.0.0');
define('APP_ENV', 'production'); // set to 'development' locally for error details

// ─── JWT Secret — read from .env ─────────────────────────────────────────────
// Generate a new secret: php -r "echo bin2hex(random_bytes(32));"
// Add to .env:  JWT_SECRET=<your_64_char_hex>
// IMPORTANT: Rotate this key if the previous value was ever committed to git.
$_jwtEnvPath = dirname(__DIR__, 2) . '/.env';
$_jwtSecret  = '';
if (file_exists($_jwtEnvPath)) {
    foreach (file($_jwtEnvPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $_jwtLine) {
        if (str_starts_with(trim($_jwtLine), '#') || !str_contains($_jwtLine, '=')) continue;
        [$_jk, $_jv] = array_map('trim', explode('=', $_jwtLine, 2));
        if ($_jk === 'JWT_SECRET') { $_jwtSecret = $_jv; break; }
    }
}
define('JWT_SECRET', $_jwtSecret);
unset($_jwtEnvPath, $_jwtSecret, $_jwtLine, $_jk, $_jv);

// ─── JWT Expiry ───────────────────────────────────────────────────────────────
// Mobile App token lifetimes (long-lived for background usage)
define('JWT_ACCESS_EXPIRY',         60 * 60 * 24 * 30);  // 30 days  (app)
define('JWT_REFRESH_EXPIRY',        60 * 60 * 24 * 180); // 180 days (app)

// Website / Admin token lifetimes (short-lived browser sessions)
define('JWT_WEB_ACCESS_EXPIRY',     60 * 60 * 24 * 1);   // 1 day
define('JWT_WEB_REFRESH_EXPIRY',    60 * 60 * 24 * 7);   // 7 days

// ─── Rate limiting ────────────────────────────────────────────────────────────
define('RATE_LIMIT_REQUESTS',       100); // general: 100 req / 60 s
define('RATE_LIMIT_WINDOW',         60);

define('RATE_LIMIT_LOGIN_MAX',      5);          // 5 login attempts
define('RATE_LIMIT_LOGIN_WINDOW',   60 * 15);    // per 15 minutes

define('RATE_LIMIT_REGISTER_MAX',   3);          // 3 register attempts
define('RATE_LIMIT_REGISTER_WINDOW', 60 * 60);   // per 1 hour

// ─── CORS ─────────────────────────────────────────────────────────────────────
// Set CORS_ORIGIN in .env — change it there when the admin dashboard domain changes.
// Flutter (mobile) ignores CORS; this only matters for browsers.
$_corsEnvPath = dirname(__DIR__, 2) . '/.env';
$_corsOrigin  = '';
if (file_exists($_corsEnvPath)) {
    foreach (file($_corsEnvPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $_corsLine) {
        if (str_starts_with(trim($_corsLine), '#') || !str_contains($_corsLine, '=')) continue;
        [$_ck, $_cv] = array_map('trim', explode('=', $_corsLine, 2));
        if ($_ck === 'CORS_ORIGIN') { $_corsOrigin = $_cv; break; }
    }
}
define('CORS_ORIGIN', $_corsOrigin ?: 'https://api.ecosudar.com');
unset($_corsEnvPath, $_corsOrigin, $_corsLine, $_ck, $_cv);

// ─── Security ────────────────────────────────────────────────────────────────
define('BCRYPT_COST', 12);
