/**
 * Meetings + RACI API
 *
 * Endpoints:
 *   GET    /api/admin/meetings
 *   GET    /api/admin/meetings/upcoming
 *   GET    /api/admin/meetings/:id
 *   POST   /api/admin/meetings
 *   PUT    /api/admin/meetings/:id
 *   PUT    /api/admin/meetings/:id/attendees
 *   DELETE /api/admin/meetings/:id
 */
import { apiFetch } from "./client";

export type RaciRole = "R" | "A" | "C" | "I" | "-";
export const RACI_ROLES: RaciRole[] = ["R", "A", "C", "I", "-"];

export interface RaciAssignment {
  /** employeeId -> role */
  [employeeId: string]: RaciRole;
}

export type ActionStatus = "Open" | "In Progress" | "Done";

export interface ActionItem {
  id: string;
  description: string;
  ownerId: string;       // EMP-XXX
  dueDate: string;       // YYYY-MM-DD
  status: ActionStatus;
}

export interface Meeting {
  meeting_id?: number;
  id?: string;           // For backward compatibility
  title: string;
  date: string;          // YYYY-MM-DD
  time: string;          // HH:mm
  location?: string;
  agenda?: string;
  notes?: string;
  attendees: string[];   // employeeIds
  /** RACI: outcome/deliverable label -> assignments */
  raci: { id: string; deliverable: string; assignments: RaciAssignment }[];
  action_items?: ActionItem[];
  actionItems?: ActionItem[];  // For backward compatibility
  created_by?: number;
  created_at?: string;
  createdAt?: string;    // For backward compatibility
  updated_at?: string;
}

// Helper to normalize meeting data from backend
const normalizeMeeting = (m: any): Meeting => ({
  ...m,
  id: m.meeting_id?.toString() || m.id,
  actionItems: m.action_items || m.actionItems || [],
  createdAt: m.created_at || m.createdAt,
});

export const meetingsApi = {
  async list(): Promise<Meeting[]> {
    const response = await apiFetch<{ success: boolean; data: any[]; pagination?: any }>("/admin/meetings");
    return (response.data || []).map(normalizeMeeting);
  },
  async upcoming(limit = 10): Promise<Meeting[]> {
    const response = await apiFetch<{ success: boolean; data: any[] }>(`/admin/meetings/upcoming?limit=${limit}`);
    return (response.data || []).map(normalizeMeeting);
  },
  async general(): Promise<Meeting> {
    const response = await apiFetch<{ success: boolean; data: any }>("/admin/meetings/general");
    return normalizeMeeting(response.data);
  },
  async getById(id: string): Promise<Meeting> {
    const response = await apiFetch<{ success: boolean; data: any }>(`/admin/meetings/${id}`);
    return normalizeMeeting(response.data);
  },
  async create(data: Omit<Meeting, "id" | "meeting_id" | "createdAt" | "created_at">): Promise<Meeting> {
    const response = await apiFetch<{ success: boolean; data: any }>("/admin/meetings", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return normalizeMeeting(response.data);
  },
  async update(id: string, data: Partial<Meeting>): Promise<Meeting> {
    const response = await apiFetch<{ success: boolean; data: any }>(`/admin/meetings/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return normalizeMeeting(response.data);
  },
  async updateAttendees(id: string, attendees: string[]): Promise<Meeting> {
    const response = await apiFetch<{ success: boolean; data: any }>(`/admin/meetings/${id}/attendees`, {
      method: "PUT",
      body: JSON.stringify({ attendees }),
    });
    return normalizeMeeting(response.data);
  },
  async remove(id: string): Promise<void> {
    await apiFetch<void>(`/admin/meetings/${id}`, { method: "DELETE" });
  },
};

export const RACI_LABELS: Record<RaciRole, { label: string; color: string }> = {
  R: { label: "Responsible", color: "bg-primary text-primary-foreground" },
  A: { label: "Accountable", color: "bg-blue-600 text-white" },
  C: { label: "Consulted",  color: "bg-amber-500 text-white" },
  I: { label: "Informed",   color: "bg-secondary text-secondary-foreground" },
  "-": { label: "—",        color: "bg-muted text-muted-foreground" },
};
