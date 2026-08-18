import { apiFetch } from "./client";

export type GstStatus = "draft" | "reviewed" | "filed" | "locked";

/** Live-computed figures for a period (from invoices + purchase orders). */
export interface GstCalc {
  period_key: string;
  from_date: string;
  to_date: string;
  invoice_count: number;
  purchase_count: number;
  sales_taxable: number;
  sales_cgst: number;
  sales_sgst: number;
  sales_igst: number;
  output_tax: number;
  input_tax: number;
  net_payable: number;
  credit_carried: number;
}

/** A saved/filed snapshot row from gst_compliance_periods. */
export interface GstPeriod {
  period_id: number;
  id: string;
  period_key: string;
  from_date: string;
  to_date: string;
  sales_taxable: number;
  sales_cgst: number;
  sales_sgst: number;
  sales_igst: number;
  output_tax: number;
  input_tax: number;
  net_payable: number;
  status: GstStatus;
  filed_on: string | null;
  reference_no: string | null;
  notes: string | null;
  locked_by: number | null;
  locked_at: string | null;
}

export interface GstB2bRow {
  invoice_id: number;
  invoice_number: string;
  invoice_date: string | null;
  customer_name: string;
  customer_gstin: string;
  customer_state: string;
  taxable: number;
  cgst_amount: number;
  sgst_amount: number;
  igst_amount: number;
  total: number;
}

export interface GstHsnRow {
  hsn_code: string;
  gst_rate: number;
  quantity: number;
  taxable: number;
  tax_amount: number;
}

export interface GstExport {
  period: GstCalc;
  gstr1_b2b: GstB2bRow[];
  hsn_summary: GstHsnRow[];
}

interface Envelope<T> { success: boolean; data: T; message?: string }
interface Paginated<T> { success: boolean; data: T[]; pagination: { page: number; limit: number; total: number; total_pages: number } }

/** Current month as YYYY-MM. */
export const currentPeriod = (): string => new Date().toISOString().slice(0, 7);

export const gstComplianceApi = {
  async history(limit = 24): Promise<GstPeriod[]> {
    const res = await apiFetch<Paginated<GstPeriod>>(`/admin/gst-compliance?limit=${limit}`);
    return res.data ?? [];
  },
  async calculate(period: string): Promise<GstCalc> {
    const res = await apiFetch<Envelope<GstCalc>>(`/admin/gst-compliance/calculate?period=${period}`);
    return res.data;
  },
  async detail(period: string): Promise<{ saved: GstPeriod | null; calculated: GstCalc }> {
    const res = await apiFetch<Envelope<{ saved: GstPeriod | null; calculated: GstCalc }>>(`/admin/gst-compliance/${period}`);
    return res.data;
  },
  async save(period: string): Promise<GstPeriod> {
    const res = await apiFetch<Envelope<GstPeriod>>(`/admin/gst-compliance/${period}/save`, { method: "POST" });
    return res.data;
  },
  async review(period: string, notes?: string): Promise<GstPeriod> {
    const res = await apiFetch<Envelope<GstPeriod>>(`/admin/gst-compliance/${period}/review`, {
      method: "POST", body: JSON.stringify({ notes }),
    });
    return res.data;
  },
  async file(period: string, payload: { filed_on?: string; reference_no?: string; notes?: string }): Promise<GstPeriod> {
    const res = await apiFetch<Envelope<GstPeriod>>(`/admin/gst-compliance/${period}/file`, {
      method: "POST", body: JSON.stringify(payload),
    });
    return res.data;
  },
  async lock(period: string): Promise<GstPeriod> {
    const res = await apiFetch<Envelope<GstPeriod>>(`/admin/gst-compliance/${period}/lock`, { method: "POST" });
    return res.data;
  },
  async export(period: string): Promise<GstExport> {
    const res = await apiFetch<Envelope<GstExport>>(`/admin/gst-compliance/${period}/export`);
    return res.data;
  },
};
