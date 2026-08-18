/**
 * Tasks & Performance API – mock-mode.
 *
 * Future endpoints:
 *   GET    /api/tasks?assignee&status&priority&from&to
 *   POST   /api/tasks
 *   PATCH  /api/tasks/:id
 *   DELETE /api/tasks/:id
 *   GET    /api/tasks/performance?month=YYYY-MM
 */
import { MOCK_MODE, apiFetch, mockDelay } from "./client";

export type TaskStatus = "Pending" | "In Progress" | "Completed" | "Blocked";
export type TaskPriority = "Low" | "Medium" | "High" | "Critical";

export interface Task {
  id: string;
  title: string;
  description: string;
  assigneeId: string;       // EMP-XXX
  assignedBy: string;
  priority: TaskPriority;
  status: TaskStatus;
  createdAt: string;        // ISO
  dueDate: string;          // YYYY-MM-DD
  completedAt?: string;
  tags: string[];
}

export interface PerformanceRow {
  employeeId: string;
  total: number;
  completed: number;
  inProgress: number;
  pending: number;
  overdue: number;
  onTime: number;
  completionRate: number;   // 0..1
  onTimeRate: number;       // 0..1
  productivityScore: number; // 0..100
}

export const TASK_STATUSES: TaskStatus[] = ["Pending", "In Progress", "Completed", "Blocked"];
export const TASK_PRIORITIES: TaskPriority[] = ["Low", "Medium", "High", "Critical"];

const today = () => new Date().toISOString().slice(0, 10);
const iso = (d: Date) => d.toISOString();
const minus = (days: number) => iso(new Date(Date.now() - days * 86400000));
const plus = (days: number) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

let MOCK_TASKS: Task[] = [
  { id: "TSK-001", title: "Inspect Line A briquette press", description: "Daily QC check on press #2 and log readings.", assigneeId: "EMP-001", assignedBy: "Admin", priority: "High", status: "Completed", createdAt: minus(5), dueDate: plus(-3), completedAt: minus(3), tags: ["QC", "Daily"] },
  { id: "TSK-002", title: "Pellet moisture sampling", description: "Collect 3 samples per shift, record results.", assigneeId: "EMP-002", assignedBy: "Admin", priority: "Medium", status: "In Progress", createdAt: minus(2), dueDate: plus(1), tags: ["QC"] },
  { id: "TSK-003", title: "Dispatch — order ORD-1042", description: "Pack & label 4 tons for GreenLeaf, vehicle TN-45-AB-1234.", assigneeId: "EMP-003", assignedBy: "Admin", priority: "High", status: "Pending", createdAt: minus(1), dueDate: today(), tags: ["Dispatch"] },
  { id: "TSK-004", title: "Sales follow-up — 12 prospects", description: "Call back leads from this week's quote requests.", assigneeId: "EMP-004", assignedBy: "Admin", priority: "Medium", status: "In Progress", createdAt: minus(3), dueDate: plus(2), tags: ["Sales"] },
  { id: "TSK-005", title: "Hammer-mill bearing replacement", description: "Replace worn bearing, log spare consumption.", assigneeId: "EMP-005", assignedBy: "Admin", priority: "Critical", status: "Pending", createdAt: minus(0), dueDate: plus(0), tags: ["Maintenance"] },
  { id: "TSK-006", title: "Weekly QC report", description: "Compile last week's QC findings and email to Admin.", assigneeId: "EMP-002", assignedBy: "Admin", priority: "Low", status: "Completed", createdAt: minus(8), dueDate: plus(-6), completedAt: minus(6), tags: ["Reporting"] },
  { id: "TSK-007", title: "Stock audit — raw materials", description: "Verify cotton stalk, corn cob and wood bark inventory.", assigneeId: "EMP-001", assignedBy: "Admin", priority: "Medium", status: "Pending", createdAt: minus(4), dueDate: plus(-1), tags: ["Audit"] },
  { id: "TSK-008", title: "Customer complaint #C-77", description: "Investigate moisture complaint and respond within SLA.", assigneeId: "EMP-004", assignedBy: "Admin", priority: "High", status: "Blocked", createdAt: minus(6), dueDate: plus(-2), tags: ["Service"] },
  { id: "TSK-009", title: "Retrain new operator", description: "2-hour training on briquette press SOP.", assigneeId: "EMP-001", assignedBy: "Admin", priority: "Low", status: "Completed", createdAt: minus(10), dueDate: plus(-7), completedAt: minus(7), tags: ["Training"] },
  { id: "TSK-010", title: "Loader maintenance", description: "Service loader, top-up hydraulic oil.", assigneeId: "EMP-005", assignedBy: "Admin", priority: "Medium", status: "Completed", createdAt: minus(7), dueDate: plus(-5), completedAt: minus(4), tags: ["Maintenance"] },
];

const nextId = () => `TSK-${String(MOCK_TASKS.length + 1).padStart(3, "0")}`;

export const tasksApi = {
  async list(): Promise<Task[]> {
    if (MOCK_MODE) { await mockDelay(); return [...MOCK_TASKS].sort((a, b) => b.createdAt.localeCompare(a.createdAt)); }
    return (await apiFetch<{data: Task[]}>("/admin/tasks")).data;
  },
  async create(data: Omit<Task, "id" | "createdAt" | "completedAt">): Promise<Task> {
    if (MOCK_MODE) {
      await mockDelay();
      const t: Task = { ...data, id: nextId(), createdAt: iso(new Date()) };
      MOCK_TASKS.unshift(t); return t;
    }
    return (await apiFetch<{data: Task}>("/admin/tasks", { method: "POST", body: JSON.stringify(data) })).data;
  },
  async update(id: string, patch: Partial<Task>): Promise<Task> {
    if (MOCK_MODE) {
      await mockDelay();
      MOCK_TASKS = MOCK_TASKS.map((t) => {
        if (t.id !== id) return t;
        const next = { ...t, ...patch };
        if (patch.status === "Completed" && !next.completedAt) next.completedAt = iso(new Date());
        if (patch.status && patch.status !== "Completed") next.completedAt = undefined;
        return next;
      });
      return MOCK_TASKS.find((t) => t.id === id)!;
    }
    return (await apiFetch<{data: Task}>(`/admin/tasks/${id}`, { method: "PATCH", body: JSON.stringify(patch) })).data;
  },
  async remove(id: string): Promise<void> {
    if (MOCK_MODE) { await mockDelay(); MOCK_TASKS = MOCK_TASKS.filter((t) => t.id !== id); return; }
    await apiFetch<void>(`/admin/tasks/${id}`, { method: "DELETE" });
  },
};

export function computePerformance(tasks: Task[], employeeIds: string[]): PerformanceRow[] {
  const todayStr = today();
  return employeeIds.map((empId) => {
    const own = tasks.filter((t) => t.assigneeId === empId);
    const completed = own.filter((t) => t.status === "Completed");
    const inProgress = own.filter((t) => t.status === "In Progress").length;
    const pending = own.filter((t) => t.status === "Pending" || t.status === "Blocked").length;
    const overdue = own.filter((t) => t.status !== "Completed" && t.dueDate < todayStr).length;
    const onTime = completed.filter((t) => t.completedAt && t.completedAt.slice(0, 10) <= t.dueDate).length;
    const completionRate = own.length ? completed.length / own.length : 0;
    const onTimeRate = completed.length ? onTime / completed.length : 0;
    // Score: 70% completion + 30% punctuality, penalised by overdue ratio
    const overdueRatio = own.length ? overdue / own.length : 0;
    const productivityScore = Math.max(0, Math.round(
      (completionRate * 70 + onTimeRate * 30) * (1 - overdueRatio * 0.4),
    ));
    return {
      employeeId: empId, total: own.length,
      completed: completed.length, inProgress, pending, overdue, onTime,
      completionRate, onTimeRate, productivityScore,
    };
  });
}
