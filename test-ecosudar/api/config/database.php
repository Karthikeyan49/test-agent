<?php
// ─── Hostinger → Databases → MySQL panel ─────────────────────────────────────
// Credentials are read from the server-side .env file (one level above public_html/api).
// Never hardcode credentials here — rotate any that were previously committed to git.
$_envPath = dirname(__DIR__, 2) . '/.env';
$_env     = [];

if (file_exists($_envPath)) {
    foreach (file($_envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $_line) {
        if (str_starts_with(trim($_line), '#') || !str_contains($_line, '=')) continue;
        [$_k, $_v] = array_map('trim', explode('=', $_line, 2));
        $_env[$_k] = $_v;
    }
}

// DB credentials — required; fail loudly if missing
foreach (['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASS'] as $_required) {
    if (empty($_env[$_required])) {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => 'Server misconfiguration']);
        exit;
    }
}

define('DB_HOST',    $_env['DB_HOST']);
define('DB_PORT',    (int)($_env['DB_PORT'] ?? 3306));
define('DB_NAME',    $_env['DB_NAME']);
define('DB_USER',    $_env['DB_USER']);
define('DB_PASS',    $_env['DB_PASS']);
define('DB_CHARSET', $_env['DB_CHARSET'] ?? 'utf8mb4');

// AI API Keys — optional; empty string if not set
define('GEMINI_API_KEY',     $_env['gemini_api_key']     ?? '');
define('GROQ_API_KEY',       $_env['groq_api_key']       ?? '');
define('GROQ_API_KEY_NEW',   $_env['groq_api_key_new']   ?? '');

unset($_envPath, $_env, $_line, $_k, $_v, $_required);
