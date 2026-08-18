/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BarChart3, CheckCircle2, Gauge, LineChart, Plus, RefreshCw, Save, Target, Wallet } from "lucide-react";
import { Bar, BarChart, CartesianGrid, Line, LineChart as RLineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { toast } from "sonner";
import { Req } from "@/components/Req";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { StatCard } from "@/components/StatCard";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";

const inr = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const today = () => new Date().toISOString().slice(0, 10);
const minus = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const num = (v: any) => Number(v || 0);

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

function DataTable({ columns, rows, empty = "No records found." }: { columns: string[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <ScrollableX>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground"><tr>{columns.map((c) => <th key={c} className="px-4 py-3 text-left font-medium whitespace-nowrap">{c}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">{empty}</td></tr>}
            {rows.map((row, i) => <tr key={i} className="border-t hover:bg-muted/30">{row.map((cell, j) => <td key={j} className="px-4 py-3 align-top whitespace-nowrap">{cell}</td>)}</tr>)}
          </tbody>
        </table>
      </ScrollableX>
    </div>
  );
}

export default function FinancePlanning() {
  const [from, setFrom] = useState(minus(90));
  const [to, setTo] = useState(today());
  const [module, setModule] = useState("sales");
  const [budgetOpen, setBudgetOpen] = useState(false);
  const [benchmarkOpen, setBenchmarkOpen] = useState(false);
  const [selectedBudget, setSelectedBudget] = useState<ApiRow | null>(null);
  const [budget, setBudget] = useState<ApiRow>({ name: "", fiscal_year: "2026-2027", period_type: "monthly", category: "Material Purchase", period: today().slice(0, 7), amount: "", notes: "" });
  const [benchmark, setBenchmark] = useState<ApiRow>({ metric: "gross_margin", target_value: "", unit: "%", comparison: "gte", notes: "" });

  const [expenseAnalyticsData, setExpenseAnalyticsData] = useState<any>(null);
  const [reportsAnalyticsData, setReportsAnalyticsData] = useState<any>(null);
  const [overlayData, setOverlayData] = useState<any>(null);
  const [budgetsData, setBudgetsData] = useState<any[]>([]);
  const [benchmarksData, setBenchmarksData] = useState<any[]>([]);
  const [benchmarkStatusData, setBenchmarkStatusData] = useState<any>(null);
  const [budgetActualData, setBudgetActualData] = useState<any>(null);

  const loadData = useCallback(() => {
    Promise.all([
      phase2Api.financePlanning.expenseAnalytics({ from, to }).then(setExpenseAnalyticsData).catch(() => {}),
      phase2Api.financePlanning.reportsAnalytics({ module, from, to }).then(setReportsAnalyticsData).catch(() => {}),
      phase2Api.financePlanning.overlay({ from, to }).then(setOverlayData).catch(() => {}),
      phase2Api.financePlanning.budgets().then((d) => setBudgetsData(d as any)).catch(() => {}),
      phase2Api.financePlanning.benchmarks().then((d) => setBenchmarksData(d as any)).catch(() => {}),
      phase2Api.financePlanning.benchmarkStatus({ from, to }).then(setBenchmarkStatusData).catch(() => {}),
    ]);
  }, [from, to, module]);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!selectedBudget?.budget_id) { setBudgetActualData(null); return; }
    phase2Api.financePlanning.budgetVsActual(selectedBudget.budget_id).then(setBudgetActualData).catch(() => {});
  }, [selectedBudget?.budget_id]);

  const doRun = async (action: string, payload: any) => {
    try {
      if (action === "budget") await phase2Api.financePlanning.createBudget(payload);
      if (action === "benchmark") await phase2Api.financePlanning.saveBenchmark(payload);
      toast.success("Finance planning updated");
      loadData();
    } catch (e: any) {
      toast.error(e instanceof Error ? e.message : "Operation failed");
      throw e;
    }
  };

  const metrics = useMemo(() => {
    const exp = expenseAnalyticsData || {};
    const rep = reportsAnalyticsData || {};
    const ov = overlayData || {};
    return {
      expenseTotal: num(exp.total ?? exp.total_expenses),
      reportTotal: num(rep.total ?? rep.total_amount),
      revenue: num(ov.revenue ?? ov.total_revenue),
      grossProfit: num(ov.gross_profit ?? ov.profit),
      variance: num((budgetActualData as any)?.total_variance ?? (budgetActualData as any)?.variance),
    };
  }, [expenseAnalyticsData, reportsAnalyticsData, overlayData, budgetActualData]);

  const expenseChart = (expenseAnalyticsData?.by_category || expenseAnalyticsData?.categories || []).map((r: ApiRow) => ({
    name: r.category || r.name,
    amount: num(r.amount || r.total),
  }));
  const overlayChart = (overlayData?.series || overlayData?.monthly || overlayData?.rows || []).map((r: ApiRow) => ({
    period: r.period || r.month || r.date,
    revenue: num(r.revenue),
    expenses: num(r.expenses || r.cost),
    profit: num(r.profit || r.gross_profit),
  }));

  const createBudget = async () => {
    if (!budget.name?.trim()) return toast.error("Budget name is required");
    await doRun("budget", {
      name: budget.name,
      fiscal_year: budget.fiscal_year,
      period_type: budget.period_type,
      notes: budget.notes,
      is_active: true,
      lines: [{ category: budget.category, period: budget.period, amount: num(budget.amount), notes: budget.notes }],
    });
    setBudgetOpen(false);
  };

  const createBenchmark = async () => {
    if (!benchmark.target_value) return toast.error("Target value is required");
    await doRun("benchmark", { ...benchmark, target_value: num(benchmark.target_value), is_active: true });
    setBenchmarkOpen(false);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Finance Analytics & Planning</h1>
          <p className="text-muted-foreground">Expense graphics, report analytics, budget vs actual, and benchmark controls.</p>
        </div>
        <Button variant="outline" onClick={loadData}><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </div>

      <div className="rounded-xl border bg-card p-4 shadow-sm grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
        <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
        <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
        <Field label="Report module"><Select value={module} onValueChange={setModule}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["sales", "orders", "payments", "expenses", "production", "forecast"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></Field>
        <Button onClick={() => setBudgetOpen(true)}><Plus className="h-4 w-4" /> Budget</Button>
        <Button variant="outline" onClick={() => setBenchmarkOpen(true)}><Target className="h-4 w-4" /> Benchmark</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard title="Expense Total" value={inr(metrics.expenseTotal)} subtitle="selected window" icon={Wallet} />
        <StatCard title="Report Total" value={inr(metrics.reportTotal)} subtitle={`${module} analytics`} icon={BarChart3} />
        <StatCard title="Revenue" value={inr(metrics.revenue)} subtitle="finance overlay" icon={LineChart} />
        <StatCard title="Gross Profit" value={inr(metrics.grossProfit)} subtitle="overlay margin" icon={Gauge} />
        <StatCard title="Budget Variance" value={inr(metrics.variance)} subtitle={selectedBudget ? selectedBudget.name : "select budget"} icon={Target} />
      </div>

      <Tabs defaultValue="analytics" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="analytics">Analytics</TabsTrigger>
          <TabsTrigger value="budgets">Budget vs Actual</TabsTrigger>
          <TabsTrigger value="benchmarks">Benchmarks</TabsTrigger>
        </TabsList>

        <TabsContent value="analytics" className="space-y-4">
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <h3 className="font-semibold mb-1">Expense by Category</h3>
              <p className="text-xs text-muted-foreground mb-4">From expense analytics endpoint</p>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={expenseChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `₹${Number(v) / 1000}k`} />
                  <Tooltip formatter={(v: number) => inr(v)} />
                  <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="rounded-xl border bg-card p-5 shadow-sm">
              <h3 className="font-semibold mb-1">Revenue / Expense / Profit Overlay</h3>
              <p className="text-xs text-muted-foreground mb-4">Monthly operational overlay</p>
              <ResponsiveContainer width="100%" height={280}>
                <RLineChart data={overlayChart}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="period" tick={{ fontSize: 11 }} />
                  <YAxis tickFormatter={(v) => `₹${Number(v) / 1000}k`} />
                  <Tooltip formatter={(v: number) => inr(v)} />
                  <Line type="monotone" dataKey="revenue" stroke="hsl(var(--primary))" strokeWidth={2} />
                  <Line type="monotone" dataKey="expenses" stroke="hsl(0,72%,51%)" strokeWidth={2} />
                  <Line type="monotone" dataKey="profit" stroke="hsl(210,70%,55%)" strokeWidth={2} />
                </RLineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="budgets" className="space-y-4">
          <DataTable
            columns={["Budget", "Fiscal Year", "Type", "Lines", "Active", "Created", "Action"]}
            rows={(budgetsData ?? []).map((b) => [
              <span className="font-medium">{b.name}</span>,
              b.fiscal_year,
              b.period_type,
              b.lines_count ?? b.lines?.length ?? 0,
              b.is_active ? <Badge className="bg-emerald-500">Active</Badge> : <Badge variant="outline">Inactive</Badge>,
              b.created_at?.slice(0, 10) || "—",
              <Button size="sm" variant={selectedBudget?.budget_id === b.budget_id ? "default" : "outline"} onClick={() => setSelectedBudget(b)}>View Actual</Button>,
            ])}
          />
          {selectedBudget && (
            <DataTable
              columns={["Category", "Period", "Budget", "Actual", "Variance", "Status"]}
              rows={((budgetActualData as any)?.lines || (budgetActualData as any)?.rows || []).map((r: ApiRow) => [
                r.category,
                r.period,
                inr(r.budget_amount ?? r.amount),
                inr(r.actual_amount ?? r.actual),
                inr(r.variance),
                num(r.variance) >= 0 ? <Badge variant="outline" className="text-emerald-600">Under/OK</Badge> : <Badge variant="outline" className="text-red-600">Over</Badge>,
              ])}
              empty="Select a budget or add budget lines to see variance."
            />
          )}
        </TabsContent>

        <TabsContent value="benchmarks" className="space-y-4">
          <DataTable
            columns={["Metric", "Target", "Comparison", "Unit", "Status", "Notes"]}
            rows={(benchmarksData ?? []).map((b) => [
              b.metric,
              b.target_value,
              b.comparison,
              b.unit || "—",
              b.is_active ? <Badge className="bg-emerald-500">Active</Badge> : <Badge variant="outline">Inactive</Badge>,
              b.notes || "—",
            ])}
          />
          <DataTable
            columns={["Metric", "Actual", "Target", "Result", "Gap"]}
            rows={((benchmarkStatusData as any)?.benchmarks || (benchmarkStatusData as any)?.rows || []).map((b: ApiRow) => [
              b.metric,
              b.actual_value ?? b.actual,
              b.target_value ?? b.target,
              b.passed ? <Badge className="bg-emerald-500"><CheckCircle2 className="h-3 w-3 mr-1" /> Passed</Badge> : <Badge variant="outline" className="text-amber-600">Watch</Badge>,
              b.gap ?? "—",
            ])}
            empty="No benchmark status available for this window."
          />
        </TabsContent>
      </Tabs>

      <Dialog open={budgetOpen} onOpenChange={setBudgetOpen}>
        <DialogScrollContent onInteractOutside={(e) => e.preventDefault()} className="max-w-2xl">
          <DialogHeader><DialogTitle>Create Budget</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label={<>Budget name <Req /></>}><Input value={budget.name} onChange={(e) => setBudget({ ...budget, name: e.target.value })} /></Field>
            <Field label="Fiscal year"><Input value={budget.fiscal_year} onChange={(e) => setBudget({ ...budget, fiscal_year: e.target.value })} /></Field>
            <Field label="Type"><Select value={budget.period_type} onValueChange={(v) => setBudget({ ...budget, period_type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="monthly">Monthly</SelectItem><SelectItem value="quarterly">Quarterly</SelectItem><SelectItem value="yearly">Yearly</SelectItem></SelectContent></Select></Field>
            <Field label="Category"><Input value={budget.category} onChange={(e) => setBudget({ ...budget, category: e.target.value })} /></Field>
            <Field label="Period"><Input value={budget.period} onChange={(e) => setBudget({ ...budget, period: e.target.value })} /></Field>
            <Field label="Amount"><Input type="number" value={budget.amount} onChange={(e) => setBudget({ ...budget, amount: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><Textarea value={budget.notes} onChange={(e) => setBudget({ ...budget, notes: e.target.value })} /></Field>
          <div className="flex justify-end"><Button onClick={createBudget}><Save className="h-4 w-4" /> Save Budget</Button></div>
        </DialogScrollContent>
      </Dialog>

      <Dialog open={benchmarkOpen} onOpenChange={setBenchmarkOpen}>
        <DialogScrollContent onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>Create Benchmark</DialogTitle></DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Metric"><Select value={benchmark.metric} onValueChange={(v) => setBenchmark({ ...benchmark, metric: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["gross_margin", "net_margin", "expense_ratio", "collection_days", "inventory_turnover"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></Field>
            <Field label={<>Target <Req /></>}><Input type="number" value={benchmark.target_value} onChange={(e) => setBenchmark({ ...benchmark, target_value: e.target.value })} /></Field>
            <Field label="Comparison"><Select value={benchmark.comparison} onValueChange={(v) => setBenchmark({ ...benchmark, comparison: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="gte">Greater/equal</SelectItem><SelectItem value="lte">Less/equal</SelectItem></SelectContent></Select></Field>
            <Field label="Unit"><Input value={benchmark.unit} onChange={(e) => setBenchmark({ ...benchmark, unit: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><Textarea value={benchmark.notes} onChange={(e) => setBenchmark({ ...benchmark, notes: e.target.value })} /></Field>
          <div className="flex justify-end"><Button onClick={createBenchmark}><Target className="h-4 w-4" /> Save Benchmark</Button></div>
        </DialogScrollContent>
      </Dialog>
    </div>
  );
}
