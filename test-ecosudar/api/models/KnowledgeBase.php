<?php
declare(strict_types=1);

class KnowledgeBase
{
    /**
     * Full-text search — returns top $limit relevant chunks for a query.
     */
    public static function search(string $query, int $limit = 5): array
    {
        $query = trim($query);
        if ($query === '') return [];

        // FULLTEXT natural language search with relevance score
        $rows = Database::fetchAll(
            "SELECT id, title, content, category, tags,
                    MATCH(title, content, tags) AGAINST(? IN NATURAL LANGUAGE MODE) AS score
             FROM chat_knowledge_base
             WHERE is_active = 1
               AND MATCH(title, content, tags) AGAINST(? IN NATURAL LANGUAGE MODE)
             ORDER BY score DESC
             LIMIT ?",
            [$query, $query, $limit]
        );

        // Fallback: LIKE search if FULLTEXT returns nothing (e.g. single short word)
        if (empty($rows)) {
            $like = '%' . $query . '%';
            $rows = Database::fetchAll(
                "SELECT id, title, content, category, tags, 0 AS score
                 FROM chat_knowledge_base
                 WHERE is_active = 1
                   AND (title LIKE ? OR content LIKE ? OR tags LIKE ?)
                 LIMIT ?",
                [$like, $like, $like, $limit]
            );
        }

        return $rows;
    }

    public static function getAll(int $page = 1, int $perPage = 20, string $category = ''): array
    {
        $offset = ($page - 1) * $perPage;
        $where  = $category ? "WHERE category = ?" : "WHERE 1";
        $params = $category ? [$category, $perPage, $offset] : [$perPage, $offset];

        $rows  = Database::fetchAll(
            "SELECT id, title, content, category, tags, is_active, created_at, updated_at
             FROM chat_knowledge_base $where
             ORDER BY created_at DESC LIMIT ? OFFSET ?",
            $params
        );
        $total = (int) Database::fetch(
            "SELECT COUNT(*) AS cnt FROM chat_knowledge_base " . ($category ? "WHERE category = ?" : ""),
            $category ? [$category] : []
        )['cnt'];

        return compact('rows', 'total');
    }

    public static function getById(int $id): ?array
    {
        return Database::fetch(
            "SELECT * FROM chat_knowledge_base WHERE id = ?", [$id]
        );
    }

    public static function create(array $data): int
    {
        return Database::insert(
            "INSERT INTO chat_knowledge_base (title, content, category, tags, is_active, created_by)
             VALUES (?, ?, ?, ?, ?, ?)",
            [
                $data['title'],
                $data['content'],
                $data['category'] ?? 'general',
                $data['tags']     ?? '',
                isset($data['is_active']) ? (int)$data['is_active'] : 1,
                $data['created_by'] ?? null,
            ]
        );
    }

    public static function update(int $id, array $data): bool
    {
        $fields = [];
        $params = [];
        foreach (['title','content','category','tags','is_active'] as $f) {
            if (array_key_exists($f, $data)) {
                $fields[] = "$f = ?";
                $params[] = $f === 'is_active' ? (int)$data[$f] : $data[$f];
            }
        }
        if (!$fields) return false;
        $params[] = $id;
        return Database::execute(
            "UPDATE chat_knowledge_base SET " . implode(', ', $fields) . " WHERE id = ?",
            $params
        ) > 0;
    }

    public static function delete(int $id): bool
    {
        return Database::execute("DELETE FROM chat_knowledge_base WHERE id = ?", [$id]) > 0;
    }

    public static function categories(): array
    {
        return array_column(
            Database::fetchAll("SELECT DISTINCT category FROM chat_knowledge_base WHERE is_active = 1 ORDER BY category"),
            'category'
        );
    }
}
