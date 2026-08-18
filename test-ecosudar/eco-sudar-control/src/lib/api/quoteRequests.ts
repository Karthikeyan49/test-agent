/**
 * Quote Requests API
 * GET /admin/quote-requests
 * GET /admin/quote-requests/{id}
 * PUT /admin/quote-requests/{id}
 */
import { apiFetch } from "./client";

export type QuoteStatus = "New" | "Contacted" | "Quoted" | "Closed";

export interface QuoteRequest {
  id: string;
  _quoteId: number;
  customerName: string;
  phone: string;
  email: string;
  date: string;
  product: string;
  quantityPerMonth: string;
  currentFuel: string;
  currentCost: string;
  biomassCost: string;
  monthlySavings: string;
  annualSavings: string;
  status: QuoteStatus;
  adminNotes: string;
  quotedPrice: string;
}

interface ApiQuoteRow {
  quote_id: number;
  quote_number: string;
  name: string;
  email: string;
  phone: string | null;
  message: string | null;
  product: string | null;
  quantity_per_month: number | null;
  current_fuel: string | null;
  current_cost: number | null;
  biomass_cost: number | null;
  monthly_savings: number | null;
  annual_savings: number | null;
  admin_notes: string | null;
  quoted_price: string | null;
  status: string;
  created_at: string;
}

interface Paginated<T> { success: boolean; data: T[] }
interface Envelope<T>  { success: boolean; data: T }

function fmtMoney(n: number | null, suffix = ""): string {
  if (n == null) return "";
  return `₹${n.toLocaleString("en-IN")}${suffix}`;
}

function rowToQuote(row: ApiQuoteRow): QuoteRequest {
  return {
    id:               row.quote_number,
    _quoteId:         row.quote_id,
    customerName:     row.name,
    phone:            row.phone || "",
    email:            row.email,
    date:             (row.created_at || "").slice(0, 10),
    product:          row.product || "Biomass Pellets",
    quantityPerMonth: row.quantity_per_month != null ? `${row.quantity_per_month} kg/month` : "",
    currentFuel:      row.current_fuel || "",
    currentCost:      fmtMoney(row.current_cost, "/month"),
    biomassCost:      fmtMoney(row.biomass_cost, "/month"),
    monthlySavings:   fmtMoney(row.monthly_savings, "/month"),
    annualSavings:    fmtMoney(row.annual_savings, "/year"),
    status:           (row.status as QuoteStatus) || "New",
    adminNotes:       row.admin_notes || "",
    quotedPrice:      row.quoted_price || "",
  };
}

export const quoteRequestsApi = {
  async list(): Promise<QuoteRequest[]> {
    const res = await apiFetch<Paginated<ApiQuoteRow>>("/admin/quote-requests?limit=100");
    return (res.data ?? []).map(rowToQuote);
  },

  async update(
    quoteId: number,
    patch: { status: QuoteStatus; adminNotes: string; quotedPrice: string }
  ): Promise<{ email_sent: boolean }> {
    const res = await apiFetch<Envelope<{ quote_id: number; status: string; email_sent: boolean }>>(
      `/admin/quote-requests/${quoteId}`,
      {
        method: "PUT",
        body: JSON.stringify({
          status:       patch.status,
          admin_notes:  patch.adminNotes,
          quoted_price: patch.quotedPrice,
        }),
      }
    );
    return { email_sent: res.data?.email_sent ?? false };
  },
};
