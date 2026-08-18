import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeIndianRupee, Pencil, Plus, Trash2, WalletCards } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/StatCard";
import { toast } from "sonner";
import {
  employeeAdvancesApi,
  employeesApi,
  type Employee,
  type EmployeeAdvance,
  type EmployeeAdvancePayload,
} from "@/lib/api/hr";
import { exportToExcel, type ExportColumn } from "@/lib/exporters";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { ExportMenu, type ExportColumnDef } from "@/components/ExportMenu";

const ADVANCE_EXPORT_COLUMNS: ExportColumnDef<EmployeeAdvance>[] = [
  { header: "Date",          key: "advanceDate" },
  { header: "Payroll Month", key: "payrollMonth" },
  { header: "Emp ID",        key: "employeeId" },
  { header: "Name",          key: "employeeName" },
  { header: "Designation",   key: "designation" },
  { header: "Amount",        key: "amount" },
  { header: "Notes",         key: "notes", group: "detail", defaultChecked: false },
];

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

const emptyForm = (employeeId = ""): EmployeeAdvancePayload => ({
  employeeId,
  advanceDate: today(),
  payrollMonth: currentMonth(),
  amount: 0,
  notes: "",
});

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong";

export default function AdvanceRegister() {
  const [month, setMonth] = useState(currentMonth());
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [rows, setRows] = useState<EmployeeAdvance[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<EmployeeAdvance | null>(null);
  const navigate = useNavigate();

  const load = useCallback(async (selectedMonth = month) => {
    setLoading(true);
    try {
      const [employeeRows, advanceRows] = await Promise.all([
        employeesApi.list(),
        employeeAdvancesApi.list({ month: selectedMonth }),
      ]);
      setEmployees(employeeRows);
      setRows(advanceRows);
    } catch (error) {
      toast.error(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { void load(month); }, [load, month]);

  const stats = useMemo(() => {
    const total = rows.reduce((sum, row) => sum + row.amount, 0);
    const employeesWithAdvance = new Set(rows.map((row) => row.employeeId)).size;
    return { total, count: rows.length, employeesWithAdvance };
  }, [rows]);

  const paged = usePagedRows(rows);

  const remove = (advance: EmployeeAdvance) => {
    setDeleteTarget(advance);
  };

  const columns: ExportColumn<EmployeeAdvance>[] = [
    { header: "Date", key: "advanceDate" },
    { header: "Payroll Month", key: "payrollMonth" },
    { header: "Emp ID", key: "employeeId" },
    { header: "Name", key: "employeeName" },
    { header: "Designation", key: "designation" },
    { header: "Amount", key: (row) => row.amount.toLocaleString("en-IN") },
    { header: "Notes", key: "notes" },
  ];

  const exportRows = () => {
    if (!rows.length) return;
    exportToExcel({ sheetName: `Advances ${month}`, columns, rows, filename: `advance-register-${month}` });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Advance Register</h1>
          <p className="text-muted-foreground">Record employee advances and deduct them from the selected payroll month.</p>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
          <div>
            <Label className="text-xs">Payroll Month</Label>
            <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </div>
          <ExportMenu title="Advance Register" columns={ADVANCE_EXPORT_COLUMNS} rows={rows} dateField="advanceDate" filename={`advance-register-${month}`} />
          <Button onClick={() => navigate("/advance-register/new")}>
            <Plus className="h-4 w-4" /> Add Advance
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Advance Entries" value={String(stats.count)} subtitle={month} icon={WalletCards} />
        <StatCard title="Employees" value={String(stats.employeesWithAdvance)} subtitle="with advance" icon={BadgeIndianRupee} />
        <StatCard title="Total Advance" value={inr(stats.total)} subtitle="deducted in payroll" icon={BadgeIndianRupee} />
      </div>

      <div className="rounded-lg border bg-card overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Employee</th>
                <th className="text-left px-4 py-3 font-medium">Designation</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
                <th className="text-left px-4 py-3 font-medium">Notes</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">Loading...</td></tr>}
              {!loading && rows.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No advance entries for this month.</td></tr>}
              {!loading && paged.rows.map((advance) => (
                <tr key={advance.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3">{advance.advanceDate}</td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{advance.employeeName}</div>
                    <div className="text-xs text-muted-foreground">{advance.employeeId}</div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{advance.designation || "-"}</td>
                  <td className="px-4 py-3 text-right font-semibold">{inr(advance.amount)}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-sm truncate">{advance.notes || "-"}</td>
                  <td className="px-4 py-3 text-right">
                    <Button size="icon" variant="ghost" onClick={() => navigate(`/advance-register/${advance.id}/edit`, { state: { advance } })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="text-destructive" onClick={() => void remove(advance)}><Trash2 className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
      </div>
      {!loading && rows.length > 0 && (
        <Pagination {...paged} onPage={paged.setPage} noun="entries" />
      )}

      <ConfirmDeleteDialog
        open={deleteTarget !== null}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        onConfirm={async () => {
          if (!deleteTarget) return;
          try {
            await employeeAdvancesApi.remove(deleteTarget.id);
            toast.success("Advance deleted");
            setDeleteTarget(null);
            await load(month);
          } catch (error) {
            toast.error(errorMessage(error));
          }
        }}
        description={deleteTarget ? `Delete advance for ${deleteTarget.employeeName}? This cannot be undone.` : undefined}
      />
    </div>
  );
}
