<?php
declare(strict_types=1);

/**
 * Admin FAQ Controller
 * GET    /admin/faqs           — list all FAQs ordered by sort_order
 * POST   /admin/faqs           — create FAQ
 * PUT    /admin/faqs/reorder   — bulk-update sort_order (must be before /{id})
 * PUT    /admin/faqs/{id}      — update question/answer/active/sort_order
 * DELETE /admin/faqs/{id}      — delete FAQ
 */
class AdminFaqController
{
    public function index(Request $request): void
    {
        $rows = Database::fetchAll(
            "SELECT faq_id, question, answer, active, sort_order, created_at
             FROM faqs
             ORDER BY sort_order ASC, faq_id ASC"
        );

        foreach ($rows as &$row) {
            $row['active'] = (bool)$row['active'];
        }
        unset($row);

        Response::success($rows, 'FAQs retrieved');
    }

    public function store(Request $request): void
    {
        $question = trim((string)$request->input('question', ''));
        $answer   = trim((string)$request->input('answer',   ''));

        if ($question === '') {
            Response::error('Question is required', 422);
        }
        if ($answer === '') {
            Response::error('Answer is required', 422);
        }

        $maxOrder = Database::fetch("SELECT COALESCE(MAX(sort_order), 0) AS mx FROM faqs");
        $sortOrder = ((int)($maxOrder['mx'] ?? 0)) + 10;

        $faqId = Database::insert(
            "INSERT INTO faqs (question, answer, active, sort_order) VALUES (?, ?, 1, ?)",
            [$question, $answer, $sortOrder]
        );

        $row = Database::fetch("SELECT faq_id, question, answer, active, sort_order, created_at FROM faqs WHERE faq_id = ?", [$faqId]);
        $row['active'] = (bool)$row['active'];

        Response::success($row, 'FAQ created', 201);
    }

    public function update(Request $request): void
    {
        $faqId = (int)$request->param('id');
        if ($faqId <= 0) {
            Response::error('Invalid FAQ ID', 400);
        }

        $faq = Database::fetch('SELECT faq_id FROM faqs WHERE faq_id = ? LIMIT 1', [$faqId]);
        if (!$faq) {
            Response::error('FAQ not found', 404);
        }

        $sets   = [];
        $params = [];

        $question = $request->input('question');
        if ($question !== null) {
            $q = trim((string)$question);
            if ($q === '') {
                Response::error('Question cannot be empty', 422);
            }
            $sets[]   = 'question = ?';
            $params[] = $q;
        }

        $answer = $request->input('answer');
        if ($answer !== null) {
            $a = trim((string)$answer);
            if ($a === '') {
                Response::error('Answer cannot be empty', 422);
            }
            $sets[]   = 'answer = ?';
            $params[] = $a;
        }

        $active = $request->input('active');
        if ($active !== null) {
            $sets[]   = 'active = ?';
            $params[] = $active ? 1 : 0;
        }

        $sortOrder = $request->input('sort_order');
        if ($sortOrder !== null) {
            $sets[]   = 'sort_order = ?';
            $params[] = (int)$sortOrder;
        }

        if (empty($sets)) {
            Response::error('No fields to update', 422);
        }

        $params[] = $faqId;
        Database::execute('UPDATE faqs SET ' . implode(', ', $sets) . ' WHERE faq_id = ?', $params);

        Response::success(['faq_id' => $faqId], 'FAQ updated');
    }

    public function reorder(Request $request): void
    {
        $ids = $request->input('ids');
        if (!is_array($ids) || empty($ids)) {
            Response::error('ids array is required', 422);
        }

        foreach ($ids as $pos => $id) {
            $id = (int)$id;
            if ($id <= 0) continue;
            Database::execute('UPDATE faqs SET sort_order = ? WHERE faq_id = ?', [($pos + 1) * 10, $id]);
        }

        Response::success(null, 'FAQ order saved');
    }

    public function destroy(Request $request): void
    {
        $faqId = (int)$request->param('id');
        if ($faqId <= 0) {
            Response::error('Invalid FAQ ID', 400);
        }

        $faq = Database::fetch('SELECT faq_id FROM faqs WHERE faq_id = ? LIMIT 1', [$faqId]);
        if (!$faq) {
            Response::error('FAQ not found', 404);
        }

        Database::execute('DELETE FROM faqs WHERE faq_id = ?', [$faqId]);
        Response::success(null, 'FAQ deleted');
    }
}
