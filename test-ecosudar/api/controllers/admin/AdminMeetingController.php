<?php
declare(strict_types=1);

class AdminMeetingController
{
    /**
     * GET /api/admin/meetings - List all meetings
     */
    public function index(Request $request): void
    {
        $filters = [];
        
        if ($from = $request->query('from')) {
            $filters['from'] = $from;
        }
        if ($to = $request->query('to')) {
            $filters['to'] = $to;
        }
        if ($attendee = $request->query('attendee')) {
            $filters['attendee'] = $attendee;
        }

        $rows = Meeting::all($filters);
        
        // Sort by meeting_id in ascending order
        usort($rows, function($a, $b) {
            return $a['meeting_id'] - $b['meeting_id'];
        });
        
        Response::success(array_map([Meeting::class, 'format'], $rows));
    }

    /**
     * GET /api/admin/meetings/upcoming - Get upcoming meetings
     */
    public function upcoming(Request $request): void
    {
        $limit = (int)$request->query('limit', 10);
        $rows = Meeting::upcoming($limit);
        Response::success(array_map([Meeting::class, 'format'], $rows));
    }

    /**
     * GET /api/admin/meetings/general - Get (or create) the shared meeting used
     * for standalone media uploads that aren't tied to a specific meeting.
     */
    public function general(Request $request): void
    {
        $title = 'General / Standalone Media';

        $row = Database::fetch(
            'SELECT * FROM meetings WHERE title = ? ORDER BY meeting_id ASC LIMIT 1',
            [$title]
        );

        if (!$row) {
            $id = Meeting::create([
                'title'        => $title,
                'date'         => date('Y-m-d'),
                'time'         => '00:00',
                'location'     => 'N/A',
                'agenda'       => null,
                'notes'        => null,
                'attendees'    => [],
                'raci'         => [],
                'action_items' => [],
                'created_by'   => $request->user['user_id'] ?? null,
            ]);
            $row = Meeting::findById($id);
        }

        Response::success(Meeting::format($row));
    }

    /**
     * GET /api/admin/meetings/{id} - Get single meeting
     */
    public function show(Request $request): void
    {
        $id = (int)$request->param('id');
        $meeting = Meeting::findById($id);
        
        if (!$meeting) {
            Response::error('Meeting not found', 404);
        }
        
        Response::success(Meeting::format($meeting));
    }

    /**
     * POST /api/admin/meetings - Create new meeting
     */
    public function store(Request $request): void
    {
        $title = trim((string)$request->input('title', ''));
        $date = trim((string)$request->input('date', ''));
        $time = trim((string)$request->input('time', ''));
        $location = trim((string)$request->input('location', ''));
        $agenda = trim((string)$request->input('agenda', ''));
        $notes = trim((string)$request->input('notes', ''));
        $attendees = $request->input('attendees', []);
        $raci = $request->input('raci', []);
        
        // Handle both actionItems and action_items
        $actionItems = $request->input('actionItems') ?? $request->input('action_items', []);

        // Validation
        if (!$title) Response::error('Title is required', 422);
        if (!$date) Response::error('Date is required', 422);
        if (!$time) Response::error('Time is required', 422);
        
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $date)) {
            Response::error('Date must be in YYYY-MM-DD format', 422);
        }
        if (!preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $time)) {
            Response::error('Time must be in HH:MM or HH:MM:SS format', 422);
        }

        $id = Meeting::create([
            'title' => $title,
            'date' => $date,
            'time' => $time,
            'location' => $location,
            'agenda' => $agenda,
            'notes' => $notes,
            'attendees' => $attendees,
            'raci' => $raci,
            'action_items' => $actionItems,
            'created_by' => $request->user['user_id'] ?? null,
        ]);

        $row = Meeting::findById($id);
        Response::success(Meeting::format($row), 'Meeting created', 201);
    }

    /**
     * PUT /api/admin/meetings/{id} - Update meeting
     */
    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        $meeting = Meeting::findById($id);
        
        if (!$meeting) {
            Response::error('Meeting not found', 404);
        }

        $data = [];
        
        // Simple fields
        foreach (['title', 'date', 'time', 'location', 'agenda', 'notes'] as $field) {
            $val = $request->input($field);
            if ($val !== null) {
                $data[$field] = trim((string)$val);
            }
        }

        // Array fields
        if ($request->input('attendees') !== null) {
            $data['attendees'] = $request->input('attendees');
        }
        if ($request->input('raci') !== null) {
            $data['raci'] = $request->input('raci');
        }
        
        // Handle both actionItems and action_items
        $actionItems = $request->input('actionItems') ?? $request->input('action_items');
        if ($actionItems !== null) {
            $data['action_items'] = $actionItems;
        }

        if (empty($data)) {
            Response::error('No fields to update', 400);
        }

        // Validation
        if (isset($data['date']) && !preg_match('/^\d{4}-\d{2}-\d{2}$/', $data['date'])) {
            Response::error('Date must be in YYYY-MM-DD format', 422);
        }
        if (isset($data['time']) && !preg_match('/^\d{2}:\d{2}(:\d{2})?$/', $data['time'])) {
            Response::error('Time must be in HH:MM or HH:MM:SS format', 422);
        }

        Meeting::update($id, $data);
        
        $updated = Meeting::findById($id);
        Response::success(Meeting::format($updated), 'Meeting updated');
    }

    /**
     * PUT /api/admin/meetings/{id}/attendees - Update attendees only
     */
    public function updateAttendees(Request $request): void
    {
        $id = (int)$request->param('id');
        $meeting = Meeting::findById($id);
        
        if (!$meeting) {
            Response::error('Meeting not found', 404);
        }

        $attendees = $request->input('attendees');
        if (!is_array($attendees)) {
            Response::error('Attendees must be an array', 400);
        }

        Meeting::update($id, ['attendees' => $attendees]);
        
        $updated = Meeting::findById($id);
        Response::success(Meeting::format($updated), 'Attendees updated');
    }

    /**
     * DELETE /api/admin/meetings/{id} - Delete meeting
     */
    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        $meeting = Meeting::findById($id);
        
        if (!$meeting) {
            Response::error('Meeting not found', 404);
        }

        Meeting::delete($id);
        Response::success(null, 'Meeting deleted');
    }
}