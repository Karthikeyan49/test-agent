import { apiFetch } from "./client";

// ── Types ──────────────────────────────────────────────────────────────────

export interface ApiOrderItem {
  item_id: number;
  product_id: number;
  config_id: number | null;
  quantity: number;
  unit_price: number;
  total_price: number;
  size: string | null;
  purpose: string | null;
  sub_purpose: string | null;
  product_name: string;
  product_type: string;
}

export interface ApiOrder {
  order_id: number;
  order_number: string;
  total_amount: number;
  delivery_fee: number;
  order_status: string;
  payment_status: string;
  payment_method: string | null;
  tracking_number: string | null;
  cancel_reason: string | null;
  refund_status: "N/A" | "Initiated" | "Processed" | null;
  delivery_address: string | null;
  delivery_city: string | null;
  delivery_state: string | null;
  delivery_pincode: string | null;
  notes: string | null;
  created_at: string;
  customer_name: string;
  email: string;
  phone: string;
  company_name?: string | null;
  total_items: number;
  items?: ApiOrderItem[];
}

// ── Fetch list (admin — all orders) ───────────────────────────────────────

export async function fetchOrders(limit = 100): Promise<ApiOrder[]> {
  const res = await apiFetch<{ data: ApiOrder[] }>(`/orders?limit=${limit}`);
  return res.data ?? [];
}

// ── Fetch single order with full items ────────────────────────────────────

export async function fetchOrder(id: number): Promise<ApiOrder> {
  const res = await apiFetch<{ data: ApiOrder }>(`/orders/${id}`);
  return res.data;
}

// ── Update status (+ optional tracking_number / cancel_reason) ────────────

export async function updateOrderStatus(
  id: number,
  status: string,
  extra?: { tracking_number?: string; cancel_reason?: string }
): Promise<{ invoice_generated?: boolean; invoice_number?: string }> {
  const res = await apiFetch<{ data?: { invoice_generated?: boolean; invoice_number?: string } }>(
    `/orders/${id}/status`,
    { method: "PUT", body: JSON.stringify({ order_status: status, ...extra }) }
  );
  return res.data ?? {};
}

export async function updateOrderPayment(id: number, paymentMethod: string): Promise<void> {
  await apiFetch(`/orders/${id}/payment`, {
    method: "PUT",
    body: JSON.stringify({ payment_method: paymentMethod.toLowerCase().replace(/ /g, "_") }),
  });
}

export async function updateOrderPaymentStatus(id: number, paymentStatus: string): Promise<{
  invoice_generated?: boolean; invoice_number?: string;
}> {
  const res = await apiFetch<{ data?: { invoice_generated?: boolean; invoice_number?: string } }>(
    `/orders/${id}/payment-status`,
    { method: "PUT", body: JSON.stringify({ payment_status: paymentStatus.toLowerCase() }) }
  );
  return res.data ?? {};
}

export async function updateOrderRefundStatus(id: number, refundStatus: string): Promise<void> {
  await apiFetch(`/orders/${id}/refund-status`, {
    method: "PUT",
    body: JSON.stringify({ refund_status: refundStatus }),
  });
}

export interface CreateOrderItem {
  product_id: number;
  config_id?: number | null;
  quantity: number;
  unit_price: number;
  size?: string;
  purpose?: string;
  sub_purpose?: string;
}

export interface CreateOrderPayload {
  customer_id: number;
  items: CreateOrderItem[];
  delivery_address?: string;
  delivery_city?: string;
  delivery_state?: string;
  delivery_pincode?: string;
  payment_method?: string;
  notes?: string;
  delivery_fee?: number;
}

export async function createOrder(payload: CreateOrderPayload): Promise<{ order_id: number; order_number: string }> {
  const res = await apiFetch<{ success: boolean; data: { order_id: number; order_number: string } }>(
    "/admin/orders",
    { method: "POST", body: JSON.stringify(payload) }
  );
  return res.data;
}

export async function generateInvoice(orderId: number): Promise<{ invoice_number: string }> {
  const res = await apiFetch<{ data: { invoice_number: string } }>("/admin/invoices", {
    method: "POST",
    body: JSON.stringify({ order_id: orderId }),
  });
  return res.data;
}

// ── Map API → UI Order shape ───────────────────────────────────────────────

import type { Order, OrderItem } from "@/pages/Orders";

function fmt(amount: number): string {
  return `₹${amount.toLocaleString("en-IN")}`;
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}/${d.getFullYear()}`;
}

export function mapApiOrderToUI(o: ApiOrder, items: ApiOrderItem[]): Order {
  const subtotal = o.total_amount - o.delivery_fee;
  const gst = Math.round(subtotal * 0.18 * 100) / 100;

  const uiItems: OrderItem[] = items.map(item => ({
    product: item.product_name,
    size: item.size ?? "—",
    quantity: String(item.quantity),
    unitPrice: fmt(item.unit_price),
    subtotal: fmt(item.total_price),
    purpose: item.purpose ?? "—",
  }));

  const isDealer = !!o.company_name;

  return {
    id: o.order_number,
    _orderId: o.order_id,
    items: uiItems,
    deliveryAddress: {
      name: o.customer_name,
      phone: o.phone,
      address: o.delivery_address ?? "",
      landmark: "",
      city: o.delivery_city ?? "",
      state: o.delivery_state ?? "",
      pincode: o.delivery_pincode ?? "",
      addressType: "Other",
      preferredDate: "",
      preferredTimeSlot: "",
      deliveryInstructions: o.notes ?? "",
    },
    date: formatDate(o.created_at),
    status: capitalize(o.order_status),
    customer: {
      name: o.customer_name,
      phone: o.phone,
      email: o.email,
      type: isDealer ? "Dealer" : "Customer",
      businessName: o.company_name ?? undefined,
      address: o.delivery_address ?? undefined,
      city: o.delivery_city ?? undefined,
      pincode: o.delivery_pincode ?? undefined,
      deliveryAddress: o.delivery_address ?? undefined,
    },
    trackingNumber: o.tracking_number ?? "",
    paymentMethod:  capitalizePay(o.payment_method),
    paymentStatus:  o.payment_status ?? "pending",
    cancelReason:   o.cancel_reason ?? "",
    refundStatus:   (o.refund_status ?? "N/A") as Order["refundStatus"],
    subtotal: fmt(subtotal),
    gstAmount: fmt(gst),
    deliveryFee: fmt(o.delivery_fee),
    discount: fmt(0),
    grandTotal: fmt(o.total_amount),
  };
}

function capitalize(s: string): string {
  if (!s) return "Pending";
  return s.replace(/\b\w/g, c => c.toUpperCase());
}

function capitalizePay(s: string | null): string {
  if (!s || s === "pending") return "Pending";
  const map: Record<string, string> = {
    cod: "COD", upi: "UPI", online: "Online",
    "net_banking": "Net Banking", wallet: "Wallet",
  };
  return map[s.toLowerCase()] ?? capitalize(s);
}
