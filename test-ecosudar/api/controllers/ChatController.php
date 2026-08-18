<?php
declare(strict_types=1);

class ChatController
{
    private const SYSTEM_PROMPT = <<<'PROMPT'
You are EcoSudar Assistant, an AI for Bio Energy LLP (EcoSudar).
You have access to live business data provided below as context.
Answer questions using ONLY this data. Be concise, accurate and professional.
If the answer is not in the provided data, say: "I don't have that information right now. Please contact our team for details."
Do not make up numbers, names, or facts.
PROMPT;

    private const HISTORY_LIMIT = 6;

    // ── POST /chat ─────────────────────────────────────────────────────────────
    public function send(Request $request): void
    {
        $message   = trim((string)($request->input('message') ?? ''));
        $sessionId = trim((string)($request->input('session_id') ?? ''));

        if ($message === '') Response::error('Message is required', 400);
        if (strlen($message) > 2000) Response::error('Message too long (max 2000 chars)', 400);

        if ($sessionId === '') {
            $sessionId = bin2hex(random_bytes(16));
        }

        $userId = $request->user['user_id'] ?? null;
        $this->ensureSession($sessionId, $userId);

        // ── Fetch live DB context based on what the question is about ──────────
        $context = DataBridge::fetchContext($message);

        // ── Build message history for LLM ──────────────────────────────────────
        $history  = $this->getHistory($sessionId, self::HISTORY_LIMIT);
        $messages = [[
            'role'    => 'system',
            'content' => self::SYSTEM_PROMPT . "\n\n## Live Business Data:\n" . $context,
        ]];
        foreach ($history as $h) {
            $messages[] = ['role' => $h['role'], 'content' => $h['content']];
        }
        $messages[] = ['role' => 'user', 'content' => $message];

        // ── Call Groq ──────────────────────────────────────────────────────────
        try {
            $reply = GroqClient::chat($messages, 512);
        } catch (\RuntimeException $e) {
            error_log('[Chat] Groq error: ' . $e->getMessage());
            Response::error('AI service unavailable. Please try again.', 503);
        }

        // ── Persist ────────────────────────────────────────────────────────────
        $this->saveMessage($sessionId, 'user',      $message);
        $this->saveMessage($sessionId, 'assistant', $reply);

        Response::success([
            'session_id' => $sessionId,
            'reply'      => $reply,
        ], 'OK');
    }

    // ── GET /chat/debug ────────────────────────────────────────────────────────
    public function debug(Request $request): void
    {
        $question = $request->query('q', 'what is the price of pellet');
        $checks   = [];

        // 1. Check DataBridge class exists
        $checks['databridge_loaded'] = class_exists('DataBridge');

        // 2. Check GroqClient exists
        $checks['groq_loaded'] = class_exists('GroqClient');

        // 3. Check GROQ_API_KEY
        $checks['groq_key_set']    = defined('GROQ_API_KEY') && strlen(GROQ_API_KEY) > 10;
        $checks['groq_key_prefix'] = defined('GROQ_API_KEY') ? substr(GROQ_API_KEY, 0, 8) . '...' : 'NOT SET';

        // 4. Check DB tables
        try {
            $checks['products_count']  = (int) Database::fetch("SELECT COUNT(*) AS cnt FROM products")['cnt'];
            $checks['employees_count'] = (int) Database::fetch("SELECT COUNT(*) AS cnt FROM employees")['cnt'];
            $checks['faqs_count']      = (int) Database::fetch("SELECT COUNT(*) AS cnt FROM faqs")['cnt'];
            $checks['chat_sessions_table'] = 'OK';
        } catch (\Throwable $e) {
            $checks['db_error'] = $e->getMessage();
        }

        // 5. Test each data source individually
        $sources = ['summary', 'products', 'faqs', 'employees', 'orders'];
        foreach ($sources as $src) {
            try {
                $result = DataBridge::fetchSource($src);
                $checks["src_{$src}_len"]     = strlen($result);
                $checks["src_{$src}_preview"] = mb_substr($result, 0, 200);
            } catch (\Throwable $e) {
                $checks["src_{$src}_error"] = $e->getMessage();
            }
        }

        // 6. Full context fetch
        try {
            $context = DataBridge::fetchContext($question);
            $checks['context_length']  = strlen($context);
            $checks['context_preview'] = mb_substr($context, 0, 500);
        } catch (\Throwable $e) {
            $checks['context_error'] = $e->getMessage();
        }

        Response::success($checks, 'Debug info');
    }

    // ── GET /chat/history?session_id=xxx ───────────────────────────────────────
    public function history(Request $request): void
    {
        $sessionId = trim((string)($request->query('session_id') ?? ''));
        if ($sessionId === '') Response::error('session_id is required', 400);

        $messages = Database::fetchAll(
            "SELECT role, content, created_at FROM chat_messages
             WHERE session_id = ? ORDER BY created_at ASC",
            [$sessionId]
        );

        Response::success($messages);
    }

    // ── GET /admin/chat/sessions ───────────────────────────────────────────────
    public function sessions(Request $request): void
    {
        $page   = max(1, (int)($request->query('page', 1)));
        $offset = ($page - 1) * 20;

        $rows = Database::fetchAll(
            "SELECT s.session_id, s.user_id, u.name AS user_name, u.email,
                    COUNT(m.id) AS message_count,
                    MAX(m.created_at) AS last_message_at,
                    s.created_at
             FROM chat_sessions s
             LEFT JOIN users u ON u.user_id = s.user_id
             LEFT JOIN chat_messages m ON m.session_id = s.session_id
             GROUP BY s.session_id
             ORDER BY last_message_at DESC
             LIMIT 20 OFFSET ?",
            [$offset]
        );

        $total = (int) Database::fetch("SELECT COUNT(*) AS cnt FROM chat_sessions")['cnt'];

        Response::paginated($rows, [
            'total'    => $total,
            'page'     => $page,
            'per_page' => 20,
            'pages'    => (int) ceil($total / 20),
        ]);
    }

    // ── Helpers ────────────────────────────────────────────────────────────────

    private function ensureSession(string $sessionId, ?int $userId): void
    {
        Database::execute(
            "INSERT IGNORE INTO chat_sessions (session_id, user_id) VALUES (?, ?)",
            [$sessionId, $userId]
        );
    }

    private function saveMessage(string $sessionId, string $role, string $content): void
    {
        Database::execute(
            "INSERT INTO chat_messages (session_id, role, content) VALUES (?, ?, ?)",
            [$sessionId, $role, $content]
        );
    }

    private function getHistory(string $sessionId, int $limit): array
    {
        $rows = Database::fetchAll(
            "SELECT role, content FROM chat_messages
             WHERE session_id = ? ORDER BY created_at DESC LIMIT ?",
            [$sessionId, $limit]
        );
        return array_reverse($rows);
    }
}
