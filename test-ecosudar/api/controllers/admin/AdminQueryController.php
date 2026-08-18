<?php
declare(strict_types=1);

/**
 * Admin Query Controller
 * GET /admin/queries           — list customer queries
 * GET /admin/queries/{id}      — single query
 * PUT /admin/queries/{id}/reply — update admin reply + status
 */
class AdminQueryController
{
    /** DB status → UI status */
    private static function toUiStatus(string $raw): string
    {
        return match ($raw) {
            'in_progress' => 'In Progress',
            'resolved'    => 'Resolved',
            default       => 'New',
        };
    }

    /** UI status → DB status */
    private static function toDbStatus(string $ui): string
    {
        return match ($ui) {
            'In Progress' => 'in_progress',
            'Resolved'    => 'resolved',
            default       => 'pending',
        };
    }

    private static function normalizeRow(array $row): array
    {
        $row['status']      = self::toUiStatus($row['status'] ?? '');
        $row['admin_reply'] = $row['admin_reply'] ?? '';
        return $row;
    }

    public function index(Request $request): void
    {
        $page  = max(1, (int)$request->query('page', 1));
        $limit = min(100, max(1, (int)$request->query('limit', 50)));

        $where  = ['1=1'];
        $params = [];

        $uiStatus = $request->query('status');
        if ($uiStatus && in_array($uiStatus, ['New', 'In Progress', 'Resolved'], true)) {
            $where[]  = 'status = ?';
            $params[] = self::toDbStatus($uiStatus);
        }

        $search = $request->query('search');
        if ($search && trim($search) !== '') {
            $like     = '%' . trim($search) . '%';
            $where[]  = '(name LIKE ? OR email LIKE ? OR query_number LIKE ?)';
            $params[] = $like;
            $params[] = $like;
            $params[] = $like;
        }

        $whereClause = implode(' AND ', $where);
        $total  = Database::count("SELECT COUNT(*) AS cnt FROM queries WHERE $whereClause", $params);
        $offset = ($page - 1) * $limit;

        $rows = Database::fetchAll(
            "SELECT query_id, user_id, query_number, name, email, message,
                    admin_reply, status, created_at
             FROM queries
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
        $queryId = (int)$request->param('id');
        if ($queryId <= 0) {
            Response::error('Invalid query ID', 400);
        }

        $row = Database::fetch(
            "SELECT query_id, user_id, query_number, name, email, message,
                    admin_reply, status, created_at
             FROM queries
             WHERE query_id = ? LIMIT 1",
            [$queryId]
        );

        if (!$row) {
            Response::error('Query not found', 404);
        }

        Response::success(self::normalizeRow($row), 'Query details retrieved');
    }

    public function reply(Request $request): void
    {
        $queryId = (int)$request->param('id');
        if ($queryId <= 0) {
            Response::error('Invalid query ID', 400);
        }

        $query = Database::fetch('SELECT * FROM queries WHERE query_id = ? LIMIT 1', [$queryId]);
        if (!$query) {
            Response::error('Query not found', 404);
        }

        $uiStatus   = (string)$request->input('status', 'New');
        $adminReply = trim((string)$request->input('admin_reply', ''));

        if (!in_array($uiStatus, ['New', 'In Progress', 'Resolved'], true)) {
            Response::error('Invalid status. Allowed: New, In Progress, Resolved', 422);
        }

        $dbStatus = self::toDbStatus($uiStatus);

        Database::execute(
            'UPDATE queries SET admin_reply = ?, status = ? WHERE query_id = ?',
            [$adminReply, $dbStatus, $queryId]
        );

        // Send Email if reply provided and customer has email
        if (!empty($adminReply) && !empty($query['email'])) {
            $to      = $query['email'];
            $subject = 'Re: ' . ($query['subject'] ?? 'Your Query to Eco Sudar');
            
            $html = '
            <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; border: 1px solid #e5e7eb; border-radius: 8px; padding: 20px;">
                <h2 style="color: #10b981;">Eco Sudar Bio Energy</h2>
                <p>Dear ' . htmlspecialchars($query['name']) . ',</p>
                <p>Thank you for reaching out to us. We have reviewed your query and here is our response:</p>
                <div style="background-color: #f3f4f6; padding: 15px; border-radius: 5px; margin: 15px 0;">
                    <p style="margin: 0; font-weight: bold;">Your original message:</p>
                    <p style="margin: 5px 0 0 0; color: #4b5563;">' . nl2br(htmlspecialchars($query['message'])) . '</p>
                </div>
                <div style="background-color: #ecfdf5; border-left: 4px solid #10b981; padding: 15px; border-radius: 0 5px 5px 0; margin: 15px 0;">
                    <p style="margin: 0; font-weight: bold; color: #047857;">Our Reply:</p>
                    <p style="margin: 5px 0 0 0; color: #065f46;">' . nl2br(htmlspecialchars($adminReply)) . '</p>
                </div>
                <p>If you have any further questions, please do not hesitate to contact us.</p>
                <p>Best regards,<br>The Eco Sudar Team</p>
                <hr style="border: none; border-top: 1px solid #e5e7eb; margin: 20px 0;">
                <p style="margin:0;color:#9ca3af;font-size:12px;text-align:center;">© Eco Sudar Bio Energy LLP · This is an automated message, please do not reply to this email directly.</p>
            </div>';

            $headers  = "MIME-Version: 1.0\r\n";
            $headers .= "Content-Type: text/html; charset=UTF-8\r\n";
            $headers .= "From: Eco Sudar Support <noreply@ecosudar.com>\r\n";

            mail($to, $subject, $html, $headers);
        }

        Response::success(
            ['query_id' => $queryId, 'status' => $uiStatus, 'admin_reply' => $adminReply],
            'Query updated and response emailed to customer'
        );
    }
}
