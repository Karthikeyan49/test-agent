import { useEffect, useMemo, useState } from "react";
import { Plus, Factory, Calendar, Boxes, Leaf, ShieldCheck, Pencil } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { toast } from "sonner";
import { inventoryApi, qty, type ProductionRun } from "@/lib/api/inventory";
import { StatCard } from "@/components/StatCard";
import { ExportMenu } from "@/components/ExportMenu";
import { type ExportColumnDef } from "@/components/ExportDialog";
import { TableSkeleton } from "@/components/TableSkeleton";
import { usePagedRows, Pagination } from "@/components/Pagination";

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);

const runOutput = (r: ProductionRun) => r.outputs.reduce((s, o) => s + o.quantity, 0);
const runConsumed = (r: ProductionRun) => r.consumption.reduce((s, c) => s + c.quantity, 0);
const outSummary = (r: ProductionRun) =>
  r.outputs.length ? r.outputs.map((o) => `${qty(o.quantity, o.unit)} ${o.product_name ?? ""}`.trim()).join(", ") : "—";
const consSummary = (r: ProductionRun) =>
  r.consumption.length ? r.consumption.map((c) => `${c.name} (${qty(c.quantity, c.unit)})`).join(", ") : "—";

const QUALITY_BADGE: Record<string, string> = {
  pass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  fail: "bg-red-50 text-red-600 border-red-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
};

const EXPORT_COLUMNS: ExportColumnDef<ProductionRun>[] = [
  { header: "Date", key: "run_date" },
  { header: "Batch", key: (r) => r.batch_number ?? "" },
  { header: "Outputs", key: (r) => outSummary(r) },
  { header: "Total output", key: (r) => runOutput(r) },
  { header: "Shift", key: "shift" },
  { header: "Operator", key: (r) => r.operator_name ?? "" },
  { header: "Consumed", key: (r) => consSummary(r) },
  { header: "Quality", key: (r) => r.quality?.result ?? "" },
  { header: "Notes", key: (r) => r.notes ?? "", group: "detail", defaultChecked: false },
];

export default function Production() {
  const navigate = useNavigate();
  const [runs, setRuns] = useState<ProductionRun[]>([]);
  const [loading, setLoading] = useState(true);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");

  const loadRuns = () => {
    setLoading(true);
    inventoryApi.production(from || undefined, to || undefined).then(setRuns)
      .catch((e) => toast.error(err(e, "Failed to load production runs")))
      .finally(() => setLoading(false));
  };
  useEffect(loadRuns, [from, to]);

  const stats = useMemo(() => {
    const totalOutput = runs.reduce((s, r) => s + runOutput(r), 0);
    const totalConsumed = runs.reduce((s, r) => s + runConsumed(r), 0);
    const checked = runs.filter((r) => r.quality && r.quality.result !== "pending");
    const passed = checked.filter((r) => r.quality?.result === "pass").length;
    const passRate = checked.length ? Math.round((passed / checked.length) * 100) : null;
    return { totalOutput, totalConsumed, passRate, checkedCount: checked.length };
  }, [runs]);

  const paged = usePagedRows(runs);

  // Output grouped by day for the mini bar chart (most recent 14 days present in data).
  const series = useMemo(() => {
    const byDay = new Map<string, number>();
    runs.forEach((r) => byDay.set(r.run_date, (byDay.get(r.run_date) ?? 0) + runOutput(r)));
    const days = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).slice(-14);
    const max = days.reduce((m, [, v]) => Math.max(m, v), 0) || 1;
    return { days, max };
  }, [runs]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Production Tracking</h1>
          <p className="text-muted-foreground">Consume raw materials, record output &amp; quality, and add finished stock.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu title="Production" columns={EXPORT_COLUMNS} rows={runs} dateField="run_date" filename="production-runs" />
          <Button onClick={() => navigate("/inventory/production/new")}><Plus className="h-4 w-4" /> Log production</Button>
        </div>
      </div>

      {/* Overview */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Runs" value={String(runs.length)} subtitle={from || to ? "in range" : "all time"} icon={Factory} />
        <StatCard title="Finished output" value={qty(stats.totalOutput)} subtitle="added to stock" icon={Boxes} subtitleColor="primary" />
        <StatCard title="Raw consumed" value={qty(stats.totalConsumed)} subtitle="across runs" icon={Leaf} />
        <StatCard title="Quality pass rate" value={stats.passRate === null ? "—" : `${stats.passRate}%`} subtitle={`${stats.checkedCount} inspected`} icon={ShieldCheck} subtitleColor={stats.passRate !== null && stats.passRate < 100 ? "muted" : "primary"} />
      </div>

      {/* Output by day */}
      <div className="bg-card rounded-xl border shadow-sm p-4">
        <h2 className="text-base font-semibold text-card-foreground mb-3">Output by day</h2>
        {series.days.length === 0 ? (
          <p className="text-sm text-muted-foreground py-6 text-center">No production in this range.</p>
        ) : (
          <div className="flex items-end gap-2 h-40">
            {series.days.map(([day, val]) => (
              <div key={day} className="flex-1 flex flex-col items-center justify-end gap-1 min-w-0" title={`${day}: ${qty(val)}`}>
                <span className="text-[10px] text-muted-foreground eco-nums">{val ? qty(val) : ""}</span>
                <div className="w-full rounded-t-md bg-primary/80 hover:bg-primary transition-colors" style={{ height: `${Math.max(4, (val / series.max) * 100)}%` }} />
                <span className="text-[10px] text-muted-foreground truncate w-full text-center">{day.slice(5)}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Filter */}
      <div className="bg-card rounded-xl border p-4 shadow-sm flex flex-wrap items-end gap-3">
        <div><Label className="text-xs flex items-center gap-1"><Calendar className="h-3 w-3" /> From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
        {(from || to) && <Button variant="ghost" size="sm" onClick={() => { setFrom(""); setTo(""); }}>Clear</Button>}
        <div className="ml-auto text-sm text-muted-foreground">{runs.length} run(s)</div>
      </div>

      {/* Run log */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Batch</th>
                <th className="text-left px-4 py-3 font-medium">Output</th>
                <th className="text-left px-4 py-3 font-medium">Raw consumed</th>
                <th className="text-left px-4 py-3 font-medium">Shift</th>
                <th className="text-left px-4 py-3 font-medium">Quality</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={7} />}
              {!loading && runs.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No production runs in this range.</td></tr>}
              {!loading && paged.rows.map((r) => (
                <tr key={r.run_id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/inventory/production/${r.run_id}`)}>
                  <td className="px-4 py-3 whitespace-nowrap">{r.run_date}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.batch_number || "—"}</td>
                  <td className="px-4 py-3 font-medium text-card-foreground max-w-[260px] truncate" title={outSummary(r)}>{outSummary(r)}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground max-w-[240px] truncate" title={consSummary(r)}>{consSummary(r)}</td>
                  <td className="px-4 py-3 capitalize">{r.shift}</td>
                  <td className="px-4 py-3">
                    {r.quality ? (
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${QUALITY_BADGE[r.quality.result] ?? "bg-muted text-muted-foreground"}`}>{r.quality.result}</span>
                    ) : <span className="text-xs text-muted-foreground">—</span>}
                  </td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <Button size="icon" variant="ghost" title="Edit" onClick={() => navigate(`/inventory/production/${r.run_id}/edit`)}><Pencil className="h-4 w-4" /></Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun="runs" />
      </div>
    </div>
  );
}
