/**
 * Monthly report API.
 * Endpoint: GET /admin/reports/monthly?from=YYYY-MM-DD&to=YYYY-MM-DD
 * One row per calendar month: invoiced, collected, expenses, net.
 */
import { apiFetch } from "./client";

export interface MonthlyRow {
  month: string; // YYYY-MM
  label: string; // "Aug 2026"
  invoices: number;
  invoiced: number;
  collected: number;
  expenses: number;
  net: number;
}

export interface MonthlyTotals {
  invoiced: number;
  collected: number;
  expenses: number;
  net: number;
  invoices: number;
}

interface ApiResponse {
  success: boolean;
  data: { from: string; to: string; rows: MonthlyRow[]; count: number; totals: MonthlyTotals };
}

export const monthlyReportApi = {
  async fetch(from: string, to: string): Promise<ApiResponse["data"]> {
    const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await apiFetch<ApiResponse>("/admin/reports/monthly" + q);
    return res.data ?? { from, to, rows: [], count: 0, totals: { invoiced: 0, collected: 0, expenses: 0, net: 0, invoices: 0 } };
  },
};
