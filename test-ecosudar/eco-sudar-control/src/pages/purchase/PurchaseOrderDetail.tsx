import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, Send, PackageCheck, IndianRupee, Ban, Pencil, CheckCircle2,
  ClipboardList, ShoppingBag, Truck, ReceiptText, Wallet, PackageMinus, Copy, RotateCcw, Undo2,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { StatusBadge } from "@/components/StatusBadge";
import { QuickCreateDialog } from "@/components/QuickCreateDialog";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { cn } from "@/lib/utils";

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);
const inr = (n: unknown) => `₹${Number(n ?? 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const qtyFmt = (n: unknown) => Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 3 });
const today = () => new Date().toISOString().slice(0, 10);
const PAYMENT_MODES = ["Cash", "Bank Transfer", "UPI", "Cheque", "Card"];

const PO_STATUS_STYLES: Record<string, string> = {
  paid:                "bg-emerald-50 text-emerald-700 border-emerald-200",
  billed:              "bg-primary/10 text-primary border-primary/20",
  received:            "bg-primary/10 text-primary border-primary/20",
  partially_received:  "bg-amber-50 text-amber-700 border-amber-200",
  issued:              "bg-blue-50 text-blue-700 border-blue-200",
  cancelled:           "bg-destructive/10 text-destructive border-destructive/20",
  short_closed:        "bg-amber-50 text-amber-700 border-amber-200",
  draft:               "bg-muted text-muted-foreground border-border",
};
const PAY_STATUS_STYLES: Record<string, string> = {
  paid:    "bg-emerald-50 text-emerald-700 border-emerald-200",
  partial: "bg-amber-50 text-amber-700 border-amber-200",
  unpaid:  "bg-red-50 text-red-600 border-red-200",
};

type StepState = "done" | "current" | "todo";
const STEPS = [
  { key: "request", label: "Request", icon: ClipboardList },
  { key: "order", label: "Order", icon: ShoppingBag },
  { key: "received", label: "Received", icon: Truck },
  { key: "bill", label: "Bill", icon: ReceiptText },
] as const;

/** Map a PO status → the state of each of the 4 flow steps. */
function stepStates(status: string): Record<string, StepState> {
  const s = (status || "").toLowerCase();
  const orderDone = !["draft", "cancelled"].includes(s);
  const receiveActive = ["issued", "partially_received"].includes(s);
  const receiveDone = ["received", "short_closed", "billed", "paid"].includes(s);
  const billDone = ["billed", "paid"].includes(s);

  // A PO existing means the request was made — always complete.
  const request: StepState = "done";
  const order: StepState = s === "draft" ? "current" : orderDone ? "done" : "todo";
  const received: StepState = receiveDone ? "done" : receiveActive ? "current" : "todo";
  const bill: StepState = billDone ? "done" : receiveDone ? "current" : "todo";
  return { request, order, received, bill };
}

function FlowStepper({ status }: { status: string }) {
  const states = stepStates(status);
  return (
    <div className="flex items-center">
      {STEPS.map((step, i) => {
        const state = states[step.key];
        const Icon = step.icon;
        return (
          <div key={step.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <span className={cn(
                "flex h-10 w-10 items-center justify-center rounded-full border-2 transition-colors",
                state === "done" && "border-primary bg-primary text-primary-foreground",
                state === "current" && "border-primary bg-primary/10 text-primary",
                state === "todo" && "border-border bg-muted text-muted-foreground",
              )}>
                {state === "done" ? <CheckCircle2 className="h-5 w-5" /> : <Icon className="h-5 w-5" />}
              </span>
              <span className={cn(
                "text-xs font-medium",
                state === "todo" ? "text-muted-foreground" : "text-foreground",
              )}>{step.label}</span>
            </div>
            {i < STEPS.length - 1 && (
              <div className={cn("mx-2 h-0.5 flex-1 rounded", states[STEPS[i + 1].key] !== "todo" ? "bg-primary" : "bg-border")} />
            )}
          </div>
        );
      })}
    </div>
  );
}

interface ReceiveLine { po_item_id: number; description: string; ordered: number; received: number; outstanding: number; unit: string; qtyNow: string; }

export default function PurchaseOrderDetail() {
  const navigate = useNavigate();
  const { id } = useParams();
  const poId = Number(id);

  const [po, setPo] = useState<ApiRow | null>(null);
  const [payInfo, setPayInfo] = useState<ApiRow | null>(null);
  const [payments, setPayments] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [receiveOpen, setReceiveOpen] = useState(false);
  const [receiveDate, setReceiveDate] = useState(today());
  const [receiveNotes, setReceiveNotes] = useState("");
  const [receiveLines, setReceiveLines] = useState<ReceiveLine[]>([]);

  const [payOpen, setPayOpen] = useState(false);
  const [payForm, setPayForm] = useState({ amount: "", payment_mode: "Bank Transfer", paid_on: today(), reference_no: "", notes: "" });

  const [confirmCancel, setConfirmCancel] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [voidGrn, setVoidGrn] = useState<ApiRow | null>(null);
  const [voidReason, setVoidReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [poRow, pay] = await Promise.all([
        phase2Api.purchaseOrders.get(poId),
        phase2Api.purchaseOrders.payments(poId).catch(() => null),
      ]);
      setPo(poRow);
      if (pay) { setPayInfo(pay.purchase_order ?? null); setPayments(Array.isArray(pay.payments) ? pay.payments : []); }
    } catch (e) {
      toast.error(err(e, "Failed to load purchase order"));
    } finally {
      setLoading(false);
    }
  }, [poId]);
  useEffect(() => { if (poId > 0) load(); }, [poId, load]);

  const status = String(po?.status ?? "").toLowerCase();
  const items: ApiRow[] = useMemo(() => (Array.isArray(po?.items) ? po!.items : []), [po]);
  const receipts: ApiRow[] = useMemo(() => (Array.isArray(po?.receipts) ? po!.receipts : []), [po]);
  const outstandingQty = useMemo(() => items.reduce((s, it) => s + Number(it.outstanding_qty ?? 0), 0), [items]);

  const total = Number(payInfo?.total ?? po?.total ?? 0);
  const paid = Number(payInfo?.amount_paid ?? 0);
  const balance = Number(payInfo?.balance_due ?? Math.max(0, total - paid));
  const payStatus = String(payInfo?.payment_status ?? po?.payment_status ?? "unpaid").toLowerCase();

  const canIssue = status === "draft";
  const canReceive = ["issued", "partially_received"].includes(status);
  const canBill = ["received", "short_closed"].includes(status);
  const canCancel = ["draft", "issued"].includes(status);
  const canPay = !["draft", "cancelled"].includes(status) && balance > 0.005;
  const canRevert = ["issued", "billed", "cancelled"].includes(status);
  const revertTarget =
    status === "billed" ? "back to Received — the linked bill/expense will be removed"
    : status === "issued" ? "back to Draft so it can be edited"
    : status === "cancelled" ? "back to Draft (reinstated)"
    : "";

  const submitVoid = async () => {
    if (!voidGrn) return;
    if (!voidReason.trim()) { toast.error("A void reason is required"); return; }
    setBusy(true);
    try {
      await phase2Api.purchaseOrders.voidReceipt(Number(voidGrn.grn_id), voidReason.trim());
      toast.success("Goods receipt voided");
      setVoidGrn(null); setVoidReason("");
      await load();
    } catch (e) {
      toast.error(err(e, "Could not void receipt"));
    } finally {
      setBusy(false);
    }
  };

  const act = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try { await fn(); toast.success(ok); await load(); }
    catch (e) { toast.error(err(e, "Action failed")); }
    finally { setBusy(false); }
  };

  // ── Receive (batch / partial) ───────────────────────────────────────────────
  const openReceive = () => {
    setReceiveDate(today());
    setReceiveNotes("");
    setReceiveLines(items
      .filter((it) => Number(it.outstanding_qty ?? 0) > 0)
      .map((it) => ({
        po_item_id: Number(it.item_id),
        description: String(it.description ?? ""),
        ordered: Number(it.quantity ?? 0),
        received: Number(it.received_qty ?? 0),
        outstanding: Number(it.outstanding_qty ?? 0),
        unit: String(it.unit ?? ""),
        qtyNow: String(Number(it.outstanding_qty ?? 0)),
      })));
    setReceiveOpen(true);
  };
  const submitReceive = async () => {
    const lines = receiveLines
      .map((l) => ({ po_item_id: l.po_item_id, quantity: Number(l.qtyNow || 0), outstanding: l.outstanding }))
      .filter((l) => l.quantity > 0);
    if (!lines.length) { toast.error("Enter a received quantity for at least one item"); return; }
    const over = lines.find((l) => l.quantity > l.outstanding + 0.0005);
    if (over) { toast.error("Received quantity cannot exceed the outstanding quantity"); return; }
    setBusy(true);
    try {
      await phase2Api.purchaseOrders.receive(poId, {
        received_on: receiveDate,
        notes: receiveNotes.trim(),
        items: lines.map((l) => ({ po_item_id: l.po_item_id, quantity: l.quantity })),
      });
      toast.success("Goods receipt recorded");
      setReceiveOpen(false);
      await load();
    } catch (e) {
      toast.error(err(e, "Could not record receipt"));
    } finally {
      setBusy(false);
    }
  };

  // ── Payment (batch / partial) ───────────────────────────────────────────────
  const openPay = () => {
    setPayForm({ amount: balance > 0 ? String(balance) : "", payment_mode: "Bank Transfer", paid_on: today(), reference_no: "", notes: "" });
    setPayOpen(true);
  };
  const submitPay = async () => {
    const amount = Number(payForm.amount || 0);
    if (amount <= 0) { toast.error("Enter a payment amount greater than 0"); return; }
    if (amount > balance + 0.005) { toast.error(`Payment cannot exceed the outstanding ${inr(balance)}`); return; }
    setBusy(true);
    try {
      await phase2Api.purchaseOrders.pay(poId, {
        direction: "out",
        amount,
        payment_mode: payForm.payment_mode,
        paid_on: payForm.paid_on,
        reference_no: payForm.reference_no.trim() || null,
        notes: payForm.notes.trim() || null,
      });
      toast.success("Payment recorded");
      setPayOpen(false);
      await load();
    } catch (e) {
      toast.error(err(e, "Could not record payment"));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="p-6 text-sm text-muted-foreground">Loading purchase order…</div>;
  if (!po) return (
    <div className="p-6 space-y-3">
      <p className="text-sm text-muted-foreground">Purchase order not found.</p>
      <Button variant="outline" onClick={() => navigate("/purchase/orders")}><ArrowLeft className="h-4 w-4" /> Back to Purchase Orders</Button>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" className="mt-1" onClick={() => navigate("/purchase/orders")}><ArrowLeft className="h-5 w-5" /></Button>
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-2xl font-bold text-foreground">{po.po_number}</h1>
              <StatusBadge value={status} styleMap={PO_STATUS_STYLES} />
              <StatusBadge value={payStatus} styleMap={PAY_STATUS_STYLES} />
            </div>
            <p className="text-muted-foreground">
              <button type="button" className="text-primary hover:underline" onClick={() => navigate(`/purchase/vendors/${po.vendor_id}`)}>{po.vendor_name}</button>
              {po.reference_number ? ` · Ref ${po.reference_number}` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {canIssue && <Button variant="outline" disabled={busy} onClick={() => act(() => phase2Api.purchaseOrders.issue(poId), "PO issued")}><Send className="h-4 w-4" /> Issue</Button>}
          {canReceive && <Button disabled={busy} onClick={openReceive}><Truck className="h-4 w-4" /> Receive</Button>}
          {canBill && <Button variant="outline" disabled={busy} onClick={() => act(() => phase2Api.purchaseOrders.bill(poId), "Bill recorded")}><IndianRupee className="h-4 w-4" /> Bill</Button>}
          {canPay && <Button variant="outline" disabled={busy} onClick={openPay}><Wallet className="h-4 w-4" /> Add Payment</Button>}
          {["draft", "issued"].includes(status) && <Button variant="outline" disabled={busy} onClick={() => navigate(`/purchase/orders/${poId}/edit`)}><Pencil className="h-4 w-4" /> Edit</Button>}
          <Button variant="outline" disabled={busy} onClick={() => navigate(`/purchase/orders/new?from=${poId}`)}><Copy className="h-4 w-4" /> Clone</Button>
          {canRevert && <Button variant="ghost" disabled={busy} onClick={() => setConfirmRevert(true)}><Undo2 className="h-4 w-4" /> Revert</Button>}
          {canCancel && <Button variant="ghost" className="text-destructive" disabled={busy} onClick={() => setConfirmCancel(true)}><Ban className="h-4 w-4" /> Cancel</Button>}
        </div>
      </div>

      {/* Flow stepper */}
      <div className="bg-card rounded-xl border shadow-sm p-5">
        <FlowStepper status={status} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: details + items + receipts */}
        <div className="lg:col-span-2 space-y-6">
          {/* PO info */}
          <div className="bg-card rounded-xl border shadow-sm">
            <div className="p-4 border-b"><h2 className="text-base font-semibold text-card-foreground">Order Details</h2></div>
            <dl className="grid grid-cols-2 md:grid-cols-3 gap-4 p-4 text-sm">
              <Detail label="Vendor" value={<button type="button" className="text-primary hover:underline text-left" onClick={() => navigate(`/purchase/vendors/${po.vendor_id}`)}>{po.vendor_name}</button>} />
              <Detail label="Order Date" value={po.order_date} />
              <Detail label="Expected" value={po.expected_date || "—"} />
              <Detail label="Payment Terms" value={po.payment_terms || "—"} />
              <Detail label="GST Treatment" value={po.gst_treatment || "—"} />
              <Detail label="From Request" value={po.pr_id ? `PR #${po.pr_id}` : "Direct PO"} />
            </dl>
            {po.notes && <div className="px-4 pb-4 text-sm"><span className="text-muted-foreground">Notes: </span>{po.notes}</div>}
          </div>

          {/* Line items */}
          <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
            <div className="p-4 border-b flex items-center justify-between">
              <h2 className="text-base font-semibold text-card-foreground">Line Items</h2>
              {outstandingQty > 0 && <span className="text-xs text-amber-600 inline-flex items-center gap-1"><PackageMinus className="h-3.5 w-3.5" /> {qtyFmt(outstandingQty)} outstanding</span>}
            </div>
            <ScrollableX>
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="text-left px-4 py-2.5 font-medium">Item</th>
                    <th className="text-right px-4 py-2.5 font-medium">Ordered</th>
                    <th className="text-right px-4 py-2.5 font-medium">Received</th>
                    <th className="text-right px-4 py-2.5 font-medium">Outstanding</th>
                    <th className="text-right px-4 py-2.5 font-medium">Rate</th>
                    <th className="text-right px-4 py-2.5 font-medium">GST %</th>
                    <th className="text-right px-4 py-2.5 font-medium">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it) => {
                    const out = Number(it.outstanding_qty ?? 0);
                    return (
                      <tr key={it.item_id} className="border-t">
                        <td className="px-4 py-2.5">
                          <div className="font-medium text-card-foreground">{it.description}</div>
                          {it.hsn_code && <div className="text-xs text-muted-foreground">HSN {it.hsn_code}</div>}
                        </td>
                        <td className="px-4 py-2.5 text-right eco-nums">{qtyFmt(it.quantity)} {it.unit}</td>
                        <td className="px-4 py-2.5 text-right eco-nums">{qtyFmt(it.received_qty)}</td>
                        <td className={cn("px-4 py-2.5 text-right eco-nums", out > 0 ? "text-amber-600 font-medium" : "text-muted-foreground")}>{qtyFmt(out)}</td>
                        <td className="px-4 py-2.5 text-right eco-nums">{inr(it.unit_price)}</td>
                        <td className="px-4 py-2.5 text-right eco-nums text-muted-foreground">{Number(it.gst_rate ?? 0)}%</td>
                        <td className="px-4 py-2.5 text-right eco-nums font-medium">{inr(it.line_total)}</td>
                      </tr>
                    );
                  })}
                  {items.length === 0 && <tr><td colSpan={7} className="px-4 py-6 text-center text-muted-foreground">No line items.</td></tr>}
                </tbody>
              </table>
            </ScrollableX>
          </div>

          {/* Goods receipts (batches) */}
          <div className="bg-card rounded-xl border shadow-sm">
            <div className="p-4 border-b"><h2 className="text-base font-semibold text-card-foreground">Goods Receipts <span className="text-muted-foreground font-normal">({receipts.length})</span></h2></div>
            <div className="divide-y">
              {receipts.length === 0 && <div className="p-4 text-sm text-muted-foreground">No goods received yet.</div>}
              {receipts.map((r) => (
                <div key={r.grn_id} className="p-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <PackageCheck className="h-4 w-4 text-primary" />
                      <span className="font-medium text-card-foreground">{r.grn_number}</span>
                      {r.status && r.status !== "posted" && <StatusBadge value={String(r.status).toLowerCase()} styleMap={{ voided: "bg-destructive/10 text-destructive border-destructive/20" }} />}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {r.received_on}{r.received_by_name ? ` · by ${r.received_by_name}` : ""}
                      {Array.isArray(r.items) ? ` · ${r.items.length} line${r.items.length === 1 ? "" : "s"}` : ""}
                    </div>
                    {r.notes && <div className="text-xs text-muted-foreground mt-0.5">{r.notes}</div>}
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    <div className="text-right text-xs text-muted-foreground">
                      {Array.isArray(r.items) && r.items.map((it: ApiRow, idx: number) => (
                        <div key={idx}>{qtyFmt(it.quantity)} × {it.description || `#${it.po_item_id}`}</div>
                      ))}
                    </div>
                    {String(r.status ?? "posted").toLowerCase() !== "voided" && (
                      <Button size="sm" variant="ghost" className="h-7 text-destructive" disabled={busy} onClick={() => { setVoidGrn(r); setVoidReason(""); }}>
                        <RotateCcw className="h-3.5 w-3.5" /> Void
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right: totals + payments */}
        <div className="space-y-6">
          <div className="bg-card rounded-xl border shadow-sm p-4 space-y-2 text-sm">
            <h2 className="text-base font-semibold text-card-foreground mb-2">Summary</h2>
            <Row label="Subtotal" value={inr(po.subtotal)} />
            <Row label="Tax (GST)" value={inr(po.tax_amount)} />
            {Number(po.other_charges ?? 0) > 0 && <Row label="Other Charges" value={inr(po.other_charges)} />}
            <div className="border-t pt-2"><Row label="Total" value={inr(total)} bold /></div>
          </div>

          <div className="bg-card rounded-xl border shadow-sm">
            <div className="p-4 border-b flex items-center gap-2">
              <h2 className="text-base font-semibold text-card-foreground">Payments</h2>
              <span className="text-xs text-muted-foreground">{payments.length} installment{payments.length === 1 ? "" : "s"}</span>
            </div>
            {po.billed_expense_id && (
              <div className="px-4 pt-3 -mb-1 text-xs text-muted-foreground inline-flex items-center gap-1">
                <ReceiptText className="h-3.5 w-3.5 text-primary" /> Billed to expense
                <button type="button" className="text-primary hover:underline" onClick={() => navigate(`/expenses/${po.billed_expense_id}/edit`)}>#{po.billed_expense_id}</button>
              </div>
            )}
            <div className="p-4 space-y-2 text-sm border-b">
              <Row label="Total" value={inr(total)} />
              <Row label="Paid" value={inr(paid)} valueClass="text-emerald-600" />
              <Row label="Outstanding" value={inr(balance)} valueClass={balance > 0 ? "text-amber-600 font-semibold" : "text-muted-foreground"} />
              {paid > total + 0.005 && <Row label="Credit (advance)" value={inr(paid - total)} valueClass="text-primary" />}
            </div>
            <div className="divide-y">
              {payments.length === 0 && <div className="p-4 text-sm text-muted-foreground">No payments recorded yet.</div>}
              {payments.map((p) => (
                <div key={p.payment_id ?? p.id} className="p-4 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-card-foreground eco-nums">{inr(p.amount)}</div>
                    <div className="text-xs text-muted-foreground">
                      {(p.paid_on ?? p.payment_date ?? "").toString().slice(0, 10)} · {p.payment_mode}
                      {p.reference_no ? ` · ${p.reference_no}` : ""}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground">{p.payment_number}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Receive dialog */}
      <QuickCreateDialog
        open={receiveOpen}
        onOpenChange={setReceiveOpen}
        title="Receive Goods"
        description="Record what physically arrived. You can receive in multiple batches — outstanding quantities carry forward."
        size="xl"
        saving={busy}
        submitLabel="Record Receipt"
        onSubmit={submitReceive}
        submitDisabled={receiveLines.every((l) => Number(l.qtyNow || 0) <= 0)}
      >
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Received On</Label>
            <Input type="date" value={receiveDate} onChange={(e) => setReceiveDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label>Notes</Label>
            <Input value={receiveNotes} onChange={(e) => setReceiveNotes(e.target.value)} placeholder="Vehicle no., condition…" />
          </div>
        </div>
        <ScrollableX className="rounded-md border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-3 py-2 font-medium">Item</th>
                <th className="text-right px-3 py-2 font-medium">Ordered</th>
                <th className="text-right px-3 py-2 font-medium">Already</th>
                <th className="text-right px-3 py-2 font-medium">Outstanding</th>
                <th className="text-right px-3 py-2 font-medium w-32">Receive now</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {receiveLines.map((l, i) => (
                <tr key={l.po_item_id}>
                  <td className="px-3 py-2">{l.description}</td>
                  <td className="px-3 py-2 text-right eco-nums">{qtyFmt(l.ordered)} {l.unit}</td>
                  <td className="px-3 py-2 text-right eco-nums text-muted-foreground">{qtyFmt(l.received)}</td>
                  <td className="px-3 py-2 text-right eco-nums text-amber-600">{qtyFmt(l.outstanding)}</td>
                  <td className="px-3 py-2 text-right">
                    <Input
                      type="number" min={0} max={l.outstanding} step="0.001"
                      value={l.qtyNow}
                      onFocus={(e) => e.currentTarget.select()}
                      onChange={(e) => setReceiveLines((ls) => ls.map((x, idx) => idx === i ? { ...x, qtyNow: e.target.value.replace(/^0+(?=\d)/, "") } : x))}
                      className="h-8 w-28 text-right text-sm ml-auto"
                    />
                  </td>
                </tr>
              ))}
              {receiveLines.length === 0 && <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">Nothing outstanding to receive.</td></tr>}
            </tbody>
          </table>
        </ScrollableX>
      </QuickCreateDialog>

      {/* Payment dialog */}
      <QuickCreateDialog
        open={payOpen}
        onOpenChange={setPayOpen}
        title="Record Payment"
        description="Payments to the vendor can be made in parts. Outstanding updates automatically."
        size="md"
        saving={busy}
        submitLabel="Record Payment"
        onSubmit={submitPay}
      >
        <div className="grid grid-cols-3 gap-2 mb-1">
          <div className="rounded-md border bg-muted/40 p-2.5 text-center">
            <div className="text-xs text-muted-foreground">Total</div>
            <div className="font-semibold eco-nums text-sm">{inr(total)}</div>
          </div>
          <div className="rounded-md border bg-muted/40 p-2.5 text-center">
            <div className="text-xs text-muted-foreground">Paid</div>
            <div className="font-semibold eco-nums text-sm text-emerald-600">{inr(paid)}</div>
          </div>
          <div className="rounded-md border bg-muted/40 p-2.5 text-center">
            <div className="text-xs text-muted-foreground">Outstanding</div>
            <div className="font-semibold eco-nums text-sm text-amber-600">{inr(balance)}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 mb-1">
          <StatusBadge value={payStatus} styleMap={PAY_STATUS_STYLES} />
          <span className="text-xs text-muted-foreground">{payments.length} installment{payments.length === 1 ? "" : "s"} recorded</span>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <Label>Amount (₹)</Label>
            <Input type="number" min={0} max={balance} step="0.01" value={payForm.amount} onFocus={(e) => e.currentTarget.select()} onChange={(e) => setPayForm((f) => ({ ...f, amount: e.target.value.replace(/^0+(?=\d)/, "") }))} placeholder="0.00" />
            <p className="text-xs text-muted-foreground">Max {inr(balance)} — can't exceed the outstanding balance.</p>
          </div>
          <div className="space-y-1.5">
            <Label>Payment Mode</Label>
            <Select value={payForm.payment_mode} onValueChange={(v) => setPayForm((f) => ({ ...f, payment_mode: v }))}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Paid On</Label>
            <Input type="date" value={payForm.paid_on} onChange={(e) => setPayForm((f) => ({ ...f, paid_on: e.target.value }))} />
          </div>
          <div className="space-y-1.5">
            <Label>Reference No.</Label>
            <Input value={payForm.reference_no} onChange={(e) => setPayForm((f) => ({ ...f, reference_no: e.target.value }))} placeholder="UTR / cheque no." />
          </div>
          <div className="space-y-1.5 md:col-span-2">
            <Label>Notes</Label>
            <Textarea rows={2} value={payForm.notes} onChange={(e) => setPayForm((f) => ({ ...f, notes: e.target.value }))} />
          </div>
        </div>
      </QuickCreateDialog>

      <ConfirmDeleteDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        onConfirm={() => act(() => phase2Api.purchaseOrders.cancel(poId), "PO cancelled")}
        title="Cancel this purchase order?"
        description={`"${po.po_number}" will be marked cancelled. This cannot be undone.`}
        confirmLabel="Cancel PO"
      />

      <ConfirmDeleteDialog
        open={confirmRevert}
        onOpenChange={setConfirmRevert}
        onConfirm={() => act(() => phase2Api.purchaseOrders.revert(poId), "Purchase order reverted")}
        title="Revert this purchase order?"
        description={`"${po.po_number}" will move ${revertTarget}.`}
        confirmLabel="Revert"
      />

      <QuickCreateDialog
        open={!!voidGrn}
        onOpenChange={(o) => { if (!o) { setVoidGrn(null); setVoidReason(""); } }}
        title="Void Goods Receipt"
        description={voidGrn ? `Reverses the received quantities from ${voidGrn.grn_number} and moves the PO back toward issued.` : ""}
        size="md"
        saving={busy}
        submitLabel="Void receipt"
        onSubmit={submitVoid}
      >
        <div className="space-y-1.5">
          <Label>Reason <span className="text-destructive">*</span></Label>
          <Textarea rows={3} value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Why is this receipt being voided?" />
        </div>
      </QuickCreateDialog>
    </div>
  );
}

function Detail({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm text-card-foreground mt-0.5">{value}</dd>
    </div>
  );
}

function Row({ label, value, bold, valueClass }: { label: string; value: React.ReactNode; bold?: boolean; valueClass?: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn("text-muted-foreground", bold && "font-semibold text-foreground")}>{label}</span>
      <span className={cn("eco-nums", bold && "font-bold text-foreground", valueClass)}>{value}</span>
    </div>
  );
}
