import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, IndianRupee, ReceiptText, Wallet, FileDown, RefreshCw,
  CheckCircle2, Send, Lock, Percent,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { StatCard } from "@/components/StatCard";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { toast } from "sonner";
import {
  gstComplianceApi, currentPeriod,
  type GstCalc, type GstPeriod, type GstStatus,
} from "@/lib/api/gstCompliance";
import { exportWorkbook } from "@/lib/exporters";
import { StatusBadge } from "@/components/StatusBadge";

const inr = (n: number) => `₹${(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

const GST_STATUS_STYLES: Record<string, string> = {
  draft:    "bg-muted text-muted-foreground border-border",
  reviewed: "bg-amber-100 text-amber-700 border-amber-200",
  filed:    "bg-blue-100 text-blue-700 border-blue-200",
  locked:   "bg-primary/10 text-primary border-primary/20",
};

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function periodLabel(key: string): string {
  const [y, m] = key.split("-");
  const d = new Date(Number(y), Number(m) - 1, 1);
  return isNaN(d.getTime()) ? key : d.toLocaleDateString("en-IN", { month: "long", year: "numeric" });
}

export default function GstCompliance() {
  const [period, setPeriod] = useState<string>(currentPeriod());
  const [calc, setCalc] = useState<GstCalc | null>(null);
  const [saved, setSaved] = useState<GstPeriod | null>(null);
  const [history, setHistory] = useState<GstPeriod[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  const [fileOpen, setFileOpen] = useState(false);
  const [fileForm, setFileForm] = useState({ filed_on: new Date().toISOString().slice(0, 10), reference_no: "", notes: "" });

  const loadHistory = useCallback(async () => {
    try { setHistory(await gstComplianceApi.history()); }
    catch (e: unknown) { toast.error(errorMessage(e, "Could not load filing history")); }
  }, []);

  const loadPeriod = useCallback(async (p: string) => {
    setLoading(true);
    try {
      const detail = await gstComplianceApi.detail(p);
      setCalc(detail.calculated);
      setSaved(detail.saved);
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Could not compute GST for this period"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadPeriod(period); }, [period, loadPeriod]);
  useEffect(() => { loadHistory(); }, [loadHistory]);

  const locked = saved?.status === "locked";
  const filed = saved?.status === "filed" || locked;

  const run = async (fn: () => Promise<GstPeriod>, okMsg: string) => {
    setBusy(true);
    try {
      const row = await fn();
      setSaved(row);
      toast.success(okMsg);
      loadHistory();
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Action failed"));
    } finally {
      setBusy(false);
    }
  };

  const onSave    = () => run(() => gstComplianceApi.save(period), "Snapshot saved");
  const onReview  = () => run(() => gstComplianceApi.review(period), "Marked reviewed");
  const onLock    = () => run(() => gstComplianceApi.lock(period), "Period locked");
  const onFile    = async () => {
    setFileOpen(false);
    await run(() => gstComplianceApi.file(period, fileForm), "Return filed");
  };

  const onExport = async () => {
    setBusy(true);
    try {
      const data = await gstComplianceApi.export(period);
      const summarySheet = [{
        Period: periodLabel(period),
        From: data.period.from_date, To: data.period.to_date,
        "Taxable Sales": data.period.sales_taxable,
        CGST: data.period.sales_cgst, SGST: data.period.sales_sgst, IGST: data.period.sales_igst,
        "Output Tax": data.period.output_tax, "Input Tax Credit": data.period.input_tax,
        "Net Payable": data.period.net_payable,
      }];
      const b2b = data.gstr1_b2b.map((r) => ({
        "Invoice No": r.invoice_number, Date: r.invoice_date, Customer: r.customer_name,
        GSTIN: r.customer_gstin, State: r.customer_state, Taxable: r.taxable,
        CGST: r.cgst_amount, SGST: r.sgst_amount, IGST: r.igst_amount, Total: r.total,
      }));
      const hsn = data.hsn_summary.map((r) => ({
        HSN: r.hsn_code, "GST %": r.gst_rate, Qty: r.quantity, Taxable: r.taxable, Tax: r.tax_amount,
      }));
      exportWorkbook(`GSTR1-${period}`, [
        { name: "Summary", rows: summarySheet },
        { name: "B2B Invoices", rows: b2b },
        { name: "HSN Summary", rows: hsn },
      ]);
      toast.success("GSTR-1 workbook downloaded");
    } catch (e: unknown) {
      toast.error(errorMessage(e, "Export failed"));
    } finally {
      setBusy(false);
    }
  };

  const view = calc;
  const isInter = (view?.sales_igst ?? 0) > 0;

  const historyExport = useMemo(() => history.map((h) => ({
    Period: periodLabel(h.period_key), Status: h.status,
    "Taxable Sales": h.sales_taxable, "Output Tax": h.output_tax,
    "Input Credit": h.input_tax, "Net Payable": h.net_payable,
    "Filed On": h.filed_on ?? "", "ARN / Ref": h.reference_no ?? "",
  })), [history]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">GST Compliance</h1>
          <p className="text-muted-foreground">Monthly GSTR summary, output vs input tax, and return filing status.</p>
        </div>
        <div className="flex items-end gap-2 flex-wrap">
          <div>
            <Label className="text-xs text-muted-foreground">Return period</Label>
            <Input
              type="month"
              value={period}
              max={currentPeriod()}
              onChange={(e) => e.target.value && setPeriod(e.target.value)}
              className="w-44"
            />
          </div>
          <Button variant="outline" onClick={() => loadPeriod(period)} disabled={loading}>
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} /> Recalculate
          </Button>
          <Button variant="outline" onClick={onExport} disabled={busy || loading}>
            <FileDown className="h-4 w-4" /> Export GSTR-1
          </Button>
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Taxable Sales" value={inr(view?.sales_taxable ?? 0)}
          subtitle={`${view?.invoice_count ?? 0} invoices`} icon={ReceiptText} subtitleColor="muted" />
        <StatCard title="Output Tax (Payable)" value={inr(view?.output_tax ?? 0)}
          subtitle={isInter ? "IGST" : "CGST + SGST"} icon={Percent} accent="amber" />
        <StatCard title="Input Tax Credit" value={inr(view?.input_tax ?? 0)}
          subtitle={`${view?.purchase_count ?? 0} purchases`} icon={Wallet} subtitleColor="muted" accent="violet" />
        <StatCard title="Net GST Payable" value={inr(view?.net_payable ?? 0)}
          subtitle={(view?.credit_carried ?? 0) > 0 ? `Credit carried ${inr(view!.credit_carried)}` : "After input credit"}
          icon={IndianRupee} />
      </div>

      {/* Tax breakdown + status/actions */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-2 bg-card rounded-xl border shadow-sm p-5">
          <h2 className="font-semibold text-card-foreground mb-4">{periodLabel(period)} — tax breakdown</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
            <Figure label="CGST" value={inr(view?.sales_cgst ?? 0)} />
            <Figure label="SGST" value={inr(view?.sales_sgst ?? 0)} />
            <Figure label="IGST" value={inr(view?.sales_igst ?? 0)} />
            <Figure label="Output Tax" value={inr(view?.output_tax ?? 0)} />
            <Figure label="Input Credit" value={inr(view?.input_tax ?? 0)} />
            <Figure label="Net Payable" value={inr(view?.net_payable ?? 0)} strong />
          </div>
          <p className="text-xs text-muted-foreground mt-4">
            Figures are computed live from sent invoices and posted purchase orders for
            {" "}{view?.from_date} to {view?.to_date}. Save a snapshot to lock these numbers for filing.
          </p>
        </div>

        <div className="bg-card rounded-xl border shadow-sm p-5 flex flex-col">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-card-foreground">Filing status</h2>
            <StatusBadge value={saved?.status ?? "draft"} styleMap={GST_STATUS_STYLES} />
          </div>
          {saved?.filed_on && (
            <p className="text-xs text-muted-foreground mb-1">Filed on {saved.filed_on}</p>
          )}
          {saved?.reference_no && (
            <p className="text-xs text-muted-foreground mb-3">ARN / Ref: <span className="font-medium text-card-foreground">{saved.reference_no}</span></p>
          )}
          <div className="mt-auto space-y-2 pt-2">
            <Button className="w-full" variant="outline" onClick={onSave} disabled={busy || locked}>
              <ShieldCheck className="h-4 w-4" /> Save snapshot
            </Button>
            <Button className="w-full" variant="outline" onClick={onReview} disabled={busy || locked || !saved}>
              <CheckCircle2 className="h-4 w-4" /> Mark reviewed
            </Button>
            <Button className="w-full" onClick={() => setFileOpen(true)} disabled={busy || locked || !saved}>
              <Send className="h-4 w-4" /> {filed ? "Update filing" : "File return"}
            </Button>
            <Button className="w-full" variant="outline" onClick={onLock} disabled={busy || locked || !filed}>
              <Lock className="h-4 w-4" /> Lock period
            </Button>
          </div>
        </div>
      </div>

      {/* Filing history */}
      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <div className="flex items-center justify-between p-4">
          <h2 className="font-semibold text-card-foreground">Filing history</h2>
          <Button size="sm" variant="outline" onClick={() => exportWorkbook("GST-filing-history", [{ name: "History", rows: historyExport }])} disabled={!history.length}>
            <FileDown className="h-4 w-4" /> Export
          </Button>
        </div>
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Period</th>
                <th className="text-right px-4 py-3 font-medium">Taxable</th>
                <th className="text-right px-4 py-3 font-medium">Output Tax</th>
                <th className="text-right px-4 py-3 font-medium">Input Credit</th>
                <th className="text-right px-4 py-3 font-medium">Net Payable</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-left px-4 py-3 font-medium">Filed / Ref</th>
              </tr>
            </thead>
            <tbody>
              {history.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-muted-foreground">No saved periods yet.</td></tr>
              )}
              {history.map((h) => (
                <tr
                  key={h.period_id}
                  className="border-t hover:bg-muted/30 cursor-pointer"
                  onClick={() => setPeriod(h.period_key)}
                >
                  <td className="px-4 py-3 font-semibold text-card-foreground">{periodLabel(h.period_key)}</td>
                  <td className="px-4 py-3 text-right">{inr(h.sales_taxable)}</td>
                  <td className="px-4 py-3 text-right">{inr(h.output_tax)}</td>
                  <td className="px-4 py-3 text-right">{inr(h.input_tax)}</td>
                  <td className="px-4 py-3 text-right font-semibold">{inr(h.net_payable)}</td>
                  <td className="px-4 py-3">
                    <StatusBadge value={h.status} styleMap={GST_STATUS_STYLES} />
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {h.filed_on || "—"}{h.reference_no ? <><br />{h.reference_no}</> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
      </div>

      {/* File return dialog */}
      <Dialog open={fileOpen} onOpenChange={setFileOpen}>
        <DialogScrollContent>
          <DialogHeader>
            <DialogTitle>File GST return — {periodLabel(period)}</DialogTitle>
            <DialogDescription>Record the filing date and the acknowledgement / ARN from the GST portal.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Filed on</Label>
              <Input type="date" value={fileForm.filed_on} onChange={(e) => setFileForm({ ...fileForm, filed_on: e.target.value })} />
            </div>
            <div>
              <Label>ARN / Reference number</Label>
              <Input value={fileForm.reference_no} onChange={(e) => setFileForm({ ...fileForm, reference_no: e.target.value })} placeholder="e.g. AA33..." />
            </div>
            <div>
              <Label>Notes (optional)</Label>
              <Textarea rows={2} value={fileForm.notes} onChange={(e) => setFileForm({ ...fileForm, notes: e.target.value })} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFileOpen(false)}>Cancel</Button>
            <Button onClick={onFile} disabled={busy}>Confirm filing</Button>
          </DialogFooter>
        </DialogScrollContent>
      </Dialog>
    </div>
  );
}

function Figure({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="rounded-lg bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 eco-nums ${strong ? "text-lg font-bold text-card-foreground" : "font-semibold text-card-foreground"}`}>{value}</p>
    </div>
  );
}
