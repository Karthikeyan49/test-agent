import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  Plus, Search, Pencil, Trash2, ListTodo, CheckCircle2, Clock, AlertTriangle, Trophy, Target,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { StatCard } from "@/components/StatCard";
import { toast } from "sonner";
import {
  tasksApi, computePerformance, TASK_STATUSES, TASK_PRIORITIES,
  type Task, type TaskStatus, type TaskPriority, type PerformanceRow,
} from "@/lib/api/tasks";
import { employeesApi, type Employee } from "@/lib/api/hr";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { ExportMenu, type ExportColumnDef } from "@/components/ExportMenu";

const TASK_EXPORT_COLUMNS: ExportColumnDef<Task>[] = [
  { header: "ID",        key: "id" },
  { header: "Title",     key: "title" },
  { header: "Priority",  key: "priority" },
  { header: "Status",    key: "status" },
  { header: "Due Date",  key: "dueDate" },
  { header: "Created",   key: "createdAt" },
  { header: "Assignee",  key: "assigneeId", group: "detail", defaultChecked: false },
];

const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
const currentMonthStr = () => new Date().toISOString().slice(0, 7); // YYYY-MM

const STATUS_COLOR: Record<TaskStatus, string> = {
  Pending: "bg-muted text-muted-foreground",
  "In Progress": "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  Completed: "bg-primary/10 text-primary",
  Blocked: "bg-destructive/10 text-destructive",
};

const PRIORITY_COLOR: Record<TaskPriority, string> = {
  Low: "bg-secondary text-secondary-foreground",
  Medium: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300",
  High: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  Critical: "bg-destructive/10 text-destructive",
};

type DateFilter = "all" | "today" | "week" | "month" | "overdue";

const DATE_LABELS: Record<DateFilter, string> = {
  all: "All dates", today: "Today", week: "This Week", month: "This Month", overdue: "Overdue",
};

// Build last 6 months array: [{ value: "2026-04", label: "April 2026" }, ...]
const buildLast6Months = () => {
  const months = [];
  const now = new Date();
  for (let i = 0; i < 6; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    const label = d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
    months.push({ value, label });
  }
  return months;
};

// Get the previous month string from a YYYY-MM string
const prevMonthOf = (ym: string): string => {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y, m - 2, 1); // m is 1-indexed, m-2 is previous in 0-indexed
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
};

export default function Tasks() {
  const navigate = useNavigate();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [assigneeFilter, setAssigneeFilter] = useState<string>("all");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");

  // Performance tab month selector
  const [perfMonth, setPerfMonth] = useState<string>(currentMonthStr);
  const last6Months = useMemo(() => buildLast6Months(), []);

  const [confirmDelete, setConfirmDelete] = useState<Task | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [t, e] = await Promise.all([tasksApi.list(), employeesApi.list()]);
      setTasks(t); setEmployees(e);
    } catch (err: any) { toast.error(err.message); }
    finally { setLoading(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  const empMap = useMemo(() => Object.fromEntries(employees.map((e) => [e.id, e])), [employees]);

  const today = todayStr();

  // ── Board / List filters ───────────────────────────────────────────────────
  const filtered = useMemo(() => {
    const weekEnd = new Date(Date.now() + 6 * 86400000).toISOString().slice(0, 10);
    const monthPrefix = today.slice(0, 7);
    return tasks.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (priorityFilter !== "all" && t.priority !== priorityFilter) return false;
      if (assigneeFilter !== "all" && t.assigneeId !== assigneeFilter) return false;
      if (dateFilter === "today" && t.dueDate !== today) return false;
      if (dateFilter === "week" && (t.dueDate < today || t.dueDate > weekEnd)) return false;
      if (dateFilter === "month" && !t.dueDate.startsWith(monthPrefix)) return false;
      if (dateFilter === "overdue" && (t.status === "Completed" || t.dueDate >= today)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!t.title.toLowerCase().includes(q) &&
            !t.description.toLowerCase().includes(q) &&
            !t.id.toLowerCase().includes(q) &&
            !t.tags.some((tg) => tg.toLowerCase().includes(q))) return false;
      }
      return true;
    });
  }, [tasks, statusFilter, priorityFilter, assigneeFilter, dateFilter, search, today]);

  const paged = usePagedRows(filtered);

  // ── Stats (all tasks) ──────────────────────────────────────────────────────
  const stats = useMemo(() => {
    const total = tasks.length;
    const completed = tasks.filter((t) => t.status === "Completed").length;
    const inProgress = tasks.filter((t) => t.status === "In Progress").length;
    const overdue = tasks.filter((t) => t.status !== "Completed" && t.dueDate < today).length;
    const completionRate = total ? Math.round((completed / total) * 100) : 0;
    return { total, completed, inProgress, overdue, completionRate };
  }, [tasks, today]);

  useEffect(() => {
    window.dispatchEvent(new CustomEvent("task-overdue-update", { detail: stats.overdue }));
  }, [stats.overdue]);

  // ── Performance: selected month tasks ─────────────────────────────────────
  const perfTasks = useMemo(
    () => tasks.filter((t) => t.createdAt.startsWith(perfMonth)),
    [tasks, perfMonth],
  );

  // ── Performance: previous month tasks (for delta) ─────────────────────────
  const prevMonth = useMemo(() => prevMonthOf(perfMonth), [perfMonth]);
  const prevPerfTasks = useMemo(
    () => tasks.filter((t) => t.createdAt.startsWith(prevMonth)),
    [tasks, prevMonth],
  );

  // ── Performance scores for selected month ─────────────────────────────────
  const performance = useMemo(
    () => computePerformance(perfTasks, employees.map((e) => e.id))
            .sort((a, b) => b.productivityScore - a.productivityScore),
    [perfTasks, employees],
  );

  // ── Previous month scores keyed by employeeId (for delta) ─────────────────
  const prevPerformance = useMemo(
    () => computePerformance(prevPerfTasks, employees.map((e) => e.id))
            .reduce<Record<string, PerformanceRow>>((acc, row) => {
              acc[row.employeeId] = row;
              return acc;
            }, {}),
    [prevPerfTasks, employees],
  );

  const onDelete = async () => {
    if (!confirmDelete) return;
    try { await tasksApi.remove(confirmDelete.id); toast.success("Task deleted"); setConfirmDelete(null); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  const quickStatus = async (t: Task, status: TaskStatus) => {
    try { await tasksApi.update(t.id, { status }); load(); }
    catch (e: any) { toast.error(e.message); }
  };

  // Helper: render delta badge
  const DeltaBadge = ({ current, prev }: { current: number; prev?: PerformanceRow }) => {
    if (!prev || prev.total === 0) return <span className="text-xs text-muted-foreground">No prev data</span>;
    const delta = current - prev.productivityScore;
    if (delta === 0) return <span className="text-xs text-muted-foreground">— same</span>;
    return (
      <span className={`text-xs font-semibold ${delta > 0 ? "text-primary" : "text-destructive"}`}>
        {delta > 0 ? "▲" : "▼"} {Math.abs(delta)}
      </span>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Tasks &amp; Performance</h1>
          <p className="text-muted-foreground">Assign tasks, track status and measure productivity.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu title="Tasks" columns={TASK_EXPORT_COLUMNS} rows={filtered} dateField="dueDate" filename="tasks" />
          <Button onClick={() => navigate('/tasks/new')}><Plus className="h-4 w-4" />New Task</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Tasks" value={String(stats.total)} subtitle={`${stats.completionRate}% complete`} icon={ListTodo} />
        <StatCard title="In Progress" value={String(stats.inProgress)} subtitle="active" icon={Clock} />
        <StatCard title="Completed" value={String(stats.completed)} subtitle="all time" icon={CheckCircle2} />
        <StatCard title="Overdue" value={String(stats.overdue)} subtitle="needs attention" icon={AlertTriangle} subtitleColor="muted" />
      </div>

      <Tabs defaultValue="board" className="w-full">
        <TabsList>
          <TabsTrigger value="board">Board</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
          <TabsTrigger value="performance">Performance</TabsTrigger>
        </TabsList>

        {/* Filters bar — Board & List only */}
        <div className="bg-card rounded-xl border p-4 shadow-sm space-y-3 mt-4">
          <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search title, tag, ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={statusFilter} onValueChange={setStatusFilter}>
              <SelectTrigger><SelectValue placeholder="Status" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All statuses</SelectItem>
                {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={priorityFilter} onValueChange={setPriorityFilter}>
              <SelectTrigger><SelectValue placeholder="Priority" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All priorities</SelectItem>
                {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={assigneeFilter} onValueChange={setAssigneeFilter}>
              <SelectTrigger><SelectValue placeholder="Assignee" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All assignees</SelectItem>
                {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {/* Date quick-filter chips */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-muted-foreground font-medium">Due:</span>
            {(["all", "today", "week", "month", "overdue"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setDateFilter(f)}
                className={`text-xs px-3 py-1 rounded-full border transition-colors ${
                  dateFilter === f
                    ? f === "overdue"
                      ? "bg-destructive text-destructive-foreground border-destructive"
                      : "bg-primary text-primary-foreground border-primary"
                    : "bg-transparent text-muted-foreground border-border hover:border-primary hover:text-foreground"
                }`}
              >
                {DATE_LABELS[f]}
              </button>
            ))}
          </div>
        </div>

        {/* BOARD VIEW */}
        <TabsContent value="board" className="mt-4">
          {loading
            ? <div className="text-center py-10 text-muted-foreground">No tasks found.</div>
            : (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                {TASK_STATUSES.map((status) => {
                  const col = filtered.filter((t) => t.status === status);
                  return (
                    <div key={status} className="bg-muted/30 rounded-xl border p-3 min-h-[200px]">
                      <div className="flex items-center justify-between mb-3 px-1">
                        <div className="flex items-center gap-2">
                          <span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLOR[status]}`}>{status}</span>
                          <span className="text-xs text-muted-foreground">{col.length}</span>
                        </div>
                      </div>
                      <div className="space-y-2">
                        {col.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">Empty</p>}
                        {col.map((t) => {
                          const assignee = empMap[t.assigneeId];
                          const overdue = t.status !== "Completed" && t.dueDate < today;
                          return (
                            <div key={t.id} className="bg-card rounded-lg p-3 border shadow-sm hover:shadow transition-shadow">
                              <div className="flex items-start justify-between gap-2 mb-1">
                                <p className="font-medium text-sm text-card-foreground line-clamp-2">{t.title}</p>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded-full whitespace-nowrap ${PRIORITY_COLOR[t.priority]}`}>{t.priority}</span>
                              </div>
                              <p className="text-xs text-muted-foreground line-clamp-2 mb-2">{t.description}</p>
                              <div className="flex items-center justify-between text-xs">
                                <span className="text-muted-foreground">{assignee?.name ?? t.assigneeId}</span>
                                <span className={overdue ? "text-destructive font-medium" : "text-muted-foreground"}>Due {t.dueDate}</span>
                              </div>
                              <div className="text-[10px] text-muted-foreground mt-0.5">
                                Created {fmtDate(t.createdAt)} · by {t.assignedBy || "—"}
                              </div>
                              <div className="flex items-center gap-1 mt-2">
                                <Select value={t.status} onValueChange={(v) => quickStatus(t, v as TaskStatus)}>
                                  <SelectTrigger className="h-7 text-xs flex-1"><SelectValue /></SelectTrigger>
                                  <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                                </Select>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => navigate(`/tasks/${t.id}/edit`)}><Pencil className="h-3 w-3" /></Button>
                                <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setConfirmDelete(t)}><Trash2 className="h-3 w-3 text-destructive" /></Button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
        </TabsContent>

        {/* LIST VIEW */}
        <TabsContent value="list" className="mt-4">
          <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
            <ScrollableX>
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium">ID</th>
                    <th className="text-left px-4 py-3 font-medium">Title</th>
                    <th className="text-left px-4 py-3 font-medium">Assignee</th>
                    <th className="text-left px-4 py-3 font-medium">Priority</th>
                    <th className="text-left px-4 py-3 font-medium">Status</th>
                    <th className="text-left px-4 py-3 font-medium">Due / Created</th>
                    <th className="text-right px-4 py-3 font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading && <TableSkeleton cols={7} />}
                  {!loading && filtered.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No tasks match.</td></tr>}
                  {!loading && paged.rows.map((t) => {
                    const assignee = empMap[t.assigneeId];
                    const overdue = t.status !== "Completed" && t.dueDate < today;
                    return (
                      <tr key={t.id} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium text-card-foreground">{t.id}</td>
                        <td className="px-4 py-3">
                          {t.title}
                          {t.tags.length > 0 && <div className="flex gap-1 mt-1">{t.tags.map((tg) => <span key={tg} className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground">{tg}</span>)}</div>}
                        </td>
                        <td className="px-4 py-3">{assignee?.name ?? t.assigneeId}</td>
                        <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full ${PRIORITY_COLOR[t.priority]}`}>{t.priority}</span></td>
                        <td className="px-4 py-3"><span className={`text-xs px-2 py-1 rounded-full ${STATUS_COLOR[t.status]}`}>{t.status}</span></td>
                        <td className="px-4 py-3">
                          <div className={overdue ? "text-destructive font-medium" : ""}>{t.dueDate}</div>
                          <div className="text-[10px] text-muted-foreground">Created {fmtDate(t.createdAt)}</div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex gap-1">
                            <Button size="icon" variant="ghost" onClick={() => navigate(`/tasks/${t.id}/edit`)}><Pencil className="h-4 w-4" /></Button>
                            <Button size="icon" variant="ghost" onClick={() => setConfirmDelete(t)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableX>
          </div>
          {!loading && filtered.length > 0 && (
            <Pagination {...paged} onPage={paged.setPage} noun="tasks" />
          )}
        </TabsContent>

        {/* PERFORMANCE VIEW */}
        <TabsContent value="performance" className="mt-4 space-y-6">

          {/* Month selector */}
          <div className="flex items-center justify-between flex-wrap gap-3 bg-card rounded-xl border p-4 shadow-sm">
            <div>
              <p className="text-sm font-medium text-foreground">Performance Period</p>
              <p className="text-xs text-muted-foreground">
                Comparing with {last6Months.find((m) => m.value === prevMonth)?.label ?? prevMonth}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Select value={perfMonth} onValueChange={setPerfMonth}>
                <SelectTrigger className="w-44">
                  <SelectValue placeholder="Select month" />
                </SelectTrigger>
                <SelectContent>
                  {last6Months.map((m) => (
                    <SelectItem key={m.value} value={m.value}>{m.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {perfTasks.length === 0 && (
                <span className="text-xs text-muted-foreground">No tasks recorded for this month</span>
              )}
            </div>
          </div>

          {/* Top 3 performer cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {performance.slice(0, 3).map((row, i) => {
              const emp = empMap[row.employeeId];
              const medal = ["🥇", "🥈", "🥉"][i];
              const prev = prevPerformance[row.employeeId];
              return (
                <div key={row.employeeId} className="bg-card rounded-xl border p-5 shadow-sm">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Top performer #{i + 1}</p>
                      <p className="font-semibold text-card-foreground">{emp?.name ?? row.employeeId}</p>
                      <p className="text-xs text-muted-foreground">{emp?.designation ?? ""}</p>
                    </div>
                    <div className="text-3xl">{medal}</div>
                  </div>
                  <div className="flex items-end gap-2 mb-1">
                    <div className="text-3xl font-bold text-primary">
                      {row.productivityScore}
                      <span className="text-sm text-muted-foreground">/100</span>
                    </div>
                    <div className="mb-1"><DeltaBadge current={row.productivityScore} prev={prev} /></div>
                  </div>
                  <Progress value={row.productivityScore} className="h-2" />
                  <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
                    <div><div className="text-muted-foreground">Done</div><div className="font-semibold">{row.completed}</div></div>
                    <div><div className="text-muted-foreground">On time</div><div className="font-semibold">{Math.round(row.onTimeRate * 100)}%</div></div>
                    <div><div className="text-muted-foreground">Overdue</div><div className="font-semibold text-destructive">{row.overdue}</div></div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Full ranking table */}
          <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
            <ScrollableX>
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-3 font-medium"><Trophy className="h-4 w-4 inline" /> Rank</th>
                    <th className="text-left px-4 py-3 font-medium">Employee</th>
                    <th className="text-right px-4 py-3 font-medium">Total</th>
                    <th className="text-right px-4 py-3 font-medium">Completed</th>
                    <th className="text-right px-4 py-3 font-medium">In Progress</th>
                    <th className="text-right px-4 py-3 font-medium">Overdue</th>
                    <th className="text-right px-4 py-3 font-medium">Completion %</th>
                    <th className="text-right px-4 py-3 font-medium">On-time %</th>
                    <th className="text-right px-4 py-3 font-medium"><Target className="h-4 w-4 inline" /> Score</th>
                    <th className="text-right px-4 py-3 font-medium">vs Last Month</th>
                  </tr>
                </thead>
                <tbody>
                  {performance.map((row, i) => {
                    const emp = empMap[row.employeeId];
                    const prev = prevPerformance[row.employeeId];
                    return (
                      <tr key={row.employeeId} className="border-t hover:bg-muted/30">
                        <td className="px-4 py-3 font-medium">{i + 1}</td>
                        <td className="px-4 py-3">
                          {emp?.name ?? row.employeeId}
                          <div className="text-xs text-muted-foreground">{emp?.department}</div>
                        </td>
                        <td className="px-4 py-3 text-right">{row.total}</td>
                        <td className="px-4 py-3 text-right text-primary font-medium">{row.completed}</td>
                        <td className="px-4 py-3 text-right">{row.inProgress}</td>
                        <td className="px-4 py-3 text-right text-destructive">{row.overdue}</td>
                        <td className="px-4 py-3 text-right">{Math.round(row.completionRate * 100)}%</td>
                        <td className="px-4 py-3 text-right">{Math.round(row.onTimeRate * 100)}%</td>
                        <td className="px-4 py-3 text-right">
                          <div className="inline-flex items-center gap-2">
                            <span className="font-bold text-foreground">{row.productivityScore}</span>
                            <div className="w-16"><Progress value={row.productivityScore} className="h-2" /></div>
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right">
                          <DeltaBadge current={row.productivityScore} prev={prev} />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableX>
          </div>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete task?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && <>This will permanently remove <strong>{confirmDelete.id}</strong>: "{confirmDelete.title}".</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
