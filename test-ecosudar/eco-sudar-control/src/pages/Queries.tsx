import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { queriesApi, type Query } from "@/lib/api/queries";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { ExportMenu, type ExportColumnDef } from "@/components/ExportMenu";
import { TableSkeleton } from "@/components/TableSkeleton";

const statusColors: Record<string, string> = {
  "New":         "bg-blue-500/15 text-blue-400 border-blue-500/30",
  "In Progress": "bg-amber-500/15 text-amber-400 border-amber-500/30",
  "Resolved":    "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
};

const EXPORT_COLUMNS: ExportColumnDef<Query>[] = [
  { header: "Query ID", key: "id" },
  { header: "Customer", key: "name" },
  { header: "Email",    key: "email" },
  { header: "Message",  key: "message" },
  { header: "Date",     key: "date" },
  { header: "Status",   key: "status" },
  { header: "Admin Reply", key: "adminReply", group: "detail", defaultChecked: false },
];

export default function Queries() {
  const [queries, setQueries] = useState<Query[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const navigate = useNavigate();

  useEffect(() => {
    queriesApi.list()
      .then(setQueries)
      .catch(() => toast.error("Failed to load queries"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = queries.filter(q => {
    const matchSearch = q.name.toLowerCase().includes(search.toLowerCase()) ||
      q.email.toLowerCase().includes(search.toLowerCase()) ||
      q.id.toLowerCase().includes(search.toLowerCase()) ||
      q.message.toLowerCase().includes(search.toLowerCase());
    const matchStatus = filterStatus === "All" || q.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const paged = usePagedRows(filtered);

  const counts = {
    All:          queries.length,
    New:          queries.filter(q => q.status === "New").length,
    "In Progress": queries.filter(q => q.status === "In Progress").length,
    Resolved:     queries.filter(q => q.status === "Resolved").length,
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-card-foreground">Customer Queries</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage queries submitted from the mobile app</p>
        </div>
        <ExportMenu title="Customer Queries" columns={EXPORT_COLUMNS} rows={filtered} dateField="date" filename="queries" />
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        {(["All", "New", "In Progress", "Resolved"] as const).map(s => (
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
        <Input placeholder="Search queries..." className="pl-9" value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {/* Table */}
      <div className="bg-card rounded-xl border border-border overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/30">
                <th className="text-left p-3 font-medium text-muted-foreground">Query ID</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Customer</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Message</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Date</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Status</th>
                <th className="text-left p-3 font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={6} />}
              {!loading && paged.rows.map(q => (
                <tr key={q.id} className="border-b border-border/50 hover:bg-muted/20 transition-colors">
                  <td className="p-3 font-mono text-xs text-primary">{q.id}</td>
                  <td className="p-3">
                    <div className="font-medium text-card-foreground">{q.name}</div>
                    <div className="text-xs text-muted-foreground">{q.email}</div>
                  </td>
                  <td className="p-3 max-w-xs truncate text-muted-foreground">{q.message}</td>
                  <td className="p-3 text-muted-foreground">{q.date}</td>
                  <td className="p-3">
                    <Badge variant="outline" className={statusColors[q.status]}>{q.status}</Badge>
                  </td>
                  <td className="p-3">
                    <Button variant="ghost" size="sm" onClick={() => navigate(`/queries/${q.id}/edit`, { state: { query: q } })}>
                      View
                    </Button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={6} className="p-8 text-center text-muted-foreground">No queries found</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableX>
      </div>
      {!loading && filtered.length > 0 && (
        <Pagination {...paged} onPage={paged.setPage} noun="queries" />
      )}

    </div>
  );
}
