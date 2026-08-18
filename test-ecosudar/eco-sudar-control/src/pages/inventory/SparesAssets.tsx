import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, ArrowDownUp, Trash2, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { StatCard } from "@/components/StatCard";
import { toast } from "sonner";
import { Req } from "@/components/Req";
import { inventoryApi, qty, type SpareAsset, type MovementInput } from "@/lib/api/inventory";
import { ExportMenu } from "@/components/ExportMenu";
import { type ExportColumnDef } from "@/components/ExportDialog";
import { FilterBar, FilterSearch, FilterSelect, matchesFilter, distinctOptions, ALL } from "@/components/Filters";
import { TableSkeleton } from "@/components/TableSkeleton";

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);
const today = () => new Date().toISOString().slice(0, 10);

const STATUS_OPTIONS = [{ value: "low", label: "Low stock" }, { value: "ok", label: "OK" }];
const EXPORT_COLUMNS: ExportColumnDef<SpareAsset>[] = [
  { header: "Name", key: "name" }, { header: "Category", key: (r) => r.category ?? "" },
  { header: "Unit", key: "unit" }, { header: "Current Stock", key: "current_stock" },
  { header: "Reorder Level", key: "reorder_level" }, { header: "Location", key: (r) => r.location ?? "" },
  { header: "Low", key: (r) => (r.low_stock ? "Yes" : "No") },
];

interface EditForm { name: string; category: string; unit: string; reorder_level: number; location: string; current_stock: number }
const emptyForm = (): EditForm => ({ name: "", category: "", unit: "nos", reorder_level: 0, location: "", current_stock: 0 });

export default function SparesAssets() {
  const [items, setItems] = useState<SpareAsset[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);

  const [editing, setEditing] = useState<SpareAsset | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState<EditForm>(emptyForm());
  const [saving, setSaving] = useState(false);

  const [moveFor, setMoveFor] = useState<SpareAsset | null>(null);
  const [move, setMove] = useState<MovementInput>({ movement_type: "in", quantity: 0, reference: "", movement_date: today() });
  const [confirmDel, setConfirmDel] = useState<SpareAsset | null>(null);

  const load = () => {
    setLoading(true);
    inventoryApi.spares().then(setItems)
      .catch((e) => toast.error(err(e, "Failed to load spares & assets")))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const categoryOptions = useMemo(() => distinctOptions(items, (v) => v.category ?? undefined), [items]);

  const filtered = useMemo(() => items.filter((i) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || i.name.toLowerCase().includes(q) || (i.category ?? "").toLowerCase().includes(q) || (i.location ?? "").toLowerCase().includes(q);
    const matchesStatus = statusFilter === ALL || (statusFilter === "low" ? i.low_stock : !i.low_stock);
    return matchesSearch && matchesFilter(category, i.category) && matchesStatus;
  }), [items, search, category, statusFilter]);

  const paged = usePagedRows(filtered);

  // Totals for the summary — respect the current category filter so the cards show
  // the chosen category's current stock (the user's "display chosen category stock").
  const totals = useMemo(() => {
    const totalStock = filtered.reduce((s, i) => s + i.current_stock, 0);
    const lowCount = filtered.filter((i) => i.low_stock).length;
    return { count: filtered.length, totalStock, lowCount };
  }, [filtered]);

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setFormOpen(true); };
  const openEdit = (s: SpareAsset) => {
    setEditing(s);
    setForm({ name: s.name, category: s.category ?? "", unit: s.unit, reorder_level: s.reorder_level, location: s.location ?? "", current_stock: s.current_stock });
    setFormOpen(true);
  };

  const submitForm = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      if (editing) {
        await inventoryApi.updateSpare(editing.spare_id, { name: form.name.trim(), category: form.category.trim() || null, unit: form.unit || "nos", reorder_level: form.reorder_level, location: form.location.trim() || null });
        toast.success("Updated");
      } else {
        await inventoryApi.createSpare({ name: form.name.trim(), category: form.category.trim() || null, unit: form.unit || "nos", reorder_level: form.reorder_level, location: form.location.trim() || null, current_stock: form.current_stock });
        toast.success("Spare / asset added");
      }
      setFormOpen(false); load();
    } catch (e) { toast.error(err(e, "Save failed")); }
    finally { setSaving(false); }
  };

  const submitMove = async () => {
    if (!moveFor) return;
    if (move.quantity < 0) { toast.error("Quantity must be ≥ 0"); return; }
    try { await inventoryApi.spareMovement(moveFor.spare_id, move); toast.success("Stock updated"); setMoveFor(null); load(); }
    catch (e) { toast.error(err(e, "Movement failed")); }
  };

  const remove = async () => {
    if (!confirmDel) return;
    try { await inventoryApi.deleteSpare(confirmDel.spare_id); toast.success("Deactivated"); setConfirmDel(null); load(); }
    catch (e) { toast.error(err(e, "Delete failed")); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Spares &amp; Assets</h1>
          <p className="text-muted-foreground">Spare parts, tools and assets bought via POs — received stock lands here.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu title="Spares & Assets" columns={EXPORT_COLUMNS} rows={filtered} filename="spares-assets" />
          <Button onClick={openCreate}><Plus className="h-4 w-4" /> Add spare / asset</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title={category === ALL ? "Items" : `Items · ${category}`} value={String(totals.count)} subtitle="in view" icon={Wrench} />
        <StatCard title={category === ALL ? "Current stock" : `Stock · ${category}`} value={qty(totals.totalStock)} subtitle="total on hand" icon={Wrench} subtitleColor="primary" />
        <StatCard title="Low stock" value={String(totals.lowCount)} subtitle="at/below reorder" icon={Wrench} subtitleColor={totals.lowCount ? "muted" : "primary"} />
      </div>

      <FilterBar>
        <FilterSearch value={search} onChange={setSearch} placeholder="Search name, category or location…" />
        <FilterSelect label="Category" value={category} onChange={setCategory} options={categoryOptions} />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
      </FilterBar>

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Item</th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-right px-4 py-3 font-medium">Current Stock</th>
                <th className="text-right px-4 py-3 font-medium">Reorder</th>
                <th className="text-left px-4 py-3 font-medium">Location</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={7} />}
              {!loading && filtered.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No spares or assets yet. Received PO stock items appear here automatically.</td></tr>}
              {!loading && paged.rows.map((s) => (
                <tr key={s.spare_id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-card-foreground">{s.name}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.category || "—"}</td>
                  <td className="px-4 py-3 text-right eco-nums">{qty(s.current_stock, s.unit)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground eco-nums">{qty(s.reorder_level, s.unit)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{s.location || "—"}</td>
                  <td className="px-4 py-3">
                    {s.low_stock
                      ? <span className="text-xs px-2 py-1 rounded-full bg-destructive/10 text-destructive font-medium">Low</span>
                      : <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">OK</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="icon" variant="ghost" title="Stock in/out" onClick={() => { setMoveFor(s); setMove({ movement_type: "in", quantity: 0, reference: "", movement_date: today() }); }}><ArrowDownUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" title="Edit" onClick={() => openEdit(s)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" title="Deactivate" onClick={() => setConfirmDel(s)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun="items" />
      </div>

      {/* Add / edit */}
      <Dialog open={formOpen} onOpenChange={(o) => { if (!saving) setFormOpen(o); }}>
        <DialogScrollContent>
          <DialogHeader>
            <DialogTitle>{editing ? "Edit spare / asset" : "Add spare / asset"}</DialogTitle>
            <DialogDescription>{editing ? "Update the item details. Use stock in/out to change quantity." : "Create a spare part, tool or asset."}</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><Label>Name <Req /></Label><Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Die plate 6mm" /></div>
            <div><Label>Category</Label><Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="e.g. Machine spares" /></div>
            <div><Label>Unit</Label><Input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} placeholder="nos" /></div>
            <div><Label>Reorder level</Label><Input type="number" min="0" value={String(form.reorder_level)} onChange={(e) => setForm((f) => ({ ...f, reorder_level: Number(e.target.value) }))} /></div>
            <div><Label>Location</Label><Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} placeholder="Store / rack" /></div>
            {!editing && <div className="col-span-2"><Label>Opening stock</Label><Input type="number" min="0" value={String(form.current_stock)} onChange={(e) => setForm((f) => ({ ...f, current_stock: Number(e.target.value) }))} /></div>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFormOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={submitForm} disabled={saving}>{saving ? "Saving…" : editing ? "Save" : "Add"}</Button>
          </DialogFooter>
        </DialogScrollContent>
      </Dialog>

      {/* Movement */}
      <Dialog open={!!moveFor} onOpenChange={(o) => !o && setMoveFor(null)}>
        <DialogScrollContent>
          <DialogHeader>
            <DialogTitle>Stock movement — {moveFor?.name}</DialogTitle>
            <DialogDescription>Current: {moveFor && qty(moveFor.current_stock, moveFor.unit)}</DialogDescription>
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
            <div><Label>{move.movement_type === "adjust" ? "New stock level" : "Quantity"}</Label><Input type="number" min="0" value={String(move.quantity)} onChange={(e) => setMove({ ...move, quantity: Number(e.target.value) })} /></div>
            <div><Label>Date</Label><Input type="date" value={move.movement_date} onChange={(e) => setMove({ ...move, movement_date: e.target.value })} /></div>
            <div><Label>Reference</Label><Input value={move.reference} onChange={(e) => setMove({ ...move, reference: e.target.value })} placeholder="PO / note" /></div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMoveFor(null)}>Cancel</Button>
            <Button onClick={submitMove}>Record</Button>
          </DialogFooter>
        </DialogScrollContent>
      </Dialog>

      <AlertDialog open={!!confirmDel} onOpenChange={(o) => !o && setConfirmDel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate item?</AlertDialogTitle>
            <AlertDialogDescription>{confirmDel && <>“{confirmDel.name}” will be hidden from lists. History is kept.</>}</AlertDialogDescription>
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
