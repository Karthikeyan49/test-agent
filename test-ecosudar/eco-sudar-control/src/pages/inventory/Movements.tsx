import { useEffect, useMemo, useState } from "react";
import { Plus } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { toast } from "sonner";
import { inventoryApi, qty, type Movement } from "@/lib/api/inventory";
import { ExportMenu } from "@/components/ExportMenu";
import { type ExportColumnDef } from "@/components/ExportDialog";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { TableSkeleton } from "@/components/TableSkeleton";

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);
type Kind = "finished" | "raw" | "spare" | "all";
const TABS: { key: Kind; label: string }[] = [
  { key: "finished", label: "Finished goods" },
  { key: "raw", label: "Raw materials" },
  { key: "spare", label: "Spares & assets" },
  { key: "all", label: "All" },
];

const itemName = (m: Movement) =>
  m.kind === "raw" ? (m.material_name ?? "") : m.kind === "spare" ? (m.spare_name ?? "") : (m.product_name ?? "");

export default function Movements() {
  const navigate = useNavigate();
  const [kind, setKind] = useState<Kind>("finished");
  const [rows, setRows] = useState<Movement[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    setLoading(true);
    inventoryApi.movements(kind).then(setRows)
      .catch((e) => toast.error(err(e, "Failed to load movements")))
      .finally(() => setLoading(false));
  }, [kind]);

  const filtered = useMemo(() => rows.filter((m) =>
    itemName(m).toLowerCase().includes(search.toLowerCase()) ||
    (m.reference ?? "").toLowerCase().includes(search.toLowerCase())
  ), [rows, search]);

  const paged = usePagedRows(filtered);

  const EXPORT_COLUMNS: ExportColumnDef<Movement>[] = [
    { header: "Date", key: "movement_date" }, { header: "Kind", key: "kind" },
    { header: "Item", key: itemName }, { header: "Type", key: "movement_type" },
    { header: "Source", key: (m) => m.source ?? "" }, { header: "Qty", key: "quantity" },
    { header: "Reference", key: (m) => m.reference ?? "" },
    { header: "Notes", key: (m) => m.notes ?? "", group: "detail", defaultChecked: false },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Stock Movements</h1>
          <p className="text-muted-foreground">Auditable ledger of every stock change across the plant.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu title="Movements" columns={EXPORT_COLUMNS} rows={filtered} dateField="movement_date" filename={`stock-movements-${kind}`} />
          <Button onClick={() => navigate("/inventory/movements/new")}><Plus className="h-4 w-4" /> Record Movement</Button>
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
        <Input className="w-full sm:w-72 sm:ml-auto" placeholder="Search item or reference…" value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Item</th>
                <th className="text-left px-4 py-3 font-medium">Kind</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-right px-4 py-3 font-medium">Qty</th>
                <th className="text-left px-4 py-3 font-medium">Reference</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={6} />}
              {!loading && filtered.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No movements.</td></tr>}
              {!loading && paged.rows.map((m, i) => (
                <tr key={`${m.kind}-${m.stock_movement_id ?? m.movement_id}-${i}`} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3">{m.movement_date}</td>
                  <td className="px-4 py-3 font-medium text-card-foreground">{itemName(m)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground capitalize">{m.kind}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full capitalize ${m.movement_type === "in" ? "bg-primary/10 text-primary" : m.movement_type === "out" ? "bg-destructive/10 text-destructive" : "bg-muted text-muted-foreground"}`}>
                      {m.movement_type}{m.source ? ` · ${m.source}` : ""}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right eco-nums">{qty(m.quantity)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{m.reference || "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun="movements" />
      </div>
    </div>
  );
}
