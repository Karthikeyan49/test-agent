<?php
declare(strict_types=1);

class AdminKnowledgeController
{
    // GET /admin/knowledge
    public function index(Request $request): void
    {
        $page     = max(1, (int)$request->query('page', 1));
        $category = $request->query('category', '');

        ['rows' => $rows, 'total' => $total] = KnowledgeBase::getAll($page, 20, $category);

        Response::paginated($rows, $total, $page, 20);
    }

    // GET /admin/knowledge/categories
    public function categories(Request $request): void
    {
        Response::success(KnowledgeBase::categories());
    }

    // GET /admin/knowledge/{id}
    public function show(Request $request): void
    {
        $item = KnowledgeBase::getById((int)$request->params['id']);
        if (!$item) Response::error('Not found', 404);
        Response::success($item);
    }

    // POST /admin/knowledge
    public function store(Request $request): void
    {
        $title   = trim((string)($request->input('title') ?? ''));
        $content = trim((string)($request->input('content') ?? ''));

        if (!$title || !$content) {
            Response::error('title and content are required', 400);
        }

        $id = KnowledgeBase::create([
            'title'      => $title,
            'content'    => $content,
            'category'   => $request->input('category') ?? 'general',
            'tags'       => $request->input('tags') ?? '',
            'is_active'  => $request->input('is_active') ?? 1,
            'created_by' => $request->user['user_id'] ?? null,
        ]);

        Response::success(KnowledgeBase::getById($id), 'Knowledge entry created', 201);
    }

    // PUT /admin/knowledge/{id}
    public function update(Request $request): void
    {
        $id   = (int)$request->params['id'];
        $item = KnowledgeBase::getById($id);
        if (!$item) Response::error('Not found', 404);

        $fields = array_filter([
            'title'     => $request->input('title'),
            'content'   => $request->input('content'),
            'category'  => $request->input('category'),
            'tags'      => $request->input('tags'),
            'is_active' => $request->input('is_active'),
        ], fn($v) => $v !== null);

        KnowledgeBase::update($id, $fields);
        Response::success(KnowledgeBase::getById($id), 'Updated');
    }

    // DELETE /admin/knowledge/{id}
    public function destroy(Request $request): void
    {
        $id = (int)$request->params['id'];
        if (!KnowledgeBase::getById($id)) Response::error('Not found', 404);
        KnowledgeBase::delete($id);
        Response::success(null, 'Deleted');
    }
}
