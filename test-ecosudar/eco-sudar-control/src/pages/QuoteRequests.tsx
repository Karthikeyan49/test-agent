import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { quoteRequestsApi, type QuoteRequest } from "@/lib/api/quoteRequests";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { ExportMenu, type ExportColumnDef } from "@/components/ExportMenu";
import { TableSkeleton } from "@/components/TableSkeleton";

const statusColors: Record<string, string> = {
  "New":       "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "Contacted": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "Quoted":    "bg-indigo-500/15 text-indigo-400 border-indigo-500/30",
  "Closed":    "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

const EXPORT_COLUMNS: ExportColumnDef<QuoteRequest>[] = [
  { header: "Quote ID",        key: "id" },
  { header: "Customer",        key: "customerName" },
  { header: "Phone",           key: "phone" },
  { header: "Email",           key: "email" },
  { header: "Product",         key: "product" },
  { header: "Qty/Month",       key: "quantityPerMonth" },
  { header: "Monthly Savings", key: "monthlySavings" },
  { header: "Annual Savings",  key: "annualSavings" },
  { header: "Date",            key: "date" },
  { header: "Status",          key: "status" },
  { header: "Quoted Price",    key: "quotedPrice",  group: "detail", defaultChecked: false },
  { header: "Admin Notes",     key: "adminNotes",   group: "detail", defaultChecked: false },
];

export default function QuoteRequests() {
  const [quotes, setQuotes] = useState<QuoteRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const navigate = useNavigate();

  useEffect(() => {
    quoteRequestsApi.list()
      .then(setQuotes)
      .catch(() => toast.error("Failed to load quote requests"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = quotes.filter(q => {
    const matchSearch = q.customerName.toLowerCase().includes(search.toLowerCase()) ||
      q.id.toLowerCase().includes(search.toLowerCase()) ||
      q.email.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "All" || q.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const paged = usePagedRows(filtered);

  const counts = {
    All:       quotes.length,
    New:       quotes.filter(q => q.status === "New").length,
    Contacted: quotes.filter(q => q.status === "Contacted").length,
    Quoted:    quotes.filter(q => q.status === "Quoted").length,
    Closed:    quotes.filter(q => q.status === "Closed").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-card-foreground">Quote Requests</h1>
          <p className="text-muted-foreground text-sm mt-1">Custom quotes requested from the Savings Calculator in the mobile app</p>
        </div>
        <ExportMenu title="Quote Requests" columns={EXPORT_COLUMNS} rows={filtered} dateField="date" filename="quote-requests" />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["All", "New", "Contacted", "Quoted", "Closed"] as const).map(s => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-4 py-1.5 text-sm rounded-full border transition-colors ${
              filterStatus === s
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card text-muted-foreground border-border hover:bg-muted"
            }`}
          >
            {s} ({counts[s]})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input placeholder="Search by name, ID, or email..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-3 font-medium text-muted-foreground">Quote ID</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Customer</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Product</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Qty/Month</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Monthly Savings</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={8} />}
              {!loading && paged.rows.map(q => (
                <tr key={q.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="p-3 font-mono text-xs text-primary">{q.id}</td>
                  <td className="p-3">
                    <div className="font-medium text-card-foreground">{q.customerName}</div>
                    <div className="text-xs text-muted-foreground">{q.phone}</div>
                  </td>
                  <td className="p-3 text-card-foreground">{q.product}</td>
                  <td className="p-3 text-card-foreground">{q.quantityPerMonth}</td>
                  <td className="p-3 font-medium text-emerald-400">{q.monthlySavings}</td>
                  <td className="p-3 text-muted-foreground">{q.date}</td>
                  <td className="p-3">
                    <Badge variant="outline" className={statusColors[q.status]}>{q.status}</Badge>
                  </td>
                  <td className="p-3">
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/quote-requests/${q.id}/edit`, { state: { quote: q } })}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="p-8 text-center text-muted-foreground">No quote requests found</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableX>
      </div>
      {!loading && filtered.length > 0 && (
        <Pagination {...paged} onPage={paged.setPage} noun="quotes" />
      )}

    </div>
  );
}
