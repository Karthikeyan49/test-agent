/**
 * Customer ledger API.
 * Endpoint: GET /admin/reports/customer-ledger?customer=<name>&from=&to=
 * Running-balance ledger: invoices are debits, received payments are credits.
 */
import { apiFetch } from "./client";

export interface LedgerRow {
  date: string;
  type: "Invoice" | "Payment";
  reference: string;
  detail: string;
  debit: number;
  credit: number;
  balance: number;
}

interface ApiResponse {
  success: boolean;
  data: {
    customer: string;
    from: string;
    to: string;
    opening_balance: number;
    rows: LedgerRow[];
    count: number;
    total_debit: number;
    total_credit: number;
    closing_balance: number;
  };
}

export const customerLedgerApi = {
  async fetch(customer: string, from: string, to: string): Promise<ApiResponse["data"]> {
    const q = `?customer=${encodeURIComponent(customer)}&from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
    const res = await apiFetch<ApiResponse>("/admin/reports/customer-ledger" + q);
    return (
      res.data ?? {
        customer, from, to, opening_balance: 0, rows: [], count: 0,
        total_debit: 0, total_credit: 0, closing_balance: 0,
      }
    );
  },
};
