/**
 * Customer Queries API
 * GET /admin/queries
 * GET /admin/queries/{id}
 * PUT /admin/queries/{id}/reply
 */
import { apiFetch } from "./client";

export type QueryStatus = "New" | "In Progress" | "Resolved";

export interface Query {
  id: string;
  _queryId: number;
  name: string;
  email: string;
  message: string;
  date: string;
  status: QueryStatus;
  adminReply: string;
}

interface ApiQueryRow {
  query_id: number;
  query_number: string;
  name: string;
  email: string;
  message: string;
  admin_reply: string | null;
  status: string;
  created_at: string;
}

interface Paginated<T> { success: boolean; data: T[] }
interface Envelope<T>  { success: boolean; data: T }

function rowToQuery(row: ApiQueryRow): Query {
  return {
    id:         row.query_number,
    _queryId:   row.query_id,
    name:       row.name,
    email:      row.email,
    message:    row.message,
    date:       (row.created_at || "").slice(0, 10),
    status:     (row.status as QueryStatus) || "New",
    adminReply: row.admin_reply || "",
  };
}

export const queriesApi = {
  async list(): Promise<Query[]> {
    const res = await apiFetch<Paginated<ApiQueryRow>>("/admin/queries?limit=100");
    return (res.data ?? []).map(rowToQuery);
  },

  async reply(queryId: number, adminReply: string, status: QueryStatus): Promise<void> {
    await apiFetch<Envelope<unknown>>(`/admin/queries/${queryId}/reply`, {
      method: "PUT",
      body: JSON.stringify({ admin_reply: adminReply, status }),
    });
  },
};
