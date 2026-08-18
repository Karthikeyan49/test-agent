/**
 * Finance API — live backend.
 * Endpoints:
 *   GET /admin/finance/pnl?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET /admin/finance/ratios?from=YYYY-MM-DD&to=YYYY-MM-DD
 *   GET /admin/finance/config
 *   PUT /admin/finance/config
 */
import { apiFetch } from "./client";

export interface MonthlyPoint {
  month: string;
  revenue: number;
  expenses: number;
  profit: number;
}

export interface ExpenseSlice {
  category: string;
  amount: number;
}

export interface PnLSummary {
  periodFrom: string;
  periodTo: string;
  revenue: number;
  expenses: number;
  grossProfit: number;
  netProfit: number;
  taxes: number;
  monthly: MonthlyPoint[];
  expenseBreakdown: ExpenseSlice[];
  revenueBreakdown: { source: string; amount: number }[];
}

export interface FinancialRatios {
  profitMargin: number;
  expenseRatio: number;
  roi: number;
  currentRatio: number;
  grossMargin: number;
  operatingMargin: number;
  currentAssets: number;
  currentLiabilities: number;
  investment: number;
}

export interface FinanceConfig {
  [key: string]: { value: number; notes: string | null };
}

interface ApiEnvelope<T> { success: boolean; data: T }

function buildQuery(params?: { from?: string; to?: string }): string {
  if (!params) return "";
  const parts: string[] = [];
  if (params.from) parts.push(`from=${encodeURIComponent(params.from)}`);
  if (params.to)   parts.push(`to=${encodeURIComponent(params.to)}`);
  return parts.length ? "?" + parts.join("&") : "";
}

export interface FinanceAiAnalysis {
  period: { from: string; to: string };
  health_score: number;
  headline: string;
  summary: string;
  drivers: string[];
  risks: string[];
  recommendations: string[];
  outlook: string;
  figures?: Record<string, unknown>;
  generated_at: string;
}

export interface CashFlow {
  from: string;
  to: string;
  inflow: number;
  outflow: number;
  net: number;
  payments_in: number;
  payments_out: number;
  operating_expenses: number;
  invoice_collections: number;
  series: { month: string; inflow: number; outflow: number }[];
  expense_categories: { category: string; amount: number }[];
}

export interface AgeingSummary {
  as_of: string;
  current: number;
  days_1_30: number;
  days_31_60: number;
  days_61_90: number;
  days_over_90: number;
  total_due: number;
}

export interface ReceivableRow {
  invoice_id: number;
  invoice_number: string;
  customer_name: string;
  due_on: string;
  total: number;
  amount_paid: number;
  balance_due: number;
  days_overdue: number;
}

export interface PayableRow {
  po_id: number;
  po_number: string;
  vendor_name: string;
  order_date: string;
  total: number;
  paid: number;
  balance_due: number;
  days_overdue: number;
}

export const financeApi = {
  async cashFlow(params?: { from?: string; to?: string }): Promise<CashFlow> {
    const res = await apiFetch<ApiEnvelope<CashFlow>>("/admin/finance/cash-flow" + buildQuery(params));
    return res.data;
  },
  async receivables(asOf?: string): Promise<{ summary: AgeingSummary; rows: ReceivableRow[] }> {
    const res = await apiFetch<ApiEnvelope<{ summary: AgeingSummary; rows: ReceivableRow[] }>>(
      "/admin/receivables/ageing" + (asOf ? `?as_of=${asOf}` : ""),
    );
    return res.data;
  },
  async payables(asOf?: string): Promise<{ summary: AgeingSummary; rows: PayableRow[] }> {
    const res = await apiFetch<ApiEnvelope<{ summary: AgeingSummary; rows: PayableRow[] }>>(
      "/admin/finance/payables" + (asOf ? `?as_of=${asOf}` : ""),
    );
    return res.data;
  },
  async aiAnalysis(params?: { from?: string; to?: string }): Promise<FinanceAiAnalysis> {
    const res = await apiFetch<ApiEnvelope<FinanceAiAnalysis>>(
      "/admin/finance/ai-analysis" + buildQuery(params),
      { method: "POST", body: JSON.stringify({}) },
    );
    return res.data;
  },
  async pnl(params?: { from?: string; to?: string }): Promise<PnLSummary> {
    const res = await apiFetch<ApiEnvelope<PnLSummary>>("/admin/finance/pnl" + buildQuery(params));
    return res.data;
  },
  async ratios(params?: { from?: string; to?: string }): Promise<FinancialRatios> {
    const res = await apiFetch<ApiEnvelope<FinancialRatios>>("/admin/finance/ratios" + buildQuery(params));
    return res.data;
  },
  async config(): Promise<FinanceConfig> {
    const res = await apiFetch<ApiEnvelope<FinanceConfig>>("/admin/finance/config");
    return res.data;
  },
  async updateConfig(patch: Partial<Record<"investment" | "current_assets" | "current_liabilities" | "tax_rate" | "opex_tax_portion", number>>): Promise<void> {
    await apiFetch("/admin/finance/config", {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  },
};
