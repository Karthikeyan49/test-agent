import { useEffect, useMemo, useState } from "react";
import { Search, ArrowDownUp, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { StatCard } from "@/components/StatCard";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { toast } from "sonner";
import {
  inventoryApi, inr, qty,
  type StockItem, type CategoryStock, type MovementInput,
} from "@/lib/api/inventory";
import { ExportMenu } from "@/components/ExportMenu";
import { type ExportColumnDef } from "@/components/ExportDialog";
import { FilterSelect, ALL } from "@/components/Filters";
import { TableSkeleton } from "@/components/TableSkeleton";

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);
const STATUS_OPTIONS = [{ value: "low", label: "Low stock" }, { value: "ok", label: "OK" }];
const EXPORT_COLUMNS: ExportColumnDef<StockItem>[] = [
  { header: "Product", key: "product_name" }, { header: "Category", key: "category" },
  { header: "Stock", key: "stock_quantity" }, { header: "Unit", key: "unit" },
  { header: "Reorder Level", key: "reorder_level" }, { header: "Stock Value", key: "stock_value" },
  { header: "Low", key: (r) => (r.low_stock ? "Yes" : "No") },
  { header: "Base Price", key: "base_price", group: "detail", defaultChecked: false },
];

export default function StockLevels() {
  const [items, setItems] = useState<StockItem[]>([]);
  const [cats, setCats] = useState<CategoryStock[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [statusFilter, setStatusFilter] = useState(ALL);

  const [moveFor, setMoveFor] = useState<StockItem | null>(null);
  const [move, setMove] = useState<MovementInput>({ movement_type: "in", quantity: 0, source: "manual", reference: "", movement_date: new Date().toISOString().slice(0, 10) });

  const load = () => {
    setLoading(true);
    Promise.all([inventoryApi.stock(), inventoryApi.stockCategories()])
      .then(([s, c]) => { setItems(s); setCats(c); })
      .catch((e) => toast.error(err(e, "Failed to load stock")))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const categoryNames = useMemo(() => Array.from(new Set(items.map((i) => i.category))).sort(), [items]);
  const filtered = useMemo(() => items.filter((i) =>
    (category === "all" || i.category === category) &&
    (statusFilter === ALL || (statusFilter === "low" ? i.low_stock : !i.low_stock)) &&
    i.product_name.toLowerCase().includes(search.toLowerCase())
  ), [items, search, category, statusFilter]);

  const totals = useMemo(() => ({
    value: filtered.reduce((s, i) => s + i.stock_value, 0),
    low: filtered.filter((i) => i.low_stock).length,
  }), [filtered]);

  const paged = usePagedRows(filtered);

  const submitMove = async () => {
    if (!moveFor) return;
    if (move.quantity < 0) { toast.error("Quantity must be ≥ 0"); return; }
    try {
      await inventoryApi.stockMovement(moveFor.product_id, move);
      toast.success("Stock updated"); setMoveFor(null); load();
    } catch (e) { toast.error(err(e, "Movement failed")); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Finished Stock</h1>
          <p className="text-muted-foreground">Finished-goods inventory by category (pellets, stoves, burners…).</p>
        </div>
        <ExportMenu title="Finished Stock" columns={EXPORT_COLUMNS} rows={filtered} filename="finished-stock" />
      </div>

      {/* Category summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cats.map((c) => (
          <button key={c.category} onClick={() => setCategory(c.category)}
            className={`text-left rounded-xl border p-4 shadow-sm transition-colors ${category === c.category ? "border-primary bg-primary/5" : "bg-card hover:bg-muted/40"}`}>
            <p className="text-sm font-medium text-card-foreground capitalize">{c.category}</p>
            <p className="text-2xl font-bold mt-1 eco-nums text-card-foreground">{qty(c.total_stock)}</p>
            <p className="text-xs text-muted-foreground mt-1">{c.sku_count} SKUs · {inr(c.stock_value)}{c.low_count > 0 ? ` · ${c.low_count} low` : ""}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard title="Stock Value (filtered)" value={inr(totals.value)} subtitle={`${filtered.length} SKUs`} icon={Boxes} />
        <StatCard title="Low-Stock SKUs" value={String(totals.low)} subtitle="at or below reorder level" icon={ArrowDownUp} accent="rose" subtitleColor="muted" />
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border p-4 shadow-sm flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search product…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={category} onValueChange={setCategory}>
          <SelectTrigger className="w-52"><SelectValue placeholder="Category" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All categories</SelectItem>
            {categoryNames.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
      </div>

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Product</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-right px-4 py-3 font-medium">In Stock</th>
                <th className="text-right px-4 py-3 font-medium">Reorder</th>
                <th className="text-right px-4 py-3 font-medium">Value</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Adjust</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={7} />}
              {!loading && filtered.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No products.</td></tr>}
              {!loading && paged.rows.map((i) => (
                <tr key={i.product_id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-card-foreground">{i.product_name}</td>
                  <td className="px-4 py-3 text-muted-foreground capitalize">{i.category}</td>
                  <td className="px-4 py-3 text-right font-semibold eco-nums">{qty(i.stock_quantity, i.unit)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground eco-nums">{qty(i.reorder_level)}</td>
                  <td className="px-4 py-3 text-right eco-nums">{inr(i.stock_value)}</td>
                  <td className="px-4 py-3">
                    {i.low_stock
                      ? <span className="text-xs px-2 py-1 rounded-full bg-destructive/10 text-destructive font-medium">Low</span>
                      : <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">OK</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Button size="icon" variant="ghost" title="Adjust stock"
                      onClick={() => { setMoveFor(i); setMove({ movement_type: "in", quantity: 0, source: "manual", reference: "", movement_date: new Date().toISOString().slice(0, 10) }); }}>
                      <ArrowDownUp className="h-4 w-4" />
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun="products" />
      </div>

      {/* Adjust dialog */}
      <Dialog open={!!moveFor} onOpenChange={(o) => !o && setMoveFor(null)}>
        <DialogScrollContent>
          <DialogHeader>
            <DialogTitle>Adjust stock — {moveFor?.product_name}</DialogTitle>
            <DialogDescription>Current: {moveFor && qty(moveFor.stock_quantity, moveFor.unit)}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Type</Label>
              <Select value={move.movement_type} onValueChange={(v) => setMove({ ...move, movement_type: v as MovementInput["movement_type"] })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="in">Stock in</SelectItem>
                  <SelectItem value="out">Stock out</SelectItem>
                  <SelectItem value="adjust">Set / correction</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Reason</Label>
              <Select value={move.source} onValueChange={(v) => setMove({ ...move, source: v })}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="manual">Manual adjust</SelectItem>
                  <SelectItem value="return">Return</SelectItem>
                  <SelectItem value="production">Production</SelectItem>
                  <SelectItem value="order">Order / dispatch</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div><Label>{move.movement_type === "adjust" ? "New level" : "Quantity"}</Label><Input type="number" min="0" value={String(move.quantity)} onChange={(e) => setMove({ ...move, quantity: Number(e.target.value) })} /></div>
            <div><Label>Date</Label><Input type="date" value={move.movement_date} onChange={(e) => setMove({ ...move, movement_date: e.target.value })} /></div>
            <div className="col-span-2"><Label>Reference</Label><Input value={move.reference} onChange={(e) => setMove({ ...move, reference: e.target.value })} placeholder="Reason / doc #" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveFor(null)}>Cancel</Button>
            <Button onClick={submitMove}>Record</Button>
          </DialogFooter>
        </DialogScrollContent>
      </Dialog>
    </div>
  );
}
