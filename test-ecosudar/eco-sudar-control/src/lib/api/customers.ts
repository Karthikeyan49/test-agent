import { apiFetch } from "./client";

export interface ApiUser {
  user_id: number;
  name: string;
  email: string;
  phone: string;
  user_type: string;
  city: string | null;
  is_active: boolean;
  created_at: string;
  total_orders: number;
  total_spent: number;
}

export interface ApiUsersResponse {
  success: boolean;
  data: ApiUser[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    total_pages: number;
  };
}

export interface ApiUserOrderStats {
  user_id: number;
  total_orders: number;
  active_orders: number;
  delivered_orders: number;
  cancelled_orders: number;
  returned_orders: number;
  total_spent: number;
}

// Fetch list of customers
export async function fetchCustomers(limit = 100, userType = "customer"): Promise<ApiUser[]> {
  const res = await apiFetch<ApiUsersResponse>(`/admin/users?limit=${limit}&user_type=${userType}`);
  return res.data ?? [];
}

// Fetch per-status order breakdown for one user
export async function fetchCustomerOrderStats(userId: number): Promise<ApiUserOrderStats> {
  const res = await apiFetch<{ success: boolean; data: ApiUserOrderStats }>(
    `/admin/users/${userId}/stats`
  );
  return res.data;
}

export interface CreateCustomerPayload {
  name: string;
  email: string;
  password: string;
  phone: string;
  user_type: "customer" | "dealer";
  city?: string;
  address?: string;
  pincode?: string;
  send_welcome_email?: boolean;
}

export async function createCustomer(payload: CreateCustomerPayload): Promise<ApiUser> {
  const res = await apiFetch<{ success: boolean; data: ApiUser }>("/admin/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  return res.data;
}

// Update active status
export async function updateCustomerStatus(id: number, isActive: boolean): Promise<void> {
  await apiFetch(`/admin/users/${id}/status`, {
    method: "PUT",
    body: JSON.stringify({ is_active: isActive }),
  });
}

function fmt(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

export function mapApiUserToUI(u: ApiUser, stats?: ApiUserOrderStats): any {
  return {
    id: u.user_id,
    name: u.name,
    phone: u.phone,
    email: u.email,
    userType: u.user_type === "dealer" ? "Dealer" : "Customer",
    deliveryAddress: "—",
    city: u.city ?? "—",
    pincode: "—",
    orders: stats?.total_orders ?? u.total_orders,
    lastOrder: "—",
    totalSpent: fmt(stats?.total_spent ?? u.total_spent),
    cancelledOrders: stats?.cancelled_orders ?? 0,
    accountCreatedDate: formatDate(u.created_at),
    activeOrders: stats?.active_orders ?? 0,
    deliveredOrders: stats?.delivered_orders ?? 0,
    returnedOrders: stats?.returned_orders ?? 0,
    isActive: u.is_active,
  };
}
