import { useEffect, useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Filter, CalendarRange, IndianRupee, Wallet, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatCard } from "@/components/StatCard";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { exportToPdf, exportToExcel, type ExportColumn } from "@/lib/exporters";
import { monthlyReportApi, type MonthlyRow } from "@/lib/api/monthlyReport";
import { customerReportApi, type CustomerReportRow } from "@/lib/api/customerReport";
import { toast } from "sonner";

type Preset = "12m" | "year" | "24m" | "custom";

const inr = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const startOfYear = () => `${new Date().getFullYear()}-01-01`;
const firstOfMonthAgo = (months: number) => {
  const d = new Date();
  d.setMonth(d.getMonth() - months, 1);
  return d.toISOString().slice(0, 10);
};
const currentMonthYm = () => today().slice(0, 7);
// [from, to] date bounds for a YYYY-MM month
const monthBounds = (ym: string): [string, string] => {
  const [y, m] = ym.split("-").map(Number);
  const from = `${ym}-01`;
  const to = new Date(y, m, 0).toISOString().slice(0, 10); // day 0 of next month = last day
  return [from, to];
};

export default function MonthlyReport() {
  const [preset, setPreset] = useState<Preset>("12m");
  const [from, setFrom] = useState(firstOfMonthAgo(11));
  const [to, setTo] = useState(today());
  const [drillYm, setDrillYm] = useState<string | null>(null);

  const [data, setData] = useState<Awaited<ReturnType<typeof monthlyReportApi.fetch>> | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  useEffect(() => {
    setIsFetching(true);
    monthlyReportApi.fetch(from, to)
      .then(setData)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setIsFetching(false));
  }, [from, to]);

  const rows = data?.rows ?? [];
  const totals = data?.totals ?? { invoiced: 0, collected: 0, expenses: 0, net: 0, invoices: 0 };
  const curYm = currentMonthYm();

  const onPreset = (p: Preset) => {
    setPreset(p);
    if (p === "12m") { setFrom(firstOfMonthAgo(11)); setTo(today()); }
    else if (p === "24m") { setFrom(firstOfMonthAgo(23)); setTo(today()); }
    else if (p === "year") { setFrom(startOfYear()); setTo(today()); }
  };

  const columns: ExportColumn<MonthlyRow>[] = [
    { header: "Month", key: "label" },
    { header: "Invoices", key: (r) => r.invoices },
    { header: "Invoiced (₹)", key: (r) => r.invoiced.toLocaleString("en-IN") },
    { header: "Collected (₹)", key: (r) => r.collected.toLocaleString("en-IN") },
    { header: "Expenses (₹)", key: (r) => r.expenses.toLocaleString("en-IN") },
    { header: "Net (₹)", key: (r) => r.net.toLocaleString("en-IN") },
  ];
  const subtitle = `${from} → ${to} · Invoiced ${inr(totals.invoiced)} · Expenses ${inr(totals.expenses)} · Net ${inr(totals.net)}`;
  const onExportPdf = () => { if (!rows.length) return toast.error("Nothing to export"); exportToPdf({ title: "Monthly Report", subtitle, columns, rows, filename: `monthly-report-${from}_to_${to}` }); toast.success("PDF generated"); };
  const onExportXlsx = () => { if (!rows.length) return toast.error("Nothing to export"); exportToExcel({ sheetName: "Monthly Report", columns, rows, filename: `monthly-report-${from}_to_${to}` }); toast.success("Excel generated"); };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Monthly Report</h1>
        <p className="text-muted-foreground">Month-by-month sales, collections, expenses & net. Click a month to see its customer-wise breakdown.</p>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3 text-sm font-medium text-card-foreground"><Filter className="h-4 w-4" /> Filters</div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div className="md:col-span-2">
            <Label className="text-xs">Range</Label>
            <Select value={preset} onValueChange={(v) => onPreset(v as Preset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="12m">Last 12 months</SelectItem>
                <SelectItem value="24m">Last 24 months</SelectItem>
                <SelectItem value="year">This year</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} /></div>
          <div className="md:col-span-2 flex gap-2 justify-end">
            <Button variant="outline" onClick={onExportXlsx}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
            <Button onClick={onExportPdf}><FileDown className="h-4 w-4" /> PDF</Button>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Invoiced" value={inr(totals.invoiced)} subtitle={`${totals.invoices} invoices`} icon={IndianRupee} />
        <StatCard title="Collected" value={inr(totals.collected)} subtitle="payments received" icon={Wallet} />
        <StatCard title="Expenses" value={inr(totals.expenses)} subtitle="operating costs" icon={CalendarRange} subtitleColor="muted" />
        <StatCard title="Net" value={inr(totals.net)} subtitle="invoiced − expenses" icon={TrendingUp} />
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Month</th>
                <th className="text-right px-4 py-3 font-medium">Invoices</th>
                <th className="text-right px-4 py-3 font-medium">Invoiced</th>
                <th className="text-right px-4 py-3 font-medium">Collected</th>
                <th className="text-right px-4 py-3 font-medium">Expenses</th>
                <th className="text-right px-4 py-3 font-medium">Net</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">{isFetching ? "Loading…" : "No data in this range."}</td></tr>}
              {rows.map((r) => (
                <tr key={r.month} className={`border-t hover:bg-muted/30 cursor-pointer ${r.month === curYm ? "bg-primary/5" : ""}`} onClick={() => setDrillYm(r.month)}>
                  <td className="px-4 py-3 font-medium text-card-foreground">{r.label}{r.month === curYm && <span className="ml-2 text-xs px-1.5 py-0.5 rounded bg-primary/15 text-primary">current</span>}</td>
                  <td className="px-4 py-3 text-right">{r.invoices}</td>
                  <td className="px-4 py-3 text-right font-semibold">{inr(r.invoiced)}</td>
                  <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">{inr(r.collected)}</td>
                  <td className="px-4 py-3 text-right text-amber-600 dark:text-amber-400">{inr(r.expenses)}</td>
                  <td className={`px-4 py-3 text-right font-semibold ${r.net < 0 ? "text-destructive" : ""}`}>{inr(r.net)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t bg-muted/30 font-semibold">
                <tr>
                  <td className="px-4 py-3">Total</td>
                  <td className="px-4 py-3 text-right">{totals.invoices}</td>
                  <td className="px-4 py-3 text-right">{inr(totals.invoiced)}</td>
                  <td className="px-4 py-3 text-right">{inr(totals.collected)}</td>
                  <td className="px-4 py-3 text-right">{inr(totals.expenses)}</td>
                  <td className="px-4 py-3 text-right">{inr(totals.net)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </ScrollableX>
      </div>

      <MonthDrill ym={drillYm} onClose={() => setDrillYm(null)} />
    </div>
  );
}

// ── Per-month customer-wise breakdown (reuses the customers endpoint) ─────────
function MonthDrill({ ym, onClose }: { ym: string | null; onClose: () => void }) {
  const bounds = ym ? monthBounds(ym) : null;
  const label = ym ? new Date(ym + "-01").toLocaleString("en-IN", { month: "long", year: "numeric" }) : "";
  const [data, setData] = useState<Awaited<ReturnType<typeof customerReportApi.fetch>> | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  useEffect(() => {
    if (!ym || !bounds) { setData(null); return; }
    setIsFetching(true);
    customerReportApi.fetch(bounds[0], bounds[1])
      .then(setData)
      .catch(() => {})
      .finally(() => setIsFetching(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym]);
  const rows = data?.rows ?? [];

  const columns: ExportColumn<CustomerReportRow>[] = [
    { header: "Customer", key: "customer" },
    { header: "GSTIN", key: (r) => r.gstin || "—" },
    { header: "Invoices", key: (r) => r.invoice_count },
    { header: "Invoiced (₹)", key: (r) => r.total_invoiced.toLocaleString("en-IN") },
    { header: "Paid (₹)", key: (r) => r.total_paid.toLocaleString("en-IN") },
    { header: "Outstanding (₹)", key: (r) => r.outstanding.toLocaleString("en-IN") },
  ];
  const exportMonth = (fn: typeof exportToPdf | typeof exportToExcel) => {
    if (!rows.length) return toast.error("Nothing to export");
    if (fn === exportToPdf) exportToPdf({ title: `Customer Report — ${label}`, subtitle: `${rows.length} customers`, columns, rows, filename: `customer-report-${ym}` });
    else exportToExcel({ sheetName: `Customers ${ym}`, columns, rows, filename: `customer-report-${ym}` });
    toast.success("Export generated");
  };

  return (
    <Dialog open={!!ym} onOpenChange={(o) => !o && onClose()}>
      <DialogScrollContent className="max-w-3xl">
        <DialogHeader><DialogTitle>Customer-wise · {label}</DialogTitle></DialogHeader>
        <div className="flex gap-2 justify-end">
          <Button size="sm" variant="outline" onClick={() => exportMonth(exportToExcel)}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
          <Button size="sm" onClick={() => exportMonth(exportToPdf)}><FileDown className="h-4 w-4" /> PDF</Button>
        </div>
        <div className="max-h-[55vh] overflow-auto rounded-lg border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Customer</th>
                <th className="text-right px-3 py-2 font-medium">Invoices</th>
                <th className="text-right px-3 py-2 font-medium">Invoiced</th>
                <th className="text-right px-3 py-2 font-medium">Outstanding</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr><td colSpan={4} className="text-center py-8 text-muted-foreground">{isFetching ? "Loading…" : "No invoices this month."}</td></tr>}
              {rows.map((r) => (
                <tr key={r.customer} className="border-t">
                  <td className="px-3 py-2 font-medium">{r.customer}</td>
                  <td className="px-3 py-2 text-right">{r.invoice_count}</td>
                  <td className="px-3 py-2 text-right font-semibold">{inr(r.total_invoiced)}</td>
                  <td className="px-3 py-2 text-right text-amber-600 dark:text-amber-400">{inr(r.outstanding)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </DialogScrollContent>
    </Dialog>
  );
}
