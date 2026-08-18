import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Package, ShoppingBag, IndianRupee, Boxes } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);
const inr = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyFmt = (n: unknown) => Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });

const TYPE_META: Record<string, { label: string; badge: string }> = {
  stock: { label: "Spares & Assets", badge: "bg-primary/10 text-primary border-primary/20" },
  raw_material: { label: "Raw Material", badge: "bg-amber-50 text-amber-700 border-amber-200" },
  pellet: { label: "Pellet", badge: "bg-emerald-50 text-emerald-700 border-emerald-200" },
};
const normType = (v: unknown) => {
  const s = String(v ?? "").toLowerCase();
  if (s === "raw_material") return "raw_material";
  if (s === "pellet" || s === "pellets" || s === "finished") return "pellet";
  return "stock";
};

const PO_STATUS_STYLES: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  billed: "bg-primary/10 text-primary border-primary/20",
  received: "bg-primary/10 text-primary border-primary/20",
  partially_received: "bg-amber-50 text-amber-700 border-amber-200",
  issued: "bg-blue-50 text-blue-700 border-blue-200",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
  short_closed: "bg-amber-50 text-amber-700 border-amber-200",
  draft: "bg-muted text-muted-foreground border-border",
};

export default function PurchaseItemDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const itemId = Number(id);

  const [item, setItem] = useState<ApiRow | null>(null);
  const [orders, setOrders] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [it, pos] = await Promise.all([
        phase2Api.purchaseItems.get(itemId),
        phase2Api.purchaseItems.orders(itemId).catch(() => [] as ApiRow[]),
      ]);
      setItem(it);
      setOrders(Array.isArray(pos) ? pos : []);
    } catch (e) {
      toast.error(err(e, "Failed to load item"));
    } finally {
      setLoading(false);
    }
  }, [itemId]);
  useEffect(() => { if (itemId > 0) load(); }, [itemId, load]);

  const stats = useMemo(() => {
    const qty = orders.reduce((s, o) => s + Number(o.quantity ?? 0), 0);
    const value = orders.reduce((s, o) => s + Number(o.line_total ?? 0), 0);
    return { count: orders.length, qty, value };
  }, [orders]);

  const paged = usePagedRows(orders);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading item…</div>;
  if (!item) return (
    <div className="p-6 space-y-3">
      <p className="text-sm text-muted-foreground">Item not found.</p>
      <Button variant="outline" onClick={() => navigate("/purchase/items")}><ArrowLeft className="h-4 w-4" /> Back to Items</Button>
    </div>
  );

  const t = TYPE_META[normType(item.item_type)];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="mt-1" onClick={() => navigate("/purchase/items")}><ArrowLeft className="h-5 w-5" /></Button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">{item.name}</h1>
              <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium ${t.badge}`}>{t.label}</span>
            </div>
            <p className="text-muted-foreground">{item.item_code}{item.category ? ` · ${item.category}` : ""}</p>
          </div>
        </div>
        <Button variant="outline" onClick={() => navigate(`/purchase/items/${itemId}/edit`)}><Pencil className="h-4 w-4" /> Edit</Button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Times ordered" value={String(stats.count)} subtitle="PO lines" icon={ShoppingBag} />
        <StatCard title="Total quantity" value={qtyFmt(stats.qty)} subtitle={String(item.unit ?? "")} icon={Boxes} subtitleColor="primary" />
        <StatCard title="Total value" value={inr(stats.value)} subtitle="across POs" icon={IndianRupee} subtitleColor="primary" />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Item info */}
        <div className="bg-card rounded-xl border shadow-sm">
          <div className="p-4 border-b flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10"><Package className="h-4 w-4 text-primary" /></span>
            <h2 className="text-base font-semibold text-card-foreground">Item Details</h2>
          </div>
          <dl className="p-4 space-y-3 text-sm">
            <Field label="Type" value={t.label} />
            <Field label="Category" value={item.category} />
            <Field label="Unit" value={item.unit} />
            <Field label="Rate" value={inr(item.rate)} />
            <Field label="GST %" value={`${Number(item.gst_rate ?? 0)}%`} />
            <Field label="HSN" value={item.hsn_code} />
            <Field label="Specification" value={item.specification} />
          </dl>
        </div>

        {/* Purchase history */}
        <div className="lg:col-span-2 bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold text-card-foreground">Purchase History <span className="text-muted-foreground font-normal">({orders.length})</span></h2>
            <p className="text-xs text-muted-foreground mt-0.5">Purchase orders where this item appears (matched by name).</p>
          </div>
          <ScrollableX>
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">PO #</th>
                  <th className="text-left px-4 py-3 font-medium">Vendor</th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-right px-4 py-3 font-medium">Qty</th>
                  <th className="text-right px-4 py-3 font-medium">Rate</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">This item hasn't been ordered yet.</td></tr>}
                {paged.rows.map((o, i) => (
                  <tr key={`${o.po_id}-${i}`} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/purchase/orders/${o.po_id}`)}>
                    <td className="px-4 py-3 font-medium text-card-foreground">{o.po_number}</td>
                    <td className="px-4 py-3 text-muted-foreground">{o.vendor_name}</td>
                    <td className="px-4 py-3 text-muted-foreground">{o.order_date}</td>
                    <td className="px-4 py-3 text-right eco-nums">{qtyFmt(o.quantity)} {o.unit}</td>
                    <td className="px-4 py-3 text-right eco-nums">{inr(o.unit_price)}</td>
                    <td className="px-4 py-3 text-right eco-nums font-medium">{inr(o.line_total)}</td>
                    <td className="px-4 py-3"><StatusBadge value={String(o.status ?? "").toLowerCase()} styleMap={PO_STATUS_STYLES} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableX>
          <Pagination {...paged} onPage={paged.setPage} noun="orders" />
        </div>
      </div>
    </div>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-card-foreground text-right">{value || "—"}</dd>
    </div>
  );
}
