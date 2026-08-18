<?php
declare(strict_types=1);

/**
 * Public Query Controller (Minimal)
 */
class QueryController
{
    // ─── POST /queries ────────────────────────────────────────────────────────
    public function store(Request $request): void
    {
        Validator::make($request->only(['name', 'email', 'message']), [
            'name'    => 'required|string|max:100',
            'email'   => 'required|email|max:100',
            'message' => 'required|string',
        ])->validate();

        $userId = $request->user['user_id'] ?? null;

        Database::beginTransaction();
        try {
            $tempQueryNum = 'QRY-TEMP-' . uniqid();
            
            $queryId = Database::insert(
                'INSERT INTO queries (user_id, query_number, name, email, message, status, created_at)
                 VALUES (?, ?, ?, ?, ?, "pending", NOW())',
                [
                    $userId,
                    $tempQueryNum,
                    Request::sanitize((string)$request->input('name')),
                    Request::sanitize((string)$request->input('email')),
                    Request::sanitize((string)$request->input('message')),
                ]
            );

            $queryNumber = 'QRY-' . date('Y') . '-' . str_pad((string)$queryId, 4, '0', STR_PAD_LEFT);
            Database::execute('UPDATE queries SET query_number = ? WHERE query_id = ?', [$queryNumber, $queryId]);
            
            Database::commit();
        } catch (\Throwable $e) {
            Database::rollBack();
            throw $e;
        }

        $createdAt = date('Y-m-d\TH:i:s\Z');
        Response::success([
            'query_id'     => $queryId,
            'query_number' => $queryNumber,
            'name'         => Request::sanitize((string)$request->input('name')),
            'email'        => Request::sanitize((string)$request->input('email')),
            'message'      => Request::sanitize((string)$request->input('message')),
            'status'       => 'pending',
            'created_at'   => $createdAt
        ], 'Query submitted successfully', 201);
    }
}
