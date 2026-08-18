import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Package } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { toast } from "sonner";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { ExportMenu } from "@/components/ExportMenu";
import { type ExportColumnDef } from "@/components/ExportDialog";
import { FilterBar, FilterSearch, FilterSelect, matchesFilter, distinctOptions, ALL } from "@/components/Filters";
import { Pagination, usePagedRows } from "@/components/Pagination";

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);
const inr = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

// Item type — where received goods post: stock/pellet → finished stock, raw material →
// raw stock. (pellet = finished pellets bought in rather than produced.)
const normType = (v: unknown) => {
  const s = String(v ?? "").toLowerCase();
  if (s === "raw_material") return "raw_material";
  if (s === "pellet" || s === "pellets" || s === "finished") return "pellet";
  return "stock";
};
const TYPE_META: Record<string, { label: string; badge: string }> = {
  stock:        { label: "Spares & Assets", badge: "bg-primary/10 text-primary border-primary/20" },
  raw_material: { label: "Raw Material",    badge: "bg-amber-50 text-amber-700 border-amber-200" },
  pellet:       { label: "Pellet",          badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};
const typeLabel = (v: unknown) => TYPE_META[normType(v)].label;
const typeBadge = (v: unknown) => TYPE_META[normType(v)].badge;

const TYPE_OPTIONS = [
  { value: "stock", label: "Spares & Assets" },
  { value: "raw_material", label: "Raw Material" },
  { value: "pellet", label: "Pellet" },
];

const EXPORT_COLUMNS: ExportColumnDef<ApiRow>[] = [
  { header: "Code", key: "item_code" },
  { header: "Name", key: "name" },
  { header: "Category", key: "category" },
  { header: "Type", key: (v) => typeLabel(v.item_type) },
  { header: "Unit", key: "unit" },
  { header: "Rate", key: "rate" },
  { header: "GST %", key: "gst_rate" },
  { header: "HSN", key: "hsn_code", group: "detail", defaultChecked: false },
  { header: "Specification", key: "specification", group: "detail", defaultChecked: false },
  { header: "Status", key: (v) => (Number(v.is_active ?? 1) ? "Active" : "Inactive"), group: "detail", defaultChecked: false },
];

const STATUS_OPTIONS = [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }];

export default function PurchaseItems() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [itemType, setItemType] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [confirmDel, setConfirmDel] = useState<ApiRow | null>(null);

  const load = () => {
    setLoading(true);
    phase2Api.purchaseItems.list().then(setItems)
      .catch((e) => toast.error(err(e, "Failed to load items")))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const categoryOptions = useMemo(() => distinctOptions(items, (v) => v.category), [items]);

  const filtered = useMemo(() => items.filter((it) => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      String(it.name ?? "").toLowerCase().includes(q) ||
      String(it.item_code ?? "").toLowerCase().includes(q) ||
      String(it.category ?? "").toLowerCase().includes(q) ||
      String(it.hsn_code ?? "").toLowerCase().includes(q);
    const active = it.is_active === undefined ? true : !!Number(it.is_active);
    const matchesStatus = status === ALL || (status === "active" ? active : !active);
    const matchesType = itemType === ALL || normType(it.item_type) === itemType;
    return matchesSearch && matchesFilter(category, it.category) && matchesType && matchesStatus;
  }), [items, search, category, itemType, status]);

  const paged = usePagedRows(filtered);

  const remove = async () => {
    if (!confirmDel) return;
    try { await phase2Api.purchaseItems.remove(confirmDel.purchase_item_id); toast.success("Item deactivated"); setConfirmDel(null); load(); }
    catch (e) { toast.error(err(e, "Delete failed")); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Items</h1>
          <p className="text-muted-foreground">Catalog of items purchased from vendors — rate &amp; GST auto-fill on a PO.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu title="Purchase Items" columns={EXPORT_COLUMNS} rows={filtered} dateField="created_at" filename="purchase-items" />
          <Button onClick={() => navigate("/purchase/items/new")}><Plus className="h-4 w-4" /> Add item</Button>
        </div>
      </div>

      <FilterBar>
        <FilterSearch value={search} onChange={setSearch} placeholder="Search name, code, category…" />
        <FilterSelect label="Category" value={category} onChange={setCategory} options={categoryOptions} />
        <FilterSelect label="Type" value={itemType} onChange={setItemType} options={TYPE_OPTIONS} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </FilterBar>

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Item</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Unit</th>
                <th className="text-right px-4 py-3 font-medium">Rate</th>
                <th className="text-right px-4 py-3 font-medium">GST %</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">Loading…</td></tr>}
              {!loading && filtered.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No items yet. Add your first purchasable item.</td></tr>}
              {!loading && paged.rows.map((it) => (
                <tr key={it.purchase_item_id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/purchase/items/${it.purchase_item_id}`)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0"><Package className="h-4 w-4 text-primary" /></span>
                      <div>
                        <div className="font-medium text-card-foreground">{it.name}</div>
                        <div className="text-xs text-muted-foreground">{it.item_code}{it.specification ? ` · ${it.specification}` : ""}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{it.category || "—"}</td>
                  <td className="px-4 py-3">
                    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${typeBadge(it.item_type)}`}>
                      {typeLabel(it.item_type)}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{it.unit || "—"}</td>
                  <td className="px-4 py-3 text-right font-semibold eco-nums">{inr(it.rate)}</td>
                  <td className="px-4 py-3 text-right eco-nums text-muted-foreground">{Number(it.gst_rate ?? 0)}%</td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex gap-1">
                      <Button size="icon" variant="ghost" title="Deactivate" onClick={() => setConfirmDel(it)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun="items" />
      </div>

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate item?</AlertDialogTitle>
            <AlertDialogDescription>{confirmDel && <>“{confirmDel.name}” will be hidden from lists and the PO item picker. History is kept.</>}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={remove} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
