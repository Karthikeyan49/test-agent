<?php
/**
 * DEVELOPMENT/TESTING TOOL — clear_rate_limits.php
 * ─────────────────────────────────────────────────
 * Flushes rate_limits and revoked_tokens from the DB.
 *
 * CLI usage:  php api/tests/clear_rate_limits.php
 * Web usage:  GET /api/tests/clear_rate_limits.php?key=<DEV_CLEAR_KEY>
 *   (Add DEV_CLEAR_KEY=<random> to your .env to enable web access)
 */

define('ROOT_PATH', dirname(__DIR__));

// ── Secret key guard (web only) ───────────────────────────────────────────────
$_envPath = dirname(ROOT_PATH, 1) . '/.env';
$_devKey  = '';
if (file_exists($_envPath)) {
    foreach (file($_envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $_line) {
        if (str_starts_with(trim($_line), '#') || !str_contains($_line, '=')) continue;
        [$_k, $_v] = array_map('trim', explode('=', $_line, 2));
        if ($_k === 'DEV_CLEAR_KEY') { $_devKey = $_v; break; }
    }
}
unset($_envPath, $_line, $_k, $_v);

if (php_sapi_name() !== 'cli') {
    $provided = $_GET['key'] ?? '';
    if (empty($_devKey) || !hash_equals($_devKey, $provided)) {
        http_response_code(403);
        header('Content-Type: application/json');
        echo json_encode(['success' => false, 'message' => 'Forbidden']);
        exit;
    }
}
unset($_devKey);

require_once ROOT_PATH . '/config/database.php';

try {
    $dsn = sprintf('mysql:host=%s;port=%d;dbname=%s;charset=%s', DB_HOST, DB_PORT, DB_NAME, DB_CHARSET);
    $pdo = new PDO($dsn, DB_USER, DB_PASS, [PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION]);

    $before = $pdo->query('SELECT COUNT(*) FROM rate_limits')->fetchColumn();
    $pdo->exec('DELETE FROM rate_limits');
    $pdo->exec('DELETE FROM revoked_tokens');
    $after  = $pdo->query('SELECT COUNT(*) FROM rate_limits')->fetchColumn();

    header('Content-Type: application/json');
    echo json_encode([
        'success'                => true,
        'message'                => 'Rate limits and revoked tokens cleared.',
        'rows_deleted'           => (int) $before,
        'rows_remaining'         => (int) $after,
        'revoked_tokens_cleared' => true,
    ], JSON_PRETTY_PRINT);
} catch (PDOException $e) {
    http_response_code(500);
    header('Content-Type: application/json');
    echo json_encode(['success' => false, 'error' => $e->getMessage()]);
}
