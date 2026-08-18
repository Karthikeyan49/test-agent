import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Plus, Building2, ShoppingBag, IndianRupee, PackageMinus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { StatCard } from "@/components/StatCard";
import { StatusBadge } from "@/components/StatusBadge";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { TableSkeleton } from "@/components/TableSkeleton";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);
const inr = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

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
const PAY_STATUS_STYLES: Record<string, string> = {
  paid: "bg-emerald-50 text-emerald-700 border-emerald-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  unpaid: "bg-red-50 text-red-600 border-red-200",
};

export default function VendorDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const vendorId = Number(id);

  const [vendor, setVendor] = useState<ApiRow | null>(null);
  const [orders, setOrders] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [v, pos] = await Promise.all([
        phase2Api.vendors.get(vendorId),
        phase2Api.purchaseOrders.list({ vendor_id: vendorId, limit: 200 }).catch(() => [] as ApiRow[]),
      ]);
      setVendor(v);
      setOrders(Array.isArray(pos) ? pos : []);
    } catch (e) {
      toast.error(err(e, "Failed to load vendor"));
    } finally {
      setLoading(false);
    }
  }, [vendorId]);
  useEffect(() => { if (vendorId > 0) load(); }, [vendorId, load]);

  const stats = useMemo(() => {
    const totalValue = orders.reduce((s, o) => s + Number(o.total ?? 0), 0);
    const open = orders.filter((o) => !["paid", "cancelled"].includes(String(o.status ?? "").toLowerCase())).length;
    return { count: orders.length, totalValue, open };
  }, [orders]);

  const paged = usePagedRows(orders);

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading vendor…</div>;
  if (!vendor) return (
    <div className="p-6 space-y-3">
      <p className="text-sm text-muted-foreground">Vendor not found.</p>
      <Button variant="outline" onClick={() => navigate("/purchase/vendors")}><ArrowLeft className="h-4 w-4" /> Back to Vendors</Button>
    </div>
  );

  const active = vendor.is_active === undefined ? true : !!Number(vendor.is_active);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="mt-1" onClick={() => navigate("/purchase/vendors")}><ArrowLeft className="h-5 w-5" /></Button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">{vendor.name}</h1>
              <StatusBadge value={active ? "active" : "inactive"} styleMap={{ active: "bg-emerald-50 text-emerald-700 border-emerald-200", inactive: "bg-muted text-muted-foreground border-border" }} />
            </div>
            <p className="text-muted-foreground">{vendor.vendor_code}{vendor.gstin ? ` · GSTIN ${vendor.gstin}` : ""}</p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Button onClick={() => navigate(`/purchase/orders/new?vendor_id=${vendorId}`)}><Plus className="h-4 w-4" /> New PO</Button>
          <Button variant="outline" onClick={() => navigate(`/purchase/vendors/${vendorId}/edit`)}><Pencil className="h-4 w-4" /> Edit</Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard title="Purchase orders" value={String(stats.count)} subtitle="all time" icon={ShoppingBag} />
        <StatCard title="Total ordered" value={inr(stats.totalValue)} subtitle="across all POs" icon={IndianRupee} subtitleColor="primary" />
        <StatCard title="Open POs" value={String(stats.open)} subtitle="not paid / cancelled" icon={PackageMinus} subtitleColor={stats.open ? "muted" : "primary"} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Vendor info */}
        <div className="bg-card rounded-xl border shadow-sm">
          <div className="p-4 border-b flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10"><Building2 className="h-4 w-4 text-primary" /></span>
            <h2 className="text-base font-semibold text-card-foreground">Vendor Details</h2>
          </div>
          <dl className="p-4 space-y-3 text-sm">
            <Field label="Contact" value={vendor.contact_name} />
            <Field label="Phone" value={[vendor.phone, vendor.mobile].filter(Boolean).join(" / ")} />
            <Field label="Email" value={vendor.email} />
            <Field label="PAN" value={vendor.pan} />
            <Field label="Address" value={[vendor.address, vendor.city, vendor.state, vendor.pincode].filter(Boolean).join(", ")} />
            <Field label="Payment Terms" value={vendor.payment_terms} />
            <Field label="Bank" value={[vendor.bank_name, vendor.bank_account_number, vendor.bank_ifsc].filter(Boolean).join(" · ")} />
            {vendor.notes ? <Field label="Notes" value={vendor.notes} /> : null}
          </dl>
        </div>

        {/* Purchase orders */}
        <div className="lg:col-span-2 bg-card rounded-xl border shadow-sm overflow-hidden">
          <div className="p-4 border-b">
            <h2 className="text-base font-semibold text-card-foreground">Purchase Orders <span className="text-muted-foreground font-normal">({orders.length})</span></h2>
          </div>
          <ScrollableX>
            <table className="w-full text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="text-left px-4 py-3 font-medium">PO #</th>
                  <th className="text-left px-4 py-3 font-medium">Date</th>
                  <th className="text-left px-4 py-3 font-medium">Status</th>
                  <th className="text-left px-4 py-3 font-medium">Payment</th>
                  <th className="text-right px-4 py-3 font-medium">Total</th>
                </tr>
              </thead>
              <tbody>
                {orders.length === 0 && <tr><td colSpan={5} className="text-center py-10 text-muted-foreground">No purchase orders for this vendor yet.</td></tr>}
                {paged.rows.map((o) => (
                  <tr key={o.po_id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/purchase/orders/${o.po_id}`)}>
                    <td className="px-4 py-3 font-medium text-card-foreground">{o.po_number}</td>
                    <td className="px-4 py-3 text-muted-foreground">{o.order_date}</td>
                    <td className="px-4 py-3"><StatusBadge value={String(o.status ?? "").toLowerCase()} styleMap={PO_STATUS_STYLES} /></td>
                    <td className="px-4 py-3"><StatusBadge value={String(o.payment_status ?? "unpaid").toLowerCase()} styleMap={PAY_STATUS_STYLES} /></td>
                    <td className="px-4 py-3 text-right eco-nums font-medium">{inr(o.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollableX>
          <Pagination {...paged} onPage={paged.setPage} noun="POs" />
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
