import { apiFetch } from "@/lib/api/client";

export type CompanyProfile = {
  name: string; subtitle: string; gstin: string;
  logo: string;
  primaryColor: string;
  email: string; phone: string; address: string;
  bankName: string; bankAccount: string; bankIfsc: string; bankBranch: string;
};

const FALLBACK: CompanyProfile = {
  name: "Eco Sudar", subtitle: "Bio Energy LLP", logo: "", primaryColor: "#2ea0da", gstin: "", email: "", phone: "", address: "",
  bankName: "", bankAccount: "", bankIfsc: "", bankBranch: "",
};

let cache: CompanyProfile | null = null;

type Env = { success: boolean; data: any };

export async function loadCompanyProfile(): Promise<CompanyProfile> {
  try {
    const r = await apiFetch<Env>("/admin/settings");
    const d = r.data ?? {};
    cache = {
      name: d.company_name || "Eco Sudar",
      subtitle: d.company_subtitle || "",
      logo: d.company_logo || "",
      primaryColor: d.company_primary_color || "#2ea0da",
      gstin: d.gstin || "",
      email: d.company_email || "",
      phone: d.company_phone || "",
      address: d.company_address || "",
      bankName: d.company_bank_name || "",
      bankAccount: d.company_bank_account || "",
      bankIfsc: d.company_bank_ifsc || "",
      bankBranch: d.company_bank_branch || "",
    };
  } catch {
    cache = cache ?? FALLBACK;
  }
  return cache;
}

export function getCompanyProfile(): CompanyProfile {
  return cache ?? FALLBACK;
}
