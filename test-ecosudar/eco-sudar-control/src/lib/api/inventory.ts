import { apiFetch } from "./client";

interface Envelope<T> { success: boolean; data: T; message?: string }

export interface RawMaterial {
  raw_material_id: number;
  name: string;
  unit: string;
  current_stock: number;
  reorder_level: number;
  supplier: string | null;
  is_active: boolean;
  low_stock: boolean;
}

export interface ConsumptionLine { raw_material_id: number; name?: string; quantity: number; unit?: string }
export interface SpareConsumptionLine { spare_id: number; name?: string; quantity: number; unit?: string }
export interface OutputLine { product_id: number; product_name?: string; quantity: number; unit?: string }

export interface ProductionQuality {
  moisture_pct: number | null;
  ash_pct: number | null;
  gcv: number | null;
  fines_pct: number | null;
  diameter_mm: number | null;
  durability_pct: number | null;
  result: "pass" | "fail" | "pending";
  inspector: string | null;
  notes: string | null;
  checked_at?: string;
}

export interface ProductionRun {
  run_id: number;
  run_date: string;
  product_id: number;
  product_name: string;
  batch_number: string | null;
  output_quantity: number;
  unit: string;
  shift: "day" | "night" | "general";
  operator_name: string | null;
  notes: string | null;
  created_at?: string;
  consumption: ConsumptionLine[];
  spare_consumption: SpareConsumptionLine[];
  outputs: OutputLine[];
  quality: ProductionQuality | null;
}

export interface StockItem {
  product_id: number;
  product_name: string;
  product_type: string;
  category: string;
  unit: string;
  stock_quantity: number;
  reorder_level: number;
  base_price: number;
  stock_value: number;
  low_stock: boolean;
}

export interface SpareAsset {
  spare_id: number;
  name: string;
  category: string | null;
  unit: string;
  current_stock: number;
  reorder_level: number;
  location: string | null;
  is_active: boolean;
  low_stock: boolean;
}

export interface CategoryStock {
  category: string;
  sku_count: number;
  total_stock: number;
  stock_value: number;
  low_count: number;
}

export interface Movement {
  kind: "finished" | "raw" | "spare";
  movement_type: "in" | "out" | "adjust";
  source?: string;
  quantity: number;
  reference: string | null;
  notes: string | null;
  movement_date: string;
  created_at?: string;
  // finished
  stock_movement_id?: number;
  product_id?: number;
  product_name?: string;
  // raw
  movement_id?: number;
  raw_material_id?: number;
  material_name?: string;
  // spare
  spare_id?: number;
  spare_name?: string;
}

export interface Suggestion {
  kind: "raw" | "finished";
  id: number;
  name: string;
  category?: string;
  unit: string;
  current: number;
  reorder_level: number;
  suggested_order: number;
}

export interface InventoryOverview {
  raw_materials: { count: number; low_stock: number };
  finished_goods: { sku_count: number; total_stock: number; stock_value: number; low_stock: number };
  production: { runs_7d: number; output_7d: number; runs_30d: number; output_30d: number };
  trend: { date: string; output: number }[];
  category_stock: CategoryStock[];
  recent_movements: Movement[];
  suggestions: Suggestion[];
}

export interface MovementInput {
  movement_type: "in" | "out" | "adjust";
  quantity: number;
  reference?: string;
  notes?: string;
  movement_date?: string;
  source?: string;
}

export interface ProductionInput {
  run_date?: string;
  batch_number?: string;
  shift?: "day" | "night" | "general";
  operator_name?: string;
  notes?: string;
  outputs?: { product_id: number; quantity: number; unit?: string }[];
  consumption?: { raw_material_id: number; quantity: number }[];
  spare_consumption?: { spare_id: number; quantity: number }[];
  quality?: Partial<Omit<ProductionQuality, "checked_at">>;
}

export const inventoryApi = {
  overview: () => apiFetch<Envelope<InventoryOverview>>("/admin/inventory/overview").then((r) => r.data),
  suggestions: () => apiFetch<Envelope<Suggestion[]>>("/admin/inventory/suggestions").then((r) => r.data),
  movements: (kind: "finished" | "raw" | "spare" | "all" = "finished") =>
    apiFetch<Envelope<Movement[]>>(`/admin/inventory/movements?kind=${kind}`).then((r) => r.data),

  rawMaterials: () => apiFetch<Envelope<RawMaterial[]>>("/admin/inventory/raw-materials").then((r) => r.data),
  createRawMaterial: (body: Partial<RawMaterial>) =>
    apiFetch<Envelope<RawMaterial>>("/admin/inventory/raw-materials", { method: "POST", body: JSON.stringify(body) }).then((r) => r.data),
  updateRawMaterial: (id: number, body: Partial<RawMaterial>) =>
    apiFetch<Envelope<RawMaterial>>(`/admin/inventory/raw-materials/${id}`, { method: "PUT", body: JSON.stringify(body) }).then((r) => r.data),
  deleteRawMaterial: (id: number) =>
    apiFetch<Envelope<null>>(`/admin/inventory/raw-materials/${id}`, { method: "DELETE" }),
  rawMovement: (id: number, body: MovementInput) =>
    apiFetch<Envelope<RawMaterial>>(`/admin/inventory/raw-materials/${id}/movement`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.data),

  production: (from?: string, to?: string) => {
    const q = new URLSearchParams();
    if (from) q.set("from", from);
    if (to) q.set("to", to);
    const qs = q.toString();
    return apiFetch<Envelope<ProductionRun[]>>(`/admin/inventory/production${qs ? `?${qs}` : ""}`).then((r) => r.data);
  },
  createProduction: (body: ProductionInput) =>
    apiFetch<Envelope<ProductionRun>>("/admin/inventory/production", { method: "POST", body: JSON.stringify(body) }).then((r) => r.data),
  productionRun: (id: number) =>
    apiFetch<Envelope<ProductionRun>>(`/admin/inventory/production/${id}`).then((r) => r.data),
  updateProduction: (id: number, body: ProductionInput) =>
    apiFetch<Envelope<ProductionRun>>(`/admin/inventory/production/${id}`, { method: "PUT", body: JSON.stringify(body) }).then((r) => r.data),

  stock: (category?: string) =>
    apiFetch<Envelope<StockItem[]>>(`/admin/inventory/stock${category && category !== "all" ? `?category=${encodeURIComponent(category)}` : ""}`).then((r) => r.data),
  stockCategories: () => apiFetch<Envelope<CategoryStock[]>>("/admin/inventory/stock/categories").then((r) => r.data),
  stockMovement: (productId: number, body: MovementInput) =>
    apiFetch<Envelope<StockItem>>(`/admin/inventory/stock/${productId}/movement`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.data),

  spares: (category?: string) =>
    apiFetch<Envelope<SpareAsset[]>>(`/admin/inventory/spares${category && category !== "all" ? `?category=${encodeURIComponent(category)}` : ""}`).then((r) => r.data),
  createSpare: (body: Partial<SpareAsset>) =>
    apiFetch<Envelope<SpareAsset>>("/admin/inventory/spares", { method: "POST", body: JSON.stringify(body) }).then((r) => r.data),
  updateSpare: (id: number, body: Partial<SpareAsset>) =>
    apiFetch<Envelope<SpareAsset>>(`/admin/inventory/spares/${id}`, { method: "PUT", body: JSON.stringify(body) }).then((r) => r.data),
  deleteSpare: (id: number) =>
    apiFetch<Envelope<null>>(`/admin/inventory/spares/${id}`, { method: "DELETE" }),
  spareMovement: (id: number, body: MovementInput) =>
    apiFetch<Envelope<SpareAsset>>(`/admin/inventory/spares/${id}/movement`, { method: "POST", body: JSON.stringify(body) }).then((r) => r.data),
};

export const inr = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
export const qty = (n: number, unit = "") => `${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}${unit ? " " + unit : ""}`;
