<?php
declare(strict_types=1);

class Payroll
{
    public static function forMonth(string $month): array
    {
        return Database::fetchAll(
            'SELECT p.*, e.name AS employee_name, e.designation, e.joined_at
             FROM payroll p
             JOIN employees e ON p.employee_key = e.employee_key
             WHERE p.month = ?
             ORDER BY p.employee_key ASC',
            [$month]
        );
    }

    /** Insert or re-compute (safe to run multiple times for same month) */
    public static function upsert(array $data): void
    {
        Database::execute(
            'INSERT INTO payroll
               (employee_key, month, working_days, present_days, salary_per_day,
                leaves, leave_availed_this_month, leave_salary, travel_allow,
                total_salary, salary_advance_paid, deducted_advance,
                base_salary, site_allowance, da, food_allowance, gross_salary,
                earned_salary, attend_bonus,
                overtime_rate, overtime_hrs, overtime_salary,
                hra, allowances, pf, professional_tax, deductions, net_pay, generated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
             ON DUPLICATE KEY UPDATE
               working_days=VALUES(working_days),   present_days=VALUES(present_days),
               salary_per_day=VALUES(salary_per_day),
               leaves=VALUES(leaves),
               leave_availed_this_month=VALUES(leave_availed_this_month),
               leave_salary=VALUES(leave_salary),   travel_allow=VALUES(travel_allow),
               salary_advance_paid=VALUES(salary_advance_paid),
               deducted_advance=VALUES(deducted_advance),
               base_salary=VALUES(base_salary),     site_allowance=VALUES(site_allowance),
               da=VALUES(da),                       food_allowance=VALUES(food_allowance),
               gross_salary=VALUES(gross_salary),
               earned_salary=VALUES(earned_salary), attend_bonus=VALUES(attend_bonus),
               total_salary=VALUES(total_salary),
               overtime_rate=VALUES(overtime_rate), overtime_hrs=VALUES(overtime_hrs),
               overtime_salary=VALUES(overtime_salary),
               hra=VALUES(hra),                     allowances=VALUES(allowances),
               pf=VALUES(pf),                       professional_tax=VALUES(professional_tax),
               deductions=VALUES(deductions),       net_pay=VALUES(net_pay),
               generated_at=NOW()',
            [
                $data['employeeKey'],   $data['month'],      $data['workingDays'],
                $data['presentDays'],   $data['salaryPerDay'],
                $data['leaves'],        $data['leaveAvailedThisMonth'],
                $data['leaveSalary'],   $data['travelAllow'],
                $data['totalSalary'],   $data['salaryAdvancePaid'],
                $data['deductedAdvance'],
                $data['baseSalary'],    $data['siteAllowance'],
                $data['da'],            $data['foodAllowance'],
                $data['grossSalary'],   $data['earnedSalary'],
                $data['attendBonus'],
                $data['overtimeRate'],  $data['overtimeHours'],
                $data['overtimeSalary'],
                $data['hra'],           $data['allowances'],
                $data['pf'],            $data['professionalTax'],
                $data['deductions'],    $data['netPay'],
            ]
        );
    }

    public static function format(array $row): array
    {
        return [
            'employeeId'      => $row['employee_key'],
            'employeeName'    => $row['employee_name'],
            'designation'     => $row['designation'],
            'doj'             => $row['joined_at'] ?? '',
            'month'           => $row['month'],
            'workingDays'     => (int)$row['working_days'],
            'presentDays'     => (float)$row['present_days'],
            'leaves'          => (int)$row['leaves'],
            'leaveAvailedThisMonth' => (int)($row['leave_availed_this_month'] ?? $row['leaves'] ?? 0),
            'leaveSalary'     => (float)($row['leave_salary'] ?? 0),
            'travelAllow'     => (float)($row['travel_allow'] ?? 0),
            'salaryAdvancePaid' => (float)($row['salary_advance_paid'] ?? 0),
            'deductedAdvance' => (float)($row['deducted_advance'] ?? 0),
            'baseSalary'      => (float)$row['base_salary'],
            'siteAllowance'   => (float)($row['site_allowance'] ?? 0),
            'da'              => (float)($row['da'] ?? 0),
            'foodAllowance'   => (float)($row['food_allowance'] ?? 0),
            'grossSalary'     => (float)($row['gross_salary'] ?? $row['base_salary'] ?? 0),
            'salaryPerDay'    => (float)($row['salary_per_day'] ?? 0),
            'earnedSalary'    => (float)$row['earned_salary'],
            'attendBonus'     => (float)($row['attend_bonus'] ?? 0),
            'overtimeRate'    => (float)($row['overtime_rate'] ?? 0),
            'overtimeHours'   => (float)($row['overtime_hrs'] ?? $row['overtime_hours'] ?? 0),
            'overtimeSalary'  => (float)($row['overtime_salary'] ?? 0),
            'totalSalary'     => (float)($row['total_salary'] ?? 0),
            'hra'             => (float)$row['hra'],
            'allowances'      => (float)$row['allowances'],
            'pf'              => (float)$row['pf'],
            'professionalTax' => (float)$row['professional_tax'],
            'deductions'      => (float)$row['deductions'],
            'netPay'          => (float)$row['net_pay'],
            'status'          => $row['status'] ?? 'Draft',
            'processedAt'     => isset($row['processed_at']) && $row['processed_at'] ? date('c', strtotime($row['processed_at'])) : null,
            'paidAt'          => isset($row['paid_at'])      && $row['paid_at']      ? date('c', strtotime($row['paid_at']))      : null,
        ];
    }
}
