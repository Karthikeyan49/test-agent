<?php
declare(strict_types=1);

class EmployeeAdvance
{
    public static function all(array $filters = []): array
    {
        $where = ['1=1'];
        $params = [];

        if (!empty($filters['month'])) {
            $where[] = 'a.payroll_month = ?';
            $params[] = $filters['month'];
        }
        if (!empty($filters['employeeKey'])) {
            $where[] = 'a.employee_key = ?';
            $params[] = $filters['employeeKey'];
        }

        return Database::fetchAll(
            'SELECT a.*, e.name AS employee_name, e.designation
               FROM employee_advances a
               JOIN employees e ON a.employee_key = e.employee_key
              WHERE ' . implode(' AND ', $where) . '
              ORDER BY a.advance_date DESC, a.advance_id DESC',
            $params
        );
    }

    public static function find(int $id): ?array
    {
        return Database::fetch(
            'SELECT a.*, e.name AS employee_name, e.designation
               FROM employee_advances a
               JOIN employees e ON a.employee_key = e.employee_key
              WHERE a.advance_id = ? LIMIT 1',
            [$id]
        );
    }

    public static function create(array $data): int
    {
        return Database::insert(
            'INSERT INTO employee_advances
               (employee_key, advance_date, payroll_month, amount, notes, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, NOW(), NOW())',
            [
                $data['employeeKey'],
                $data['advanceDate'],
                $data['payrollMonth'],
                $data['amount'],
                $data['notes'],
            ]
        );
    }

    public static function update(int $id, array $data): void
    {
        Database::execute(
            'UPDATE employee_advances
                SET employee_key = ?, advance_date = ?, payroll_month = ?, amount = ?, notes = ?, updated_at = NOW()
              WHERE advance_id = ?',
            [
                $data['employeeKey'],
                $data['advanceDate'],
                $data['payrollMonth'],
                $data['amount'],
                $data['notes'],
                $id,
            ]
        );
    }

    public static function delete(int $id): void
    {
        Database::execute('DELETE FROM employee_advances WHERE advance_id = ?', [$id]);
    }

    public static function totalsForMonth(string $month): array
    {
        $rows = Database::fetchAll(
            'SELECT employee_key, SUM(amount) AS total_advance
               FROM employee_advances
              WHERE payroll_month = ?
              GROUP BY employee_key',
            [$month]
        );

        $totals = [];
        foreach ($rows as $row) {
            $totals[(string)$row['employee_key']] = round(max(0, (float)$row['total_advance']), 2);
        }
        return $totals;
    }

    public static function format(array $row): array
    {
        return [
            'id'           => (int)$row['advance_id'],
            'employeeId'   => $row['employee_key'],
            'employeeName' => $row['employee_name'] ?? '',
            'designation'  => $row['designation'] ?? '',
            'advanceDate'  => $row['advance_date'],
            'payrollMonth' => $row['payroll_month'],
            'amount'       => (float)$row['amount'],
            'notes'        => $row['notes'] ?? '',
            'createdAt'    => isset($row['created_at']) && $row['created_at'] ? date('c', strtotime($row['created_at'])) : null,
            'updatedAt'    => isset($row['updated_at']) && $row['updated_at'] ? date('c', strtotime($row['updated_at'])) : null,
        ];
    }
}
