import { useEffect, useMemo, useState } from "react";
import {
  Camera, ScanLine, CheckCircle2, Clock, Calendar, Users,
  FileDown, FileUp, Plus, Pencil, Trash2, BarChart2, TrendingUp,
  Loader2, SlidersHorizontal, X, ListChecks,
} from "lucide-react";
import { HrImportWizard } from "@/components/HrImportWizard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogScrollContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { StatCard } from "@/components/StatCard";
import { QrScanner } from "@/components/QrScanner";
import { FaceAttendanceScanner } from "@/components/FaceAttendanceScanner";
import { toast } from "sonner";
import { Req } from "@/components/Req";
import {
  attendanceApi, employeesApi,
  type AttendanceEntry, type AttendanceScanResponse,
  type AttendanceShift, type Employee,
} from "@/lib/api/hr";
import { exportToExcel } from "@/lib/exporters";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { TableSkeleton } from "@/components/TableSkeleton";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { Pagination, usePagedRows } from "@/components/Pagination";
import {
  LineChart, Line, BarChart, Bar, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";

// ── Helpers ──────────────────────────────────────────────────────────────────

const todayStr = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

const fmtTime = (iso?: string): string => {
  if (!iso) return "—";
  const match = iso.match(/[T ](\d{2}):(\d{2})/);
  if (!match) return "—";
  let h = parseInt(match[1], 10);
  const m = match[2];
  const period = h >= 12 ? "PM" : "AM";
  h = h % 12 || 12;
  return `${String(h).padStart(2, "0")}:${m} ${period}`;
};

const isoToTime = (iso?: string): string => {
  if (!iso) return "";
  const match = iso.match(/[T ](\d{2}:\d{2})/);
  return match ? match[1] : "";
};

function parseTo12h(val: string) {
  if (!val) return { h12: "", minute: "", period: "AM" as "AM" | "PM" };
  const [hStr, mStr] = val.split(":");
  const h24 = parseInt(hStr, 10);
  const period: "AM" | "PM" = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return { h12: String(h12).padStart(2, "0"), minute: mStr ?? "00", period };
}
function formatTo24h(h12: string, minute: string, period: "AM" | "PM"): string {
  if (!h12 || !minute) return "";
  let h = parseInt(h12, 10);
  if (period === "AM" && h === 12) h = 0;
  if (period === "PM" && h !== 12) h += 12;
  return `${String(h).padStart(2, "0")}:${minute.padStart(2, "0")}`;
}

const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : "Something went wrong";

// ── AmPm Time Picker ─────────────────────────────────────────────────────────

function AmPmTimePicker({
  value, onChange, label, optional,
}: {
  value: string;
  onChange: (v: string) => void;
  label: string;
  optional?: boolean;
}) {
  const { h12, minute, period } = parseTo12h(value);
  const set = (h: string, m: string, p: "AM" | "PM") => onChange(formatTo24h(h, m, p));
  const hours   = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0"));
  // All 60 minutes so manual attendance times are exact (not just 00/15/30/45).
  const minutes = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, "0"));
  return (
    <div>
      <Label className="text-sm">
        {label}{optional && <span className="text-muted-foreground text-xs ml-1">(optional)</span>}
      </Label>
      <div className="flex items-center gap-1 mt-1">
        <Select value={h12} onValueChange={(v) => set(v, minute || "00", period as "AM" | "PM")}>
          <SelectTrigger className="w-[68px] px-2"><SelectValue placeholder="HH" /></SelectTrigger>
          <SelectContent>{hours.map((h) => <SelectItem key={h} value={h}>{h}</SelectItem>)}</SelectContent>
        </Select>
        <span className="text-muted-foreground font-bold">:</span>
        <Select value={minute || ""} onValueChange={(v) => set(h12 || "12", v, period as "AM" | "PM")}>
          <SelectTrigger className="w-[68px] px-2"><SelectValue placeholder="MM" /></SelectTrigger>
          <SelectContent>{minutes.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={period} onValueChange={(v) => set(h12 || "12", minute || "00", v as "AM" | "PM")}>
          <SelectTrigger className="w-[68px] px-2"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="AM">AM</SelectItem>
            <SelectItem value="PM">PM</SelectItem>
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// ── Constants ────────────────────────────────────────────────────────────────

const ATTENDANCE_STATUS_STYLES: Record<string, string> = {
  present:    "bg-primary/10 text-primary border-primary/20",
  "half-day": "bg-amber-50 text-amber-700 border-amber-200",
  absent:     "bg-destructive/10 text-destructive border-destructive/20",
  leave:      "bg-destructive/10 text-destructive border-destructive/20",
};

const STATUS_OPTIONS: AttendanceEntry["status"][] = ["Present", "Half-day", "Absent", "Leave"];

const CHART_COLORS = {
  present: "#0ea5e9",
  halfday: "#d97706",
  absent:  "#dc2626",
  leave:   "#6366f1",
};

const PIE_COLORS = ["#0ea5e9", "#d97706", "#dc2626", "#6366f1", "#7c3aed"];

type ManualForm = {
  entryId?: string;
  employeeId: string;
  date: string;
  shiftId: string;
  checkIn: string;
  checkOut: string;
  status: AttendanceEntry["status"];
  note?: string;
};

const NOTE_MAX = 500;

const emptyForm = (defaultEmpId = ""): ManualForm => ({
  employeeId: defaultEmpId,
  date: todayStr(),
  shiftId: "",
  checkIn: "",
  checkOut: "",
  status: "Present",
  note: "",
});

// ── Analytics Tab ────────────────────────────────────────────────────────────
// Consumes the existing GET /admin/attendance/analytics endpoint via
// attendanceApi.analytics() (correct auth + base URL). Maps the backend's
// snake_case buckets to the chart/table shapes below — no new backend needed.

const pctColor = (pct: number) =>
  pct >= 90 ? "text-primary" : pct >= 75 ? "text-amber-600 dark:text-amber-400" : "text-destructive";
const pctBadge = (pct: number) =>
  pct >= 90
    ? "bg-primary/10 text-primary"
    : pct >= 75
    ? "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-400"
    : "bg-destructive/10 text-destructive";

function monthRange(month: string): { from: string; to: string } {
  const from = `${month}-01`;
  const lastDay = new Date(
    parseInt(month.slice(0, 4), 10),
    parseInt(month.slice(5, 7), 10),
    0,
  ).getDate();
  return { from, to: `${month}-${String(lastDay).padStart(2, "0")}` };
}

function AnalyticsTab() {
  const [month, setMonth] = useState(currentMonth());
  const [trend, setTrend] = useState<{ date: string; present: number; halfday: number; absent: number; leave: number }[]>([]);
  const [depts, setDepts] = useState<{ department: string; attendancePct: number }[]>([]);
  const [summary, setSummary] = useState<{
    employeeId: string; name: string; department: string;
    present: number; halfDay: number; absent: number; daysRecorded: number; totalHours: number;
  }[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const { from, to } = monthRange(month);
        const a = await attendanceApi.analytics({ from, to });
        if (cancelled) return;

        setTrend(
          a.daily_trend.map((d) => ({
            date: d.date ?? "",
            present: d.present_days,
            halfday: d.half_days,
            absent: d.absent_days,
            leave: d.leave_days,
          })),
        );
        setDepts(
          a.departments.map((d) => ({
            department: d.department ?? "Unassigned",
            attendancePct: d.attendance_pct,
          })),
        );
        setSummary(
          a.employees.map((e) => ({
            employeeId: e.employee_key ?? "",
            name: e.name ?? "",
            department: e.department ?? "",
            present: e.present_days,
            halfDay: e.half_days,
            absent: e.absent_days,
            daysRecorded: e.scheduled_days,
            totalHours: e.total_hours,
          })),
        );
      } catch (error: unknown) {
        if (!cancelled) toast.error(errorMessage(error));
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => { cancelled = true; };
  }, [month]);

  // Derived summary stats
  const monthStats = useMemo(() => {
    const totalPresent  = summary.reduce((a, r) => a + r.present, 0);
    const totalAbsent   = summary.reduce((a, r) => a + r.absent, 0);
    const totalHalfDay  = summary.reduce((a, r) => a + r.halfDay, 0);
    const totalRecorded = summary.reduce((a, r) => a + r.daysRecorded, 0);
    const avgPct = totalRecorded > 0
      ? Math.round(((totalPresent + totalHalfDay * 0.5) / totalRecorded) * 100)
      : 0;
    const mostAbsent = [...summary].sort((a, b) => b.absent - a.absent)[0];
    const perfectCount = summary.filter((r) => r.absent === 0 && r.daysRecorded > 0).length;
    return { totalPresent, totalAbsent, totalHalfDay, avgPct, mostAbsent, perfectCount };
  }, [summary]);

  // Pie chart data
  const pieData = useMemo(() => {
    const p = monthStats.totalPresent;
    const h = monthStats.totalHalfDay;
    const a = monthStats.totalAbsent;
    if (p + h + a === 0) return [];
    return [
      { name: "Present",  value: p },
      { name: "Half-day", value: h },
      { name: "Absent",   value: a },
    ];
  }, [monthStats]);

  // Format date for chart X axis (DD/MM)
  const fmtDate = (d: string) => {
    const parts = d.split("-");
    return parts.length === 3 ? `${parts[2]}/${parts[1]}` : d;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading analytics…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Month picker */}
      <div className="flex items-center gap-3">
        <Label className="text-sm text-muted-foreground shrink-0">Month</Label>
        <Input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          className="w-[180px]"
        />
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="bg-card rounded-xl border p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Avg Attendance</p>
          <p className={`text-2xl font-bold mt-1 ${pctColor(monthStats.avgPct)}`}>
            {monthStats.avgPct}%
          </p>
        </div>
        <div className="bg-card rounded-xl border p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Total Present</p>
          <p className="text-2xl font-bold mt-1 text-primary">{monthStats.totalPresent}</p>
        </div>
        <div className="bg-card rounded-xl border p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Total Absent</p>
          <p className="text-2xl font-bold mt-1 text-destructive">{monthStats.totalAbsent}</p>
        </div>
        <div className="bg-card rounded-xl border p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Half-days</p>
          <p className="text-2xl font-bold mt-1 text-amber-600 dark:text-amber-400">{monthStats.totalHalfDay}</p>
        </div>
        <div className="bg-card rounded-xl border p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Perfect Attendance</p>
          <p className="text-2xl font-bold mt-1">{monthStats.perfectCount}</p>
          <p className="text-xs text-muted-foreground">employees</p>
        </div>
        <div className="bg-card rounded-xl border p-4 shadow-sm">
          <p className="text-xs text-muted-foreground">Most Absent</p>
          <p className="text-sm font-semibold mt-1 truncate">
            {monthStats.mostAbsent?.name ?? "—"}
          </p>
          {monthStats.mostAbsent && (
            <p className="text-xs text-destructive">{monthStats.mostAbsent.absent} days</p>
          )}
        </div>
      </div>

      {/* Charts row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

        {/* Daily trend line chart */}
        <div className="lg:col-span-2 bg-card rounded-xl border p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Daily Attendance Trend</h3>
          </div>
          {trend.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              No data for this month
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trend} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                <XAxis
                  dataKey="date"
                  tickFormatter={fmtDate}
                  tick={{ fontSize: 11 }}
                  className="fill-muted-foreground"
                />
                <YAxis tick={{ fontSize: 11 }} className="fill-muted-foreground" />
                <Tooltip
                  labelFormatter={(l) => `Date: ${l}`}
                  contentStyle={{ fontSize: 12 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="present" stroke={CHART_COLORS.present} strokeWidth={2} dot={false} name="Present" />
                <Line type="monotone" dataKey="absent"  stroke={CHART_COLORS.absent}  strokeWidth={2} dot={false} name="Absent" />
                <Line type="monotone" dataKey="halfday" stroke={CHART_COLORS.halfday} strokeWidth={2} dot={false} name="Half-day" />
              </LineChart>
            </ResponsiveContainer>
          )}
        </div>

        {/* Pie chart */}
        <div className="bg-card rounded-xl border p-4 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart2 className="h-4 w-4 text-muted-foreground" />
            <h3 className="font-semibold text-sm">Status Breakdown</h3>
          </div>
          {pieData.length === 0 ? (
            <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
              No data for this month
            </div>
          ) : (
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={55}
                  outerRadius={85}
                  paddingAngle={3}
                  dataKey="value"
                  label={({ name, percent }) =>
                    `${name} ${((percent ?? 0) * 100).toFixed(0)}%`
                  }
                  labelLine={false}
                >
                  {pieData.map((_, i) => (
                    <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {/* Department bar chart */}
      <div className="bg-card rounded-xl border p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-4">
          <BarChart2 className="h-4 w-4 text-muted-foreground" />
          <h3 className="font-semibold text-sm">Department-wise Attendance %</h3>
        </div>
        {depts.length === 0 ? (
          <div className="flex items-center justify-center h-40 text-muted-foreground text-sm">
            No department data for this month
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={depts} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="department" tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <YAxis domain={[0, 100]} tick={{ fontSize: 11 }} className="fill-muted-foreground" />
              <Tooltip
                formatter={(v: number) => [`${v}%`, "Attendance"]}
                contentStyle={{ fontSize: 12 }}
              />
              <Bar dataKey="attendancePct" name="Attendance %" radius={[4, 4, 0, 0]}>
                {depts.map((d, i) => (
                  <Cell
                    key={i}
                    fill={d.attendancePct >= 80 ? CHART_COLORS.present : CHART_COLORS.absent}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Employee summary table */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <div className="p-4 border-b">
          <h3 className="font-semibold text-sm">Employee Attendance Summary</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Green &gt;90% · Yellow 75–90% · Red &lt;75%
          </p>
        </div>
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Employee</th>
                <th className="text-left px-4 py-3 font-medium">Department</th>
                <th className="text-right px-4 py-3 font-medium">Present</th>
                <th className="text-right px-4 py-3 font-medium">Absent</th>
                <th className="text-right px-4 py-3 font-medium">Half-day</th>
                <th className="text-right px-4 py-3 font-medium">Hours</th>
                <th className="text-center px-4 py-3 font-medium">Attendance %</th>
              </tr>
            </thead>
            <tbody>
              {summary.length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center py-10 text-muted-foreground">
                    No data for this month
                  </td>
                </tr>
              )}
              {summary.map((row) => {
                const pct = row.daysRecorded > 0
                  ? Math.round(((row.present + row.halfDay * 0.5) / row.daysRecorded) * 100)
                  : 0;
                return (
                  <tr key={row.employeeId} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <p className="font-medium">{row.name}</p>
                      <p className="text-xs text-muted-foreground">{row.employeeId}</p>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{row.department || "—"}</td>
                    <td className="px-4 py-3 text-right text-primary font-medium">{row.present}</td>
                    <td className="px-4 py-3 text-right text-destructive font-medium">{row.absent}</td>
                    <td className="px-4 py-3 text-right text-amber-600 dark:text-amber-400">{row.halfDay}</td>
                    <td className="px-4 py-3 text-right text-muted-foreground">
                      {row.totalHours.toFixed(1)}h
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${pctBadge(pct)}`}>
                        {pct}%
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableX>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────

export default function Attendance() {
  const [employees, setEmployees]   = useState<Employee[]>([]);
  const [entries, setEntries]       = useState<AttendanceEntry[]>([]);
  const [shifts, setShifts]         = useState<AttendanceShift[]>([]);
  const [loading, setLoading]       = useState(true);
  const [from, setFrom]             = useState(todayStr());
  const [to, setTo]                 = useState(todayStr());
  const [empFilter, setEmpFilter]   = useState("all");
  const [scannerOpen, setScannerOpen]       = useState(false);
  const [faceScannerOpen, setFaceScannerOpen] = useState(false);
  const [tmsImportOpen, setTmsImportOpen] = useState(false);
  const [taskImportOpen, setTaskImportOpen] = useState(false);
  const [busy, setBusy]             = useState(false);
  const [lastScan, setLastScan]     = useState<{ name: string; action: string; time: string } | null>(null);

  // Tab state
  const [activeTab, setActiveTab] = useState<"records" | "analytics">("records");

  // Export dropdown — monthly-summary loading state
  const [exportingSummary, setExportingSummary] = useState(false);

  // Advanced client-side filters (Records tab)
  const ALL_STATUSES: AttendanceEntry["status"][] = STATUS_OPTIONS;
  const [showFilters, setShowFilters] = useState(false);
  const [statusFilter, setStatusFilter] = useState<AttendanceEntry["status"][]>(ALL_STATUSES);
  const [lateOnly, setLateOnly] = useState(false);

  // Manual entry dialog
  const [manualOpen, setManualOpen]       = useState(false);
  const [editEntry, setEditEntry]         = useState<AttendanceEntry | null>(null);
  const [form, setForm]                   = useState<ManualForm>(emptyForm());
  const [saving, setSaving]               = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<AttendanceEntry | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [emps, atts, shiftRows] = await Promise.all([
        employeesApi.list(),
        attendanceApi.list({ from, to, employeeId: empFilter === "all" ? undefined : empFilter }),
        attendanceApi.shifts.list(),
      ]);
      setEmployees(emps);
      setEntries(atts);
      setShifts(shiftRows);
    } catch (error: unknown) { toast.error(errorMessage(error)); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, [from, to, empFilter]);

  useEffect(() => {
    if (!lastScan) return undefined;
    const timer = window.setTimeout(() => setLastScan(null), 2000);
    return () => window.clearTimeout(timer);
  }, [lastScan]);

  // Reset the advanced (client-side) filters when the From/To/Employee
  // selection changes — those drive an API refetch, so stale filters shouldn't carry over.
  useEffect(() => {
    setStatusFilter(ALL_STATUSES);
    setLateOnly(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, empFilter]);

  // ── Advanced client-side filters ───────────────────────────────────────────
  // Applied on the already-loaded `entries` array — no API refetch.
  const statusFilterActive = statusFilter.length !== ALL_STATUSES.length;
  const activeFilterCount = (statusFilterActive ? 1 : 0) + (lateOnly ? 1 : 0);
  const filtersActive = activeFilterCount > 0;

  const filteredEntries = useMemo(() => {
    if (!filtersActive) return entries;
    return entries.filter((e) => {
      if (statusFilterActive && !statusFilter.includes(e.status)) return false;
      if (lateOnly && !((e.lateMinutes ?? 0) > 0)) return false;
      return true;
    });
  }, [entries, statusFilter, statusFilterActive, lateOnly, filtersActive]);

  const paged = usePagedRows(filteredEntries);

  const toggleStatusFilter = (status: AttendanceEntry["status"]) => {
    setStatusFilter((prev) =>
      prev.includes(status) ? prev.filter((s) => s !== status) : [...prev, status],
    );
  };
  const clearFilters = () => {
    setStatusFilter(ALL_STATUSES);
    setLateOnly(false);
  };

  const empMap = useMemo(() =>
    Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);
  const activeShifts = useMemo(() =>
    shifts.filter((s) => s.active), [shifts]);
  const defaultShiftId = useMemo(() =>
    activeShifts.find((s) => s.isDefault)?.id ?? activeShifts[0]?.id ?? "", [activeShifts]);
  const shiftById = (id?: string | null) =>
    activeShifts.find((s) => s.id === id) ?? shifts.find((s) => s.id === id);

  const today        = todayStr();
  const todayEntries = useMemo(() =>
    entries.filter((e) => e.date === today), [entries, today]);
  const stats = useMemo(() => {
    const present   = todayEntries.filter((e) => e.status === "Present").length;
    const half      = todayEntries.filter((e) => e.status === "Half-day").length;
    const absent    = todayEntries.filter((e) => e.status === "Absent").length;
    const checkedIn = todayEntries.filter((e) => e.checkIn && !e.checkOut).length;
    return { present, half, absent, checkedIn };
  }, [todayEntries]);

  const handleAttendanceMarked = (result: AttendanceScanResponse) => {
    void load();
    setLastScan({
      name:   result.employee.name,
      action: result.action === "checked-in" ? "Checked In" : "Checked Out",
      time:   new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" }),
    });
  };

  const onScan = async (token: string) => {
    setBusy(true);
    try {
      const result = await attendanceApi.scan(token);
      handleAttendanceMarked(result);
    } catch (error: unknown) { toast.error(errorMessage(error)); }
    finally { setBusy(false); }
  };

  const onFaceMatch = async (employeeId: string) => {
    setBusy(true);
    try {
      const rows = await attendanceApi.list({ from: todayStr(), to: todayStr(), employeeId });
      const openToday = rows.some(
        (entry) => entry.employeeId === employeeId && entry.checkIn && !entry.checkOut
      );
      const result = openToday
        ? await attendanceApi.checkOut(employeeId)
        : await attendanceApi.checkIn(employeeId);
      handleAttendanceMarked(result);
    } catch (error: unknown) {
      toast.error(errorMessage(error));
      throw error;
    } finally { setBusy(false); }
  };

  const openNew = () => {
    setEditEntry(null);
    // Pre-fill check-in/out from the default shift's timing; the user can overwrite.
    const s = shiftById(defaultShiftId);
    setForm({
      ...emptyForm(empFilter !== "all" ? empFilter : employees[0]?.id ?? ""),
      shiftId:  defaultShiftId,
      checkIn:  s?.startTime ?? "",
      checkOut: s?.endTime ?? "",
    });
    setManualOpen(true);
  };

  const openEdit = (a: AttendanceEntry) => {
    setEditEntry(a);
    const sid = a.shiftId ?? defaultShiftId;
    const s = shiftById(sid);
    const working = a.status === "Present" || a.status === "Half-day";
    const ci = isoToTime(a.checkIn);
    const co = isoToTime(a.checkOut);
    setForm({
      entryId:    a.id,
      employeeId: a.employeeId,
      date:       a.date,
      shiftId:    sid,
      // Keep the record's own times; if missing (and it's a working day), fall back
      // to the shift timing so the user can confirm/overwrite instead of a blank field.
      checkIn:    ci || (working ? (s?.startTime ?? "") : ""),
      checkOut:   co || (working ? (s?.endTime ?? "") : ""),
      status:     a.status,
      note:       "",
    });
    setManualOpen(true);
  };

  const submitManual = async () => {
    if (!form.employeeId) { toast.error("Select an employee"); return; }
    if (!form.date)        { toast.error("Date is required");  return; }
    setSaving(true);
    try {
      await attendanceApi.manual({ ...form, entryId: editEntry?.id });
      toast.success(editEntry ? "Attendance updated" : "Attendance recorded");
      setManualOpen(false);
      load();
    } catch (error: unknown) { toast.error(errorMessage(error)); }
    finally { setSaving(false); }
  };

  const onDelete = async () => {
    if (!confirmDelete) return;
    try {
      await attendanceApi.delete(confirmDelete.id);
      setEntries((prev) => prev.filter((e) => e.id !== confirmDelete.id));
      toast.success("Attendance record deleted");
      setConfirmDelete(null);
    } catch (error: unknown) { toast.error(errorMessage(error)); }
  };

  const needsTimes = form.status === "Present" || form.status === "Half-day";

  const exportXlsx = () => {
    if (!entries.length) { toast.error("No data to export"); return; }
    exportToExcel({
      sheetName: "Attendance",
      filename:  `attendance-${from}_to_${to}`,
      columns: [
        { header: "Date",         key: "date" },
        { header: "Employee ID",  key: "employeeId" },
        { header: "Name",         key: (r) => empMap[r.employeeId]?.name       ?? "—" },
        { header: "Department",   key: (r) => empMap[r.employeeId]?.department ?? "—" },
        { header: "Shift",        key: (r) => r.shiftName ?? "—" },
        { header: "Check In",     key: (r) => fmtTime(r.checkIn) },
        { header: "Check Out",    key: (r) => fmtTime(r.checkOut) },
        { header: "Hours",        key: (r) => r.hoursWorked ?? "" },
        { header: "Late Minutes", key: (r) => r.lateMinutes ?? 0 },
        { header: "Status",       key: "status" },
      ],
      rows: entries,
    });
    toast.success("Excel exported");
  };

  const exportMonthlySummary = async () => {
    setExportingSummary(true);
    try {
      const month = currentMonth();
      const { from: mFrom, to: mTo } = monthRange(month);
      const a = await attendanceApi.analytics({ from: mFrom, to: mTo });
      if (!a.employees.length) { toast.error("No data to export"); return; }
      exportToExcel({
        sheetName: "Monthly Summary",
        filename:  `attendance-summary-${month}`,
        columns: [
          { header: "Employee ID",  key: (r) => r.employee_key ?? "" },
          { header: "Name",         key: (r) => r.name ?? "" },
          { header: "Department",   key: (r) => r.department ?? "" },
          { header: "Present Days", key: (r) => r.present_days },
          { header: "Absent Days",  key: (r) => r.absent_days },
          { header: "Half-days",    key: (r) => r.half_days },
          { header: "Total Hours",  key: (r) => r.total_hours },
          { header: "Attendance %", key: (r) => r.attendance_pct },
        ],
        rows: a.employees,
      });
      toast.success("Monthly summary exported");
    } catch (error: unknown) {
      toast.error(errorMessage(error));
    } finally {
      setExportingSummary(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Attendance</h1>
          <p className="text-muted-foreground">Scan by face or QR, or add entries manually.</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-start md:justify-end">
          <Button variant="outline" onClick={() => setTmsImportOpen(true)}><FileUp className="h-4 w-4" /> Attendance Import</Button>
          <Button variant="outline" onClick={() => setTaskImportOpen(true)}><ListChecks className="h-4 w-4" /> Task Status (TMS)</Button>
          {activeTab === "analytics" ? (
            <Button variant="outline" onClick={exportMonthlySummary} disabled={exportingSummary}>
              {exportingSummary
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <FileDown className="h-4 w-4" />}
              Export Summary
            </Button>
          ) : (
            <Button variant="outline" onClick={exportXlsx}>
              <FileDown className="h-4 w-4" />
              Export
            </Button>
          )}
          <Button variant="outline" onClick={openNew}><Plus className="h-4 w-4" /> Manual Entry</Button>
          <Button onClick={() => setFaceScannerOpen(true)}><Camera className="h-4 w-4" /> Face Attendance</Button>
          <Button variant="outline" onClick={() => setScannerOpen(true)}><ScanLine className="h-4 w-4" /> QR Attendance</Button>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Present Today"  value={String(stats.present)}   subtitle={`of ${employees.length} staff`} icon={CheckCircle2} />
        <StatCard title="Half-day"       value={String(stats.half)}      subtitle="today"                          icon={Clock} />
        <StatCard title="Absent Today"   value={String(stats.absent)}    subtitle="today"                          icon={Calendar} subtitleColor="muted" />
        <StatCard title="Checked-in"     value={String(stats.checkedIn)} subtitle="awaiting check-out"             icon={Users} />
      </div>

      {/* Tab navigation */}
      <div className="flex border-b">
        <button
          onClick={() => setActiveTab("records")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "records"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          Records
        </button>
        <button
          onClick={() => setActiveTab("analytics")}
          className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors flex items-center gap-1.5 ${
            activeTab === "analytics"
              ? "border-primary text-primary"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`}
        >
          <BarChart2 className="h-3.5 w-3.5" />
          Analytics
        </button>
      </div>

      {/* Records tab */}
      {activeTab === "records" && (
        <>
          {/* Date / employee filters */}
          <div className="bg-card rounded-xl border p-4 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-x-3 gap-y-3 items-end">
            <div className="flex flex-col gap-1">
              <Label className="text-xs">From</Label>
              <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="flex flex-col gap-1">
              <Label className="text-xs">To</Label>
              <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
            <div className="md:col-span-2 flex flex-col gap-1">
              <Label className="text-xs">Employee</Label>
              <Select value={empFilter} onValueChange={setEmpFilter}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All employees</SelectItem>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>{e.name} ({e.id})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Advanced filters toggle */}
          <div className="flex items-center gap-2 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters((v) => !v)}
            >
              <SlidersHorizontal className="h-4 w-4" />
              Filters
              {activeFilterCount > 0 && (
                <span className="ml-1 inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                  {activeFilterCount}
                </span>
              )}
            </Button>
            {filtersActive && (
              <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
                <X className="h-4 w-4" />
                Clear filters
              </Button>
            )}
          </div>

          {/* Collapsible advanced filters */}
          {showFilters && (
            <div className="bg-card rounded-xl border p-4 shadow-sm flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
              <div className="flex flex-col gap-2">
                <Label className="text-xs">Status</Label>
                <div className="flex flex-wrap gap-3">
                  {ALL_STATUSES.map((s) => (
                    <label key={s} className="flex items-center gap-2 text-sm cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={statusFilter.includes(s)}
                        onChange={() => toggleStatusFilter(s)}
                        className="h-4 w-4 rounded border-input accent-primary"
                      />
                      {s}
                    </label>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <Switch id="late-only" checked={lateOnly} onCheckedChange={setLateOnly} />
                <Label htmlFor="late-only" className="text-sm cursor-pointer">Late arrivals only</Label>
              </div>
            </div>
          )}

          {/* Filtered count */}
          {filtersActive && !loading && (
            <p className="text-xs text-muted-foreground">
              Showing {filteredEntries.length} of {entries.length} records
            </p>
          )}

          {/* Records table */}
          <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
            <ScrollableX>
              <table className="w-full text-sm table-fixed">
                <colgroup>
                  <col className="w-[110px]" />
                  <col className="w-[160px]" />
                  <col className="w-[110px]" />
                  <col className="w-[130px]" />
                  <col className="w-[100px]" />
                  <col className="w-[100px]" />
                  <col className="w-[70px]" />
                  <col className="w-[70px]" />
                  <col className="w-[90px]" />
                  <col className="w-[60px]" />
                </colgroup>
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">Date</th>
                    <th className="text-left px-4 py-3 font-medium">Employee</th>
                    <th className="text-left px-4 py-3 font-medium">Dept</th>
                    <th className="text-left px-4 py-3 font-medium">Shift</th>
                    <th className="text-left px-4 py-3 font-medium">Check In</th>
                    <th className="text-left px-4 py-3 font-medium">Check Out</th>
                    <th className="text-right px-4 py-3 font-medium">Hours</th>
                    <th className="text-right px-4 py-3 font-medium">Late</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium"></th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <TableSkeleton cols={10} />}
                  {!loading && entries.length === 0 && (
                    <tr><td colSpan={10} className="text-center py-10 text-muted-foreground">No attendance records in this range.</td></tr>
                  )}
                  {!loading && entries.length > 0 && filteredEntries.length === 0 && (
                    <tr><td colSpan={10} className="text-center py-10 text-muted-foreground">No records match the current filters.</td></tr>
                  )}
                  {!loading && paged.rows.map((a) => {
                    const emp = empMap[a.employeeId];
                    return (
                      <tr key={a.id} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-3">{a.date}</td>
                        <td className="px-4 py-3 truncate">
                          {emp?.name ?? a.employeeId}
                          <div className="text-xs text-muted-foreground">{a.employeeId}</div>
                        </td>
                        <td className="px-4 py-3 text-muted-foreground truncate">{emp?.department ?? "—"}</td>
                        <td className="px-4 py-3 truncate">
                          {a.shiftName ?? "—"}
                          <div className="text-xs text-muted-foreground">
                            {a.shiftStartTime && a.shiftEndTime ? `${a.shiftStartTime}-${a.shiftEndTime}` : ""}
                          </div>
                        </td>
                        <td className="px-4 py-3">{fmtTime(a.checkIn)}</td>
                        <td className="px-4 py-3">{fmtTime(a.checkOut)}</td>
                        <td className="px-4 py-3 text-right font-medium">{a.hoursWorked ?? "—"}</td>
                        <td className="px-4 py-3 text-right">{a.lateMinutes ?? 0}</td>
                        <td className="px-4 py-3">
                          <StatusBadge value={a.status.toLowerCase()} styleMap={ATTENDANCE_STATUS_STYLES} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex gap-1">
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => openEdit(a)}>
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setConfirmDelete(a)}>
                              <Trash2 className="h-3.5 w-3.5 text-destructive" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableX>
            {!loading && filteredEntries.length > 0 && (
              <Pagination {...paged} onPage={paged.setPage} noun="records" />
            )}
          </div>
        </>
      )}

      {/* Analytics tab */}
      {activeTab === "analytics" && <AnalyticsTab />}

      {/* QR Scanner overlay */}
      {scannerOpen && (
        <QrScanner fullscreen onScan={onScan} busy={busy} onClose={() => setScannerOpen(false)} />
      )}

      {/* Face Scanner overlay */}
      {faceScannerOpen && (
        <FaceAttendanceScanner
          employees={employees}
          busy={busy}
          onMatch={onFaceMatch}
          onClose={() => setFaceScannerOpen(false)}
        />
      )}

      {/* Scan success popup */}
      {lastScan && (
        <div className="fixed inset-0 z-[160] flex items-center justify-center bg-black/35 px-4 pointer-events-none">
          <div className="w-full max-w-md rounded-2xl border border-primary/30 bg-background p-10 text-center shadow-2xl">
            <div className="mx-auto mb-5 flex h-24 w-24 items-center justify-center rounded-full bg-primary/10">
              <CheckCircle2 className="h-14 w-14 text-primary" />
            </div>
            <p className="text-3xl font-bold text-foreground">Attendance Marked</p>
            <p className="mt-4 text-2xl font-semibold text-primary">{lastScan.name}</p>
            <p className="mt-2 text-lg text-muted-foreground">
              {lastScan.action} at {lastScan.time}
            </p>
          </div>
        </div>
      )}

      <ConfirmDeleteDialog
        open={!!confirmDelete}
        onOpenChange={(o) => !o && setConfirmDelete(null)}
        onConfirm={onDelete}
        title="Delete attendance record?"
        description={confirmDelete
          ? `This will permanently remove the record for ${empMap[confirmDelete.employeeId]?.name ?? confirmDelete.employeeId} on ${confirmDelete.date}. This cannot be undone.`
          : undefined}
      />

      {/* Manual Entry / Edit dialog */}
      <Dialog open={manualOpen} onOpenChange={(o) => { if (!saving) setManualOpen(o); }}>
        <DialogScrollContent onInteractOutside={(e) => e.preventDefault()} className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editEntry ? "Edit Attendance" : "Manual Attendance Entry"}</DialogTitle>
            <DialogDescription>
              {editEntry
                ? `Editing record for ${empMap[editEntry.employeeId]?.name ?? editEntry.employeeId} on ${editEntry.date}.`
                : "Add a check-in, check-out, or leave record for any employee."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-1">
            <div>
              <Label>Employee</Label>
              <Select
                value={form.employeeId}
                onValueChange={(v) => setForm({ ...form, employeeId: v })}
                disabled={!!editEntry}
              >
                <SelectTrigger><SelectValue placeholder="Select employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => (
                    <SelectItem key={e.id} value={e.id}>
                      {e.name} — {e.department} ({e.id})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Date <Req /></Label>
              <Input
                type="date"
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
                disabled={!!editEntry}
              />
            </div>

            <div>
              <Label>Shift</Label>
              <Select
                value={form.shiftId || defaultShiftId}
                onValueChange={(v) => {
                  const s = shiftById(v);
                  const working = form.status === "Present" || form.status === "Half-day";
                  setForm({
                    ...form,
                    shiftId: v,
                    // Fill check-in/out from the chosen shift; user can overwrite after.
                    checkIn:  working ? (s?.startTime ?? form.checkIn) : form.checkIn,
                    checkOut: working ? (s?.endTime ?? form.checkOut) : form.checkOut,
                  });
                }}
              >
                <SelectTrigger><SelectValue placeholder="Select shift" /></SelectTrigger>
                <SelectContent>
                  {activeShifts.map((s) => (
                    <SelectItem key={s.id} value={s.id}>
                      {s.name} ({s.startTime}-{s.endTime})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label>Status</Label>
              <Select
                value={form.status}
                onValueChange={(v) => {
                  const s = v as AttendanceEntry["status"];
                  const working = s === "Present" || s === "Half-day";
                  const sh = shiftById(form.shiftId || defaultShiftId);
                  setForm({
                    ...form,
                    status: s,
                    // Clear times for Absent/Leave; when switching to a working status,
                    // seed any empty time from the selected shift.
                    checkIn:  working ? (form.checkIn || sh?.startTime || "") : "",
                    checkOut: working ? (form.checkOut || sh?.endTime || "") : "",
                  });
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {STATUS_OPTIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>

            {needsTimes && (
              <div className="grid grid-cols-2 gap-3">
                <AmPmTimePicker
                  label="Check-in Time"
                  value={form.checkIn}
                  onChange={(v) => setForm({ ...form, checkIn: v })}
                />
                <AmPmTimePicker
                  label="Check-out Time"
                  optional
                  value={form.checkOut}
                  onChange={(v) => setForm({ ...form, checkOut: v })}
                />
              </div>
            )}

            {needsTimes && (
              <p className="text-xs text-muted-foreground">
                Times are pre-filled from the selected shift — overwrite them if needed.
                Early check-in is allowed; overtime starts only after scheduled shift hours are completed.
              </p>
            )}

            {(form.status === "Absent" || form.status === "Leave" || editEntry !== null) && (
              <div>
                <Label>Note / Reason <span className="text-muted-foreground text-xs ml-1">(optional)</span></Label>
                <Textarea
                  value={form.note ?? ""}
                  onChange={(e) => setForm({ ...form, note: e.target.value.slice(0, NOTE_MAX) })}
                  placeholder="Reason for manual entry, correction note, etc."
                  maxLength={NOTE_MAX}
                  rows={3}
                  className="mt-1 resize-none"
                />
                <p className="text-xs text-muted-foreground text-right mt-1">
                  {(form.note ?? "").length} / {NOTE_MAX}
                </p>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setManualOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={submitManual} disabled={saving}>
              {saving ? "Saving…" : editEntry ? "Update" : "Save"}
            </Button>
          </DialogFooter>
        </DialogScrollContent>
      </Dialog>

      <HrImportWizard kind="attendance" open={tmsImportOpen} onClose={() => setTmsImportOpen(false)} onDone={load} />
      <HrImportWizard kind="tasks" open={taskImportOpen} onClose={() => setTaskImportOpen(false)} onDone={load} />
    </div>
  );
}
