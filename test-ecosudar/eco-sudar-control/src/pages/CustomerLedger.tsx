import { useEffect, useMemo, useState } from "react";
import { FileDown, FileSpreadsheet, Filter, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { StatCard } from "@/components/StatCard";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { exportToPdf, exportToExcel, type ExportColumn } from "@/lib/exporters";
import { customerReportApi } from "@/lib/api/customerReport";
import { customerLedgerApi, type LedgerRow } from "@/lib/api/customerLedger";
import { toast } from "sonner";

type Preset = "all" | "year" | "12m" | "custom";

const inr = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const startOfYear = () => `${new Date().getFullYear()}-01-01`;
const minus = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);
const ALL_TIME_FROM = "2000-01-01";
const safeName = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "customer";

export default function CustomerLedger() {
  const [customer, setCustomer] = useState<string>("");
  const [preset, setPreset] = useState<Preset>("all");
  const [from, setFrom] = useState(ALL_TIME_FROM);
  const [to, setTo] = useState(today());

  const [custData, setCustData] = useState<Awaited<ReturnType<typeof customerReportApi.fetch>> | null>(null);
  const customerNames = useMemo(() => (custData?.rows ?? []).map((r) => r.customer), [custData]);
  useEffect(() => {
    customerReportApi.fetch(ALL_TIME_FROM, today()).then(setCustData).catch(() => {});
  }, []);
  useEffect(() => {
    if (!customer && customerNames.length) setCustomer(customerNames[0]);
  }, [customerNames, customer]);

  const [data, setData] = useState<Awaited<ReturnType<typeof customerLedgerApi.fetch>> | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  useEffect(() => {
    if (!customer) return;
    setIsFetching(true);
    customerLedgerApi.fetch(customer, from, to)
      .then(setData)
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load"))
      .finally(() => setIsFetching(false));
  }, [customer, from, to]);

  const rows = data?.rows ?? [];
  const opening = data?.opening_balance ?? 0;
  const closing = data?.closing_balance ?? 0;
  const totalDebit = data?.total_debit ?? 0;
  const totalCredit = data?.total_credit ?? 0;

  const onPreset = (p: Preset) => {
    setPreset(p);
    if (p === "all") { setFrom(ALL_TIME_FROM); setTo(today()); }
    else if (p === "year") { setFrom(startOfYear()); setTo(today()); }
    else if (p === "12m") { setFrom(minus(365)); setTo(today()); }
  };

  const columns: ExportColumn<LedgerRow>[] = [
    { header: "Date", key: "date" },
    { header: "Type", key: "type" },
    { header: "Reference", key: "reference" },
    { header: "Detail", key: (r) => r.detail || "—" },
    { header: "Debit (₹)", key: (r) => (r.debit ? r.debit.toLocaleString("en-IN") : "") },
    { header: "Credit (₹)", key: (r) => (r.credit ? r.credit.toLocaleString("en-IN") : "") },
    { header: "Balance (₹)", key: (r) => r.balance.toLocaleString("en-IN") },
  ];
  const rangeLabel = preset === "all" ? "All time" : `${from} → ${to}`;
  const subtitle = `${customer} · ${rangeLabel} · Opening ${inr(opening)} · Closing ${inr(closing)}`;

  const doExport = (kind: "pdf" | "xlsx") => {
    if (!customer) return toast.error("Pick a customer");
    if (!rows.length) return toast.error("No ledger entries");
    const filename = `ledger-${safeName(customer)}`;
    if (kind === "pdf") exportToPdf({ title: `Customer Ledger — ${customer}`, subtitle, columns, rows, filename });
    else exportToExcel({ sheetName: "Ledger", columns, rows, filename });
    toast.success(kind === "pdf" ? "PDF generated" : "Excel generated");
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Customer Ledger</h1>
        <p className="text-muted-foreground">Running-balance statement per customer — invoices as debits, received payments as credits.</p>
      </div>

      {/* Controls */}
      <div className="bg-card rounded-xl border p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-3 text-sm font-medium text-card-foreground"><Filter className="h-4 w-4" /> Ledger</div>
        <div className="grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
          <div className="md:col-span-2">
            <Label className="text-xs">Customer</Label>
            <Select value={customer} onValueChange={setCustomer}>
              <SelectTrigger><SelectValue placeholder="Select customer" /></SelectTrigger>
              <SelectContent>
                {customerNames.map((n) => <SelectItem key={n} value={n}>{n}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">Period</Label>
            <Select value={preset} onValueChange={(v) => onPreset(v as Preset)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All time</SelectItem>
                <SelectItem value="year">This year</SelectItem>
                <SelectItem value="12m">Last 12 months</SelectItem>
                <SelectItem value="custom">Custom</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPreset("custom"); }} /></div>
          <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPreset("custom"); }} /></div>
          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => doExport("xlsx")}><FileSpreadsheet className="h-4 w-4" /> Excel</Button>
            <Button onClick={() => doExport("pdf")}><FileDown className="h-4 w-4" /> PDF</Button>
          </div>
        </div>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Opening Balance" value={inr(opening)} subtitle="carried forward" icon={BookOpen} subtitleColor="muted" />
        <StatCard title="Total Billed" value={inr(totalDebit)} subtitle="debits in range" icon={FileDown} />
        <StatCard title="Total Received" value={inr(totalCredit)} subtitle="credits in range" icon={FileSpreadsheet} />
        <StatCard title="Closing Balance" value={inr(closing)} subtitle={closing > 0 ? "due from customer" : "settled"} icon={BookOpen} />
      </div>

      {/* Ledger table */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-left px-4 py-3 font-medium">Type</th>
                <th className="text-left px-4 py-3 font-medium">Reference</th>
                <th className="text-left px-4 py-3 font-medium">Detail</th>
                <th className="text-right px-4 py-3 font-medium">Debit</th>
                <th className="text-right px-4 py-3 font-medium">Credit</th>
                <th className="text-right px-4 py-3 font-medium">Balance</th>
              </tr>
            </thead>
            <tbody>
              <tr className="border-t bg-muted/20">
                <td className="px-4 py-2 text-muted-foreground" colSpan={6}>Opening balance</td>
                <td className="px-4 py-2 text-right font-semibold">{inr(opening)}</td>
              </tr>
              {rows.length === 0 && <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">{isFetching ? "Loading…" : customer ? "No entries in this range." : "Select a customer."}</td></tr>}
              {rows.map((r, i) => (
                <tr key={r.reference + i} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 text-muted-foreground">{r.date}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${r.type === "Payment" ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400" : "bg-secondary text-secondary-foreground"}`}>{r.type}</span>
                  </td>
                  <td className="px-4 py-3 font-medium text-card-foreground">{r.reference}</td>
                  <td className="px-4 py-3 text-muted-foreground">{r.detail || "—"}</td>
                  <td className="px-4 py-3 text-right">{r.debit ? inr(r.debit) : ""}</td>
                  <td className="px-4 py-3 text-right text-emerald-600 dark:text-emerald-400">{r.credit ? inr(r.credit) : ""}</td>
                  <td className="px-4 py-3 text-right font-semibold">{inr(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            {rows.length > 0 && (
              <tfoot className="border-t bg-muted/30 font-semibold">
                <tr>
                  <td className="px-4 py-3" colSpan={4}>Closing balance</td>
                  <td className="px-4 py-3 text-right">{inr(totalDebit)}</td>
                  <td className="px-4 py-3 text-right">{inr(totalCredit)}</td>
                  <td className="px-4 py-3 text-right">{inr(closing)}</td>
                </tr>
              </tfoot>
            )}
          </table>
        </ScrollableX>
      </div>
    </div>
  );
}
