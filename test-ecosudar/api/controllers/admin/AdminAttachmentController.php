<?php
declare(strict_types=1);

class AdminAttachmentController
{
    public function download(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid attachment ID', 400);
        }

        $attachment = $this->findAttachment($id);
        if (!$attachment) {
            Response::error('Attachment not found', 404);
        }
        $this->enforceAttachmentAccess($request, $attachment);

        $path = (string)$attachment['file_path'];
        $disk = (string)($attachment['storage_disk'] ?? 'local');

        if ($disk === 'external' && FileStore::isExternalUrl($path)) {
            header_remove('Content-Type');
            header('Location: ' . $path, true, 302);
            exit;
        }

        FileStore::stream(
            $path,
            $attachment['original_name'] ?? null,
            $attachment['mime_type'] ?? null,
            $request->query('download') === '1'
        );
    }

    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id <= 0) {
            Response::error('Invalid attachment ID', 400);
        }

        $attachment = $this->findAttachment($id);
        if (!$attachment) {
            Response::error('Attachment not found', 404);
        }
        $this->enforceAttachmentAccess($request, $attachment);

        Database::beginTransaction();
        try {
            Database::execute('DELETE FROM attachments WHERE attachment_id = ?', [$id]);
            Database::commit();
        } catch (Throwable $e) {
            Database::rollBack();
            error_log('Attachment delete error: ' . $e->getMessage());
            Response::error('Could not delete attachment', 500);
        }

        if (($attachment['storage_disk'] ?? 'local') === 'local') {
            FileStore::deleteLocal((string)$attachment['file_path']);
            $thumb = (string)($attachment['thumbnail_path'] ?? '');
            if ($thumb !== '' && $thumb !== (string)$attachment['file_path']) {
                FileStore::deleteLocal($thumb);
            }
        }

        Response::success(null, 'Attachment deleted');
    }

    private function findAttachment(int $id): ?array
    {
        return Database::fetch(
            'SELECT * FROM attachments WHERE attachment_id = ? LIMIT 1',
            [$id]
        );
    }

    private function enforceAttachmentAccess(Request $request, array $attachment): void
    {
        if (($attachment['entity_type'] ?? '') !== 'employee_compliance') {
            return;
        }

        $role = AdminMiddleware::normalizeStaffRole($request->user['staff_role'] ?? null);
        if ($role === null && ($request->user['user_type'] ?? '') === 'admin') {
            $role = 'owner';
        }
        if (!in_array($role, ['owner', 'hr'], true)) {
            Response::error('HR or owner access required for employee compliance documents', 403);
        }
    }
}
