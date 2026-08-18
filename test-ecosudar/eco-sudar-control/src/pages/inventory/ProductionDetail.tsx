import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Factory, Boxes, Leaf, ClipboardCheck, User, CalendarDays, Pencil, Wrench } from "lucide-react";
import { toast } from "sonner";
import { BackButton } from "@/components/BackButton";
import { Button } from "@/components/ui/button";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { inventoryApi, qty, type ProductionRun } from "@/lib/api/inventory";

const QUALITY_BADGE: Record<string, string> = {
  pass: "bg-emerald-50 text-emerald-700 border-emerald-200",
  fail: "bg-red-50 text-red-600 border-red-200",
  pending: "bg-amber-50 text-amber-700 border-amber-200",
};

function InfoRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 border-b last:border-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-sm font-medium text-card-foreground text-right">{value}</dd>
    </div>
  );
}

export default function ProductionDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [run, setRun] = useState<ProductionRun | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    inventoryApi.productionRun(Number(id))
      .then(setRun)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load run"))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  if (!run) return <div className="p-6 text-sm text-muted-foreground">Production run not found.</div>;

  const totalOutput = run.outputs.reduce((s, o) => s + o.quantity, 0);
  const totalConsumed = run.consumption.reduce((s, c) => s + c.quantity, 0);
  const yieldPct = totalConsumed > 0 ? Math.round((totalOutput / totalConsumed) * 100) : null;
  const q = run.quality;
  const metrics: [string, number | null, string][] = q ? [
    ["Moisture", q.moisture_pct, "%"], ["Ash", q.ash_pct, "%"], ["GCV", q.gcv, "kcal/kg"],
    ["Fines", q.fines_pct, "%"], ["Diameter", q.diameter_mm, "mm"], ["Durability", q.durability_pct, "%"],
  ] : [];

  return (
    <div className="space-y-6">
      <BackButton fallback="/inventory/production" label="Production" />

      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Factory className="h-6 w-6 text-primary" /> Production Run #{run.run_id}
          </h1>
          <p className="text-muted-foreground">{run.run_date}{run.batch_number ? ` · Batch ${run.batch_number}` : ""}</p>
        </div>
        <div className="flex items-center gap-2">
          {q && (
            <span className={`inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium capitalize ${QUALITY_BADGE[q.result] ?? "bg-muted text-muted-foreground"}`}>
              Quality: {q.result}
            </span>
          )}
          <Button variant="outline" onClick={() => navigate(`/inventory/production/${run.run_id}/edit`)}>
            <Pencil className="h-4 w-4 mr-1" /> Edit
          </Button>
        </div>
      </div>

      {/* Material balance */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card rounded-xl border p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Raw consumed</p>
          <p className="text-2xl font-bold mt-1 text-card-foreground eco-nums">{qty(totalConsumed)}</p>
        </div>
        <div className="bg-card rounded-xl border p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Finished output</p>
          <p className="text-2xl font-bold mt-1 text-primary eco-nums">{qty(totalOutput)}</p>
        </div>
        <div className="bg-card rounded-xl border p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Yield</p>
          <p className="text-2xl font-bold mt-1 text-card-foreground eco-nums">{yieldPct === null ? "—" : `${yieldPct}%`}</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left — outputs + consumption */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
            <div className="p-4 border-b flex items-center gap-2"><Boxes className="h-4 w-4 text-primary" /><h2 className="text-base font-semibold text-card-foreground">Finished Output → Stock</h2></div>
            <ScrollableX>
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground"><tr><th className="text-left px-4 py-2.5 font-medium">Product</th><th className="text-right px-4 py-2.5 font-medium">Quantity</th></tr></thead>
                <tbody>
                  {run.outputs.map((o, i) => (
                    <tr key={i} className="border-t"><td className="px-4 py-2.5 font-medium text-card-foreground">{o.product_name}</td><td className="px-4 py-2.5 text-right eco-nums">{qty(o.quantity, o.unit)}</td></tr>
                  ))}
                </tbody>
              </table>
            </ScrollableX>
          </div>

          <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
            <div className="p-4 border-b flex items-center gap-2"><Leaf className="h-4 w-4 text-amber-600" /><h2 className="text-base font-semibold text-card-foreground">Raw Materials Consumed</h2></div>
            <ScrollableX>
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground"><tr><th className="text-left px-4 py-2.5 font-medium">Material</th><th className="text-right px-4 py-2.5 font-medium">Quantity</th></tr></thead>
                <tbody>
                  {run.consumption.length === 0 && <tr><td colSpan={2} className="px-4 py-6 text-center text-muted-foreground">No raw materials recorded.</td></tr>}
                  {run.consumption.map((c, i) => (
                    <tr key={i} className="border-t"><td className="px-4 py-2.5 text-card-foreground">{c.name}</td><td className="px-4 py-2.5 text-right eco-nums">{qty(c.quantity, c.unit)}</td></tr>
                  ))}
                </tbody>
              </table>
            </ScrollableX>
          </div>

          {(run.spare_consumption?.length ?? 0) > 0 && (
            <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
              <div className="p-4 border-b flex items-center gap-2"><Wrench className="h-4 w-4 text-primary" /><h2 className="text-base font-semibold text-card-foreground">Spares &amp; Consumables Used</h2></div>
              <ScrollableX>
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground"><tr><th className="text-left px-4 py-2.5 font-medium">Spare / consumable</th><th className="text-right px-4 py-2.5 font-medium">Quantity</th></tr></thead>
                  <tbody>
                    {run.spare_consumption.map((c, i) => (
                      <tr key={i} className="border-t"><td className="px-4 py-2.5 text-card-foreground">{c.name}</td><td className="px-4 py-2.5 text-right eco-nums">{qty(c.quantity, c.unit)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableX>
            </div>
          )}
        </div>

        {/* Right — meta + quality */}
        <div className="space-y-6">
          <div className="bg-card rounded-xl border shadow-sm p-4">
            <h2 className="text-base font-semibold text-card-foreground mb-2">Run Details</h2>
            <dl>
              <InfoRow label="Date" value={<span className="inline-flex items-center gap-1"><CalendarDays className="h-3.5 w-3.5 text-muted-foreground" />{run.run_date}</span>} />
              <InfoRow label="Batch" value={run.batch_number || "—"} />
              <InfoRow label="Shift" value={<span className="capitalize">{run.shift}</span>} />
              <InfoRow label="Operator" value={run.operator_name ? <span className="inline-flex items-center gap-1"><User className="h-3.5 w-3.5 text-muted-foreground" />{run.operator_name}</span> : "—"} />
            </dl>
            {run.notes && <p className="text-sm text-muted-foreground mt-3 border-t pt-3">{run.notes}</p>}
          </div>

          <div className="bg-card rounded-xl border shadow-sm p-4">
            <div className="flex items-center justify-between mb-2">
              <h2 className="text-base font-semibold text-card-foreground flex items-center gap-2"><ClipboardCheck className="h-4 w-4 text-primary" /> Quality</h2>
              {q && <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium capitalize ${QUALITY_BADGE[q.result] ?? "bg-muted text-muted-foreground"}`}>{q.result}</span>}
            </div>
            {!q ? (
              <p className="text-sm text-muted-foreground">No quality check recorded for this run.</p>
            ) : (
              <>
                <dl>
                  {metrics.filter(([, v]) => v !== null).map(([label, v, unit]) => (
                    <InfoRow key={label} label={label} value={`${v}${unit ? " " + unit : ""}`} />
                  ))}
                  {q.inspector && <InfoRow label="Inspector" value={q.inspector} />}
                </dl>
                {q.notes && <p className="text-sm text-muted-foreground mt-3 border-t pt-3">{q.notes}</p>}
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
