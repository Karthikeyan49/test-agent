<?php
declare(strict_types=1);

// ── DEBUG — keep until cron is verified working ──────────────────────────────
ini_set('display_errors', '1');
ini_set('display_startup_errors', '1');
error_reporting(E_ALL);
// ─────────────────────────────────────────────────────────────────────────────

// Set the app timezone up front so the early "--- start ---" log line (written
// before config/app.php is loaded) matches the IST timestamps used everywhere else.
date_default_timezone_set('Asia/Kolkata');

/**
 * Attendance auto-mark Absent — runs every 5–10 minutes.
 *
 * Writes a log line on every invocation to: api/cron/cron.log
 * That lets you see exactly what's happening regardless of how it was triggered.
 */

define('ROOT_PATH', dirname(__DIR__));

$LOG_FILE = __DIR__ . '/cron.log';

/** Append one line to cron.log (best-effort — never throws). */
function cron_log(string $msg, string $logFile): void
{
    @file_put_contents(
        $logFile,
        '[' . date('Y-m-d H:i:s') . '] ' . $msg . PHP_EOL,
        FILE_APPEND
    );
}

cron_log('--- start (' . PHP_SAPI . ', php ' . PHP_VERSION . ') ---', $LOG_FILE);

// ── Bootstrap (catch require failures) ───────────────────────────────────────
try {
    require_once ROOT_PATH . '/config/app.php';
    require_once ROOT_PATH . '/core/Response.php';
    require_once ROOT_PATH . '/config/database.php';
    require_once ROOT_PATH . '/core/AppException.php';
    require_once ROOT_PATH . '/core/Database.php';
    require_once ROOT_PATH . '/models/AttendanceShift.php'; // Attendance::autoMarkAbsent() calls AttendanceShift::default()
    require_once ROOT_PATH . '/models/Attendance.php';
} catch (Throwable $e) {
    cron_log('BOOTSTRAP FAILED: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine(), $LOG_FILE);
    if (PHP_SAPI !== 'cli') {
        http_response_code(500);
        header('Content-Type: application/json; charset=UTF-8');
        echo json_encode(['success' => false, 'message' => 'Bootstrap failed: ' . $e->getMessage()]);
    } else {
        fwrite(STDERR, '[cron] bootstrap failed: ' . $e->getMessage() . PHP_EOL);
    }
    exit(1);
}

$isCli = (PHP_SAPI === 'cli');

// ── HTTP key guard ────────────────────────────────────────────────────────────
if (!$isCli) {
    header('Content-Type: application/json; charset=UTF-8');

    $expectedKey = '';
    $envPath = dirname(__DIR__, 2) . '/.env';
    if (file_exists($envPath)) {
        foreach (file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) as $line) {
            if (str_starts_with(trim($line), '#') || !str_contains($line, '=')) continue;
            [$k, $v] = array_map('trim', explode('=', $line, 2));
            if ($k === 'CRON_KEY') { $expectedKey = $v; break; }
        }
    }

    $providedKey = $_GET['key'] ?? $_SERVER['HTTP_X_CRON_KEY'] ?? '';

    if ($expectedKey === '' || !hash_equals($expectedKey, (string)$providedKey)) {
        cron_log('HTTP forbidden — key mismatch (expected empty? ' . ($expectedKey === '' ? 'yes' : 'no') . ')', $LOG_FILE);
        http_response_code(403);
        echo json_encode(['success' => false, 'message' => 'Forbidden']);
        exit;
    }
}

// ── Run ───────────────────────────────────────────────────────────────────────
try {
    cron_log('calling Attendance::autoMarkAbsent()', $LOG_FILE);
    $result = Attendance::autoMarkAbsent();
    cron_log('result: ' . json_encode($result), $LOG_FILE);

    $payload = ['success' => true, 'data' => $result, 'ranAt' => date('c')];

    if ($isCli) {
        echo "[cron] mark_absent: " . json_encode($payload) . PHP_EOL;
    } else {
        echo json_encode($payload);
    }
} catch (Throwable $e) {
    cron_log('RUN FAILED: ' . $e->getMessage() . ' @ ' . $e->getFile() . ':' . $e->getLine(), $LOG_FILE);
    error_log('[cron mark_absent] ' . $e->getMessage());
    if ($isCli) {
        fwrite(STDERR, "[cron] error: " . $e->getMessage() . PHP_EOL);
        exit(1);
    } else {
        http_response_code(500);
        echo json_encode(['success' => false, 'message' => $e->getMessage()]);
    }
}
