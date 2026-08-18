<?php
declare(strict_types=1);

class Meeting
{
    /**
     * Attendees now live in the `meeting_attendees` junction table (one row per
     * attendee). This correlated sub-select re-materialises them as a JSON array
     * so the API contract (attendees: string[]) is unchanged for callers.
     */
    private const ATTENDEES_SUBQUERY =
        "(SELECT COALESCE(JSON_ARRAYAGG(ma.attendee_key), JSON_ARRAY())
            FROM meeting_attendees ma WHERE ma.meeting_id = m.meeting_id) AS attendees";

    public static function all(array $filters = []): array
    {
        $where = ['1=1'];
        $params = [];

        // Filter by date range
        if (!empty($filters['from'])) {
            $where[] = 'm.date >= ?';
            $params[] = $filters['from'];
        }
        if (!empty($filters['to'])) {
            $where[] = 'm.date <= ?';
            $params[] = $filters['to'];
        }

        // Filter by attendee (now a junction lookup)
        if (!empty($filters['attendee'])) {
            $where[] = 'EXISTS (SELECT 1 FROM meeting_attendees ma2
                                 WHERE ma2.meeting_id = m.meeting_id AND ma2.attendee_key = ?)';
            $params[] = $filters['attendee'];
        }

        $sql = 'SELECT m.*, ' . self::ATTENDEES_SUBQUERY . '
                  FROM meetings m
                 WHERE ' . implode(' AND ', $where) . '
                 ORDER BY m.meeting_id ASC';

        return Database::fetchAll($sql, $params);
    }

    public static function upcoming(int $limit = 10): array
    {
        return Database::fetchAll(
            'SELECT m.*, ' . self::ATTENDEES_SUBQUERY . '
               FROM meetings m
              WHERE m.date >= CURDATE()
              ORDER BY m.date ASC, m.time ASC
              LIMIT ?',
            [$limit]
        );
    }

    public static function findById(int $id): ?array
    {
        return Database::fetch(
            'SELECT m.*, ' . self::ATTENDEES_SUBQUERY . '
               FROM meetings m
              WHERE m.meeting_id = ? LIMIT 1',
            [$id]
        );
    }

    public static function create(array $data): int
    {
        $id = Database::insert(
            'INSERT INTO meetings
                (title, date, time, location, agenda, notes, raci, action_items, created_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $data['title'],
                $data['date'],
                $data['time'],
                $data['location'] ?? null,
                $data['agenda'] ?? null,
                $data['notes'] ?? null,
                json_encode($data['raci'] ?? []),
                json_encode($data['action_items'] ?? []),
                $data['created_by'] ?? null,
            ]
        );
        self::syncAttendees($id, $data['attendees'] ?? []);
        return $id;
    }

    public static function update(int $id, array $data): void
    {
        $fields = [];
        $params = [];

        $fieldMap = [
            'title' => 'title',
            'date' => 'date',
            'time' => 'time',
            'location' => 'location',
            'agenda' => 'agenda',
            'notes' => 'notes',
        ];

        foreach ($fieldMap as $key => $col) {
            if (array_key_exists($key, $data)) {
                $fields[] = "$col = ?";
                $params[] = $data[$key];
            }
        }

        // Handle remaining JSON fields
        if (array_key_exists('raci', $data)) {
            $fields[] = 'raci = ?';
            $params[] = json_encode($data['raci']);
        }
        if (array_key_exists('action_items', $data)) {
            $fields[] = 'action_items = ?';
            $params[] = json_encode($data['action_items']);
        }

        if ($fields) {
            $fields[] = 'updated_at = NOW()';
            $params[] = $id;
            Database::execute(
                'UPDATE meetings SET ' . implode(', ', $fields) . ' WHERE meeting_id = ?',
                $params
            );
        }

        // Attendees are managed in the junction table.
        if (array_key_exists('attendees', $data)) {
            self::syncAttendees($id, is_array($data['attendees']) ? $data['attendees'] : []);
        }
    }

    public static function delete(int $id): void
    {
        // meeting_attendees rows are removed via ON DELETE CASCADE.
        Database::execute('DELETE FROM meetings WHERE meeting_id = ?', [$id]);
    }

    /** Replace a meeting's attendee set with the given employee keys (invalid keys are skipped). */
    private static function syncAttendees(int $meetingId, array $keys): void
    {
        Database::execute('DELETE FROM meeting_attendees WHERE meeting_id = ?', [$meetingId]);

        $keys = array_values(array_unique(array_filter(
            array_map(static fn($k) => trim((string)$k), $keys),
            static fn(string $k) => $k !== ''
        )));
        if (!$keys) {
            return;
        }

        // Only insert keys that map to a real employee, so the FK never rejects the row.
        $placeholders = implode(',', array_fill(0, count($keys), '?'));
        Database::execute(
            "INSERT IGNORE INTO meeting_attendees (meeting_id, attendee_key)
             SELECT ?, employee_key FROM employees WHERE employee_key IN ($placeholders)",
            array_merge([$meetingId], $keys)
        );
    }

    public static function format(array $row): array
    {
        return [
            'id' => (string)$row['meeting_id'],
            'meeting_id' => (int)$row['meeting_id'],
            'title' => $row['title'],
            'date' => $row['date'],
            'time' => substr($row['time'], 0, 5), // HH:MM format
            'location' => $row['location'] ?? '',
            'agenda' => $row['agenda'] ?? '',
            'notes' => $row['notes'] ?? '',
            'attendees' => json_decode($row['attendees'] ?? '[]', true) ?: [],
            'raci' => json_decode($row['raci'] ?? '[]', true),
            'action_items' => json_decode($row['action_items'] ?? '[]', true),
            'actionItems' => json_decode($row['action_items'] ?? '[]', true), // For backward compatibility
            'created_by' => $row['created_by'] ? (int)$row['created_by'] : null,
            'created_at' => $row['created_at'],
            'createdAt' => $row['created_at'], // For backward compatibility
            'updated_at' => $row['updated_at'] ?? null,
        ];
    }
}
