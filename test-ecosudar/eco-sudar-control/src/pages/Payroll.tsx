import { useCallback, useEffect, useMemo, useState } from "react";
import { Calculator, FileDown, Receipt, Wallet, TrendingUp, Users, ShieldCheck, ShieldAlert, AlertTriangle, CheckCircle2, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { StatCard } from "@/components/StatCard";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { payrollApi, workingDaysInMonth, type Payslip, type PayrollAiCheck } from "@/lib/api/hr";
import { exportToPdf, exportToExcel, type ExportColumn } from "@/lib/exporters";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { ExportMenu, type ExportColumnDef } from "@/components/ExportMenu";

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;
const roundMoney = (n: number) => Math.round(n * 100) / 100;
const roundDay = (n: number) => Math.round(n * 10) / 10;

const currentMonth = () => new Date().toISOString().slice(0, 7);

const SESSION_KEY = "payroll_state";
function loadSaved(): { month: string; workingDays: number } {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    // Ignore parse/storage errors and fall back to defaults.
  }
  const m = currentMonth();
  return { month: m, workingDays: workingDaysInMonth(m) };
}
function persist(month: string, workingDays: number) {
  sessionStorage.setItem(SESSION_KEY, JSON.stringify({ month, workingDays }));
}

const cleanDecimalInput = (rawValue: string) => rawValue.replace(/[^\d.]/g, "").replace(/^0+(?=\d)/, "");

const recalculateSlip = (slip: Payslip, updates: Partial<Pick<Payslip, "overtimeHours" | "leaveCredit">>) => {
  const nextOvertimeHours = roundDay(Math.max(0, Number(updates.overtimeHours ?? slip.overtimeHours ?? 0)));
  const requestedCredits = Number(updates.leaveCredit ?? slip.leaveCredit ?? 0);
  const availableBeforeLeave = roundDay(Math.max(0, Number.isFinite(requestedCredits) ? requestedCredits : 0));
  const paidLeave = roundDay(Math.min(Math.max(0, Number(slip.leaves ?? 0)), availableBeforeLeave));
  const availableLeaveCredit = roundDay(Math.max(0, availableBeforeLeave - paidLeave));
  const unpaidLeave = roundDay(Math.max(0, Number(slip.leaves ?? 0) - paidLeave));
  const payableDays = roundDay(Number(slip.presentDays ?? 0) + paidLeave);
  const overtimeSalary = roundMoney(nextOvertimeHours * slip.overtimeRate);
  const earnedSalary = roundMoney(payableDays * slip.salaryPerDay);
  const leaveSalary = roundMoney(unpaidLeave * slip.salaryPerDay);
  const totalSalary = roundMoney(earnedSalary + slip.attendBonus + overtimeSalary);
  const netPay = Math.max(0, roundMoney(totalSalary - slip.deductions));

  return {
    ...slip,
    overtimeHours: nextOvertimeHours,
    leaveCredit: availableLeaveCredit,
    leaveAvailedThisMonth: paidLeave,
    leaveSalary,
    earnedSalary,
    overtimeSalary,
    totalSalary,
    netPay,
  };
};

export default function Payroll() {
  const [month, setMonth]             = useState(() => loadSaved().month);
  const [workingDays, setWorkingDays] = useState(() => loadSaved().workingDays);
  const [slips, setSlips]             = useState<Payslip[]>([]);
  const [loading, setLoading]         = useState(false);
  const [view, setView]               = useState<Payslip | null>(null);
  const [aiCheck, setAiCheck]         = useState<PayrollAiCheck | null>(null);
  const [aiBusy, setAiBusy]           = useState(false);

  const paged = usePagedRows(slips);

  const PAYROLL_EXPORT_COLUMNS: ExportColumnDef<Payslip>[] = [
    { header: "Employee",    key: "employeeName" },
    { header: "Emp ID",      key: "employeeId" },
    { header: "Designation", key: "designation" },
    { header: "Present Days",key: "presentDays" },
    { header: "Leaves",      key: "leaves" },
    { header: "Earned",      key: "earnedSalary" },
    { header: "Deductions",  key: "deductions" },
    { header: "Net Pay",     key: "netPay" },
  ];

  const runAiCheck = async () => {
    if (!slips.length) return toast.error("Generate payroll for this month first");
    setAiBusy(true);
    try {
      const res = await payrollApi.aiCheck(month);
      setAiCheck(res);
      if (res.flagged === 0) toast.success("AI check passed — nothing unusual");
      else toast.warning(`${res.flagged} row${res.flagged === 1 ? "" : "s"} flagged for review`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "AI check failed");
    } finally { setAiBusy(false); }
  };

  const handleMonthChange = (m: string) => {
    const wd = workingDaysInMonth(m);
    setMonth(m);
    setWorkingDays(wd);
    setAiCheck(null);
    persist(m, wd);
  };

  const load = useCallback(async (m = month, wd = workingDays) => {
    setLoading(true);
    try {
      const existing = await payrollApi.get(m);
      if (existing.length > 0) {
        setSlips(existing.map((slip) => ({
          ...slip,
          leaveCredit: slip.leaveCredit ?? Math.max(0, Math.floor(Number(slip.presentDays ?? 0) / 20) - Number(slip.leaveAvailedThisMonth ?? 0)),
        })));
        return;
      }
      const overtimeHours = Object.fromEntries(
        existing.map((slip) => [slip.employeeId, Math.max(0, Number(slip.overtimeHours ?? 0))])
      );
      const leaveCredits = Object.fromEntries(
        existing.map((slip) => [slip.employeeId, Math.max(0, Number(slip.leaveCredit ?? 0))])
      );
      const computed = await payrollApi.run(m, wd, overtimeHours, leaveCredits);
      setSlips(computed);
    } catch (e: unknown) {
      console.error("[Payroll] load error:", e);
      toast.error(e instanceof Error ? e.message : "Failed to load payroll");
    }
    finally { setLoading(false); }
  }, [month, workingDays]);

  const rerun = async () => {
    const overtimeHours = Object.fromEntries(
      slips.map((slip) => [slip.employeeId, Math.max(0, Number(slip.overtimeHours ?? 0))])
    );
    const leaveCredits = Object.fromEntries(
      slips.map((slip) => [slip.employeeId, Math.max(0, Number(slip.leaveCredit ?? 0) + Number(slip.leaveAvailedThisMonth ?? 0))])
    );
    setLoading(true);
    try {
      setSlips(await payrollApi.run(month, workingDays, overtimeHours, leaveCredits));
      toast.success("Payroll saved with manual overtime and leave credits");
    }
    catch (e: unknown) { toast.error(e instanceof Error ? e.message : "Failed to re-run payroll"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(month, workingDays); }, [load, month, workingDays]);

  const stats = useMemo(() => {
    const total = slips.reduce((s, p) => s + p.netPay, 0);
    const gross = slips.reduce((s, p) => s + p.totalSalary, 0);
    const ded   = slips.reduce((s, p) => s + p.deductions, 0);
    return { total, gross, ded, count: slips.length, workingDays };
  }, [slips, workingDays]);

  const columns: ExportColumn<Payslip>[] = [
    { header: "Emp ID", key: "employeeId" },
    { header: "Name", key: "employeeName" },
    { header: "Designation", key: "designation" },
    { header: "No.Of Working Days", key: "workingDays" },
    { header: "Present Days", key: "presentDays" },
    { header: "Salary Per Day", key: (r) => r.salaryPerDay.toLocaleString("en-IN") },
    { header: "Earned Salary", key: (r) => r.earnedSalary.toLocaleString("en-IN") },
    { header: "Leave Taken", key: "leaves" },
    { header: "Available Leave Credits", key: (r) => (r.leaveCredit ?? 0).toLocaleString("en-IN") },
    { header: "Leave Deduct", key: (r) => r.leaveSalary.toLocaleString("en-IN") },
    { header: "Manual Overtime Hrs", key: (r) => r.overtimeHours.toLocaleString("en-IN") },
    { header: "Overtime Rate", key: (r) => r.overtimeRate.toLocaleString("en-IN") },
    { header: "Overtime Salary", key: (r) => r.overtimeSalary.toLocaleString("en-IN") },
    { header: "Attend Bonus", key: (r) => r.attendBonus.toLocaleString("en-IN") },
    { header: "Total Salary", key: (r) => r.totalSalary.toLocaleString("en-IN") },
    { header: "Advance Deduct", key: (r) => r.deductedAdvance.toLocaleString("en-IN") },
    { header: "Deductions", key: (r) => r.deductions.toLocaleString("en-IN") },
    { header: "Net Salary", key: (r) => r.netPay.toLocaleString("en-IN") },
  ];

  const exportPdf = () => {
    if (!slips.length) return;
    exportToPdf({
      title: `Payroll Register — ${month}`,
      subtitle: `${slips.length} employees · Working days: ${workingDays} · Total net payout: ${inr(stats.total)}`,
      columns, rows: slips, filename: `payroll-${month}`,
    });
  };
  const exportXlsx = () => {
    if (!slips.length) return;
    exportToExcel({ sheetName: `Payroll ${month}`, columns, rows: slips, filename: `payroll-${month}` });
  };

  const updateOvertimeHours = (employeeId: string, rawValue: string) => {
    const cleaned = cleanDecimalInput(rawValue);
    const parsed = cleaned === "" ? 0 : Number(cleaned);
    const hours = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;

    setSlips((prev) => prev.map((slip) => {
      if (slip.employeeId !== employeeId) return slip;
      return recalculateSlip(slip, { overtimeHours: hours });
    }));
  };

  const updateLeaveCredit = (employeeId: string, rawValue: string) => {
    const cleaned = cleanDecimalInput(rawValue);
    const parsed = cleaned === "" ? 0 : Number(cleaned);
    const leaveCredit = Number.isFinite(parsed) ? Math.max(0, parsed) : 0;

    setSlips((prev) => prev.map((slip) => {
      if (slip.employeeId !== employeeId) return slip;
      return recalculateSlip(slip, { leaveCredit });
    }));
  };

  const downloadPayslip = (p: Payslip) => {
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const tableY = () => ((doc as jsPDF & { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 95);
    doc.setFontSize(18);
    doc.text("ECO SUDAR Bio Energy LLP", 40, 50);
    doc.setFontSize(11);
    doc.setTextColor(100);
    doc.text(`Payslip for ${p.month}`, 40, 70);
    doc.setTextColor(20);

    autoTable(doc, {
      startY: 95,
      theme: "plain",
      body: [
        ["Employee", `${p.employeeName} (${p.employeeId})`],
        ["Designation", p.designation],
        ["DOJ", p.doj || "-"],
        ["Working Days", String(p.workingDays)],
        ["Present Days", String(p.presentDays)],
        ["Leave Taken", String(p.leaves)],
        ["Available Leave Credits", String(p.leaveCredit ?? 0)],
        ["Leave Deduction", p.leaveSalary.toLocaleString("en-IN")],
        ["Salary/Day", p.salaryPerDay.toLocaleString("en-IN")],
        ["Overtime Hrs", p.overtimeHours.toLocaleString("en-IN")],
        ["Overtime Rate", p.overtimeRate.toLocaleString("en-IN")],
      ],
      styles: { fontSize: 10, cellPadding: 4 },
      columnStyles: { 0: { fontStyle: "bold", cellWidth: 130 } },
    });

    autoTable(doc, {
      startY: tableY() + 14,
      head: [["Earnings", "Amount (₹)"]],
      body: [
        ["Earned Salary", p.earnedSalary.toLocaleString("en-IN")],
        ["HRA", p.hra.toLocaleString("en-IN")],
        ["Allowances", p.allowances.toLocaleString("en-IN")],
        ["Overtime Salary", p.overtimeSalary.toLocaleString("en-IN")],
        ["Attend Bonus", p.attendBonus.toLocaleString("en-IN")],
        ["Total Salary", p.totalSalary.toLocaleString("en-IN")],
      ],
      headStyles: { fillColor: [38, 132, 89] },
      styles: { fontSize: 10 },
    });

    autoTable(doc, {
      startY: tableY() + 10,
      head: [["Deductions", "Amount (₹)"]],
      body: [
        ["Provident Fund", p.pf.toLocaleString("en-IN")],
        ["Advance Deduction", p.deductedAdvance.toLocaleString("en-IN")],
        ["Total Deductions", p.deductions.toLocaleString("en-IN")],
      ],
      headStyles: { fillColor: [180, 70, 70] },
      styles: { fontSize: 10 },
    });

    autoTable(doc, {
      startY: tableY() + 14,
      theme: "grid",
      body: [["NET PAY", `₹ ${p.netPay.toLocaleString("en-IN")}`]],
      styles: { fontSize: 13, fontStyle: "bold", halign: "right" },
      columnStyles: { 0: { halign: "left", fillColor: [240, 245, 240] } },
    });

    doc.setFontSize(8);
    doc.setTextColor(140);
    doc.text("This is a system-generated payslip and does not require a signature.", 40, doc.internal.pageSize.height - 30);
    doc.save(`payslip-${p.employeeId}-${p.month}.pdf`);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Payroll</h1>
          <p className="text-muted-foreground">Computed from attendance with manual overtime hours. Generate payslips and registers.</p>
        </div>
        <div className="flex gap-2 items-end flex-wrap">
            <div>
              <Label className="text-xs">Month</Label>
              <Input type="month" value={month} onChange={(e) => handleMonthChange(e.target.value)} />
            </div>
            <div>
              <Label className="text-xs">Working Days</Label>
              <Input
                id="payroll-working-days"
                type="number"
                min={1}
                max={31}
                className="w-20 text-center appearance-none"
                value={workingDays.toString()}
                onChange={(e) => {
                  const raw = e.target.value.replace(/^0+(?=\d)/, '');
                  const wd = Math.max(1, Math.min(31, parseInt(raw) || 1));
                  setWorkingDays(wd);
                  persist(month, wd);
                }}
              />
            </div>
            <Button variant="outline" onClick={rerun}><Calculator className="h-4 w-4" /> Save / Re-run</Button>
            <Button variant="outline" onClick={runAiCheck} disabled={aiBusy || !slips.length}>
              {aiBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldCheck className="h-4 w-4" />} AI Pre-run Check
            </Button>
            <ExportMenu title="Payroll" columns={PAYROLL_EXPORT_COLUMNS} rows={slips} filename={`payroll-${month}`} />
            <Button onClick={exportPdf}><FileDown className="h-4 w-4" /> Register PDF</Button>
          </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Employees" value={String(stats.count)} subtitle="processed" icon={Users} />
        <StatCard title="Working Days" value={String(stats.workingDays)} subtitle={month} icon={Calculator} />
        <StatCard title="Gross Payable" value={inr(stats.gross)} subtitle="total salary before deductions" icon={Wallet} />
        <StatCard title="Net Payout" value={inr(stats.total)} subtitle={`Deductions ${inr(stats.ded)}`} icon={TrendingUp} />
      </div>

      {aiCheck && (
        <div className="rounded-xl border bg-card shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <div className="flex items-center gap-2 font-semibold text-card-foreground">
              {aiCheck.flagged === 0
                ? <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                : <ShieldAlert className="h-4 w-4 text-amber-600" />}
              AI Pre-run Check
              <span className="text-xs font-normal text-muted-foreground">
                {aiCheck.checked} rows · {aiCheck.flagged} flagged{aiCheck.high ? ` · ${aiCheck.high} high` : ""}
              </span>
            </div>
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setAiCheck(null)}><X className="h-4 w-4" /></Button>
          </div>
          <div className="p-4 space-y-3">
            {aiCheck.overall && <p className="text-sm text-muted-foreground">{aiCheck.overall}</p>}
            {aiCheck.flagged === 0 ? (
              <div className="flex items-center gap-2 text-sm text-emerald-600">
                <CheckCircle2 className="h-4 w-4" /> No anomalies — payroll looks consistent with history. Safe to process.
              </div>
            ) : (
              <div className="space-y-2">
                {aiCheck.flags.map((f, i) => {
                  const tone = f.severity === "high" ? "border-red-300 bg-red-50" : f.severity === "medium" ? "border-amber-300 bg-amber-50" : "border-slate-200 bg-slate-50";
                  const chip = f.severity === "high" ? "bg-red-100 text-red-700" : f.severity === "medium" ? "bg-amber-100 text-amber-700" : "bg-slate-100 text-slate-600";
                  return (
                    <div key={i} className={cn("flex gap-3 rounded-lg border p-3", tone)}>
                      <AlertTriangle className={cn("mt-0.5 h-4 w-4 shrink-0", f.severity === "high" ? "text-red-600" : f.severity === "medium" ? "text-amber-600" : "text-slate-500")} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-sm">{f.employee_name || f.employee_key}</span>
                          <span className="font-mono text-xs text-muted-foreground">{f.employee_key}</span>
                          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase", chip)}>{f.severity}</span>
                          {f.issue && <span className="text-xs font-medium text-foreground">{f.issue}</span>}
                        </div>
                        {f.detail && <p className="mt-0.5 text-sm text-muted-foreground">{f.detail}</p>}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">AI-generated from payroll figures vs each employee's history · {aiCheck.generated_at} · review before processing.</p>
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Employee</th>
                <th className="text-left px-4 py-3 font-medium">Designation</th>
                <th className="text-right px-4 py-3 font-medium">Days</th>
                <th className="text-right px-4 py-3 font-medium">Salary/Day</th>
                <th className="text-right px-4 py-3 font-medium">Earned Salary</th>
                <th className="text-right px-4 py-3 font-medium">Leave Taken</th>
                <th className="text-right px-4 py-3 font-medium">Available Leave Credits</th>
                <th className="text-right px-4 py-3 font-medium">Leave Deduct</th>
                <th className="text-right px-4 py-3 font-medium">Manual OT Hrs</th>
                <th className="text-right px-4 py-3 font-medium">OT Salary</th>
                <th className="text-right px-4 py-3 font-medium">Attend Bonus</th>
                <th className="text-right px-4 py-3 font-medium">Total Salary</th>
                <th className="text-right px-4 py-3 font-medium">Advance Deduct</th>
                <th className="text-right px-4 py-3 font-medium">Deductions</th>
                <th className="text-right px-4 py-3 font-medium">Net Salary</th>
                <th className="text-right px-4 py-3 font-medium">Payslip</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={17} />}
              {!loading && slips.length === 0 && <tr><td colSpan={17} className="text-center py-10 text-muted-foreground">No payroll data. Click Re-run to compute.</td></tr>}
              {!loading && paged.rows.map((p) => (
                <tr key={p.employeeId} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3">{p.employeeName}<div className="text-xs text-muted-foreground">{p.employeeId}</div></td>
                  <td className="px-4 py-3 text-muted-foreground">{p.designation}</td>
                  <td className="px-4 py-3 text-right">{p.presentDays} / {p.workingDays}</td>
                  <td className="px-4 py-3 text-right">{inr(p.salaryPerDay)}</td>
                  <td className="px-4 py-3 text-right">{inr(p.earnedSalary)}</td>
                  <td className="px-4 py-3 text-right">{p.leaves}</td>
                  <td className="px-4 py-3 text-right">
                    <Input
                      type="text"
                      inputMode="decimal"
                      className="h-8 w-20 ml-auto text-right"
                      value={String(p.leaveCredit ?? 0)}
                      onChange={(e) => updateLeaveCredit(p.employeeId, e.target.value)}
                    />
                  </td>
                  <td className="px-4 py-3 text-right text-destructive">{p.leaveSalary > 0 ? `−${inr(p.leaveSalary)}` : inr(0)}</td>
                  <td className="px-4 py-3 text-right">
                    <Input
                      type="text"
                      inputMode="decimal"
                      className="h-8 w-24 ml-auto text-right"
                      value={String(p.overtimeHours ?? 0)}
                      onChange={(e) => updateOvertimeHours(p.employeeId, e.target.value)}
                    />
                  </td>
                  <td className="px-4 py-3 text-right">{inr(p.overtimeSalary)}</td>
                  <td className="px-4 py-3 text-right">{inr(p.attendBonus)}</td>
                  <td className="px-4 py-3 text-right">{inr(p.totalSalary)}</td>
                  <td className="px-4 py-3 text-right text-destructive">{p.deductedAdvance > 0 ? `−${inr(p.deductedAdvance)}` : inr(0)}</td>
                  <td className="px-4 py-3 text-right text-destructive">−{inr(p.deductions)}</td>
                  <td className="px-4 py-3 text-right font-bold text-primary">{inr(p.netPay)}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => setView(p)}><Receipt className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => downloadPayslip(p)}><FileDown className="h-4 w-4" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
      </div>
      {!loading && slips.length > 0 && (
        <Pagination {...paged} onPage={paged.setPage} noun="employees" />
      )}

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        <DialogScrollContent className="max-w-md">
          {view && (
            <>
              <DialogHeader>
                <DialogTitle>Payslip — {view.month}</DialogTitle>
                <DialogDescription>{view.employeeName} ({view.employeeId})</DialogDescription>
              </DialogHeader>
              <div className="space-y-3 text-sm">
                <div className="grid grid-cols-2 gap-2">
                  <div className="text-muted-foreground">Designation</div><div>{view.designation}</div>
                  <div className="text-muted-foreground">DOJ</div><div>{view.doj || "-"}</div>
                  <div className="text-muted-foreground">Working Days</div><div>{view.workingDays}</div>
                  <div className="text-muted-foreground">Present</div><div>{view.presentDays}</div>
                  <div className="text-muted-foreground">Leave Taken</div><div>{view.leaves}</div>
                  <div className="text-muted-foreground">Available Leave Credits</div><div>{view.leaveCredit ?? 0}</div>
                  <div className="text-muted-foreground">Leave Deduction</div><div>{inr(view.leaveSalary)}</div>
                  <div className="text-muted-foreground">Salary/Day</div><div>{inr(view.salaryPerDay)}</div>
                  <div className="text-muted-foreground">Overtime Hrs</div><div>{view.overtimeHours}</div>
                  <div className="text-muted-foreground">Overtime Rate</div><div>{inr(view.overtimeRate)}</div>
                </div>
                <div className="border-t pt-3 space-y-1">
                  <div className="flex justify-between"><span>Earned Salary</span><span>{inr(view.earnedSalary)}</span></div>
                  <div className="flex justify-between"><span>HRA</span><span>{inr(view.hra)}</span></div>
                  <div className="flex justify-between"><span>Allowances</span><span>{inr(view.allowances)}</span></div>
                  <div className="flex justify-between"><span>Overtime Salary</span><span>{inr(view.overtimeSalary)}</span></div>
                  <div className="flex justify-between"><span>Attend Bonus</span><span>{inr(view.attendBonus)}</span></div>
                  <div className="flex justify-between font-medium"><span>Total Salary</span><span>{inr(view.totalSalary)}</span></div>
                </div>
                <div className="border-t pt-3 space-y-1 text-destructive">
                  <div className="flex justify-between"><span>PF</span><span>−{inr(view.pf)}</span></div>
                  <div className="flex justify-between"><span>Advance Deduction</span><span>−{inr(view.deductedAdvance)}</span></div>
                  <div className="flex justify-between font-medium"><span>Total Deductions</span><span>−{inr(view.deductions)}</span></div>
                </div>
                <div className="flex justify-between font-bold border-t pt-3 text-base">
                  <span>Net Pay</span><span className="text-primary">{inr(view.netPay)}</span>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setView(null)}>Close</Button>
                <Button onClick={() => downloadPayslip(view)}><FileDown className="h-4 w-4" /> Download PDF</Button>
              </DialogFooter>
            </>
          )}
        </DialogScrollContent>
      </Dialog>
    </div>
  );
}
