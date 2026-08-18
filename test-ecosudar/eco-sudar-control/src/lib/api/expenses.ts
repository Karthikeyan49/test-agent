/**
 * Expenses API — live backend.
 * Endpoints: /admin/expenses (GET, POST), /admin/expenses/{id} (GET, PUT, DELETE),
 *            /admin/expenses/categories (GET)
 */
import { apiFetch } from "./client";

export const EXPENSE_CATEGORIES = [
  "Office Stationery",
  "Employee Welfare",
  "Salary",
  "Maintenance Spares",
  "Rent",
  "Raw Materials - Wood Powder",
  "Raw Materials - Nappier Grass",
  "Raw Materials - Wood Bark",
  "Raw Materials - Cotton Stalk",
  "Raw Materials - Corn Cob",
  "Other",
] as const;

export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number] | string;

export interface Expense {
  id: string;
  numericId: number;   // expense_id — used for the bill download endpoint
  date: string;
  category: string;
  vendor: string;
  description: string;
  amount: number;
  paymentMode: "Cash" | "Bank Transfer" | "UPI" | "Cheque" | "Card";
  billUrl?: string;
  createdBy: string;
}

interface ApiExpense {
  expense_id: number;
  expense_code: string;
  expense_date: string;
  category: string;
  vendor: string;
  description: string | null;
  amount: number;
  payment_mode: Expense["paymentMode"];
  bill_url: string | null;
  created_by: number | null;
  created_at: string;
  updated_at: string | null;
}

interface PaginatedResponse<T> {
  success: boolean;
  data: T[];
  pagination?: { page: number; limit: number; total: number; total_pages: number };
}

export interface ExpensePagination {
  page: number;
  limit: number;
  total: number;
  total_pages: number;
}

export interface ExpenseListResult {
  items: Expense[];
  pagination: ExpensePagination;
}

export interface ExpenseListParams {
  page?: number;
  limit?: number;
  search?: string;
  category?: string;
  vendor?: string;
  paymentMode?: Expense["paymentMode"];
  from?: string;
  to?: string;
  minAmount?: number;
  maxAmount?: number;
}

export interface ExpenseSummary {
  count: number;
  total: number;
  average: number;
  category_count: number;
  top_category: { name: string; count: number; value: number } | null;
}

function toUI(row: ApiExpense): Expense {
  return {
    id: row.expense_code,
    numericId: row.expense_id,
    date: (row.expense_date || "").slice(0, 10),
    category: row.category,
    vendor: row.vendor,
    description: row.description ?? "",
    amount: Number(row.amount) || 0,
    paymentMode: row.payment_mode,
    billUrl: row.bill_url ?? undefined,
    createdBy: row.created_by ? String(row.created_by) : "admin",
  };
}

function toApi(input: Partial<Omit<Expense, "id" | "createdBy">>) {
  return {
    expense_date: input.date,
    category: input.category,
    vendor: input.vendor,
    description: input.description,
    amount: input.amount,
    payment_mode: input.paymentMode,
    bill_url: input.billUrl,
  };
}

async function idLookup(code: string): Promise<number> {
  const res = await apiFetch<PaginatedResponse<ApiExpense>>(
    `/admin/expenses?search=${encodeURIComponent(code)}&limit=5`
  );
  const row = res.data.find((r) => r.expense_code === code);
  if (!row) throw new Error(`Expense ${code} not found`);
  return row.expense_id;
}

function query(params: ExpenseListParams): string {
  const search = new URLSearchParams();
  search.set("page", String(params.page ?? 1));
  search.set("limit", String(params.limit ?? 200));
  if (params.search) search.set("search", params.search);
  if (params.category && params.category !== "all") search.set("category", params.category);
  if (params.vendor) search.set("vendor", params.vendor);
  if (params.paymentMode) search.set("payment_mode", params.paymentMode);
  if (params.from) search.set("from", params.from);
  if (params.to) search.set("to", params.to);
  if (params.minAmount !== undefined) search.set("min_amount", String(params.minAmount));
  if (params.maxAmount !== undefined) search.set("max_amount", String(params.maxAmount));
  return search.toString();
}

export const expensesApi = {
  async list(params: ExpenseListParams = {}): Promise<ExpenseListResult> {
    const res = await apiFetch<PaginatedResponse<ApiExpense>>(`/admin/expenses?${query(params)}`);
    const pagination = res.pagination ?? {
      page: params.page ?? 1,
      limit: params.limit ?? 200,
      total: res.data?.length ?? 0,
      total_pages: 1,
    };
    return {
      items: (res.data ?? []).map(toUI),
      pagination,
    };
  },
  /** Load one expense by its numeric expense_id (for deep-links, e.g. from a PO). */
  async get(numericId: number): Promise<Expense> {
    const res = await apiFetch<{ success: boolean; data: ApiExpense }>(`/admin/expenses/${numericId}`);
    return toUI(res.data);
  },
  async summary(params: ExpenseListParams = {}): Promise<ExpenseSummary> {
    const res = await apiFetch<{ success: boolean; data: ExpenseSummary }>(`/admin/expenses/summary?${query(params)}`);
    return res.data;
  },
  async create(input: Omit<Expense, "id" | "createdBy">): Promise<Expense> {
    const res = await apiFetch<{ success: boolean; data: ApiExpense }>("/admin/expenses", {
      method: "POST",
      body: JSON.stringify(toApi(input)),
    });
    return toUI(res.data);
  },
  async update(id: string, patch: Partial<Expense>): Promise<Expense> {
    const numericId = await idLookup(id);
    const res = await apiFetch<{ success: boolean; data: ApiExpense }>(`/admin/expenses/${numericId}`, {
      method: "PUT",
      body: JSON.stringify(toApi(patch)),
    });
    return toUI(res.data);
  },
  async remove(id: string): Promise<void> {
    const numericId = await idLookup(id);
    await apiFetch<void>(`/admin/expenses/${numericId}`, { method: "DELETE" });
  },
};
