import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Boxes, Factory, PackageSearch, AlertTriangle, ArrowRight, TrendingUp } from "lucide-react";
import { StatCard } from "@/components/StatCard";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { toast } from "sonner";
import { inventoryApi, inr, qty, type InventoryOverview as Overview } from "@/lib/api/inventory";

export default function InventoryOverview() {
  const navigate = useNavigate();
  const [data, setData] = useState<Overview | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    inventoryApi.overview()
      .then(setData)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load inventory overview"))
      .finally(() => setLoading(false));
  }, []);

  const maxTrend = Math.max(1, ...(data?.trend ?? []).map((t) => t.output));

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Inventory &amp; Production</h1>
          <p className="text-muted-foreground">Plant overview — raw materials, daily output and finished-goods stock.</p>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Finished Stock Value" value={inr(data?.finished_goods.stock_value ?? 0)}
          subtitle={`${data?.finished_goods.sku_count ?? 0} SKUs`} icon={Boxes} />
        <StatCard title="Output (30 days)" value={qty(data?.production.output_30d ?? 0, "kg")}
          subtitle={`${data?.production.runs_30d ?? 0} runs`} icon={Factory} accent="violet" />
        <StatCard title="Raw Materials" value={String(data?.raw_materials.count ?? 0)}
          subtitle={`${data?.raw_materials.low_stock ?? 0} below reorder`} icon={PackageSearch}
          subtitleColor="muted" accent="amber" />
        <StatCard title="Low-Stock Alerts" value={String((data?.raw_materials.low_stock ?? 0) + (data?.finished_goods.low_stock ?? 0))}
          subtitle="raw + finished" icon={AlertTriangle} accent="rose" />
      </div>

      {/* Production trend + category stock */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border shadow-sm p-5">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="h-4 w-4 text-primary" />
            <h2 className="font-semibold text-card-foreground">Production — last 14 days</h2>
          </div>
          {(!data || data.trend.length === 0) && (
            <p className="text-sm text-muted-foreground py-8 text-center">{loading ? "Loading…" : "No production logged yet."}</p>
          )}
          {data && data.trend.length > 0 && (
            <div className="flex items-end gap-1.5 h-40">
              {data.trend.map((t) => (
                <div key={t.date} className="flex-1 flex flex-col items-center justify-end gap-1" title={`${t.date}: ${qty(t.output, "kg")}`}>
                  <div className="w-full rounded-t bg-primary/70 hover:bg-primary transition-colors"
                    style={{ height: `${Math.max(4, (t.output / maxTrend) * 100)}%` }} />
                  <span className="text-[9px] text-muted-foreground">{t.date.slice(5)}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border shadow-sm p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold text-card-foreground">Stock by category</h2>
            <button onClick={() => navigate("/inventory/stock")} className="text-xs text-primary hover:underline flex items-center gap-1">
              View all <ArrowRight className="h-3 w-3" />
            </button>
          </div>
          <div className="space-y-2">
            {(data?.category_stock ?? []).map((c) => (
              <div key={c.category} className="flex items-center justify-between rounded-lg bg-muted/40 px-3 py-2.5">
                <div>
                  <p className="text-sm font-medium text-card-foreground capitalize">{c.category}</p>
                  <p className="text-xs text-muted-foreground">{c.sku_count} SKUs · {inr(c.stock_value)}</p>
                </div>
                <div className="text-right">
                  <p className="text-sm font-semibold text-card-foreground eco-nums">{qty(c.total_stock)}</p>
                  {c.low_count > 0 && <p className="text-xs text-destructive">{c.low_count} low</p>}
                </div>
              </div>
            ))}
            {(!data || data.category_stock.length === 0) && (
              <p className="text-sm text-muted-foreground py-6 text-center">{loading ? "Loading…" : "No products."}</p>
            )}
          </div>
        </div>
      </div>

      {/* Reorder suggestions */}
      <div className="bg-card rounded-xl border shadow-sm p-5">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-amber-500" />
            <h2 className="font-semibold text-card-foreground">Reorder suggestions</h2>
          </div>
          <button onClick={() => navigate("/inventory/raw-materials")} className="text-xs text-primary hover:underline">Manage raw materials</button>
        </div>
        {(data?.suggestions ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground py-4 text-center">{loading ? "Loading…" : "Everything is above its reorder level. 🎉"}</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {data!.suggestions.map((s) => (
              <div key={`${s.kind}-${s.id}`} className="rounded-lg border border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/10 p-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-card-foreground truncate">{s.name}</p>
                  <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300">{s.kind}</span>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  {qty(s.current, s.unit)} left · reorder at {qty(s.reorder_level, s.unit)}
                </p>
                <p className="text-xs font-medium text-amber-700 dark:text-amber-300 mt-1">Suggest order: {qty(s.suggested_order, s.unit)}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Recent movements */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <h2 className="font-semibold text-card-foreground">Recent stock movements</h2>
          <button onClick={() => navigate("/inventory/movements")} className="text-xs text-primary hover:underline flex items-center gap-1">
            All movements <ArrowRight className="h-3 w-3" />
          </button>
        </div>
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Item</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-right px-4 py-3 font-medium">Qty</th>
                <th className="text-left px-4 py-3 font-medium">Reference</th>
              </tr>
            </thead>
            <tbody>
              {(data?.recent_movements ?? []).length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">{loading ? "Loading…" : "No movements yet."}</td></tr>
              )}
              {(data?.recent_movements ?? []).map((m) => (
                <tr key={m.stock_movement_id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3">{m.movement_date}</td>
                  <td className="px-4 py-3 font-medium text-card-foreground">{m.product_name}</td>
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
      </div>
    </div>
  );
}
