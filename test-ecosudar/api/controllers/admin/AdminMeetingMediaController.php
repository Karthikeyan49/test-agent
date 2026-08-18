<?php
declare(strict_types=1);

class AdminMeetingMediaController
{
    public function index(Request $request): void
    {
        Response::success(MeetingMedia::list((int)$request->param('id')));
    }

    public function store(Request $request): void
    {
        $meetingId = (int)$request->param('id');
        $caption = $request->input('caption') ? (string)$request->input('caption') : null;
        $externalUrl = trim((string)$request->input('external_url', ''));

        if ($externalUrl !== '') {
            $media = MeetingMedia::attachExternalVideo(
                $meetingId,
                $externalUrl,
                $request->input('title') ? (string)$request->input('title') : null,
                $caption,
                $this->actorId($request)
            );
            Response::success($media, 'Meeting media attached', 201);
        }

        $files = $this->uploadedFiles();
        $media = MeetingMedia::uploadFiles($meetingId, $files, $caption, $this->actorId($request));
        Response::success($media, 'Meeting media uploaded', 201);
    }

    public function destroy(Request $request): void
    {
        MeetingMedia::delete((int)$request->param('id'), (int)$request->param('attachmentId'));
        Response::success(null, 'Meeting media deleted');
    }

    private function uploadedFiles(): array
    {
        $files = [];
        if (isset($_FILES['files']) && is_array($_FILES['files']['name'] ?? null)) {
            $count = count($_FILES['files']['name']);
            for ($i = 0; $i < $count; $i++) {
                if ((int)($_FILES['files']['error'][$i] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
                    continue;
                }
                $files[] = [
                    'name' => $_FILES['files']['name'][$i],
                    'type' => $_FILES['files']['type'][$i] ?? '',
                    'tmp_name' => $_FILES['files']['tmp_name'][$i],
                    'error' => $_FILES['files']['error'][$i],
                    'size' => $_FILES['files']['size'][$i],
                ];
            }
        }

        foreach (['file', 'media'] as $key) {
            if (isset($_FILES[$key]) && (int)($_FILES[$key]['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_NO_FILE) {
                $files[] = $_FILES[$key];
            }
        }

        return $files;
    }

    private function actorId(Request $request): ?int
    {
        return isset($request->user['user_id']) ? (int)$request->user['user_id'] : null;
    }
}
