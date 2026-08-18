import { useEffect, useMemo, useState } from "react";
import { Plus, Search, FileDown, Send, Trash2, Pencil, ArrowRight, Truck, ReceiptText } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { toast } from "sonner";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { downloadSalesDocumentPdf } from "@/lib/salesDocumentPdf";
import { ExportMenu } from "@/components/ExportMenu";
import { type ExportColumnDef } from "@/components/ExportDialog";
import { StatusBadge } from "@/components/StatusBadge";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { TableSkeleton } from "@/components/TableSkeleton";

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);
const inr = (n: number) => `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const DOC_STATUS_STYLES: Record<string, string> = {
  draft:     "bg-muted text-muted-foreground border-border",
  sent:      "bg-blue-50 text-blue-600 border-blue-200",
  accepted:  "bg-emerald-50 text-emerald-700 border-emerald-200",
  rejected:  "bg-red-50 text-red-600 border-red-200",
  cancelled: "bg-gray-100 text-gray-500 border-gray-200",
  converted: "bg-violet-50 text-violet-700 border-violet-200",
};

export default function SalesDocumentsPage({ docType, title, blurb }: { docType: "quotation" | "delivery_challan" | "sales_order" | "proforma"; title: string; blurb: string }) {
  const navigate = useNavigate();
  const [items, setItems] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  const load = () => {
    setLoading(true);
    phase2Api.salesDocuments.list({ document_type: docType }).then(setItems)
      .catch((e) => toast.error(err(e, "Failed to load documents")))
      .finally(() => setLoading(false));
  };
  useEffect(load, [docType]);

  const filtered = useMemo(() => items.filter((d) =>
    String(d.document_number ?? "").toLowerCase().includes(search.toLowerCase()) ||
    String(d.customer_name ?? "").toLowerCase().includes(search.toLowerCase())
  ), [items, search]);

  const paged = usePagedRows(filtered);

  const downloadPdf = async (d: ApiRow) => {
    try { downloadSalesDocumentPdf(await phase2Api.salesDocuments.get(d.document_id)); }
    catch (e) { toast.error(err(e, "PDF failed")); }
  };
  const transition = async (d: ApiRow, action: "send" | "accept" | "cancel") => {
    try { await phase2Api.salesDocuments.transition(d.document_id, action); toast.success(`Marked ${action}`); load(); }
    catch (e) { toast.error(err(e, "Action failed")); }
  };
  const convertDoc = async (d: ApiRow, target: "sales_order" | "delivery_challan" | "invoice", okMsg: string) => {
    try { await phase2Api.salesDocuments.convert(d.document_id, target); toast.success(okMsg); load(); }
    catch (e) { toast.error(err(e, "Convert failed")); }
  };
  const canConvert = (d: ApiRow) => ["sent", "accepted", "converted"].includes(String(d.status));

  const EXPORT_COLUMNS: ExportColumnDef<ApiRow>[] = [
    { header: "Document", key: "document_number" },
    { header: "Customer", key: "customer_name" },
    { header: "Date", key: "document_date" },
    { header: "Total", key: "total" },
    { header: "Status", key: "status" },
    { header: "Phone", key: "customer_phone", group: "detail", defaultChecked: false },
    { header: "Email", key: "customer_email", group: "detail", defaultChecked: false },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">{title}</h1>
          <p className="text-muted-foreground">{blurb}</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu title={title} columns={EXPORT_COLUMNS} rows={filtered} dateField="document_date" filename={docType.replace(/_/g, "-")} />
          <Button onClick={() => navigate(`/sales/documents/${docType}/new`)}><Plus className="h-4 w-4" /> New {title.replace(/s$/, "")}</Button>
        </div>
      </div>

      <div className="bg-card rounded-xl border p-4 shadow-sm">
        <div className="relative w-full sm:w-80">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search document or customer…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Document</th>
                <th className="text-left px-4 py-3 font-medium">Customer</th>
                <th className="text-left px-4 py-3 font-medium">Date</th>
                <th className="text-right px-4 py-3 font-medium">Total</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={6} />}
              {!loading && filtered.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No {title.toLowerCase()} yet.</td></tr>}
              {!loading && paged.rows.map((d) => (
                <tr key={d.document_id} className="border-t hover:bg-muted/30">
                  <td className="px-4 py-3 font-medium text-card-foreground">{d.document_number}</td>
                  <td className="px-4 py-3">{d.customer_name}<div className="text-xs text-muted-foreground">{d.customer_phone || ""}</div></td>
                  <td className="px-4 py-3 text-muted-foreground">{d.document_date}</td>
                  <td className="px-4 py-3 text-right font-semibold eco-nums">{inr(d.total)}</td>
                  <td className="px-4 py-3"><StatusBadge value={String(d.status).toLowerCase()} styleMap={DOC_STATUS_STYLES} /></td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex flex-wrap gap-1 justify-end">
                      <Button size="sm" variant="outline" onClick={() => downloadPdf(d)}><FileDown className="h-3.5 w-3.5" /> PDF</Button>
                      {docType === "quotation" && ["sent", "accepted"].includes(String(d.status)) && !d.converted_document_id && (
                        <Button size="sm" variant="outline" title="Convert to sales order" onClick={() => convertDoc(d, "sales_order", "Sales order created")}><ArrowRight className="h-3.5 w-3.5" /> Sales Order</Button>
                      )}
                      {docType === "sales_order" && canConvert(d) && (
                        <Button size="sm" variant="outline" title="Create delivery challan (dispatch stock)" onClick={() => convertDoc(d, "delivery_challan", "Delivery challan created — stock dispatched")}><Truck className="h-3.5 w-3.5" /> Challan</Button>
                      )}
                      {docType === "sales_order" && canConvert(d) && !d.invoice_id && (
                        <Button size="sm" variant="outline" title="Create tax invoice" onClick={() => convertDoc(d, "invoice", "Invoice created")}><ReceiptText className="h-3.5 w-3.5" /> Invoice</Button>
                      )}
                      {["draft", "sent"].includes(d.status) && <Button size="icon" variant="ghost" title="Edit" onClick={() => navigate(`/sales/documents/${docType}/${d.document_id}/edit`)}><Pencil className="h-4 w-4" /></Button>}
                      {d.status === "draft" && <Button size="icon" variant="ghost" title="Send" onClick={() => transition(d, "send")}><Send className="h-4 w-4" /></Button>}
                      {["draft", "sent", "accepted"].includes(d.status) && <Button size="icon" variant="ghost" title="Cancel" onClick={() => transition(d, "cancel")}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun={title.toLowerCase()} />
      </div>
    </div>
  );
}
