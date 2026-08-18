/**
 * SOP (Standard Operating Procedures) API
 *
 * Endpoints:
 *   GET    /api/admin/sops
 *   GET    /api/admin/sops/categories
 *   GET    /api/admin/sops/:id
 *   POST   /api/admin/sops
 *   PUT    /api/admin/sops/:id
 *   DELETE /api/admin/sops/:id
 *   POST   /api/admin/sops/:id/publish
 *   POST   /api/admin/sops/:id/versions
 *   PUT    /api/admin/sops/:id/versions/:versionId/status
 *   GET    /api/admin/sops/:id/versions/:versionId/download
 */
import { apiFetch, BASE_URL, getAuthToken } from "./client";

export const SOP_DEPARTMENTS = [
  "Procurement",
  "Production",
  "Quality Control",
  "Packing",
  "Sales",
  "Marketing",
  "Material Management",
  "HR",
  "Dispatch",
  "Service",
  "Customer Care",
] as const;
export type SopDepartment = (typeof SOP_DEPARTMENTS)[number];

export const SOP_ROLES = ["All Staff", "Managers", "Department Only", "Admin Only"] as const;
export type SopAccessRole = (typeof SOP_ROLES)[number];

export type SopStatus = "Draft" | "Pending Approval" | "Approved" | "Archived";

export interface SopVersion {
  version_id?: number;
  id?: string;           // For backward compatibility
  sop_id?: number;
  version: string;       // "1.0", "1.1", "2.0"
  uploaded_by?: number;
  uploadedBy?: string;   // For backward compatibility
  uploaded_at?: string;
  uploadedAt?: string;   // For backward compatibility
  file_name?: string;
  fileName?: string;     // For backward compatibility
  file_path?: string | null;
  filePath?: string | null;
  file_size?: number;
  fileSize?: number;     // For backward compatibility
  mime_type?: string | null;
  mimeType?: string | null;
  change_log?: string;
  changeLog?: string;    // For backward compatibility
  status: SopStatus;
  approved_by?: number;
  approvedBy?: string;   // For backward compatibility
  approved_at?: string;
  approvedAt?: string;   // For backward compatibility
  uploaded_by_name?: string;
  approved_by_name?: string;
}

export interface Sop {
  sop_id?: number;
  id?: string;           // For backward compatibility
  code: string;          // PROD-001
  title: string;
  department: SopDepartment;
  description?: string;
  owner_id?: number;
  ownerId?: string;      // For backward compatibility
  owner_name?: string;
  ownerName?: string;
  access_role?: SopAccessRole;
  accessRole?: SopAccessRole;  // For backward compatibility
  tags: string[];
  versions?: SopVersion[];
  current_version_id?: number;
  currentVersionId?: string;   // For backward compatibility
  current_version?: string;
  version_status?: SopStatus;
  file_name?: string;
  file_path?: string | null;
  mime_type?: string | null;
  created_at?: string;
  createdAt?: string;    // For backward compatibility
  updated_at?: string;
  updatedAt?: string;    // For backward compatibility
}

export interface SopOwner {
  id: string;
  name: string;
  email?: string;
}

export type CreateSopInput = {
  code: string;
  title: string;
  department: SopDepartment;
  description?: string;
  ownerId?: string;
  accessRole: SopAccessRole;
  tags: string[];
  document?: File | null;
  changeLog?: string;
};

export type UploadSopVersionInput = {
  file: File;
  changeLog: string;
  major: boolean;
};

// Helper to normalize SOP data from backend
const normalizeSop = (s: any): Sop => ({
  ...s,
  id: s.sop_id?.toString() || s.id,
  ownerId: s.owner_id?.toString() || s.ownerId,
  ownerName: s.owner_name || s.ownerName,
  accessRole: s.access_role || s.accessRole || "All Staff",
  currentVersionId: s.current_version_id?.toString() || s.currentVersionId,
  createdAt: s.created_at || s.createdAt,
  updatedAt: s.updated_at || s.updatedAt,
  versions: (s.versions || []).map((v: any) => ({
    ...v,
    id: v.version_id?.toString() || v.id,
    uploadedBy: v.uploaded_by?.toString() || v.uploadedBy,
    uploadedAt: v.uploaded_at || v.uploadedAt,
    fileName: v.file_name || v.fileName,
    filePath: v.file_path || v.filePath,
    fileSize: v.file_size || v.fileSize,
    mimeType: v.mime_type || v.mimeType,
    changeLog: v.change_log || v.changeLog,
    approvedBy: v.approved_by?.toString() || v.approvedBy,
    approvedAt: v.approved_at || v.approvedAt,
  })),
});

function sopFormData(data: CreateSopInput): FormData {
  const form = new FormData();
  form.append("code", data.code);
  form.append("title", data.title);
  form.append("department", data.department);
  form.append("description", data.description ?? "");
  if (data.ownerId) form.append("owner_id", data.ownerId);
  form.append("access_role", data.accessRole);
  form.append("tags", JSON.stringify(data.tags));
  form.append("change_log", data.changeLog || "Initial SOP document upload");
  if (data.document) form.append("document", data.document);
  return form;
}

async function fetchDocument(path: string): Promise<Blob> {
  const token = getAuthToken();
  const headers: Record<string, string> = { "X-Client-Type": "web" };
  if (token) headers.Authorization = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { headers });
  if (!res.ok) {
    if (res.status === 401 && typeof window !== "undefined") {
      window.dispatchEvent(new Event("eco:auth-expired"));
    }
    const text = await res.text().catch(() => res.statusText);
    try {
      const errorJson = JSON.parse(text);
      throw new Error(errorJson.message || `API ${res.status}: ${text}`);
    } catch (error) {
      if (error instanceof Error && !error.message.startsWith("Unexpected token")) {
        throw error;
      }
      throw new Error(`API ${res.status}: ${text}`);
    }
  }
  return res.blob();
}

function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName || "sop-document";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export const sopsApi = {
  async list(): Promise<Sop[]> {
    const response = await apiFetch<{ success: boolean; data: any[]; pagination?: any }>("/admin/sops");
    return (response.data || []).map(normalizeSop);
  },
  async getCategories(): Promise<string[]> {
    const response = await apiFetch<{ success: boolean; data: string[] }>("/admin/sops/categories");
    return Array.isArray(response.data) ? response.data : [];
  },
  async getById(id: string): Promise<Sop> {
    const response = await apiFetch<{ success: boolean; data: any }>(`/admin/sops/${id}`);
    return normalizeSop(response.data);
  },
  async owners(): Promise<SopOwner[]> {
    const response = await apiFetch<{ success: boolean; data: any[] }>("/admin/users?limit=100&user_type=admin");
    return (response.data || []).map((user) => ({
      id: String(user.user_id),
      name: user.name || `User #${user.user_id}`,
      email: user.email,
    }));
  },
  async create(data: CreateSopInput): Promise<Sop> {
    const response = await apiFetch<{ success: boolean; data: any }>("/admin/sops", {
      method: "POST",
      body: data.document
        ? sopFormData(data)
        : JSON.stringify({
            code: data.code,
            title: data.title,
            department: data.department,
            description: data.description ?? "",
            owner_id: data.ownerId || undefined,
            access_role: data.accessRole,
            tags: data.tags,
          }),
    });
    return normalizeSop(response.data);
  },
  async update(id: string, data: Partial<Sop>): Promise<Sop> {
    const response = await apiFetch<{ success: boolean; data: any }>(`/admin/sops/${id}`, {
      method: "PUT",
      body: JSON.stringify(data),
    });
    return normalizeSop(response.data);
  },
  async remove(id: string): Promise<void> {
    await apiFetch<void>(`/admin/sops/${id}`, { method: "DELETE" });
  },
  async publish(id: string): Promise<Sop> {
    const response = await apiFetch<{ success: boolean; data: any }>(`/admin/sops/${id}/publish`, {
      method: "POST",
    });
    return normalizeSop(response.data);
  },
  async addVersion(id: string, data: UploadSopVersionInput): Promise<Sop> {
    const form = new FormData();
    form.append("document", data.file);
    form.append("change_log", data.changeLog);
    form.append("major", data.major ? "1" : "0");
    const response = await apiFetch<{ success: boolean; data: any }>(`/admin/sops/${id}/versions`, {
      method: "POST",
      body: form,
    });
    return normalizeSop(response.data);
  },
  async setVersionStatus(id: string, versionId: string, status: SopStatus): Promise<Sop> {
    const response = await apiFetch<{ success: boolean; data: any }>(`/admin/sops/${id}/versions/${versionId}/status`, {
      method: "PUT",
      body: JSON.stringify({ status }),
    });
    return normalizeSop(response.data);
  },
  async downloadVersion(id: string, versionId: string, fileName: string): Promise<void> {
    const blob = await fetchDocument(`/admin/sops/${id}/versions/${versionId}/download?download=1`);
    downloadBlob(blob, fileName);
  },
};

export const SOP_STATUS_COLOR: Record<SopStatus, string> = {
  Draft: "bg-muted text-muted-foreground",
  "Pending Approval": "bg-amber-500 text-white",
  Approved: "bg-primary text-primary-foreground",
  Archived: "bg-secondary text-secondary-foreground",
};
