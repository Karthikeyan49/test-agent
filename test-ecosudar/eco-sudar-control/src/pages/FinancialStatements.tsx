import { useEffect, useMemo, useState } from "react";
import { Wallet, ArrowDownToLine, ArrowUpFromLine, FileDown, TrendingUp, TrendingDown, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { StatCard } from "@/components/StatCard";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { TableSkeleton } from "@/components/TableSkeleton";
import { toast } from "sonner";
import {
  financeApi,
  type CashFlow, type AgeingSummary, type ReceivableRow, type PayableRow,
} from "@/lib/api/finance";
import { exportToExcel, type ExportColumn } from "@/lib/exporters";

const inr = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const today = () => new Date().toISOString().slice(0, 10);
const monthsAgo = (m: number) => { const d = new Date(); d.setMonth(d.getMonth() - m); return d.toISOString().slice(0, 10); };
const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);

type Section = "cash-flow" | "receivables" | "payables";
const SECTIONS: { key: Section; label: string; desc: string; icon: typeof Wallet }[] = [
  { key: "cash-flow",   label: "Cash Flow",   desc: "Money in vs money out", icon: Wallet },
  { key: "receivables", label: "Receivables", desc: "Owed by customers",     icon: ArrowDownToLine },
  { key: "payables",    label: "Payables",    desc: "Owed to vendors",       icon: ArrowUpFromLine },
];

export default function FinancialStatements() {
  const [section, setSection] = useState<Section>("cash-flow");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-foreground">Financial Statements</h1>
        <p className="text-muted-foreground">Cash flow and ageing of receivables &amp; payables — from recorded transactions.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[240px_1fr] gap-6 items-start">
        <aside className="lg:sticky lg:top-4 space-y-1 rounded-xl border bg-card p-2 shadow-sm">
          <p className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">Statements</p>
          {SECTIONS.map((s) => {
            const active = section === s.key;
            const Icon = s.icon;
            return (
              <button key={s.key} onClick={() => setSection(s.key)} aria-current={active ? "true" : undefined}
                className={`w-full flex items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition-colors ${active ? "bg-primary/10 text-primary" : "text-card-foreground hover:bg-muted/50"}`}>
                <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${active ? "text-primary" : "text-muted-foreground"}`} />
                <span className="min-w-0">
                  <span className="block text-sm font-medium truncate">{s.label}</span>
                  <span className="block text-xs text-muted-foreground leading-snug">{s.desc}</span>
                </span>
              </button>
            );
          })}
        </aside>

        <div className="min-w-0">
          {section === "cash-flow" && <CashFlowView />}
          {section === "receivables" && <ReceivablesView />}
          {section === "payables" && <PayablesView />}
        </div>
      </div>
    </div>
  );
}

function CashFlowView() {
  const [from, setFrom] = useState(monthsAgo(6));
  const [to, setTo] = useState(today());
  const [data, setData] = useState<CashFlow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    financeApi.cashFlow({ from, to }).then(setData)
      .catch((e) => toast.error(err(e, "Failed to load cash flow")))
      .finally(() => setLoading(false));
  }, [from, to]);

  const maxBar = Math.max(1, ...(data?.series ?? []).flatMap((s) => [s.inflow, s.outflow]));

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border p-4 shadow-sm flex flex-wrap items-end gap-3">
        <div><Label className="text-xs">From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="w-40" /></div>
        <div><Label className="text-xs">To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="w-40" /></div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Cash In" value={inr(data?.inflow ?? 0)} subtitle="recorded payments" icon={TrendingUp} />
        <StatCard title="Cash Out" value={inr(data?.outflow ?? 0)} subtitle="payments + expenses" icon={TrendingDown} accent="rose" subtitleColor="muted" />
        <StatCard title="Net Cash" value={inr(data?.net ?? 0)} subtitle={(data?.net ?? 0) >= 0 ? "surplus" : "deficit"} icon={Scale} accent={(data?.net ?? 0) >= 0 ? "emerald" : "rose"} />
        <StatCard title="Operating Expenses" value={inr(data?.operating_expenses ?? 0)} subtitle="direct (non-PO)" icon={Wallet} accent="amber" subtitleColor="muted" />
      </div>

      {(data?.invoice_collections ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">Note: {inr(data!.invoice_collections)} of invoice collections recorded in this window (by last payment date).</p>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-card rounded-xl border shadow-sm p-5">
          <h3 className="font-semibold text-card-foreground mb-4">Monthly in vs out</h3>
          {(!data || data.series.length === 0) ? (
            <p className="text-sm text-muted-foreground py-8 text-center">{!loading && "No cash movement in this range."}</p>
          ) : (
            <div className="space-y-2">
              {data.series.map((s) => (
                <div key={s.month} className="flex items-center gap-2 text-xs">
                  <span className="w-16 text-muted-foreground shrink-0">{s.month}</span>
                  <div className="flex-1 flex flex-col gap-0.5">
                    <div className="h-2.5 rounded bg-primary/70" style={{ width: `${(s.inflow / maxBar) * 100}%` }} title={`In ${inr(s.inflow)}`} />
                    <div className="h-2.5 rounded bg-destructive/60" style={{ width: `${(s.outflow / maxBar) * 100}%` }} title={`Out ${inr(s.outflow)}`} />
                  </div>
                </div>
              ))}
              <div className="flex gap-4 pt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-primary/70" /> In</span>
                <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded bg-destructive/60" /> Out</span>
              </div>
            </div>
          )}
        </div>

        <div className="bg-card rounded-xl border shadow-sm p-5">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-card-foreground">Outflow by expense category</h3>
            <Button size="sm" variant="outline" disabled={!data?.expense_categories.length}
              onClick={() => data && exportToExcel({ sheetName: "Cash Flow", columns: [{ header: "Category", key: "category" }, { header: "Amount", key: "amount" }] as ExportColumn<{ category: string; amount: number }>[], rows: data.expense_categories, filename: "cash-flow-expenses" })}>
              <FileDown className="h-4 w-4" /> Export
            </Button>
          </div>
          {(data?.expense_categories ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground py-8 text-center">{!loading && "No expenses in range."}</p>
          ) : (
            <div className="space-y-1.5">
              {data!.expense_categories.map((c) => (
                <div key={c.category} className="flex items-center justify-between text-sm">
                  <span className="text-card-foreground">{c.category}</span>
                  <span className="font-medium eco-nums">{inr(c.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BucketBar({ s }: { s: AgeingSummary }) {
  const cells: { label: string; value: number; tone: string }[] = [
    { label: "Current", value: s.current, tone: "bg-primary/10 text-primary" },
    { label: "1–30 d", value: s.days_1_30, tone: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300" },
    { label: "31–60 d", value: s.days_31_60, tone: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300" },
    { label: "61–90 d", value: s.days_61_90, tone: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300" },
    { label: "90+ d", value: s.days_over_90, tone: "bg-destructive/10 text-destructive" },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
      {cells.map((c) => (
        <div key={c.label} className={`rounded-lg p-3 ${c.tone}`}>
          <p className="text-xs opacity-80">{c.label}</p>
          <p className="text-base font-bold eco-nums mt-0.5">{inr(c.value)}</p>
        </div>
      ))}
    </div>
  );
}

function ReceivablesView() {
  const [asOf, setAsOf] = useState(today());
  const [data, setData] = useState<{ summary: AgeingSummary; rows: ReceivableRow[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    financeApi.receivables(asOf).then(setData)
      .catch((e) => toast.error(err(e, "Failed to load receivables")))
      .finally(() => setLoading(false));
  }, [asOf]);

  const doExport = () => {
    if (!data?.rows.length) { toast.error("Nothing to export"); return; }
    const columns: ExportColumn<ReceivableRow>[] = [
      { header: "Invoice", key: "invoice_number" }, { header: "Customer", key: "customer_name" },
      { header: "Due", key: "due_on" }, { header: "Total", key: "total" },
      { header: "Paid", key: "amount_paid" }, { header: "Balance", key: "balance_due" },
      { header: "Days Overdue", key: "days_overdue" },
    ];
    exportToExcel({ sheetName: "Receivables", columns, rows: data.rows, filename: "receivables-ageing" });
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border p-4 shadow-sm flex flex-wrap items-end gap-3">
        <div><Label className="text-xs">As of</Label><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-40" /></div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Total due: <span className="font-semibold text-card-foreground">{inr(data?.summary.total_due ?? 0)}</span></span>
          <Button variant="outline" size="sm" onClick={doExport}><FileDown className="h-4 w-4" /> Export</Button>
        </div>
      </div>

      {data && <BucketBar s={data.summary} />}
      <AgeingTable
        loading={loading}
        rows={(data?.rows ?? []).map((r) => ({ ref: r.invoice_number, party: r.customer_name, date: r.due_on, total: r.total, paid: r.amount_paid, balance: r.balance_due, days: r.days_overdue }))}
        partyLabel="Customer" refLabel="Invoice" dateLabel="Due"
      />
    </div>
  );
}

function PayablesView() {
  const [asOf, setAsOf] = useState(today());
  const [data, setData] = useState<{ summary: AgeingSummary; rows: PayableRow[] } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    financeApi.payables(asOf).then(setData)
      .catch((e) => toast.error(err(e, "Failed to load payables")))
      .finally(() => setLoading(false));
  }, [asOf]);

  const doExport = () => {
    if (!data?.rows.length) { toast.error("Nothing to export"); return; }
    const columns: ExportColumn<PayableRow>[] = [
      { header: "PO", key: "po_number" }, { header: "Vendor", key: "vendor_name" },
      { header: "Order Date", key: "order_date" }, { header: "Total", key: "total" },
      { header: "Paid", key: "paid" }, { header: "Balance", key: "balance_due" },
      { header: "Days Overdue", key: "days_overdue" },
    ];
    exportToExcel({ sheetName: "Payables", columns, rows: data.rows, filename: "payables-ageing" });
  };

  return (
    <div className="space-y-4">
      <div className="bg-card rounded-xl border p-4 shadow-sm flex flex-wrap items-end gap-3">
        <div><Label className="text-xs">As of</Label><Input type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} className="w-40" /></div>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-muted-foreground">Total due: <span className="font-semibold text-card-foreground">{inr(data?.summary.total_due ?? 0)}</span></span>
          <Button variant="outline" size="sm" onClick={doExport}><FileDown className="h-4 w-4" /> Export</Button>
        </div>
      </div>

      {data && <BucketBar s={data.summary} />}
      <AgeingTable
        loading={loading}
        rows={(data?.rows ?? []).map((r) => ({ ref: r.po_number, party: r.vendor_name, date: r.order_date, total: r.total, paid: r.paid, balance: r.balance_due, days: r.days_overdue }))}
        partyLabel="Vendor" refLabel="PO" dateLabel="Order date"
      />
    </div>
  );
}

interface AgeRow { ref: string; party: string; date: string; total: number; paid: number; balance: number; days: number }
function AgeingTable({ loading, rows, partyLabel, refLabel, dateLabel }: { loading: boolean; rows: AgeRow[]; partyLabel: string; refLabel: string; dateLabel: string }) {
  const sorted = useMemo(() => [...rows].sort((a, b) => b.days - a.days), [rows]);
  return (
    <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
      <ScrollableX>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground">
            <tr>
              <th className="text-left px-4 py-3 font-medium">{refLabel}</th>
              <th className="text-left px-4 py-3 font-medium">{partyLabel}</th>
              <th className="text-left px-4 py-3 font-medium">{dateLabel}</th>
              <th className="text-right px-4 py-3 font-medium">Total</th>
              <th className="text-right px-4 py-3 font-medium">Balance</th>
              <th className="text-right px-4 py-3 font-medium">Days</th>
            </tr>
          </thead>
          <tbody>
            {loading && <TableSkeleton cols={6} />}
            {!loading && sorted.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">Nothing outstanding. 🎉</td></tr>}
            {!loading && sorted.map((r, i) => (
              <tr key={`${r.ref}-${i}`} className="border-t hover:bg-muted/30">
                <td className="px-4 py-3 font-medium text-card-foreground">{r.ref}</td>
                <td className="px-4 py-3">{r.party}</td>
                <td className="px-4 py-3 text-muted-foreground">{r.date}</td>
                <td className="px-4 py-3 text-right eco-nums">{inr(r.total)}</td>
                <td className="px-4 py-3 text-right font-semibold eco-nums">{inr(r.balance)}</td>
                <td className="px-4 py-3 text-right">
                  <span className={`text-xs px-2 py-0.5 rounded-full ${r.days <= 0 ? "bg-primary/10 text-primary" : r.days <= 30 ? "bg-amber-500/15 text-amber-600 dark:text-amber-300" : "bg-destructive/10 text-destructive"}`}>
                    {r.days <= 0 ? "Current" : `${r.days}d`}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableX>
    </div>
  );
}
