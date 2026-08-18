/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BadgeIndianRupee, FileBadge, FileCheck2, FileDown, FilePlus2, Landmark, Pencil, Plus, ReceiptText, RefreshCw, Send, Trash2, X, XCircle } from "lucide-react";
import { toast } from "sonner";
import { downloadSalesDocumentPdf } from "@/lib/salesDocumentPdf";
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
const month = () => today().slice(0, 7);
const num = (v: any) => Number(v || 0);
const GST_RATES = ["0", "5", "12", "18", "28"];

const blankLine = (): ApiRow => ({ description: "", hsn_code: "", quantity: "1", unit: "Nos", unit_price: "", gst_rate: "18" });
const blankDoc = (): ApiRow => ({
  document_type: "quotation", customer_name: "", customer_phone: "", customer_email: "", customer_gstin: "",
  customer_state: "Tamil Nadu", customer_address: "", seller_state: "Tamil Nadu", ship_to: "",
  document_date: today(), valid_until: today(), due_date: today(), subject: "", delivery_fee: "0", discount: "0", terms: "",
});

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

function StateBadge({ value }: { value: string }) {
  const s = String(value || "draft").toLowerCase();
  const cls = s.includes("paid") || s.includes("posted") || s.includes("accepted") || s.includes("filed") || s.includes("issued")
    ? "bg-emerald-500/10 text-emerald-600 border-emerald-500/30"
    : s.includes("void") || s.includes("reject") || s.includes("cancel")
      ? "bg-red-500/10 text-red-600 border-red-500/30"
      : "bg-amber-500/10 text-amber-600 border-amber-500/30";
  return <Badge variant="outline" className={cls}>{value || "draft"}</Badge>;
}

function DataTable({ columns, rows, empty = "No records found." }: { columns: string[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <ScrollableX>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground"><tr>{columns.map((c) => <th key={c} className="px-4 py-3 text-left font-medium whitespace-nowrap">{c}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">{empty}</td></tr>}
            {rows.map((r, i) => <tr key={i} className="border-t hover:bg-muted/30">{r.map((c, j) => <td key={j} className="px-4 py-3 align-top whitespace-nowrap">{c}</td>)}</tr>)}
          </tbody>
        </table>
      </ScrollableX>
    </div>
  );
}

export default function SalesBilling() {
  const navigate = useNavigate();
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [certOpen, setCertOpen] = useState(false);
  const [period, setPeriod] = useState(month());
  const [payment, setPayment] = useState<ApiRow>({ direction: "in", payment_mode: "Bank Transfer", amount: "", invoice_id: "", po_id: "", user_id: "", vendor_id: "", paid_on: today(), reference_no: "", notes: "" });
  const [cert, setCert] = useState<ApiRow>({ batch_number: "", product_name: "", customer_name: "", test_date: today(), valid_until: "", moisture_content: "", ash_content: "", gcv: "", status: "draft", notes: "" });
  const [certFile, setCertFile] = useState<File | null>(null);

  // ── Data state ───────────────────────────────────────────────────────────────
  const [paymentsData, setPaymentsData] = useState<any[]>([]);
  const [ageingData, setAgeingData] = useState<any>(null);
  const [docsData, setDocsData] = useState<any[]>([]);
  const [certsData, setCertsData] = useState<any[]>([]);
  const [gstRowsData, setGstRowsData] = useState<any[]>([]);
  const [gstCalcData, setGstCalcData] = useState<any>(null);

  const loadAll = () => {
    phase2Api.payments.list().then(setPaymentsData).catch(() => {});
    phase2Api.payments.ageing().then(setAgeingData).catch(() => {});
    phase2Api.salesDocuments.list().then(setDocsData).catch(() => {});
    phase2Api.testCertificates.list().then(setCertsData).catch(() => {});
    phase2Api.gstCompliance.list().then(setGstRowsData).catch(() => {});
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadAll(); }, []);

  useEffect(() => {
    if (!period) { setGstCalcData(null); return; }
    phase2Api.gstCompliance.calculate(period).then(setGstCalcData).catch(() => {});
  }, [period]);

  const doRun = async (action: string, payload?: any): Promise<any> => {
    try {
      let result: any;
      if (action === "payment") result = await phase2Api.payments.create(payload);
      else if (action === "void") result = await phase2Api.payments.void(payload.id, payload.reason);
      else if (action === "doc") result = await phase2Api.salesDocuments.create(payload);
      else if (action.startsWith("doc:")) result = await phase2Api.salesDocuments.transition(payload, action.split(":")[1] as any);
      else if (action === "cert") result = await phase2Api.testCertificates.create(payload);
      else if (action === "certFile") result = await phase2Api.testCertificates.uploadDocument(payload.id, payload.file);
      else if (action.startsWith("cert:")) result = await (phase2Api.testCertificates as any)[action.split(":")[1]](payload);
      else if (action.startsWith("gst:")) result = await (phase2Api.gstCompliance as any)[action.split(":")[1]](payload);
      toast.success("Sales/billing action completed");
      loadAll();
      return result;
    } catch (e: any) {
      toast.error(e instanceof Error ? e.message : e?.message ?? "Operation failed");
      throw e;
    }
  };

  const stats = useMemo(() => {
    const pay = paymentsData ?? [];
    const doc = docsData ?? [];
    const certList = certsData ?? [];
    const totalIn = pay.filter((p) => p.direction === "in" && p.status !== "void").reduce((s, p) => s + num(p.amount), 0);
    const totalOut = pay.filter((p) => p.direction === "out" && p.status !== "void").reduce((s, p) => s + num(p.amount), 0);
    return {
      collected: totalIn,
      paidOut: totalOut,
      openDocs: doc.filter((d) => !["accepted", "cancelled", "converted", "rejected"].includes(String(d.status))).length,
      certificates: certList.length,
      overdue: num((ageingData as any)?.totals?.overdue ?? (ageingData as any)?.overdue_total),
    };
  }, [paymentsData, docsData, certsData, ageingData]);

  const postPayment = async () => {
    if (!payment.amount || num(payment.amount) <= 0) return toast.error("Amount is required");
    const payload = { ...payment, amount: num(payment.amount), invoice_id: num(payment.invoice_id) || undefined, po_id: num(payment.po_id) || undefined, user_id: num(payment.user_id) || undefined, vendor_id: num(payment.vendor_id) || undefined };
    await doRun("payment", payload);
    setPaymentOpen(false);
  };

  const downloadPdf = async (d: ApiRow) => {
    try {
      const full = await phase2Api.salesDocuments.get(d.document_id);
      downloadSalesDocumentPdf(full);
    } catch (e: any) { toast.error(e.message); }
  };

  const createCertificate = async () => {
    if (!cert.batch_number?.trim() && !cert.product_name?.trim()) return toast.error("Batch number or product name is required");
    const created: any = await doRun("cert", {
      batch_no: cert.batch_number,
      certificate_type: "quality",
      sample_date: cert.test_date,
      issue_date: cert.test_date,
      result_summary: cert.notes,
      parameters: {
        product_name: cert.product_name,
        customer_name: cert.customer_name,
        valid_until: cert.valid_until,
        moisture_content: cert.moisture_content,
        ash_content: cert.ash_content,
        gcv: cert.gcv,
      },
    });
    const id = created?.certificate_id || created?.test_certificate_id || created?.id;
    if (id && certFile) await doRun("certFile", { id, file: certFile });
    setCertFile(null);
    setCertOpen(false);
  };

  const gstAction = async (action: "save" | "review" | "file" | "lock") => {
    if (!period) return toast.error("GST period is required");
    await (phase2Api.gstCompliance as any)[action](period, action === "save" ? gstCalcData : undefined);
    toast.success(`GST ${action} completed`);
    loadAll();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Sales, Billing & Compliance</h1>
          <p className="text-muted-foreground">Payments, quotation/proforma flow, quality certificates, and GST compliance tracking.</p>
        </div>
        <Button variant="outline" onClick={() => loadAll()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard title="Collected" value={inr(stats.collected)} subtitle="posted inflows" icon={BadgeIndianRupee} />
        <StatCard title="Paid Out" value={inr(stats.paidOut)} subtitle="posted outflows" icon={Landmark} />
        <StatCard title="Overdue" value={inr(stats.overdue)} subtitle="receivables ageing" icon={ReceiptText} />
        <StatCard title="Open Docs" value={String(stats.openDocs)} subtitle="quote/proforma pipeline" icon={FilePlus2} />
        <StatCard title="Certificates" value={String(stats.certificates)} subtitle="quality records" icon={FileBadge} />
      </div>

      <Tabs defaultValue="payments" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="documents">Quotation & Proforma</TabsTrigger>
          <TabsTrigger value="certificates">Test Certificates</TabsTrigger>
          <TabsTrigger value="gst">GST Compliance</TabsTrigger>
        </TabsList>

        <TabsContent value="payments" className="space-y-4">
          <div className="flex justify-end"><Button onClick={() => setPaymentOpen(true)}><Plus className="h-4 w-4" /> Post Payment</Button></div>
          <DataTable
            columns={["No", "Date", "Direction", "Mode", "Amount", "Target", "Reference", "Status", "Actions"]}
            rows={paymentsData.map((p) => [
              <span className="font-medium">{p.payment_number}</span>,
              p.paid_on || p.payment_date,
              p.direction,
              p.payment_mode,
              inr(p.amount),
              p.invoice_number || p.po_number || p.customer_name || p.vendor_name || "—",
              p.reference_no || p.reference_number || "—",
              <StateBadge value={p.status} />,
              p.status === "posted" ? <Button size="sm" variant="outline" onClick={() => doRun("void", { id: p.payment_id, reason: "Admin void from dashboard" }).catch(() => {})}>Void</Button> : "—",
            ])}
          />
        </TabsContent>

        <TabsContent value="documents" className="space-y-4">
          <div className="flex justify-end"><Button onClick={() => navigate('/sales-billing/new')}><Plus className="h-4 w-4" /> New Document</Button></div>
          <DataTable
            columns={["Document", "Type", "Customer", "Date", "Valid/Due", "Total", "Status", "Actions"]}
            rows={docsData.map((d) => [
              <span className="font-medium">{d.document_number}{d.converted_document_number ? <div className="text-xs text-muted-foreground">→ {d.invoice_number || d.converted_document_number}</div> : null}</span>,
              <span className="capitalize">{String(d.document_type).replace(/_/g, " ")}</span>,
              <div>{d.customer_name}<div className="text-xs text-muted-foreground">{d.customer_phone || d.customer_email || ""}</div></div>,
              d.document_date,
              d.valid_until || d.due_date || "—",
              inr(d.total),
              <StateBadge value={d.status} />,
              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="outline" onClick={() => downloadPdf(d)}><FileDown className="h-3 w-3" /> PDF</Button>
                {["draft", "sent"].includes(d.status) && <Button size="sm" variant="outline" onClick={() => navigate(`/sales-billing/${d.document_id}/edit`)}><Pencil className="h-3 w-3" /> Edit</Button>}
                {d.status === "draft" && <Button size="sm" variant="outline" onClick={() => doRun("doc:send", d.document_id).catch(() => {})}><Send className="h-3 w-3" /> Send</Button>}
                {["draft", "sent"].includes(d.status) && <Button size="sm" onClick={() => doRun("doc:accept", d.document_id).catch(() => {})}>Accept</Button>}
                {["draft", "sent"].includes(d.status) && <Button size="sm" variant="outline" onClick={() => doRun("doc:reject", d.document_id).catch(() => {})}><XCircle className="h-3 w-3" /> Reject</Button>}
                {["quotation", "proforma"].includes(d.document_type) && ["sent", "accepted"].includes(d.status) && !d.converted_document_id && !d.invoice_id && <Button size="sm" variant="outline" onClick={() => doRun("doc:convert", d.document_id).catch(() => {})}>{d.document_type === "quotation" ? "→ Proforma" : "→ Invoice"}</Button>}
                {["draft", "sent", "accepted", "rejected", "expired"].includes(d.status) && <Button size="sm" variant="ghost" className="text-red-600" onClick={() => doRun("doc:cancel", d.document_id).catch(() => {})}><X className="h-3 w-3" /> Cancel</Button>}
              </div>,
            ])}
          />
        </TabsContent>

        <TabsContent value="certificates" className="space-y-4">
          <div className="flex justify-end"><Button onClick={() => setCertOpen(true)}><Plus className="h-4 w-4" /> New Certificate</Button></div>
          <DataTable
            columns={["Certificate", "Batch", "Product", "Customer", "Test Date", "Validity", "Status", "Actions"]}
            rows={certsData.map((c) => [
              <span className="font-medium">{c.certificate_number || c.test_certificate_id || c.certificate_id}</span>,
              c.batch_no || c.batch_number || "—",
              c.product_name || c.parameters?.product_name || c.product_id || "—",
              c.customer_name || c.parameters?.customer_name || "—",
              c.sample_date || c.issue_date || "—",
              c.parameters?.valid_until || "—",
              <StateBadge value={c.status} />,
              <div className="flex gap-2">
                {c.status === "draft" && <Button size="sm" onClick={() => doRun("cert:issue", c.test_certificate_id || c.certificate_id).catch(() => {})}><FileCheck2 className="h-3 w-3" /> Issue</Button>}
                <Button size="sm" variant="outline" onClick={() => phase2Api.testCertificates.download(c.test_certificate_id || c.certificate_id).catch((e) => toast.error(e.message))}>Download</Button>
              </div>,
            ])}
          />
        </TabsContent>

        <TabsContent value="gst" className="space-y-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm grid grid-cols-1 md:grid-cols-6 gap-3 items-end">
            <Field label="GST Period"><Input type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></Field>
            <Button variant="outline" onClick={() => {
              if (!period) return;
              phase2Api.gstCompliance.calculate(period).then(setGstCalcData).catch(() => {});
            }}>Calculate</Button>
            <Button onClick={() => gstAction("save")}><Save className="h-4 w-4" /> Save</Button>
            <Button variant="outline" onClick={() => gstAction("review")}>Review</Button>
            <Button variant="outline" onClick={() => gstAction("file")}>Mark Filed</Button>
            <Button variant="outline" onClick={() => phase2Api.gstCompliance.export(period).catch((e) => toast.error(e.message))}>Export</Button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <StatCard title="Output GST" value={inr((gstCalcData as any)?.output_gst)} subtitle="sales tax" icon={ReceiptText} />
            <StatCard title="Input GST" value={inr((gstCalcData as any)?.input_gst)} subtitle="purchase tax" icon={Landmark} />
            <StatCard title="Net Payable" value={inr((gstCalcData as any)?.net_payable)} subtitle={period} icon={BadgeIndianRupee} />
            <StatCard title="Exceptions" value={String((gstCalcData as any)?.exceptions?.length ?? 0)} subtitle="needs review" icon={FileBadge} />
          </div>
          <DataTable
            columns={["Period", "Output", "Input", "Net", "Status", "Reviewed", "Filed"]}
            rows={gstRowsData.map((g) => [
              g.period,
              inr(g.output_gst),
              inr(g.input_gst),
              inr(g.net_payable),
              <StateBadge value={g.status} />,
              g.reviewed_at || "—",
              g.filed_at || "—",
            ])}
          />
        </TabsContent>
      </Tabs>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogScrollContent onInteractOutside={(e) => e.preventDefault()} className="max-w-2xl">
          <DialogHeader><DialogTitle>Post Payment</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <Field label="Direction"><Select value={payment.direction} onValueChange={(v) => setPayment({ ...payment, direction: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="in">In</SelectItem><SelectItem value="out">Out</SelectItem></SelectContent></Select></Field>
            <Field label="Mode"><Select value={payment.payment_mode} onValueChange={(v) => setPayment({ ...payment, payment_mode: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["Cash", "Bank Transfer", "UPI", "Cheque", "Card"].map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Amount"><Input type="number" value={payment.amount} onChange={(e) => setPayment({ ...payment, amount: e.target.value })} /></Field>
            <Field label="Date"><Input type="date" value={payment.paid_on} onChange={(e) => setPayment({ ...payment, paid_on: e.target.value })} /></Field>
            <Field label="Invoice ID"><Input value={payment.invoice_id} onChange={(e) => setPayment({ ...payment, invoice_id: e.target.value })} /></Field>
            <Field label="PO ID"><Input value={payment.po_id} onChange={(e) => setPayment({ ...payment, po_id: e.target.value })} /></Field>
            <Field label="Customer/User ID"><Input value={payment.user_id} onChange={(e) => setPayment({ ...payment, user_id: e.target.value })} /></Field>
            <Field label="Vendor ID"><Input value={payment.vendor_id} onChange={(e) => setPayment({ ...payment, vendor_id: e.target.value })} /></Field>
          </div>
          <Field label="Reference / Notes"><Input value={payment.reference_no} onChange={(e) => setPayment({ ...payment, reference_no: e.target.value })} placeholder="UTR, cheque no, receipt ref" /></Field>
          <div className="flex justify-end"><Button onClick={postPayment}>Post Payment</Button></div>
        </DialogScrollContent>
      </Dialog>


      <Dialog open={certOpen} onOpenChange={setCertOpen}>
        <DialogScrollContent className="max-w-2xl">
          <DialogHeader><DialogTitle>Create Test Certificate</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label="Batch number"><Input value={cert.batch_number} onChange={(e) => setCert({ ...cert, batch_number: e.target.value })} /></Field>
            <Field label="Product"><Input value={cert.product_name} onChange={(e) => setCert({ ...cert, product_name: e.target.value })} /></Field>
            <Field label="Customer"><Input value={cert.customer_name} onChange={(e) => setCert({ ...cert, customer_name: e.target.value })} /></Field>
            <Field label="Test date"><Input type="date" value={cert.test_date} onChange={(e) => setCert({ ...cert, test_date: e.target.value })} /></Field>
            <Field label="Valid until"><Input type="date" value={cert.valid_until} onChange={(e) => setCert({ ...cert, valid_until: e.target.value })} /></Field>
            <Field label="Document upload"><Input type="file" accept=".pdf,image/*" onChange={(e) => setCertFile(e.target.files?.[0] ?? null)} /></Field>
            <Field label="Moisture"><Input value={cert.moisture_content} onChange={(e) => setCert({ ...cert, moisture_content: e.target.value })} /></Field>
            <Field label="Ash"><Input value={cert.ash_content} onChange={(e) => setCert({ ...cert, ash_content: e.target.value })} /></Field>
            <Field label="GCV"><Input value={cert.gcv} onChange={(e) => setCert({ ...cert, gcv: e.target.value })} /></Field>
          </div>
          <Field label="Notes"><Textarea value={cert.notes} onChange={(e) => setCert({ ...cert, notes: e.target.value })} /></Field>
          <div className="flex justify-end"><Button onClick={createCertificate}>Create Certificate</Button></div>
        </DialogScrollContent>
      </Dialog>
    </div>
  );
}
