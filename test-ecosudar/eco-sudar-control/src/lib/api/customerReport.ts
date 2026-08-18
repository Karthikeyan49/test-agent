/**
 * Customer-wise report API.
 * Endpoint: GET /admin/reports/customers?from=YYYY-MM-DD&to=YYYY-MM-DD
 * Returns one aggregated row per customer, each with its own invoice breakdown.
 */
import { apiFetch } from "./client";

export interface CustomerReportInvoice {
  invoice_number: string;
  date: string;
  total: number;
  paid: number;
  balance: number;
  status: string;
}

export interface CustomerReportRow {
  customer: string;
  gstin: string;
  state: string;
  invoice_count: number;
  total_invoiced: number;
  total_paid: number;
  outstanding: number;
  first_invoice: string;
  last_invoice: string;
  invoices: CustomerReportInvoice[];
}

export interface CustomerReportTotals {
  customers: number;
  total_invoiced: number;
  total_paid: number;
  outstanding: number;
}

interface ApiResponse {
  success: boolean;
  data: {
    from: string;
    to: string;
    rows: CustomerReportRow[];
    count: number;
    totals: CustomerReportTotals;
  };
}

export const customerReportApi = {
  async fetch(from: string, to: string): Promise<ApiResponse["data"]> {
    const q = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await apiFetch<ApiResponse>("/admin/reports/customers" + q);
    return (
      res.data ?? {
        from,
        to,
        rows: [],
        count: 0,
        totals: { customers: 0, total_invoiced: 0, total_paid: 0, outstanding: 0 },
      }
    );
  },
};
