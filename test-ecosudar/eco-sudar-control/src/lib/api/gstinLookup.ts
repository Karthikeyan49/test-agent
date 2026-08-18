import { apiFetch } from "./client";

export interface GstinLookupDetails {
  gstin: string;
  company_name: string;
  trade_name: string;
  legal_name: string;
  address: string;
  address_line: string;
  city: string;
  state: string;
  state_code: string;
  pincode: string;
  status: "Active" | "Inactive" | "Unknown";
  is_active: boolean | null;
  seller_state: string;
  tax_type: "IGST" | "CGST+SGST";
  is_inter_state: boolean;
  source: "gst_portal" | "gstin_state_code";
  lookup_status: "ok" | "fallback";
  lookup_error: string;
  remote_status: number;
  remote_type: string;
}

interface Envelope<T> {
  data: T;
}

export async function fetchGstinDetails(gstin: string, sellerState?: string): Promise<GstinLookupDetails> {
  const params = new URLSearchParams({ gstin: gstin.trim().toUpperCase() });
  if (sellerState?.trim()) {
    params.set("seller_state", sellerState.trim());
  }

  const res = await apiFetch<Envelope<GstinLookupDetails>>(`/admin/gst-lookup?${params.toString()}`, {
    skipCache: true,
  });

  return res.data;
}

export function gstinCompanyName(details: Pick<GstinLookupDetails, "company_name" | "trade_name" | "legal_name">): string {
  return details.company_name || details.trade_name || details.legal_name || "";
}
