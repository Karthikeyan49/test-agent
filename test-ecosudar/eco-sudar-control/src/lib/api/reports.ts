/**
 * Reports API — live backend.
 * Endpoint: GET /admin/reports?module=<key>&from=YYYY-MM-DD&to=YYYY-MM-DD
 */
import { apiFetch } from "./client";

export type ReportModule = "sales" | "orders" | "payments" | "expenses" | "production" | "forecast";

export interface ReportRow {
  date: string;
  reference: string;
  category: string;
  party: string;
  amount: number;
  status: string;
}

interface ApiResponse {
  success: boolean;
  data: {
    module: ReportModule;
    from: string;
    to: string;
    rows: ReportRow[];
    total: number;
    count: number;
  };
}

export const reportsApi = {
  async fetch(module: ReportModule, from: string, to: string): Promise<ReportRow[]> {
    const q = `?module=${encodeURIComponent(module)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await apiFetch<ApiResponse>("/admin/reports" + q);
    return res.data?.rows ?? [];
  },
};
