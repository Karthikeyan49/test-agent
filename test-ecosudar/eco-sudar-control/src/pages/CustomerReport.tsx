import { useEffect, useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Users, Filter, IndianRupee, Wallet, Receipt } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatCard } from "@/components/StatCard";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { exportToPdf, exportToExcel, type ExportColumn } from "@/lib/exporters";
import { customerReportApi, type CustomerReportRow, type CustomerReportInvoice } from "@/lib/api/customerReport";
import { toast } from "sonner";

type Preset = "all" | "year" | "12m" | "month" | "custom";

const inr = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const startOfYear = () => `${new Date().getFullYear()}-01-01`;
const startOfMonth = () => today().slice(0, 8) + "01";
const minus = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const ALL_TIME_FROM = "2000-01-01";

export default function CustomerReport() {
  const [preset, setPreset] = useState<Preset>("all");
  const [from, setFrom] = useState(ALL_TIME_FROM);
  const [to, setTo] = useState(today());
  const [search, setSearch] = useState("");
  const [detail, setDetail] = useState<CustomerReportRow | null>(null);

  const [data, setData] = useState<Awaited<ReturnType<typeof customerReportApi.fetch>> | null>(null);
  const [isFetching, setIsFetching] = useState(false);

  useEffect(() => {
    setIsFetching(true);
    customerReportApi.fetch(from, to)
      .then(setData)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setIsFetching(false));
  }, [from, to]);

  const allRows = data?.rows ?? [];

  const onPreset = (p: Preset) => {
    setPreset(p);
    if (p === "all") { setFrom(ALL_TIME_FROM); setTo(today()); }
    else if (p === "year") { setFrom(startOfYear()); setTo(today()); }
    else if (p === "12m") { setFrom(minus(365)); setTo(today()); }
    else if (p === "month") { setFrom(startOfMonth()); setTo(today()); }
  };

  const rows = useMemo(() => {
    if (!search) return allRows;
    const q = search.toLowerCase();
    return allRows.filter(
      (r) => r.customer.toLowerCase().includes(q) || r.gstin.toLowerCase().includes(q) || r.state.toLowerCase().includes(q),
    );
  }, [allRows, search]);

  const stats = useMemo(() => ({
    customers: rows.length,
    invoiced: rows.reduce((s, r) => s + r.total_invoiced, 0),
    paid: rows.reduce((s, r) => s + r.total_paid, 0),
    outstanding: rows.reduce((s, r) => s + r.outstanding, 0),
  }), [rows]);

  const rangeLabel = preset === "all" ? "All time" : `${from} → ${to}`;
  const subtitle = `${rangeLabel} · ${rows.length} customers · Invoiced ${inr(stats.invoiced)} · Outstanding ${inr(stats.outstanding)}`;

  const columns: ExportColumn<CustomerReportRow>[] = [
    { header: "Customer", key: "customer" },
    { header: "GSTIN", key: (r) => r.gstin || "—" },
    { header: "State", key: (r) => r.state || "—" },
    { header: "Invoices", key: (r) => r.invoice_count },
    { header: "Invoiced (₹)", key: (r) => r.total_invoiced.toLocaleString("en-IN") },
    { header: "Paid (₹)", key: (r) => r.total_paid.toLocaleString("en-IN") },
    { header: "Outstanding (₹)", key: (r) => r.outstanding.toLocaleString("en-IN") },
    { header: "Last Invoice", key: (r) => r.last_invoice || "—" },
  ];

  const fileStamp = preset === "all" ? "all-time" : `${from}_to_${to}`;

  const onExportPdf = () => {
    if (!rows.length) { toast.error("No customers to export"); return; }
    exportToPdf({ title: "Customer-wise Report", subtitle, columns, rows, filename: `customer-report-${fileStamp}` });
    toast.success("PDF generated");
  };
  const onExportXlsx = () => {
    if (!rows.length) { toast.error("No customers to export"); return; }
    exportToExcel({ sheetName: "Customer Report", columns, rows, filename: `customer-report-${fileStamp}` });
    toast.success("Excel generated");
  };

  // ── Per-customer statement export ──────────────────────────────────────────
  const invoiceColumns: ExportColumn<CustomerReportInvoice>[] = [
    { header: "Invoice #", key: "invoice_number" },
    { header: "Date", key: "date" },
    { header: "Total (₹)", key: (r) => r.total.toLocaleString("en-IN") },
    { header: "Paid (₹)", key: (r) => r.paid.toLocaleString("en-IN") },
    { header: "Balance (₹)", key: (r) => r.balance.toLocaleString("en-IN") },
    { header: "Status", key: "status" },
  ];
  const safeName = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "customer";
  const exportCustomerPdf = (c: CustomerReportRow) => {
    exportToPdf({
      title: `Statement — ${c.customer}`,
      subtitle: `${c.gstin ? "GSTIN " + c.gstin + " · " : ""}Invoiced ${inr(c.total_invoiced)} · Paid ${inr(c.total_paid)} · Outstanding ${inr(c.outstanding)}`,
      columns: invoiceColumns,
      rows: c.invoices,
      filename: `statement-${safeName(c.customer)}`,
    });
    toast.success("Statement PDF generated");
  };
  const exportCustomerXlsx = (c: CustomerReportRow) => {
    exportToExcel({ sheetName: "Statement", columns: invoiceColumns, rows: c.invoices, filename: `statement-${safeName(c.customer)}` });
    toast.success("Statement Excel generated");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Customer Report</h1>
        <p className="text-muted-foreground">Customer-wise sales, collections & outstanding. Click a row to view invoices; export to PDF or Excel.</p>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3 text-sm font-medium text-card-foreground">
          <Filter className="h-4 w-4" /> Filters
        </div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div className="md:col-span-2">
            <Label className="text-xs">Period</Label>
            <Select value={preset} onValueChange={(v) => onPreset(v as Preset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="year">This year</SelectItem>
                <SelectItem value="12m">Last 12 months</SelectItem>
                <SelectItem value="month">This month</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} /></div>
          <div className="md:col-span-2"><Label className="text-xs">Search</Label><Input placeholder="customer, GSTIN, state..." value={search} onChange={(e) => setSearch(e.target.value)} /></div>
        </div>
        <div className="flex gap-2 mt-4 justify-end">
          <Button variant="outline" onClick={onExportXlsx}><FileSpreadsheet className="h-4 w-4" /> Export Excel</Button>
          <Button onClick={onExportPdf}><FileDown className="h-4 w-4" /> Export PDF</Button>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Customers" value={String(stats.customers)} subtitle="in this report" icon={Users} />
        <StatCard title="Total Invoiced" value={inr(stats.invoiced)} subtitle="excl. cancelled" icon={IndianRupee} />
        <StatCard title="Collected" value={inr(stats.paid)} subtitle="amount received" icon={Wallet} />
        <StatCard title="Outstanding" value={inr(stats.outstanding)} subtitle="pending collection" icon={Receipt} subtitleColor="muted" />
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Customer</th>
                <th className="text-left px-4 py-3 font-medium">GSTIN</th>
                <th className="text-left px-4 py-3 font-medium">State</th>
                <th className="text-right px-4 py-3 font-medium">Invoices</th>
                <th className="text-right px-4 py-3 font-medium">Invoiced</th>
                <th className="text-right px-4 py-3 font-medium">Paid</th>
                <th className="text-right px-4 py-3 font-medium">Outstanding</th>
                <th className="text-left px-4 py-3 font-medium">Last Invoice</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={8} className="text-center py-10 text-muted-foreground">{isFetching ? "Loading…" : "No customers in this range."}</td></tr>
              )}
              {rows.map((r) => (
                <tr key={r.customer} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setDetail(r)}>
                  <td className="px-4 py-3 font-medium text-card-foreground">{r.customer}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.gstin || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.state || "—"}</td>
                  <td className="px-4 py-3 text-right">{r.invoice_count}</td>
                  <td className="px-4 py-3 text-right font-semibold">{inr(r.total_invoiced)}</td>
                  <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">{inr(r.total_paid)}</td>
                  <td className={`px-4 py-3 text-right font-medium ${r.outstanding > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`}>{inr(r.outstanding)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.last_invoice || "—"}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t bg-muted/30 font-semibold">
                <tr>
                  <td className="px-4 py-3" colSpan={3}>Total ({rows.length})</td>
                  <td className="px-4 py-3 text-right">{rows.reduce((s, r) => s + r.invoice_count, 0)}</td>
                  <td className="px-4 py-3 text-right">{inr(stats.invoiced)}</td>
                  <td className="px-4 py-3 text-right">{inr(stats.paid)}</td>
                  <td className="px-4 py-3 text-right">{inr(stats.outstanding)}</td>
                  <td className="px-4 py-3"></td>
                </tr>
              </tfoot>
            )}
          </table>
        </ScrollableX>
      </div>

      {/* Per-customer drill-down */}
      <Dialog open={!!detail} onOpenChange={(o) => !o && setDetail(null)}>
        <DialogScrollContent className="max-w-3xl">
          {detail && (
            <>
              <DialogHeader>
                <DialogTitle>{detail.customer}</DialogTitle>
              </DialogHeader>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div><div className="text-xs text-muted-foreground">GSTIN</div><div className="font-medium">{detail.gstin || "—"}</div></div>
                <div><div className="text-xs text-muted-foreground">Invoices</div><div className="font-medium">{detail.invoice_count}</div></div>
                <div><div className="text-xs text-muted-foreground">Invoiced</div><div className="font-medium">{inr(detail.total_invoiced)}</div></div>
                <div><div className="text-xs text-muted-foreground">Outstanding</div><div className="font-medium text-amber-600 dark:text-amber-400">{inr(detail.outstanding)}</div></div>
              </div>
              <div className="flex gap-2 justify-end">
                <Button size="sm" variant="outline" onClick={() => exportCustomerXlsx(detail)}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
                <Button size="sm" onClick={() => exportCustomerPdf(detail)}><FileDown className="h-4 w-4" /> PDF Statement</Button>
              </div>
              <div className="max-h-[50vh] overflow-auto rounded-lg border">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-muted-foreground sticky top-0">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Invoice #</th>
                      <th className="text-left px-3 py-2 font-medium">Date</th>
                      <th className="text-right px-3 py-2 font-medium">Total</th>
                      <th className="text-right px-3 py-2 font-medium">Paid</th>
                      <th className="text-right px-3 py-2 font-medium">Balance</th>
                      <th className="text-left px-3 py-2 font-medium">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {detail.invoices.map((iv, i) => (
                      <tr key={iv.invoice_number + i} className="border-t">
                        <td className="px-3 py-2 font-medium">{iv.invoice_number}</td>
                        <td className="px-3 py-2 text-muted-foreground">{iv.date}</td>
                        <td className="px-3 py-2 text-right">{inr(iv.total)}</td>
                        <td className="px-3 py-2 text-right">{inr(iv.paid)}</td>
                        <td className="px-3 py-2 text-right">{inr(iv.balance)}</td>
                        <td className="px-3 py-2">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${iv.status.toLowerCase() === "cancelled" ? "bg-destructive/10 text-destructive" : "bg-secondary text-secondary-foreground"}`}>{iv.status}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </DialogScrollContent>
      </Dialog>
    </div>
  );
}
