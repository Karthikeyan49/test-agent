import { useEffect, useMemo, useState } from "react";
import { Plus, Send, IndianRupee, PackageCheck, Trash2 } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { toast } from "sonner";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { ExportMenu } from "@/components/ExportMenu";
import { type ExportColumnDef } from "@/components/ExportDialog";
import { FilterBar, FilterSearch, FilterSelect, matchesFilter, ALL } from "@/components/Filters";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { TableSkeleton } from "@/components/TableSkeleton";
import { StatusBadge } from "@/components/StatusBadge";

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);
const inr = (n: number) => `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const RECEIVED_STATES = ["received", "short_closed", "billed"];
const PO_STATUS_OPTIONS = [
  { value: "draft", label: "Draft" }, { value: "issued", label: "Issued" },
  { value: "received", label: "Received" }, { value: "short_closed", label: "Short closed" },
  { value: "billed", label: "Billed" }, { value: "cancelled", label: "Cancelled" },
];

const PO_STATUS_STYLES: Record<string, string> = {
  billed:      "bg-primary/10 text-primary border-primary/20",
  received:    "bg-primary/10 text-primary border-primary/20",
  issued:      "bg-blue-50 text-blue-700 border-blue-200",
  cancelled:   "bg-destructive/10 text-destructive border-destructive/20",
  short_closed:"bg-amber-50 text-amber-700 border-amber-200",
  draft:       "bg-muted text-muted-foreground border-border",
};

export default function PurchaseOrders() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ApiRow[]>([]);
  const [vendors, setVendors] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [vendorFilter, setVendorFilter] = useState(ALL);
  const [statusFilter, setStatusFilter] = useState(ALL);

  const load = () => {
    setLoading(true);
    phase2Api.purchaseOrders.list().then(setItems)
      .catch((e) => toast.error(err(e, "Failed to load purchase orders")))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);
  useEffect(() => { phase2Api.vendors.list().then(setVendors).catch(() => {}); }, []);

  const vendorName = (r: ApiRow) => r.vendor_name ?? vendors.find((v) => v.vendor_id === r.vendor_id)?.name ?? `Vendor #${r.vendor_id}`;

  const vendorOptions = useMemo(
    () => vendors.map((v) => ({ value: String(v.vendor_id), label: String(v.name ?? `Vendor #${v.vendor_id}`) }))
      .sort((a, b) => a.label.localeCompare(b.label)),
    [vendors],
  );

  const filtered = useMemo(() => items
    .filter((r) => {
      const q = search.toLowerCase();
      const matchesSearch = !q || String(r.po_number ?? "").toLowerCase().includes(q) || vendorName(r).toLowerCase().includes(q);
      const matchesStatus = statusFilter === ALL || String(r.status).toLowerCase() === statusFilter;
      return matchesSearch && matchesFilter(vendorFilter, r.vendor_id) && matchesStatus;
    }), [items, search, vendorFilter, statusFilter, vendors]);

  const paged = usePagedRows(filtered);

  const exportColumns = useMemo<ExportColumnDef<ApiRow>[]>(() => [
    { header: "PO", key: "po_number" },
    { header: "Vendor", key: (r) => vendorName(r) },
    { header: "Order Date", key: "order_date" },
    { header: "Expected", key: "expected_date" },
    { header: "Total", key: "total" },
    { header: "Status", key: "status" },
    { header: "Payment", key: "payment_status" },
    { header: "Reference", key: "reference_number", group: "detail", defaultChecked: false },
    { header: "Subtotal", key: "subtotal", group: "detail", defaultChecked: false },
    { header: "Tax", key: "tax_amount", group: "detail", defaultChecked: false },
    { header: "GST Treatment", key: "gst_treatment", group: "detail", defaultChecked: false },
    { header: "Notes", key: "notes", group: "detail", defaultChecked: false },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [vendors]);

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast.success(ok); load(); } catch (e) { toast.error(err(e, "Action failed")); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Purchase Orders</h1>
          <p className="text-muted-foreground">Raise and track purchase orders to vendors.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu title="Purchase Orders" columns={exportColumns} rows={filtered} dateField="order_date" filename="purchase-orders" />
          <Button onClick={() => navigate("/purchase/orders/new")}><Plus className="h-4 w-4" /> New PO</Button>
        </div>
      </div>

      <FilterBar>
        <FilterSearch value={search} onChange={setSearch} placeholder="Search PO or vendor…" />
        <FilterSelect label="Vendor" value={vendorFilter} onChange={setVendorFilter} options={vendorOptions} />
        <FilterSelect label="Status" value={statusFilter} onChange={setStatusFilter} options={PO_STATUS_OPTIONS} />
      </FilterBar>

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr className="whitespace-nowrap">
                <th className="text-left px-4 py-3 font-medium">PO</th>
                <th className="text-left px-4 py-3 font-medium">Vendor</th>
                <th className="text-left px-4 py-3 font-medium">Order Date</th>
                <th className="text-right px-4 py-3 font-medium">Total</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Payment</th>
                <th className="text-right px-4 py-3 font-medium w-px">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={7} />}
              {!loading && filtered.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No purchase orders.</td></tr>}
              {!loading && paged.rows.map((r) => {
                const st = String(r.status).toLowerCase();
                return (
                  <tr key={r.po_id} className="border-t hover:bg-muted/30 cursor-pointer align-middle" onClick={() => navigate(`/purchase/orders/${r.po_id}`)}>
                    <td className="px-4 py-3 font-medium text-card-foreground whitespace-nowrap">{r.po_number}</td>
                    <td className="px-4 py-3">{vendorName(r)}</td>
                    <td className="px-4 py-3 text-muted-foreground whitespace-nowrap">{r.order_date}</td>
                    <td className="px-4 py-3 text-right font-semibold eco-nums whitespace-nowrap">{inr(r.total)}</td>
                    <td className="px-4 py-3"><StatusBadge value={String(r.status).toLowerCase()} styleMap={PO_STATUS_STYLES} /></td>
                    <td className="px-4 py-3"><span className="text-xs text-muted-foreground capitalize">{r.payment_status || "unpaid"}</span></td>
                    <td className="px-4 py-3 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                      <div className="inline-flex gap-1">
                        {st === "draft" && <Button size="sm" variant="outline" onClick={() => act(() => phase2Api.purchaseOrders.issue(r.po_id), "PO issued")}><Send className="h-3.5 w-3.5" /> Issue</Button>}
                        {RECEIVED_STATES.includes(st) && String(r.payment_status).toLowerCase() !== "paid" && st !== "billed" &&
                          <Button size="sm" variant="outline" onClick={() => act(() => phase2Api.purchaseOrders.bill(r.po_id), "Bill recorded as expense")}><IndianRupee className="h-3.5 w-3.5" /> Bill</Button>}
                        {["draft", "issued"].includes(st) && <Button size="icon" variant="ghost" title="Cancel" onClick={() => act(() => phase2Api.purchaseOrders.cancel(r.po_id), "PO cancelled")}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                        {st === "billed" && <span className="inline-flex items-center gap-1 text-xs text-primary"><PackageCheck className="h-3.5 w-3.5" /> billed</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun="purchase orders" />
      </div>
    </div>
  );
}
