/**
 * Workflow / Traffic Management API
 *
 * A workflow item moves through stages:
 *   Pending → In Progress → Approved → Completed
 * (or → Rejected at any approval gate)
 *
 * Endpoints:
 *   GET    /api/admin/workflows
 *   GET    /api/admin/workflows/:id
 *   POST   /api/admin/workflows
 *   POST   /api/admin/workflows/:id/transition
 *   DELETE /api/admin/workflows/:id
 */
import { apiFetch } from "./client";

export const WORKFLOW_STAGES = ["Pending", "In Progress", "Approved", "Completed", "Rejected"] as const;
export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];

export const WORKFLOW_TYPES = [
  "Purchase Request",
  "Leave Request",
  "Expense Claim",
  "Production Order",
  "Quality Hold Release",
  "Dispatch Approval",
  "Marketing Campaign",
  "Other",
] as const;
export type WorkflowType = (typeof WORKFLOW_TYPES)[number];

export type WorkflowPriority = "Low" | "Medium" | "High" | "Urgent";

export interface WorkflowEvent {
  history_id?: number;
  id?: string;           // For backward compatibility
  workflow_id?: number;
  actor_id?: number;
  actorId?: string;      // For backward compatibility
  actor_name?: string;
  from_stage?: WorkflowStage | null;
  fromStage?: WorkflowStage | null;  // For backward compatibility
  to_stage?: WorkflowStage;
  toStage?: WorkflowStage;  // For backward compatibility
  note?: string;
  created_at?: string;
  at?: string;           // For backward compatibility
}

export interface Workflow {
  workflow_id?: number;
  id?: string;           // For backward compatibility
  title: string;
  type: WorkflowType;
  description?: string;
  requester_id?: number;
  requesterId?: string;  // For backward compatibility
  requester_name?: string;
  approver_id?: number;
  approverId?: string;   // For backward compatibility
  approver_name?: string;
  priority: WorkflowPriority;
  amount?: number;
  due_date?: string;
  dueDate?: string;      // For backward compatibility
  stage: WorkflowStage;
  history?: WorkflowEvent[];
  created_at?: string;
  createdAt?: string;    // For backward compatibility
  updated_at?: string;
  updatedAt?: string;    // For backward compatibility
}

// Helper to normalize workflow data from backend
const normalizeWorkflow = (w: any): Workflow => ({
  ...w,
  id: w.workflow_id?.toString() || w.id,
  requesterId: w.requester_id?.toString() || w.requesterId,
  approverId: w.approver_id?.toString() || w.approverId,
  dueDate: w.due_date || w.dueDate,
  createdAt: w.created_at || w.createdAt,
  updatedAt: w.updated_at || w.updatedAt,
  history: (w.history || []).map((h: any) => ({
    ...h,
    id: h.history_id?.toString() || h.id,
    actorId: h.actor_id?.toString() || h.actorId,
    fromStage: h.from_stage || h.fromStage,
    toStage: h.to_stage || h.toStage,
    at: h.created_at || h.at,
  })),
});

/** Allowed transitions from each stage */
export const ALLOWED_TRANSITIONS: Record<WorkflowStage, WorkflowStage[]> = {
  Pending: ["In Progress", "Approved", "Rejected"],
  "In Progress": ["Approved", "Rejected"],
  Approved: ["Completed", "Rejected"],
  Completed: [],
  Rejected: ["Pending"],
};

export const workflowsApi = {
  async list(): Promise<Workflow[]> {
    const response = await apiFetch<{ success: boolean; data: any[]; pagination?: any }>("/admin/workflows");
    return (response.data || []).map(normalizeWorkflow);
  },
  async getById(id: string): Promise<Workflow> {
    const response = await apiFetch<{ success: boolean; data: any }>(`/admin/workflows/${id}`);
    return normalizeWorkflow(response.data);
  },
  async create(data: Omit<Workflow, "id" | "workflow_id" | "stage" | "history" | "createdAt" | "created_at" | "updatedAt" | "updated_at">): Promise<Workflow> {
    const response = await apiFetch<{ success: boolean; data: any }>("/admin/workflows", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return normalizeWorkflow(response.data);
  },
  async transition(id: string, stage: WorkflowStage, actorId?: string, note?: string): Promise<Workflow> {
    const response = await apiFetch<{ success: boolean; data: any }>(`/admin/workflows/${id}/transition`, {
      method: "POST",
      body: JSON.stringify({ stage, actor_id: actorId, note }),
    });
    return normalizeWorkflow(response.data);
  },
  async remove(id: string): Promise<void> {
    await apiFetch<void>(`/admin/workflows/${id}`, { method: "DELETE" });
  },
};

export const STAGE_COLOR: Record<WorkflowStage, string> = {
  Pending: "bg-amber-500 text-white",
  "In Progress": "bg-blue-600 text-white",
  Approved: "bg-primary text-primary-foreground",
  Completed: "bg-emerald-600 text-white",
  Rejected: "bg-destructive text-destructive-foreground",
};

export const PRIORITY_COLOR: Record<WorkflowPriority, string> = {
  Low: "bg-secondary text-secondary-foreground",
  Medium: "bg-muted text-muted-foreground",
  High: "bg-amber-500 text-white",
  Urgent: "bg-destructive text-destructive-foreground",
};
