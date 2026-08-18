<?php
declare(strict_types=1);

/**
 * Admin Expense Controller
 *
 * Endpoints
 * ─────────
 *   GET    /admin/expenses                 — list (filterable + paginated)
 *   GET    /admin/expenses/{id}            — fetch a single expense
 *   POST   /admin/expenses                 — create
 *   PUT    /admin/expenses/{id}            — update
 *   DELETE /admin/expenses/{id}            — delete (hard)
 *   GET    /admin/expenses/categories      — distinct category list for dropdowns
 */
class AdminExpenseController
{
    private const PAYMENT_MODES = ['Cash', 'Bank Transfer', 'UPI', 'Cheque', 'Card'];

    // ─── GET /admin/expenses ─────────────────────────────────────────────────
    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(200, max(1, (int)$request->query('limit', 50)));

        [$whereClause, $params] = self::filters($request);
        $total  = Database::count("SELECT COUNT(*) AS cnt FROM expenses WHERE $whereClause", $params);
        $offset = ($page - 1) * $limit;

        $rows = Database::fetchAll(
            "SELECT expense_id, expense_code, expense_date, category, vendor, description,
                    amount, payment_mode, bill_url, created_by, created_at, updated_at
             FROM expenses
             WHERE $whereClause
             ORDER BY expense_date DESC, expense_id DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, $offset]
        );

        foreach ($rows as &$r) {
            $r['amount'] = (float)$r['amount'];
        }

        Response::paginated($rows, [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $total,
            'total_pages' => (int)ceil($total / max($limit, 1)),
        ]);
    }

    // ─── GET /admin/expenses/summary ────────────────────────────────────────
    public function summary(Request $request): void
    {
        [$whereClause, $params] = self::filters($request);

        $summary = Database::fetch(
            "SELECT COUNT(*) AS count,
                    COALESCE(SUM(amount), 0) AS total,
                    COALESCE(AVG(amount), 0) AS average
             FROM expenses
             WHERE $whereClause",
            $params
        ) ?: [];

        $categoryCount = Database::count(
            "SELECT COUNT(*) AS cnt
             FROM (SELECT category FROM expenses WHERE $whereClause GROUP BY category) x",
            $params
        );

        $topCategory = Database::fetch(
            "SELECT category AS name, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS value
             FROM expenses
             WHERE $whereClause
             GROUP BY category
             ORDER BY value DESC
             LIMIT 1",
            $params
        );

        Response::success([
            'count' => (int)($summary['count'] ?? 0),
            'total' => (float)($summary['total'] ?? 0),
            'average' => (float)($summary['average'] ?? 0),
            'category_count' => $categoryCount,
            'top_category' => $topCategory ? [
                'name' => (string)$topCategory['name'],
                'count' => (int)$topCategory['count'],
                'value' => (float)$topCategory['value'],
            ] : null,
        ]);
    }

    // ─── GET /admin/expenses/{id} ────────────────────────────────────────────
    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid expense ID', 400);
        }

        $row = Database::fetch('SELECT * FROM expenses WHERE expense_id = ? LIMIT 1', [$id]);
        if (!$row) {
            Response::error('Expense not found', 404);
        }
        $row['amount'] = (float)$row['amount'];
        Response::success($row);
    }

    // ─── GET /admin/expenses/categories ──────────────────────────────────────
    public function categories(Request $request): void
    {
        $rows = Database::fetchAll('SELECT DISTINCT category FROM expenses ORDER BY category ASC');
        Response::success(array_column($rows, 'category'));
    }

    // ─── POST /admin/expenses ────────────────────────────────────────────────
    public function store(Request $request): void
    {
        Validator::make(
            $request->only(['expense_date', 'category', 'vendor', 'amount', 'payment_mode']),
            [
                'expense_date' => 'required|string|max:10',
                'category'     => 'required|string|min:2|max:80',
                'vendor'       => 'required|string|min:2|max:150',
                'amount'       => 'required|numeric',
                'payment_mode' => 'required|string|max:20',
            ]
        )->validate();

        self::validateDate($request->input('expense_date'));
        self::validateAmount($request->input('amount'));
        self::validatePaymentMode((string)$request->input('payment_mode'));

        // Derive the next code from the highest existing EXP-#### number (not the row
        // count): counting breaks once any expense is deleted or codes have gaps, which
        // makes count+1 collide with an existing code (uk_expense_code) and 500s.
        $maxNum = (int)(Database::fetch(
            "SELECT MAX(CAST(SUBSTRING(expense_code, 5) AS UNSIGNED)) AS max_num
               FROM expenses WHERE expense_code LIKE 'EXP-%'"
        )['max_num'] ?? 0);
        $code       = 'EXP-' . str_pad((string)($maxNum + 1), 4, '0', STR_PAD_LEFT);
        $createdBy  = isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;

        // Bill photo: a base64 data URL is compressed and stored as a file on the
        // server; the DB keeps only the (small) relative path. Already-stored paths
        // and external URLs pass through unchanged.
        $billStored = self::saveBill($request->input('bill_url'), $code);

        $expenseId = Database::insert(
            'INSERT INTO expenses
                (expense_code, expense_date, category, vendor, description, amount, payment_mode, bill_url, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $code,
                $request->input('expense_date'),
                Request::sanitize((string)$request->input('category')),
                Request::sanitize((string)$request->input('vendor')),
                $request->input('description') ? Request::sanitize((string)$request->input('description')) : null,
                (float)$request->input('amount'),
                (string)$request->input('payment_mode'),
                $billStored,
                $createdBy,
            ]
        );

        $row = Database::fetch('SELECT * FROM expenses WHERE expense_id = ? LIMIT 1', [$expenseId]);
        $row['amount'] = (float)$row['amount'];
        Response::success($row, 'Expense created successfully', 201);
    }

    // ─── PUT /admin/expenses/{id} ────────────────────────────────────────────
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid expense ID', 400);
        }

        $existing = Database::fetch('SELECT expense_id, expense_code FROM expenses WHERE expense_id = ? LIMIT 1', [$id]);
        if (!$existing) {
            Response::error('Expense not found', 404);
        }

        $input = $request->only(['expense_date', 'category', 'vendor', 'description', 'amount', 'payment_mode', 'bill_url']);
        if (empty($input)) {
            Response::error('Provide at least one field to update', 400);
        }

        // A newly-attached bill (base64 data URL) is compressed + stored as a file;
        // an existing path/URL is left untouched, and clearing it stores NULL.
        if (array_key_exists('bill_url', $input)) {
            $input['bill_url'] = self::saveBill($input['bill_url'], (string)$existing['expense_code']);
        }

        if (isset($input['expense_date'])) self::validateDate($input['expense_date']);
        if (isset($input['amount']))       self::validateAmount($input['amount']);
        if (isset($input['payment_mode'])) self::validatePaymentMode((string)$input['payment_mode']);
        if (isset($input['category']) && strlen(trim((string)$input['category'])) < 2) {
            Response::error('Category must be at least 2 characters', 422);
        }
        if (isset($input['vendor']) && strlen(trim((string)$input['vendor'])) < 2) {
            Response::error('Vendor must be at least 2 characters', 422);
        }

        $sets   = [];
        $params = [];
        foreach ($input as $col => $val) {
            $sets[]   = "$col = ?";
            $params[] = in_array($col, ['category', 'vendor', 'description'], true) && $val !== null
                ? Request::sanitize((string)$val)
                : $val;
        }
        $sets[] = 'updated_at = NOW()';
        $params[] = $id;

        Database::execute(
            'UPDATE expenses SET ' . implode(', ', $sets) . ' WHERE expense_id = ?',
            $params
        );

        $row = Database::fetch('SELECT * FROM expenses WHERE expense_id = ? LIMIT 1', [$id]);
        $row['amount'] = (float)$row['amount'];
        Response::success($row, 'Expense updated successfully');
    }

    // ─── DELETE /admin/expenses/{id} ─────────────────────────────────────────
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid expense ID', 400);
        }

        $existing = Database::fetch('SELECT expense_id FROM expenses WHERE expense_id = ? LIMIT 1', [$id]);
        if (!$existing) {
            Response::error('Expense not found', 404);
        }

        Database::execute('DELETE FROM expenses WHERE expense_id = ?', [$id]);
        Response::success(null, 'Expense deleted successfully');
    }

    // ─── GET /admin/expenses/{id}/bill — view/download the stored bill ───────
    public function bill(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid expense ID', 400);
        }
        $row = Database::fetch('SELECT expense_code, bill_url FROM expenses WHERE expense_id = ? LIMIT 1', [$id]);
        if (!$row) {
            Response::error('Expense not found', 404);
        }
        $billUrl  = trim((string)($row['bill_url'] ?? ''));
        if ($billUrl === '') {
            Response::error('No bill attached to this expense', 404);
        }
        $code     = (string)$row['expense_code'];
        $download = (string)$request->query('download', '') === '1';

        // Legacy inline data URLs (older expenses) — decode and stream directly.
        if (str_starts_with($billUrl, 'data:')) {
            if (!preg_match('#^data:([\w/+.\-]+)?;base64,(.+)$#s', $billUrl, $m)) {
                Response::error('Bill data is corrupt', 404);
            }
            $mime  = $m[1] !== '' ? $m[1] : 'application/octet-stream';
            $bytes = base64_decode($m[2], true);
            if ($bytes === false) {
                Response::error('Bill data is corrupt', 404);
            }
            while (ob_get_level() > 0) { ob_end_clean(); }
            header('Content-Type: ' . $mime);
            header('Content-Disposition: ' . ($download ? 'attachment' : 'inline')
                . '; filename="' . $code . '.' . self::extFromMime(strtolower($mime)) . '"');
            header('Content-Length: ' . strlen($bytes));
            header('Cache-Control: private, no-store, max-age=0');
            echo $bytes;
            exit;
        }

        // External URL — redirect to it.
        if (filter_var($billUrl, FILTER_VALIDATE_URL)) {
            header('Location: ' . $billUrl);
            exit;
        }

        // Stored file under uploads/ — stream via FileStore (path-safe, range support).
        $ext = strtolower(pathinfo($billUrl, PATHINFO_EXTENSION)) ?: 'webp';
        FileStore::stream($billUrl, $code . '.' . $ext, null, $download);
    }

    // ─── Bill storage helpers ───────────────────────────────────────────────
    /**
     * Persist an expense bill. A base64 data URL is decoded, images are downscaled
     * and re-encoded as WebP q60 (strong compression, still legible), and the file
     * is written to uploads/expense-bills/<code>.<ext>. Already-stored relative
     * paths and external URLs pass through unchanged; empty input becomes NULL.
     * Returns the relative path/URL to store in expenses.bill_url.
     */
    private static function saveBill($billUrl, string $code): ?string
    {
        $billUrl = trim((string)$billUrl);
        if ($billUrl === '') {
            return null;
        }
        // Not a data URL → already a stored path or an external link; keep as-is.
        if (!str_starts_with($billUrl, 'data:')) {
            return $billUrl;
        }
        if (!preg_match('#^data:([\w/+.\-]+)?;base64,(.+)$#s', $billUrl, $m)) {
            return null; // malformed — drop rather than store junk
        }
        $mime  = strtolower($m[1] ?? '');
        $bytes = base64_decode($m[2], true);
        if ($bytes === false || $bytes === '') {
            return null;
        }

        $dir = ROOT_PATH . '/uploads/expense-bills';
        if (!is_dir($dir) && !mkdir($dir, 0755, true)) {
            Response::error('Could not prepare bill upload directory', 500);
        }
        $safeCode = preg_replace('/[^A-Za-z0-9_-]/', '', $code) ?: ('EXP-' . time());

        // PDFs are stored as-is (can't recompress with GD).
        if ($mime === 'application/pdf') {
            $rel = "uploads/expense-bills/{$safeCode}.pdf";
            file_put_contents(ROOT_PATH . '/' . $rel, $bytes);
            @chmod(ROOT_PATH . '/' . $rel, 0644);
            return $rel;
        }

        $img = @imagecreatefromstring($bytes);
        if ($img === false) {
            // Undecodable image — store raw bytes under a best-guess extension.
            $rel = "uploads/expense-bills/{$safeCode}." . self::extFromMime($mime);
            file_put_contents(ROOT_PATH . '/' . $rel, $bytes);
            @chmod(ROOT_PATH . '/' . $rel, 0644);
            return $rel;
        }

        // Downscale so the longest edge is <= 1600px (receipts need no more).
        $w = imagesx($img);
        $h = imagesy($img);
        $maxEdge = 1600;
        if (max($w, $h) > $maxEdge) {
            $scale = $maxEdge / max($w, $h);
            $nw = max(1, (int)round($w * $scale));
            $nh = max(1, (int)round($h * $scale));
            $resized = imagecreatetruecolor($nw, $nh);
            imagecopyresampled($resized, $img, 0, 0, 0, 0, $nw, $nh, $w, $h);
            imagedestroy($img);
            $img = $resized;
        }

        $rel = "uploads/expense-bills/{$safeCode}.webp";
        $abs = ROOT_PATH . '/' . $rel;
        $ok  = imagewebp($img, $abs, 60);
        imagedestroy($img);
        if (!$ok) {
            Response::error('Could not save bill image', 500);
        }
        @chmod($abs, 0644);
        return $rel;
    }

    private static function extFromMime(string $mime): string
    {
        return match ($mime) {
            'image/jpeg' => 'jpg',
            'image/png'  => 'png',
            'image/webp' => 'webp',
            'image/gif'  => 'gif',
            'application/pdf' => 'pdf',
            default => 'bin',
        };
    }

    // ─── Validation helpers ─────────────────────────────────────────────────
    private static function filters(Request $request): array
    {
        $where  = ['1=1'];
        $params = [];

        if ($cat = $request->query('category')) {
            $where[]  = 'category = ?';
            $params[] = $cat;
        }
        if ($vendor = $request->query('vendor')) {
            $where[]  = 'vendor LIKE ?';
            $params[] = '%' . trim((string)$vendor) . '%';
        }
        if ($mode = $request->query('payment_mode')) {
            self::validatePaymentMode((string)$mode);
            $where[]  = 'payment_mode = ?';
            $params[] = $mode;
        }
        if ($from = $request->query('from')) {
            self::validateDate($from);
            $where[]  = 'expense_date >= ?';
            $params[] = $from;
        }
        if ($to = $request->query('to')) {
            self::validateDate($to);
            $where[]  = 'expense_date <= ?';
            $params[] = $to;
        }
        if ($min = $request->query('min_amount')) {
            if (!is_numeric($min)) {
                Response::error('min_amount must be numeric', 422);
            }
            $where[] = 'amount >= ?';
            $params[] = (float)$min;
        }
        if ($max = $request->query('max_amount')) {
            if (!is_numeric($max)) {
                Response::error('max_amount must be numeric', 422);
            }
            $where[] = 'amount <= ?';
            $params[] = (float)$max;
        }
        if ($search = trim((string)$request->query('search', ''))) {
            $like     = '%' . $search . '%';
            $where[]  = '(vendor LIKE ? OR description LIKE ? OR expense_code LIKE ?)';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        return [implode(' AND ', $where), $params];
    }

    private static function validateDate($val): void
    {
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', (string)$val) || !strtotime((string)$val)) {
            Response::error('expense_date must be a valid YYYY-MM-DD date', 422);
        }
    }

    private static function validateAmount($val): void
    {
        if (!is_numeric($val) || (float)$val <= 0) {
            Response::error('amount must be a positive number', 422);
        }
        if ((float)$val > 10_000_000) {
            Response::error('amount exceeds maximum allowed (₹1 crore)', 422);
        }
    }

    private static function validatePaymentMode(string $val): void
    {
        if (!in_array($val, self::PAYMENT_MODES, true)) {
            Response::error('payment_mode must be one of: ' . implode(', ', self::PAYMENT_MODES), 422);
        }
    }

    // ─── POST /admin/expenses/extract-bill ───────────────────────────────────
    /**
     * Accepts { image: "data:image/...;base64,..." }
     * Tries Gemini 1.5 Flash first; if quota exceeded (429) falls back to a
     * structured prompt that the frontend will re-try with Tesseract.js.
     * Returns { date, vendor, amount, category, description, fallback: bool }
     */
    public function extractBill(Request $request): void
    {
        $imageData = $request->input('image');
        if (!$imageData) {
            Response::error('image is required', 422);
        }

        // Detect MIME type from data URI
        preg_match('/^data:(image\/[a-z]+);base64,/i', (string)$imageData, $m);
        $mimeType = $m[1] ?? 'image/jpeg';

        $apiKey = GEMINI_API_KEY;
        if (!$apiKey) {
            Response::error('Gemini API key not configured', 503);
        }

        $prompt = <<<'PROMPT'
You are a bill/receipt parser for an Indian business expense management system.
Extract the following fields from the bill image and return ONLY a valid JSON object with no extra text or markdown:
{
  "date": "YYYY-MM-DD or empty string",
  "vendor": "shop/vendor/company name or empty string",
  "amount": <number: the final GRAND TOTAL or NET PAYABLE, 0 if not found>,
  "category": "one of: Fuel & Transport, Utilities, Office Stationery, Raw Material, Maintenance & Repairs, Salary & Wages, Marketing, Food & Hospitality, Logistics & Freight, Professional Services, Taxes & Compliance, IT & Software, Equipment Purchase, Printing & Packaging, Bank Charges, Miscellaneous",
  "description": "2-3 sentence description of items purchased, vendor type, and purpose. Min 30 chars, max 250 chars"
}
Rules:
- date: prefer printed date on bill, output as YYYY-MM-DD
- vendor: the shop/company name, NOT the customer name
- amount: the largest/final total including GST as a plain number (no symbols)
- category: pick the closest match from the given list
- description: write 2-3 sentences describing what was purchased, what type of shop/vendor it is, and the likely business purpose
PROMPT;

        // Gemini generateContent with inline image + JSON response mode.
        // Groq removed its vision models, so bill OCR now runs on Gemini Flash.
        $base64  = preg_replace('#^data:[^;]+;base64,#i', '', (string)$imageData);
        $payload = [
            'contents' => [[
                'parts' => [
                    ['text' => $prompt],
                    ['inline_data' => ['mime_type' => $mimeType, 'data' => $base64]],
                ],
            ]],
            'generationConfig' => [
                'temperature'      => 0.1,
                'maxOutputTokens'  => 500,
                'responseMimeType' => 'application/json',
            ],
        ];

        // Try several Gemini vision models in order. Each has its own quota, so if the
        // primary is rate-limited (429) we immediately fail over to the next one. Only
        // when every model is exhausted do we tell the client to use Tesseract.
        // (Groq is NOT a viable backup here — its account has no image/vision model.)
        $models         = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-2.5-flash-lite'];
        $text           = null;
        $lastErr        = '';
        $allRateLimited = true;

        foreach ($models as $model) {
            $ch = curl_init("https://generativelanguage.googleapis.com/v1beta/models/{$model}:generateContent?key=" . urlencode((string)$apiKey));
            curl_setopt_array($ch, [
                CURLOPT_RETURNTRANSFER => true,
                CURLOPT_POST           => true,
                CURLOPT_POSTFIELDS     => json_encode($payload),
                CURLOPT_HTTPHEADER     => ['Content-Type: application/json'],
                CURLOPT_TIMEOUT        => 30,
            ]);
            $raw      = curl_exec($ch);
            $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
            curl_close($ch);
            $resp = json_decode((string)$raw, true);

            if ($httpCode === 429) {
                $lastErr = $resp['error']['message'] ?? 'Quota exceeded';
                continue; // rate-limited → immediately try the next model
            }
            $allRateLimited = false;

            if ($httpCode !== 200 || !$raw) {
                $lastErr = $resp['error']['message'] ?? "HTTP $httpCode";
                continue;
            }
            $candidate = $resp['candidates'][0]['content']['parts'][0]['text'] ?? null;
            if ($candidate !== null && $candidate !== '') {
                $text = $candidate;
                break;
            }
            $lastErr = $resp['promptFeedback']['blockReason'] ?? 'Empty response';
        }

        if ($text === null) {
            // Every Gemini model failed. If it was purely rate-limits, let the client
            // fall back to the in-browser Tesseract OCR; otherwise surface the error.
            if ($allRateLimited) {
                Response::success(
                    ['fallback' => true, 'reason' => $lastErr ?: 'All Gemini models rate-limited'],
                    'Gemini quota exceeded — use Tesseract fallback'
                );
            }
            Response::error('Gemini API error: ' . ($lastErr ?: 'no content'), 502);
        }

        // 1. Strip markdown fences if any
        $text = trim(preg_replace('/^```(?:json)?\s*|\s*```\s*$/i', '', trim($text)));

        // 2. Try direct parse
        $extracted = json_decode($text, true);

        // 3. If still failing, try extracting the first {...} block from the text
        if (!is_array($extracted)) {
            if (preg_match('/\{[^{}]*(?:\{[^{}]*\}[^{}]*)*\}/s', $text, $jsonMatch)) {
                $extracted = json_decode($jsonMatch[0], true);
            }
        }

        if (!is_array($extracted)) {
            Response::error('Could not parse Gemini response as JSON. Raw: ' . substr($text, 0, 200), 502);
        }

        $extracted['fallback'] = false;
        Response::success($extracted, 'Bill extracted successfully');
    }
}
