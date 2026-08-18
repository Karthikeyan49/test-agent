import { apiFetch, BASE_URL } from "@/lib/api/client";

export interface Document {
  id: number;
  file_name: string;
  file_type: string;
  file_size?: number;
  created_at: string;
}

export const documentApi = {
  get:         (id: number) => apiFetch<{ data: Document }>(`/admin/documents/${id}`),
  downloadUrl: (id: number) => `${BASE_URL}/admin/documents/${id}/download`,
  delete:      (id: number) => apiFetch<void>(`/admin/documents/${id}`, { method: "DELETE" }),
};
