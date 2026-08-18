import { useEffect, useState } from "react";
import { Download, Printer, Save, Loader2, Truck } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { apiFetch } from "@/lib/api/client";
import { loadCompanyProfile } from "@/lib/companyProfile";
import {
  emptyEwayForm, downloadEwayJson, printEwaySlip,
  type EwayForm, type EwayInvoiceData,
} from "@/lib/ewayBill";

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

export function EwayBillDialog({
  open, onOpenChange, invoiceId, inv,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  invoiceId: number | null;
  inv: EwayInvoiceData | null;
}) {
  const [form, setForm] = useState<EwayForm>(emptyEwayForm());
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const set = <K extends keyof EwayForm>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!open || !invoiceId) return;
    setLoading(true);
    (async () => {
      try {
        const [res, profile] = await Promise.all([
          apiFetch<{ data: Record<string, unknown> | null }>(`/admin/invoices/${invoiceId}/eway-bill`),
          loadCompanyProfile(),
        ]);
        const row = res.data;
        const base = emptyEwayForm();
        // Prefill "From" (seller) from company profile; keep the rest from saved row if any.
        base.from_gstin = profile.gstin || "";
        base.from_name = profile.name || "";
        base.from_addr = profile.address || "";
        if (row) {
          const s = (k: string) => (row[k] == null ? "" : String(row[k]));
          setForm({
            supply_type: s("supply_type") || "O", sub_supply: s("sub_supply") || "1", doc_type: s("doc_type") || "INV",
            trans_mode: s("trans_mode") || "1", vehicle_no: s("vehicle_no"), vehicle_type: s("vehicle_type") || "R",
            transporter_id: s("transporter_id"), transporter_name: s("transporter_name"),
            transport_doc_no: s("transport_doc_no"), transport_doc_date: s("transport_doc_date").slice(0, 10),
            distance_km: s("distance_km"),
            from_gstin: s("from_gstin") || base.from_gstin, from_name: s("from_name") || base.from_name,
            from_addr: s("from_addr") || base.from_addr, from_place: s("from_place"),
            from_pincode: s("from_pincode"), from_state: s("from_state") || "Tamil Nadu",
            to_place: s("to_place") || (inv?.customerCity ?? ""), to_pincode: s("to_pincode"),
            ewb_no: s("ewb_no"), ewb_date: s("ewb_date").slice(0, 10), valid_until: s("valid_until").slice(0, 10),
            notes: s("notes"),
          });
        } else {
          setForm({ ...base, to_place: inv?.customerCity ?? "" });
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load e-way bill");
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, invoiceId]);

  const save = async () => {
    if (!invoiceId) return;
    setSaving(true);
    try {
      await apiFetch(`/admin/invoices/${invoiceId}/eway-bill`, { method: "PUT", body: JSON.stringify(form) });
      toast.success("E-way bill details saved");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogScrollContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Truck className="h-5 w-5 text-primary" /> E-Way Bill — {inv?.invoiceNumber}</DialogTitle>
          <DialogDescription>
            Enter transport details, download the NIC JSON to upload on the e-way bill portal, then save the EWB number it returns.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="py-10 flex items-center justify-center text-muted-foreground"><Loader2 className="h-5 w-5 animate-spin mr-2" /> Loading…</div>
        ) : (
          <div className="space-y-5">
            {/* Transport */}
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Transport</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <F label="Mode">
                  <Select value={form.trans_mode} onValueChange={(v) => set("trans_mode", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="1">Road</SelectItem><SelectItem value="2">Rail</SelectItem>
                      <SelectItem value="3">Air</SelectItem><SelectItem value="4">Ship</SelectItem>
                    </SelectContent>
                  </Select>
                </F>
                <F label="Vehicle no."><Input value={form.vehicle_no} onChange={(e) => set("vehicle_no", e.target.value)} placeholder="TN01AB1234" /></F>
                <F label="Distance (km)"><Input type="number" min="0" value={form.distance_km} onChange={(e) => set("distance_km", e.target.value)} /></F>
                <F label="Transporter ID (GSTIN)"><Input value={form.transporter_id} onChange={(e) => set("transporter_id", e.target.value)} /></F>
                <F label="Transporter name"><Input value={form.transporter_name} onChange={(e) => set("transporter_name", e.target.value)} /></F>
                <F label="Vehicle type">
                  <Select value={form.vehicle_type} onValueChange={(v) => set("vehicle_type", v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent><SelectItem value="R">Regular</SelectItem><SelectItem value="O">Over-dimensional</SelectItem></SelectContent>
                  </Select>
                </F>
                <F label="Transport doc no."><Input value={form.transport_doc_no} onChange={(e) => set("transport_doc_no", e.target.value)} placeholder="LR / RR no." /></F>
                <F label="Transport doc date"><Input type="date" value={form.transport_doc_date} onChange={(e) => set("transport_doc_date", e.target.value)} /></F>
              </div>
            </section>

            {/* From */}
            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold text-foreground">From (dispatch)</h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <F label="GSTIN"><Input value={form.from_gstin} onChange={(e) => set("from_gstin", e.target.value)} className="font-mono" /></F>
                <F label="Name"><Input value={form.from_name} onChange={(e) => set("from_name", e.target.value)} /></F>
                <F label="State"><Input value={form.from_state} onChange={(e) => set("from_state", e.target.value)} /></F>
                <F label="Place"><Input value={form.from_place} onChange={(e) => set("from_place", e.target.value)} /></F>
                <F label="Pincode"><Input value={form.from_pincode} onChange={(e) => set("from_pincode", e.target.value)} maxLength={6} /></F>
                <div className="sm:col-span-1 col-span-2"><F label="Address"><Input value={form.from_addr} onChange={(e) => set("from_addr", e.target.value)} /></F></div>
              </div>
            </section>

            {/* To */}
            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold text-foreground">To (recipient — from invoice)</h3>
              <div className="rounded-lg bg-muted/40 p-3 text-sm">
                <div className="font-medium text-card-foreground">{inv?.customer}</div>
                <div className="text-muted-foreground">{inv?.customerAddress || "—"}</div>
                <div className="text-muted-foreground">{inv?.customerState} · GSTIN {inv?.customerGstin || "URP (unregistered)"}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <F label="To place"><Input value={form.to_place} onChange={(e) => set("to_place", e.target.value)} /></F>
                <F label="To pincode"><Input value={form.to_pincode} onChange={(e) => set("to_pincode", e.target.value)} maxLength={6} /></F>
              </div>
            </section>

            {/* EWB result */}
            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold text-foreground">EWB number <span className="font-normal text-muted-foreground text-xs">(enter after portal upload)</span></h3>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                <F label="EWB no."><Input value={form.ewb_no} onChange={(e) => set("ewb_no", e.target.value)} className="font-mono" /></F>
                <F label="EWB date"><Input type="date" value={form.ewb_date} onChange={(e) => set("ewb_date", e.target.value)} /></F>
                <F label="Valid until"><Input type="date" value={form.valid_until} onChange={(e) => set("valid_until", e.target.value)} /></F>
              </div>
              <F label="Notes"><Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} /></F>
            </section>
          </div>
        )}

        <DialogFooter className="flex-wrap gap-2">
          <Button variant="outline" onClick={() => inv && downloadEwayJson(inv, form)} disabled={loading || !inv}>
            <Download className="h-4 w-4 mr-1" /> Download JSON
          </Button>
          <Button variant="outline" onClick={() => inv && printEwaySlip(inv, form)} disabled={loading || !inv}>
            <Printer className="h-4 w-4 mr-1" /> Print slip
          </Button>
          <Button onClick={save} disabled={loading || saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Save className="h-4 w-4 mr-1" />} Save
          </Button>
        </DialogFooter>
      </DialogScrollContent>
    </Dialog>
  );
}
