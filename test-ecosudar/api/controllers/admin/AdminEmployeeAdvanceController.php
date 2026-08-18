<?php
declare(strict_types=1);

class AdminEmployeeAdvanceController
{
    public function index(Request $request): void
    {
        $month = trim((string)$request->query('month', ''));
        $employeeKey = trim((string)$request->query('employeeId', ''));

        if ($month !== '' && !preg_match('/^\d{4}-\d{2}$/', $month)) {
            Response::error('Valid month required (YYYY-MM)', 422);
        }

        $rows = EmployeeAdvance::all([
            'month' => $month,
            'employeeKey' => $employeeKey,
        ]);
        Response::success(array_map([EmployeeAdvance::class, 'format'], $rows));
    }

    public function store(Request $request): void
    {
        $data = $this->payload($request);
        $id = EmployeeAdvance::create($data);
        $row = EmployeeAdvance::find($id);
        Response::success(EmployeeAdvance::format($row ?? []), 'Advance added', 201);
    }

    public function update(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id < 1 || !EmployeeAdvance::find($id)) {
            Response::error('Advance entry not found', 404);
        }

        EmployeeAdvance::update($id, $this->payload($request));
        $row = EmployeeAdvance::find($id);
        Response::success(EmployeeAdvance::format($row ?? []), 'Advance updated');
    }

    public function destroy(Request $request): void
    {
        $id = (int)$request->param('id');
        if ($id < 1 || !EmployeeAdvance::find($id)) {
            Response::error('Advance entry not found', 404);
        }

        EmployeeAdvance::delete($id);
        Response::success(['deleted' => true], 'Advance deleted');
    }

    private function payload(Request $request): array
    {
        $employeeKey = Employee::normalizeEmployeeKey($request->input('employeeId', ''), true);
        if (!Employee::findByKey($employeeKey)) {
            Response::error('Employee not found', 404);
        }

        $advanceDate = trim((string)$request->input('advanceDate', date('Y-m-d')));
        if (!preg_match('/^\d{4}-\d{2}-\d{2}$/', $advanceDate)) {
            Response::error('Valid advance date required (YYYY-MM-DD)', 422);
        }

        $payrollMonth = trim((string)$request->input('payrollMonth', substr($advanceDate, 0, 7)));
        if (!preg_match('/^\d{4}-\d{2}$/', $payrollMonth)) {
            Response::error('Valid payroll month required (YYYY-MM)', 422);
        }

        $amount = round(max(0, (float)$request->input('amount', 0)), 2);
        if ($amount <= 0) {
            Response::error('Advance amount must be greater than zero', 422);
        }

        $notes = trim((string)$request->input('notes', ''));

        return [
            'employeeKey' => $employeeKey,
            'advanceDate' => $advanceDate,
            'payrollMonth' => $payrollMonth,
            'amount' => $amount,
            'notes' => $notes === '' ? null : $notes,
        ];
    }
}
