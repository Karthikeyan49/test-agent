import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, Pencil, Trash2, Wallet, Receipt, TrendingUp, Layers, Loader2, ArrowUp, ArrowDown, ArrowUpDown, Download } from "lucide-react";
import { downloadPath } from "@/lib/api/phase2";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatCard } from "@/components/StatCard";
import { toast } from "sonner";
import {
  EXPENSE_CATEGORIES, expensesApi, type Expense, type ExpensePagination, type ExpenseSummary,
} from "@/lib/api/expenses";
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid,
} from "recharts";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { RecordCombobox } from "@/components/RecordCombobox";

const PAGE_SIZE = 200;

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

// Numeric-aware compare so EXP-2 sorts before EXP-10 (not lexicographically).
const cmpId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });

const CHART_COLORS = [
  "hsl(200,70%,52%)", "hsl(210,70%,55%)", "hsl(30,90%,52%)", "hsl(280,55%,52%)",
  "hsl(45,90%,50%)", "hsl(0,72%,51%)", "hsl(240,60%,55%)", "hsl(170,55%,42%)",
  "hsl(330,60%,55%)", "hsl(190,65%,45%)", "hsl(120,40%,45%)",
];

export default function Expenses() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadingAll, setLoadingAll] = useState(false);
  const [pagination, setPagination] = useState<ExpensePagination | null>(null);
  const [dbSummary, setDbSummary] = useState<ExpenseSummary | null>(null);
  const [search, setSearch] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [minAmt, setMinAmt] = useState("");
  const [maxAmt, setMaxAmt] = useState("");
  // Table sort — by Date or ID (expense code), ascending or descending.
  const [sortKey, setSortKey] = useState<"date" | "id">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const [confirmDelete, setConfirmDelete] = useState<Expense | null>(null);

  const mergeById = (current: Expense[], next: Expense[]) => {
    const map = new Map(current.map((expense) => [expense.id, expense]));
    next.forEach((expense) => map.set(expense.id, expense));
    return Array.from(map.values());
  };

  const listParams = (page: number) => ({
    page,
    limit: PAGE_SIZE,
    search: search.trim() || undefined,
    category: filterCategory !== "all" ? filterCategory : undefined,
    from: fromDate || undefined,
    to: toDate || undefined,
    minAmount: minAmt ? Number(minAmt) : undefined,
    maxAmount: maxAmt ? Number(maxAmt) : undefined,
  });

  const load = async (page = 1, append = false) => {
    if (append) setLoadingMore(true);
    else setLoading(true);
    try {
      const params = listParams(page);
      const [result, summaryResult] = append
        ? [await expensesApi.list(params), null]
        : await Promise.all([expensesApi.list(params), expensesApi.summary(params)]);
      setItems((prev) => append ? mergeById(prev, result.items) : result.items);
      setPagination(result.pagination);
      if (summaryResult) setDbSummary(summaryResult);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      if (append) setLoadingMore(false);
      else setLoading(false);
    }
  };
  useEffect(() => { load(); }, [search, filterCategory, fromDate, toDate, minAmt, maxAmt]);

  const hasMore = pagination ? pagination.page < pagination.total_pages : false;
  const loadedCount = items.length;

  const loadMore = () => {
    if (!pagination || loadingMore || loadingAll || !hasMore) return;
    load(pagination.page + 1, true);
  };

  const loadAll = async () => {
    if (!pagination || loadingMore || loadingAll || !hasMore) return;
    setLoadingAll(true);
    try {
      let all = items;
      let latest = pagination;
      for (let page = pagination.page + 1; page <= pagination.total_pages; page += 1) {
        const result = await expensesApi.list(listParams(page));
        all = mergeById(all, result.items);
        latest = result.pagination;
      }
      setItems(all);
      setPagination(latest);
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoadingAll(false);
    }
  };

  const availableCategories = useMemo(() => {
    return Array.from(new Set<string>([
      ...EXPENSE_CATEGORIES,
      ...items.map((expense) => expense.category).filter(Boolean),
    ])).sort((a, b) => a.localeCompare(b));
  }, [items]);

  const categoryOptions = useMemo(
    () => [{ id: "all", label: "All categories" }, ...availableCategories.map((c) => ({ id: c, label: c }))],
    [availableCategories],
  );

  const filtered = useMemo(() => {
    return items.filter((e) => {
      if (filterCategory !== "all" && e.category !== filterCategory) return false;
      if (fromDate && e.date < fromDate) return false;
      if (toDate && e.date > toDate) return false;
      if (minAmt && e.amount < Number(minAmt)) return false;
      if (maxAmt && e.amount > Number(maxAmt)) return false;
      if (search) {
        const q = search.toLowerCase();
        if (!e.vendor.toLowerCase().includes(q) &&
            !e.description.toLowerCase().includes(q) &&
            !e.id.toLowerCase().includes(q)) return false;
      }
      return true;
    });
  }, [items, filterCategory, fromDate, toDate, minAmt, maxAmt, search]);

  // Client-side sort applied on top of the filtered set (Date or ID, asc/desc).
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const c = sortKey === "date"
        ? (a.date === b.date ? cmpId(a.id, b.id) : a.date < b.date ? -1 : 1)
        : cmpId(a.id, b.id);
      return sortDir === "asc" ? c : -c;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);

  const paged = usePagedRows(sorted);

  const toggleSort = (k: "date" | "id") => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "date" ? "desc" : "asc"); }
  };
  const sortIcon = (k: "date" | "id") =>
    sortKey !== k ? <ArrowUpDown className="h-3.5 w-3.5 opacity-40" />
      : sortDir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />;

  const summary = useMemo(() => {
    const total = filtered.reduce((s, e) => s + e.amount, 0);
    const byCat = new Map<string, number>();
    filtered.forEach((e) => byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount));
    const pieData = Array.from(byCat, ([name, value]) => ({ name, value }))
      .sort((a, b) => b.value - a.value);
    const byMonth = new Map<string, number>();
    filtered.forEach((e) => {
      const m = e.date.slice(0, 7);
      byMonth.set(m, (byMonth.get(m) ?? 0) + e.amount);
    });
    const barData = Array.from(byMonth, ([month, amount]) => ({ month, amount }))
      .sort((a, b) => a.month.localeCompare(b.month));
    const top = pieData[0];
    return { total, count: filtered.length, pieData, barData, topCategory: top };
  }, [filtered]);

  const topSummary = useMemo(() => {
    if (!dbSummary) {
      return {
        total: summary.total,
        count: summary.count,
        categoryCount: new Set(filtered.map((e) => e.category)).size,
        topCategory: summary.topCategory,
        average: summary.count ? summary.total / summary.count : 0,
      };
    }

    return {
      total: dbSummary.total,
      count: dbSummary.count,
      categoryCount: dbSummary.category_count,
      topCategory: dbSummary.top_category
        ? { name: dbSummary.top_category.name, value: dbSummary.top_category.value }
        : undefined,
      average: dbSummary.average,
    };
  }, [dbSummary, filtered, summary]);

  const onDelete = async () => {
    if (!confirmDelete) return;
    try {
      await expensesApi.remove(confirmDelete.id);
      toast.success("Expense deleted");
      setConfirmDelete(null);
      load();
    } catch (e: any) { toast.error(e.message); }
  };

  // Download the stored bill for an expense via the auth-gated endpoint.
  const downloadBill = async (e: Expense) => {
    const ext = e.billUrl?.includes(".") ? e.billUrl.split(".").pop() : "jpg";
    try {
      await downloadPath(`/admin/expenses/${e.numericId}/bill?download=1`, `${e.id}.${ext}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not download bill");
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Expense Management</h1>
          <p className="text-muted-foreground">Track, categorize and analyse business expenses.</p>
        </div>
        <Button onClick={() => navigate('/expenses/new')}><Plus className="h-4 w-4" />Add Expense</Button>
      </div>

      {/* Summary stats */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Expenses" value={inr(topSummary.total)} subtitle={`${topSummary.count} entries`} icon={Wallet} />
        <StatCard title="Categories" value={String(topSummary.categoryCount)} subtitle="active" icon={Layers} />
        <StatCard title="Top Category" value={topSummary.topCategory ? topSummary.topCategory.name.split(" - ")[0] : "—"} subtitle={topSummary.topCategory ? inr(topSummary.topCategory.value) : ""} icon={TrendingUp} />
        <StatCard title="Avg / Entry" value={topSummary.count ? inr(Math.round(topSummary.average)) : "₹0"} subtitle="filtered DB set" icon={Receipt} />
      </div>

      {/* Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-card rounded-xl border p-6 shadow-sm">
          <h3 className="font-semibold text-card-foreground mb-1">Expense Breakdown</h3>
          <p className="text-xs text-muted-foreground mb-4">Share by category</p>
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={summary.pieData} dataKey="value" nameKey="name" outerRadius={90} innerRadius={50}>
                {summary.pieData.map((_, i) => <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />)}
              </Pie>
              <Tooltip formatter={(v: number) => inr(v)} />
            </PieChart>
          </ResponsiveContainer>
        </div>
        <div className="bg-card rounded-xl border p-6 shadow-sm">
          <h3 className="font-semibold text-card-foreground mb-1">Monthly Spend</h3>
          <p className="text-xs text-muted-foreground mb-4">Aggregated by month (filtered)</p>
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={summary.barData}>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
              <XAxis dataKey="month" tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} />
              <YAxis tick={{ fontSize: 12, fill: "hsl(var(--muted-foreground))" }} tickFormatter={(v) => `₹${v / 1000}k`} />
              <Tooltip formatter={(v: number) => inr(v)} />
              <Bar dataKey="amount" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-card rounded-xl border p-4 shadow-sm grid grid-cols-1 md:grid-cols-2 lg:grid-cols-6 gap-3">
        <div className="lg:col-span-2 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search vendor, description, ID..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <RecordCombobox
          options={categoryOptions}
          value={filterCategory}
          onSelect={(v) => setFilterCategory(String(v))}
          getId={(o) => o.id}
          getLabel={(o) => o.label}
          placeholder="Category"
        />
        <Input type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} placeholder="From" />
        <Input type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} placeholder="To" />
        <div className="flex gap-2">
          <Input type="number" placeholder="Min ₹" value={minAmt} onChange={(e) => setMinAmt(e.target.value.replace(/^0+(?=\d)/, ''))} />
          <Input type="number" placeholder="Max ₹" value={maxAmt} onChange={(e) => setMaxAmt(e.target.value.replace(/^0+(?=\d)/, ''))} />
        </div>
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">
                  <button type="button" onClick={() => toggleSort("id")} className="inline-flex items-center gap-1 hover:text-foreground">ID {sortIcon("id")}</button>
                </th>
                <th className="text-left px-4 py-3 font-medium">
                  <button type="button" onClick={() => toggleSort("date")} className="inline-flex items-center gap-1 hover:text-foreground">Date {sortIcon("date")}</button>
                </th>
                <th className="text-left px-4 py-3 font-medium">Category</th>
                <th className="text-left px-4 py-3 font-medium">Vendor</th>
                <th className="text-left px-4 py-3 font-medium">Description</th>
                <th className="text-left px-4 py-3 font-medium">Mode</th>
                <th className="text-right px-4 py-3 font-medium">Amount</th>
                <th className="text-center px-4 py-3 font-medium">Bill</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={9} />}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={9} className="text-center py-10 text-muted-foreground">No expenses match the filters.</td></tr>
              )}
              {!loading && paged.rows.map((e) => (
                <tr key={e.id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-card-foreground">{e.id}</td>
                  <td className="px-4 py-3">{e.date}</td>
                  <td className="px-4 py-3"><span className="text-xs px-2 py-1 rounded-full bg-secondary text-secondary-foreground">{e.category}</span></td>
                  <td className="px-4 py-3">{e.vendor}</td>
                  <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">{e.description}</td>
                  <td className="px-4 py-3">{e.paymentMode}</td>
                  <td className="px-4 py-3 text-right font-semibold">{inr(e.amount)}</td>
                  <td className="px-4 py-3 text-center">
                    {e.billUrl ? (
                      <Button size="icon" variant="ghost" title="Download bill" onClick={() => downloadBill(e)}>
                        <Download className="h-4 w-4" />
                      </Button>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1">
                      <Button size="icon" variant="ghost" onClick={() => navigate(`/expenses/${e.id}/edit`)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setConfirmDelete(e)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun="expenses" />
        {hasMore && (
          <div className="flex flex-col gap-3 border-t px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-muted-foreground">
              {loadedCount} loaded{pagination ? ` of ${pagination.total} total` : ""} — load more to page through the rest.
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" disabled={loadingMore || loadingAll} onClick={loadMore}>
                {loadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Load more
              </Button>
              <Button variant="outline" size="sm" disabled={loadingMore || loadingAll} onClick={loadAll}>
                {loadingAll ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                Load all
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Delete confirm */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete expense?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && <>This will permanently remove <strong>{confirmDelete.id}</strong> ({inr(confirmDelete.amount)}). This cannot be undone.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
