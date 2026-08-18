<?php
declare(strict_types=1);

/**
 * Admin Quote Request Controller
 * GET /admin/quote-requests      — list
 * GET /admin/quote-requests/{id} — single
 * PUT /admin/quote-requests/{id} — update status / admin notes / quoted price
 */
class AdminQuoteController
{
    /** DB status → UI status */
    private static function toUiStatus(string $raw): string
    {
        return match ($raw) {
            'contacted'          => 'Contacted',
            'sent'               => 'Contacted', // legacy value
            'quoted'             => 'Quoted',
            'closed'             => 'Closed',
            default              => 'New',
        };
    }

    /** UI status → DB status */
    private static function toDbStatus(string $ui): string
    {
        return match ($ui) {
            'Contacted' => 'contacted',
            'Quoted'    => 'quoted',
            'Closed'    => 'closed',
            default     => 'pending',
        };
    }

    /**
     * Parse savings calculator data out of the free-text message column.
     * Format: "Customer uses 100 kg of LPG at ₹85/kg (₹8500/month).
     *          They need 283 kg/month of Biomass Pellets (≈ ₹3967/month), saving ₹4533/month."
     */
    private static function parseMessage(string $msg): array
    {
        $n = fn(string $s): float => (float)preg_replace('/[^\d.]/', '', $s);

        // current_fuel  — "100 kg of LPG"
        $currentFuel = null;
        if (preg_match('/\d+\s*kg\s+of\s+([A-Za-z0-9\s]+?)\s+at\s+/u', $msg, $m)) {
            $currentFuel = trim($m[1]);
        }

        // current_cost  — first "₹NNNN/month)" occurrence
        $currentCost = null;
        if (preg_match('/₹([\d,]+(?:\.\d+)?)\/month\)/u', $msg, $m)) {
            $currentCost = $n($m[1]);
        }

        // quantity_per_month  — "283 kg/month of"
        $quantityPerMonth = null;
        if (preg_match('/([\d,]+)\s*kg\/month\s+of/u', $msg, $m)) {
            $quantityPerMonth = $n($m[1]);
        }

        // product  — "kg/month of Biomass Pellets ("
        $product = null;
        if (preg_match('/kg\/month\s+of\s+(.+?)\s*\(/u', $msg, $m)) {
            $product = trim($m[1]);
        }

        // biomass_cost  — "≈ ₹NNNN/month)"
        $biomassCost = null;
        if (preg_match('/[≈~]\s*₹([\d,]+(?:\.\d+)?)\/month\)/u', $msg, $m)) {
            $biomassCost = $n($m[1]);
        }

        // monthly_savings  — "saving ₹NNNN/month"
        $monthlySavings = null;
        if (preg_match('/saving\s+₹([\d,]+(?:\.\d+)?)\/month/u', $msg, $m)) {
            $monthlySavings = $n($m[1]);
        }

        $annualSavings = $monthlySavings !== null ? round($monthlySavings * 12, 2) : null;

        return compact('currentFuel', 'currentCost', 'quantityPerMonth', 'product', 'biomassCost', 'monthlySavings', 'annualSavings');
    }

    private static function normalizeRow(array $row): array
    {
        $row['status']       = self::toUiStatus($row['status'] ?? '');
        $row['admin_notes']  = $row['admin_notes']  ?? '';
        $row['quoted_price'] = $row['quoted_price'] ?? '';

        foreach (['quantity_per_month','current_cost','biomass_cost','monthly_savings','annual_savings'] as $f) {
            $row[$f] = isset($row[$f]) && $row[$f] !== null ? (float)$row[$f] : null;
        }

        // If the new columns are empty, fall back to parsing the message
        $needsFallback = empty($row['current_fuel']) && $row['quantity_per_month'] === null;
        if ($needsFallback && !empty($row['message'])) {
            $parsed = self::parseMessage((string)$row['message']);
            $row['product']           = $row['product']           ?: ($parsed['product']           ?? '');
            $row['current_fuel']      = $row['current_fuel']      ?: ($parsed['currentFuel']       ?? '');
            $row['quantity_per_month'] = $row['quantity_per_month'] ?? $parsed['quantityPerMonth'];
            $row['current_cost']      = $row['current_cost']      ?? $parsed['currentCost'];
            $row['biomass_cost']      = $row['biomass_cost']      ?? $parsed['biomassCost'];
            $row['monthly_savings']   = $row['monthly_savings']   ?? $parsed['monthlySavings'];
            $row['annual_savings']    = $row['annual_savings']    ?? $parsed['annualSavings'];
        }

        $row['product']      = $row['product']      ?? '';
        $row['current_fuel'] = $row['current_fuel'] ?? '';

        return $row;
    }

    private static function quoteEmailBody(array $quote, string $quotedPrice, string $adminNotes): string
    {
        $name    = htmlspecialchars($quote['name'] ?? '');
        $product = htmlspecialchars($quote['product'] ?? 'Biomass Pellets');
        $price   = htmlspecialchars($quotedPrice);

        $fmt = fn($n) => ($n !== null && $n !== '') ? '₹' . number_format((float)$n, 0) : '—';

        $savingsRows = '';
        if (!empty($quote['current_fuel'])) {
            $fuel = htmlspecialchars($quote['current_fuel']);
            $savingsRows = "
              <tr><td style='padding:6px 0;color:#6b7280;'>Current Fuel</td><td style='padding:6px 0;font-weight:600;'>{$fuel}</td></tr>
              <tr><td style='padding:6px 0;color:#6b7280;'>Current Monthly Cost</td><td style='padding:6px 0;'>{$fmt($quote['current_cost'])}/month</td></tr>
              <tr><td style='padding:6px 0;color:#6b7280;'>With Biomass Pellets</td><td style='padding:6px 0;'>{$fmt($quote['biomass_cost'])}/month</td></tr>
              <tr><td style='padding:6px 0;color:#059669;font-weight:600;'>Monthly Savings</td><td style='padding:6px 0;color:#059669;font-weight:600;'>{$fmt($quote['monthly_savings'])}/month</td></tr>
              <tr><td style='padding:6px 0;color:#059669;font-weight:600;'>Annual Savings</td><td style='padding:6px 0;color:#059669;font-weight:600;'>{$fmt($quote['annual_savings'])}/year</td></tr>";
        }

        $savingsBlock = $savingsRows ? "
            <table width='100%' cellpadding='0' cellspacing='0' style='background:#f9fafb;border-radius:8px;padding:16px 20px;font-size:14px;margin:16px 0;'>
              {$savingsRows}
            </table>" : '';

        $notesBlock = !empty($adminNotes) ? "
            <div style='background:#f9fafb;border-radius:8px;padding:16px 20px;margin:16px 0;font-size:14px;'>
              <p style='margin:0 0 6px;font-weight:600;color:#374151;'>Additional Notes</p>
              <p style='margin:0;color:#4b5563;'>" . nl2br(htmlspecialchars($adminNotes)) . "</p>
            </div>" : '';

        return <<<HTML
        <!DOCTYPE html>
        <html>
        <body style="margin:0;padding:0;background:#f3f4f6;font-family:Arial,sans-serif;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;padding:32px 0;">
            <tr><td align="center">
              <table width="520" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);">
                <tr>
                  <td style="background:#16a34a;padding:28px 36px;">
                    <h1 style="margin:0;color:#ffffff;font-size:22px;">Eco Sudar</h1>
                    <p style="margin:4px 0 0;color:#bbf7d0;font-size:13px;">Bio Energy LLP</p>
                  </td>
                </tr>
                <tr>
                  <td style="padding:32px 36px;">
                    <h2 style="margin:0 0 8px;color:#111827;font-size:18px;">Your Custom Quote is Ready</h2>
                    <p style="margin:0 0 24px;color:#4b5563;font-size:14px;line-height:1.6;">Dear {$name},<br><br>Thank you for your interest in Eco Sudar biomass solutions. We have reviewed your request and are pleased to provide you with a custom quote.</p>

                    <div style="background:#f0fdf4;border-left:4px solid #16a34a;border-radius:0 8px 8px 0;padding:16px 20px;margin:0 0 16px;">
                      <p style="margin:0 0 4px;color:#6b7280;font-size:13px;">{$product}</p>
                      <p style="margin:0;font-size:26px;font-weight:700;color:#15803d;">{$price}</p>
                    </div>

                    {$savingsBlock}
                    {$notesBlock}

                    <p style="margin:20px 0 4px;color:#4b5563;font-size:14px;">To place an order or ask any questions, reply to this email or contact us at <a href="mailto:support@ecosudar.com" style="color:#16a34a;">support@ecosudar.com</a>.</p>
                    <p style="margin:0;color:#4b5563;font-size:14px;">Best regards,<br>The Eco Sudar Team</p>
                  </td>
                </tr>
                <tr>
                  <td style="background:#f9fafb;padding:16px 36px;border-top:1px solid #e5e7eb;">
                    <p style="margin:0;color:#9ca3af;font-size:12px;">© Eco Sudar Bio Energy LLP · This is an automated message, please do not reply directly.</p>
                  </td>
                </tr>
              </table>
            </td></tr>
          </table>
        </body>
        </html>
        HTML;
    }

    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(100, max(1, (int)$request->query('limit', 50)));

        $where  = ['1=1'];
        $params = [];

        $uiStatus = $request->query('status');
        if ($uiStatus && in_array($uiStatus, ['New', 'Contacted', 'Quoted', 'Closed'], true)) {
            $where[]  = 'status = ?';
            $params[] = self::toDbStatus($uiStatus);
        }

        $search = $request->query('search');
        if ($search && trim($search) !== '') {
            $like     = '%' . trim($search) . '%';
            $where[]  = '(name LIKE ? OR phone LIKE ? OR email LIKE ? OR quote_number LIKE ?)';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        $whereClause = implode(' AND ', $where);
        $total  = Database::count("SELECT COUNT(*) AS cnt FROM quotes WHERE $whereClause", $params);
        $offset = ($page - 1) * $limit;

        $rows = Database::fetchAll(
            "SELECT quote_id, user_id, quote_number, name, email, phone, message,
                    product, quantity_per_month, current_fuel, current_cost,
                    biomass_cost, monthly_savings, annual_savings,
                    admin_notes, quoted_price, status, created_at
             FROM quotes
             WHERE $whereClause
             ORDER BY created_at DESC
             LIMIT ? OFFSET ?",
            [...$params, $limit, $offset]
        );

        $rows = array_map([self::class, 'normalizeRow'], $rows);

        Response::paginated($rows, [
            'page'        => $page,
            'limit'       => $limit,
            'total'       => $total,
            'total_pages' => (int)ceil($total / $limit),
        ]);
    }

    public function show(Request $request): void
    {
        $quoteId = (int)$request->param('id');
        if ($quoteId <= 0) {
            Response::error('Invalid quote ID', 400);
        }

        $row = Database::fetch(
            "SELECT quote_id, user_id, quote_number, name, email, phone, message,
                    product, quantity_per_month, current_fuel, current_cost,
                    biomass_cost, monthly_savings, annual_savings,
                    admin_notes, quoted_price, status, created_at
             FROM quotes WHERE quote_id = ? LIMIT 1",
            [$quoteId]
        );

        if (!$row) {
            Response::error('Quote request not found', 404);
        }

        Response::success(self::normalizeRow($row), 'Quote details retrieved');
    }

    public function update(Request $request): void
    {
        $quoteId = (int)$request->param('id');
        if ($quoteId <= 0) {
            Response::error('Invalid quote ID', 400);
        }

        // Use only guaranteed-existing columns for this fetch
        $quote = Database::fetch(
            'SELECT quote_id, name, email, phone, message, status
             FROM quotes WHERE quote_id = ? LIMIT 1',
            [$quoteId]
        );
        if (!$quote) {
            Response::error('Quote request not found', 404);
        }

        $uiStatus = (string)$request->input('status', 'New');
        if (!in_array($uiStatus, ['New', 'Contacted', 'Quoted', 'Closed'], true)) {
            Response::error('Invalid status. Allowed: New, Contacted, Quoted, Closed', 422);
        }

        $dbStatus    = self::toDbStatus($uiStatus);
        $adminNotes  = trim((string)$request->input('admin_notes',  ''));
        $quotedPrice = trim((string)$request->input('quoted_price', ''));

        Database::execute(
            'UPDATE quotes SET status = ?, admin_notes = ?, quoted_price = ? WHERE quote_id = ?',
            [$dbStatus, $adminNotes, $quotedPrice, $quoteId]
        );

        // Send email when status is Quoted and a price is provided
        $emailSent = false;
        if ($uiStatus === 'Quoted' && !empty($quotedPrice) && !empty($quote['email'])) {
            // Enrich quote with parsed calculator data for email template
            $parsed = self::parseMessage((string)($quote['message'] ?? ''));
            $quote  = array_merge([
                'product'           => $parsed['product']           ?? '',
                'current_fuel'      => $parsed['currentFuel']       ?? '',
                'current_cost'      => $parsed['currentCost']       ?? null,
                'biomass_cost'      => $parsed['biomassCost']       ?? null,
                'monthly_savings'   => $parsed['monthlySavings']    ?? null,
                'annual_savings'    => $parsed['annualSavings']     ?? null,
            ], $quote);

            $emailSent = true;
            $headers   = "MIME-Version: 1.0\r\nContent-Type: text/html; charset=UTF-8\r\nFrom: Eco Sudar <noreply@ecosudar.com>\r\n";
            $subject   = 'Your Custom Quote from Eco Sudar Bio Energy';
            $body      = self::quoteEmailBody($quote, $quotedPrice, $adminNotes);
            @mail($quote['email'], $subject, $body, $headers);
        }

        Response::success(
            ['quote_id' => $quoteId, 'status' => $uiStatus, 'email_sent' => $emailSent],
            $emailSent ? 'Quote sent to customer via email' : 'Quote request updated'
        );
    }
}
