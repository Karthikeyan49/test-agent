import { useEffect, useMemo, useState } from "react";
import { Plus, Pencil, ArrowDownUp, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { toast } from "sonner";
import { Req } from "@/components/Req";
import { inventoryApi, qty, type RawMaterial, type MovementInput } from "@/lib/api/inventory";
import { ExportMenu } from "@/components/ExportMenu";
import { type ExportColumnDef } from "@/components/ExportDialog";
import { FilterBar, FilterSearch, FilterSelect, ALL } from "@/components/Filters";
import { TableSkeleton } from "@/components/TableSkeleton";

const STATUS_OPTIONS = [{ value: "low", label: "Low stock" }, { value: "ok", label: "OK" }];
const EXPORT_COLUMNS: ExportColumnDef<RawMaterial>[] = [
  { header: "Name", key: "name" }, { header: "Unit", key: "unit" },
  { header: "Current Stock", key: "current_stock" }, { header: "Reorder Level", key: "reorder_level" },
  { header: "Supplier", key: (r) => r.supplier ?? "" }, { header: "Low", key: (r) => (r.low_stock ? "Yes" : "No") },
];

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);

export default function RawMaterials() {
  const navigate = useNavigate();
  const [items, setItems] = useState<RawMaterial[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL);

  const [moveFor, setMoveFor] = useState<RawMaterial | null>(null);
  const [move, setMove] = useState<MovementInput>({ movement_type: "in", quantity: 0, reference: "", movement_date: new Date().toISOString().slice(0, 10) });
  const [confirmDel, setConfirmDel] = useState<RawMaterial | null>(null);

  const load = () => {
    setLoading(true);
    inventoryApi.rawMaterials().then(setItems)
      .catch((e) => toast.error(err(e, "Failed to load raw materials")))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const filtered = useMemo(() => items.filter((i) => {
    const q = search.toLowerCase();
    const matchesSearch = !q || i.name.toLowerCase().includes(q) || (i.supplier ?? "").toLowerCase().includes(q);
    const matchesStatus = statusFilter === ALL || (statusFilter === "low" ? i.low_stock : !i.low_stock);
    return matchesSearch && matchesStatus;
  }), [items, search, statusFilter]);

  const paged = usePagedRows(filtered);

  const submitMove = async () => {
    if (!moveFor) return;
    if (move.quantity < 0) { toast.error("Quantity must be ≥ 0"); return; }
    try {
      await inventoryApi.rawMovement(moveFor.raw_material_id, move);
      toast.success("Stock updated"); setMoveFor(null); load();
    } catch (e) { toast.error(err(e, "Movement failed")); }
  };

  const remove = async () => {
    if (!confirmDel) return;
    try { await inventoryApi.deleteRawMaterial(confirmDel.raw_material_id); toast.success("Raw material deactivated"); setConfirmDel(null); load(); }
    catch (e) { toast.error(err(e, "Delete failed")); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Raw Materials</h1>
          <p className="text-muted-foreground">Biomass feedstock and inputs consumed in production.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu title="Raw Materials" columns={EXPORT_COLUMNS} rows={filtered} filename="raw-materials" />
          <Button onClick={() => navigate("/inventory/materials/new")}><Plus className="h-4 w-4" /> Add material</Button>
        </div>
      </div>

      <FilterBar>
        <FilterSearch value={search} onChange={setSearch} placeholder="Search name or supplier…" />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={STATUS_OPTIONS} />
      </FilterBar>

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Material</th>
                <th className="text-right px-4 py-3 font-medium">Current Stock</th>
                <th className="text-right px-4 py-3 font-medium">Reorder Level</th>
                <th className="text-left px-4 py-3 font-medium">Supplier</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={6} />}
              {!loading && filtered.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No raw materials. Add your first feedstock.</td></tr>}
              {!loading && paged.rows.map((m) => (
                <tr key={m.raw_material_id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-card-foreground">{m.name}</td>
                  <td className="px-4 py-3 text-right eco-nums">{qty(m.current_stock, m.unit)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground eco-nums">{qty(m.reorder_level, m.unit)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{m.supplier || "—"}</td>
                  <td className="px-4 py-3">
                    {m.low_stock
                      ? <span className="text-xs px-2 py-1 rounded-full bg-destructive/10 text-destructive font-medium">Low</span>
                      : <span className="text-xs px-2 py-1 rounded-full bg-primary/10 text-primary font-medium">OK</span>}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="icon" variant="ghost" title="Stock in/out" onClick={() => { setMoveFor(m); setMove({ movement_type: "in", quantity: 0, reference: "", movement_date: new Date().toISOString().slice(0, 10) }); }}><ArrowDownUp className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" title="Edit" onClick={() => navigate(`/inventory/materials/${m.raw_material_id}/edit`)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" title="Deactivate" onClick={() => setConfirmDel(m)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun="raw materials" />
      </div>

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
            <div><Label>Reference</Label><Input value={move.reference} onChange={(e) => setMove({ ...move, reference: e.target.value })} placeholder="PO / invoice #" /></div>
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
            <AlertDialogTitle>Deactivate raw material?</AlertDialogTitle>
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
