<?php
declare(strict_types=1);

class AdminAttendanceAnalyticsController
{
    public function analytics(Request $request): void
    {
        [$from, $to] = AttendanceAnalytics::window($request->query('from'), $request->query('to'), 30);
        $department = $request->query('dept') ?? $request->query('department');
        $employeeKey = $request->query('employee_key') ?? $request->query('employeeId');
        Response::success(AttendanceAnalytics::analytics(
            $from,
            $to,
            $department ? (string)$department : null,
            $employeeKey ? (string)$employeeKey : null
        ));
    }

    public function anomalies(Request $request): void
    {
        [$from, $to] = AttendanceAnalytics::window($request->query('from'), $request->query('to'), 30);
        $department = $request->query('dept') ?? $request->query('department');
        Response::success(AttendanceAnalytics::anomalies(
            $from,
            $to,
            $department ? (string)$department : null
        ));
    }
}
