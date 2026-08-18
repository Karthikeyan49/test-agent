<?php
declare(strict_types=1);

class AdminGstComplianceController
{
    public function index(Request $request): void
    {
        $result = GstCompliance::all(
            (int)$request->query('page', 1),
            (int)$request->query('limit', 20)
        );
        Response::paginated($result['rows'], $result['pagination']);
    }

    public function show(Request $request): void
    {
        $period = GstCompliance::periodKey((string)$request->param('period'));
        Response::success([
            'saved' => GstCompliance::find($period),
            'calculated' => GstCompliance::calculate($period),
        ]);
    }

    public function calculate(Request $request): void
    {
        $period = GstCompliance::periodKey((string)($request->query('period') ?: $request->param('period')));
        Response::success(GstCompliance::calculate($period));
    }

    public function save(Request $request): void
    {
        $period = GstCompliance::periodKey((string)$request->param('period'));
        $saved = GstCompliance::saveSnapshot($period, $this->actorId($request));
        $this->audit($request, 'gst_period_saved', 'gst_compliance_periods', (int)$saved['period_id'], null, $saved);
        Response::success($saved, 'GST period snapshot saved');
    }

    public function review(Request $request): void
    {
        $this->status($request, 'reviewed', 'GST period reviewed');
    }

    public function file(Request $request): void
    {
        $filedOn = $request->input('filed_on') ? Payment::validDateOrDefault((string)$request->input('filed_on'), date('Y-m-d')) : date('Y-m-d');
        $reference = $request->input('reference_no') ? Request::sanitize((string)$request->input('reference_no')) : null;
        $this->status($request, 'filed', 'GST period filed', ['filed_on' => $filedOn, 'reference_no' => $reference]);
    }

    public function lock(Request $request): void
    {
        $this->status($request, 'locked', 'GST period locked');
    }

    public function export(Request $request): void
    {
        $period = GstCompliance::periodKey((string)$request->param('period'));
        Response::success(GstCompliance::export($period), 'GST export generated');
    }

    private function status(Request $request, string $status, string $message, array $extra = []): void
    {
        $period = GstCompliance::periodKey((string)$request->param('period'));
        $before = GstCompliance::find($period);
        $data = $extra;
        if ($request->input('notes') !== null) {
            $data['notes'] = Request::sanitize((string)$request->input('notes'));
        }
        $saved = GstCompliance::updateStatus($period, $status, $data, $this->actorId($request));
        $this->audit($request, 'gst_period_' . $status, 'gst_compliance_periods', (int)$saved['period_id'], $before, $saved);
        Response::success($saved, $message);
    }

    private function actorId(Request $request): int
    {
        return isset($request->user['user_id']) ? (int)$request->user['user_id'] : 0;
    }

    private function audit(Request $request, string $action, string $table, int $id, mixed $before, mixed $after): void
    {
        Database::execute(
            'INSERT INTO audit_log (user_id, action, table_name, record_id, old_value, new_value, ip_address, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, NOW())',
            [
                $this->actorId($request) ?: null,
                $action,
                $table,
                $id,
                $before !== null ? json_encode($before) : null,
                $after !== null ? json_encode($after) : null,
                $request->ip(),
            ]
        );
    }
}
