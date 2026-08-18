import { apiFetch } from "./client";

export interface ApiDealer {
  user_id: number;
  name: string;
  email: string;
  phone: string;
  alternate_phone: string | null;
  user_type: string;
  company_name: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  pincode: string | null;
  udyam_number: string | null;
  gst_number: string | null;
  is_active: boolean;
  created_at: string;
  total_orders: number;
  total_spent: number;
}

interface ApiDealersResponse {
  success: boolean;
  data: ApiDealer[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface DealerUIModel {
  id: number;
  contactPerson: string;
  businessName: string;
  email: string;
  phone: string;
  udyamNumber: string;
  address: string;
  city: string;
  pincode: string;
  orders: number;
  commission: string;
  status: string;
}

export function mapApiDealerToUI(u: ApiDealer): DealerUIModel {
  return {
    id: u.user_id,
    contactPerson: u.name,
    businessName: u.company_name ?? "—",
    email: u.email.endsWith("@noemail.ecosudar.local") ? "" : u.email,
    phone: u.phone,
    udyamNumber: u.udyam_number ?? "—",
    address: u.address ?? "—",
    city: u.city ?? "—",
    pincode: u.pincode ?? "—",
    orders: u.total_orders,
    commission: `₹${u.total_spent.toLocaleString("en-IN")}`,
    status: u.is_active ? "Active" : "Inactive",
  };
}

export async function fetchDealers(): Promise<ApiDealer[]> {
  const res = await apiFetch<ApiDealersResponse>(
    "/admin/users?user_type=dealer&limit=100"
  );
  return res.data ?? [];
}

export async function createDealer(data: {
  name: string;
  phone: string;
  password: string;
  alternate_phone?: string;
  email?: string;
  company_name?: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  udyam_number?: string;
  gst_number?: string;
}): Promise<ApiDealer> {
  const res = await apiFetch<{ success: boolean; data: ApiDealer }>(
    "/admin/users",
    {
      method: "POST",
      body: JSON.stringify({ ...data, user_type: "dealer" }),
    }
  );
  return res.data;
}

export async function updateDealer(
  id: number,
  data: {
    name?: string;
    email?: string;
    phone?: string;
    alternate_phone?: string;
    company_name?: string;
    address?: string;
    city?: string;
    state?: string;
    pincode?: string;
    udyam_number?: string;
    gst_number?: string;
    new_password?: string;
  }
): Promise<void> {
  await apiFetch(`/admin/users/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteDealer(id: number): Promise<void> {
  await apiFetch(`/admin/users/${id}`, { method: "DELETE" });
}
