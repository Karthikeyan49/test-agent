import { MOCK_MODE, apiFetch, mockDelay } from "./client";

export interface OverviewStats {
  orders: { total: number; revenue: number; pending: number; cancelled: number };
  users: { total: number; active: number };
  products: number;
  employees: number;
  tasks: { total: number; pending: number; inProgress: number; completed: number; overdue: number };
}

export interface DailyOrder { order_date: string; order_count: number; revenue: number }
export interface TopProduct { product_name: string; total_quantity: number; times_ordered: number; total_revenue: number }

export interface OrderStats {
  summary: Record<string, number>;
  daily: DailyOrder[];
  top_products: TopProduct[];
}

export interface ActiveOrder {
  order_id: number;
  order_number: string;
  order_status: string;
  payment_status: string;
  total_amount: number;
  created_at: string;
  customer_name: string;
  email: string;
  phone: string;
  total_items: number;
}

export interface ActiveOrdersResponse {
  summary: Record<string, number>;
  orders: ActiveOrder[];
}

// ─── Mock data (used when MOCK_MODE = true) ───────────────────────────────────

const MOCK_OVERVIEW: OverviewStats = {
  orders:    { total: 156, revenue: 620000, pending: 14, cancelled: 12 },
  users:     { total: 234, active: 218 },
  products:  48,
  employees: 5,
  tasks:     { total: 24, pending: 8, inProgress: 6, completed: 9, overdue: 1 },
};

const MOCK_ORDER_STATS: OrderStats = {
  summary: { total_orders: 156, total_revenue: 620000, avg_order_value: 3974, today_orders: 8, week_orders: 41, month_orders: 156 },
  daily: [
    { order_date: "2026-01-01", order_count: 18, revenue: 90000 },
    { order_date: "2026-02-01", order_count: 22, revenue: 140000 },
    { order_date: "2026-03-01", order_count: 28, revenue: 195000 },
    { order_date: "2026-04-01", order_count: 35, revenue: 220000 },
    { order_date: "2026-05-01", order_count: 31, revenue: 185000 },
    { order_date: "2026-06-01", order_count: 22, revenue: 132000 },
  ],
  top_products: [
    { product_name: "Pellets 6mm",          total_quantity: 42, times_ordered: 42, total_revenue: 168000 },
    { product_name: "Pellets 8mm",          total_quantity: 31, times_ordered: 31, total_revenue: 124000 },
    { product_name: "Biomass Stove Medium", total_quantity: 18, times_ordered: 18, total_revenue: 72000  },
    { product_name: "Biomass Burner 100kW", total_quantity: 12, times_ordered: 12, total_revenue: 48000  },
    { product_name: "Pellets 10mm",         total_quantity: 9,  times_ordered: 9,  total_revenue: 36000  },
  ],
};

const MOCK_ACTIVE_ORDERS: ActiveOrdersResponse = {
  summary: { total_active: 6, pending: 2, confirmed: 1, processing: 1, shipped: 2 },
  orders: [
    { order_id: 1, order_number: "ORD-2024-001", order_status: "confirmed",  payment_status: "paid",    total_amount: 15250, created_at: "2026-04-22T10:00:00Z", customer_name: "Green Industries Ltd", email: "", phone: "", total_items: 2 },
    { order_id: 2, order_number: "ORD-2024-002", order_status: "shipped",    payment_status: "paid",    total_amount: 18000, created_at: "2026-04-21T12:00:00Z", customer_name: "EcoHeat Solutions",    email: "", phone: "", total_items: 1 },
    { order_id: 3, order_number: "ORD-2024-003", order_status: "shipped",    payment_status: "paid",    total_amount: 49200, created_at: "2026-04-20T09:00:00Z", customer_name: "Biomass Trading Co",   email: "", phone: "", total_items: 1 },
    { order_id: 4, order_number: "ORD-2024-004", order_status: "pending",    payment_status: "pending", total_amount: 13970, created_at: "2026-04-19T14:00:00Z", customer_name: "Rural Energy Hub",     email: "", phone: "", total_items: 2 },
    { order_id: 5, order_number: "ORD-2024-006", order_status: "processing", payment_status: "paid",    total_amount: 4930,  created_at: "2026-04-18T11:00:00Z", customer_name: "Kavitha R",            email: "", phone: "", total_items: 1 },
    { order_id: 6, order_number: "ORD-2024-007", order_status: "confirmed",  payment_status: "pending", total_amount: 31500, created_at: "2026-04-17T16:00:00Z", customer_name: "Mohan Das",            email: "", phone: "", total_items: 1 },
  ],
};

// ─── API ─────────────────────────────────────────────────────────────────────

export const statisticsApi = {
  async overview(): Promise<OverviewStats> {
    if (MOCK_MODE) { await mockDelay(); return MOCK_OVERVIEW; }
    return (await apiFetch<{data: OverviewStats}>("/statistics/overview")).data;
  },

  async orders(): Promise<OrderStats> {
    if (MOCK_MODE) { await mockDelay(); return MOCK_ORDER_STATS; }
    return (await apiFetch<{data: OrderStats}>("/statistics/orders")).data;
  },

  async activeOrders(): Promise<ActiveOrdersResponse> {
    if (MOCK_MODE) { await mockDelay(); return MOCK_ACTIVE_ORDERS; }
    return (await apiFetch<{data: ActiveOrdersResponse}>("/statistics/active-orders")).data;
  },
};
