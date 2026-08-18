import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { toast } from "sonner";
import { inventoryApi, inr, qty } from "@/lib/api/inventory";
import { ExportMenu } from "@/components/ExportMenu";
import { type ExportColumnDef } from "@/components/ExportDialog";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { TableSkeleton } from "@/components/TableSkeleton";
import { StatusBadge } from "@/components/StatusBadge";

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);

/** A unified inventory item — every stockable thing in the plant, raw or finished. */
interface Item {
  key: string;
  name: string;
  type: "Finished Good" | "Raw Material";
  category: string;
  unit: string;
  stock: number;
  reorder: number;
  value: number | null;
  low: boolean;
}

type Kind = "all" | "finished" | "raw";
const TABS: { key: Kind; label: string }[] = [
  { key: "all", label: "All items" },
  { key: "finished", label: "Finished goods" },
  { key: "raw", label: "Raw materials" },
];

export default function Items() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<Kind>("all");
  const [search, setSearch] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const [finished, raw] = await Promise.all([
        inventoryApi.stock(),
        inventoryApi.rawMaterials(),
      ]);
      const merged: Item[] = [
        ...finished.map<Item>((s) => ({
          key: `f-${s.product_id}`,
          name: s.product_name,
          type: "Finished Good",
          category: s.category || s.product_type || "—",
          unit: s.unit || "",
          stock: s.stock_quantity,
          reorder: s.reorder_level,
          value: s.stock_value,
          low: s.low_stock,
        })),
        ...raw.filter((r) => r.is_active).map<Item>((r) => ({
          key: `r-${r.raw_material_id}`,
          name: r.name,
          type: "Raw Material",
          category: r.supplier || "—",
          unit: r.unit || "",
          stock: r.current_stock,
          reorder: r.reorder_level,
          value: null,
          low: r.low_stock,
        })),
      ];
      setItems(merged);
    } catch (e) {
      toast.error(err(e, "Failed to load items"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => items.filter((it) => {
    if (kind === "finished" && it.type !== "Finished Good") return false;
    if (kind === "raw" && it.type !== "Raw Material") return false;
    const q = search.toLowerCase();
    return !q || it.name.toLowerCase().includes(q) || it.category.toLowerCase().includes(q);
  }), [items, kind, search]);

  const lowCount = useMemo(() => filtered.filter((it) => it.low).length, [filtered]);
  const paged = usePagedRows(filtered);

  const EXPORT_COLUMNS: ExportColumnDef<Item>[] = [
    { header: "Item", key: "name" },
    { header: "Type", key: "type" },
    { header: "Category / Supplier", key: "category" },
    { header: "Unit", key: "unit" },
    { header: "In Stock", key: "stock" },
    { header: "Reorder Level", key: "reorder" },
    { header: "Status", key: (it) => (it.low ? "Low" : "OK") },
    { header: "Stock Value", key: (it) => (it.value == null ? "" : it.value), group: "detail", defaultChecked: false },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock</h1>
          <p className="text-muted-foreground">
            Master list of every stockable item — raw materials and finished goods.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu title="Stock" columns={EXPORT_COLUMNS} rows={filtered} filename="inventory-stock" />
          <Button onClick={() => navigate("/inventory/items/new")}><Plus className="h-4 w-4" /> New Item</Button>
        </div>
      </div>

      <div className="bg-card rounded-xl border p-4 shadow-sm flex flex-wrap items-center gap-3">
        <div className="flex gap-1.5">
          {TABS.map((t) => (
            <button key={t.key} onClick={() => setKind(t.key)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${kind === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <Input className="w-full sm:w-72 sm:ml-auto" placeholder="Search item or category…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <div className="px-4 py-3 border-b flex items-center justify-between text-sm">
          <span className="font-medium text-card-foreground">{filtered.length} item{filtered.length === 1 ? "" : "s"}</span>
          {lowCount > 0 && <span className="text-destructive text-xs">{lowCount} below reorder level</span>}
        </div>
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Item</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Category / Supplier</th>
                <th className="text-right px-4 py-3 font-medium">In Stock</th>
                <th className="text-right px-4 py-3 font-medium">Reorder</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Value</th>
                <th className="w-16 px-4 py-3" />
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={8} />}
              {!loading && filtered.length === 0 && <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">No items found.</td></tr>}
              {!loading && paged.rows.map((it) => (
                <tr key={it.key} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-card-foreground">{it.name}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={it.type === "Finished Good" ? "finished_good" : "raw_material"} styleMap={{ finished_good: "bg-primary/10 text-primary border-primary/20", raw_material: "bg-muted text-muted-foreground border-border" }} />
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{it.category}</td>
                  <td className="px-4 py-3 text-right eco-nums">{qty(it.stock, it.unit)}</td>
                  <td className="px-4 py-3 text-right eco-nums text-muted-foreground">{qty(it.reorder, it.unit)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={it.low ? "low_stock" : "ok"} styleMap={{ low_stock: "bg-destructive/10 text-destructive border-destructive/20", ok: "bg-emerald-50 text-emerald-600 border-emerald-200" }} />
                  </td>
                  <td className="px-4 py-3 text-right eco-nums">{it.value == null ? "—" : inr(it.value)}</td>
                  <td className="px-4 py-3 text-right">
                    {it.type === "Raw Material" && (
                      <Button size="icon" variant="ghost" title="Edit" onClick={() => navigate(`/inventory/items/${it.key.slice(2)}/edit`)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun="items" />
      </div>
    </div>
  );
}
