import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FilePlus2, Loader2, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollableX } from "@/components/ui/scrollable-x";

import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";

// ─── Constants ────────────────────────────────────────────────────────────────

const GST_RATES = ["0", "5", "12", "18", "28"];
const today = () => new Date().toISOString().slice(0, 10);
const num = (v: unknown) => Number(v || 0);
const inr = (n: unknown) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const DOCUMENT_TYPES = [
  { value: "quotation",       label: "Quotation" },
  { value: "proforma",        label: "Proforma Invoice" },
  { value: "delivery_challan",label: "Delivery Challan" },
  { value: "sales_order",     label: "Sales Order" },
];

// ─── Types ────────────────────────────────────────────────────────────────────

interface DocLine {
  description: string;
  hsn_code: string;
  quantity: string;
  unit: string;
  unit_price: string;
  gst_rate: string;
}

interface DocForm {
  document_type: string;
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  customer_gstin: string;
  customer_state: string;
  customer_address: string;
  seller_state: string;
  ship_to: string;
  document_date: string;
  valid_until: string;
  due_date: string;
  subject: string;
  delivery_fee: string;
  discount: string;
  terms: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const blankLine = (): DocLine => ({
  description: "", hsn_code: "", quantity: "1", unit: "Nos", unit_price: "", gst_rate: "18",
});

const blankForm = (): DocForm => ({
  document_type: "quotation", customer_name: "", customer_phone: "", customer_email: "",
  customer_gstin: "", customer_state: "Tamil Nadu", customer_address: "",
  seller_state: "Tamil Nadu", ship_to: "",
  document_date: today(), valid_until: today(), due_date: today(),
  subject: "", delivery_fee: "0", discount: "0", terms: "",
});

// ─── Local Field component ────────────────────────────────────────────────────

function Field({ label, children, req, wide }: { label: string; children: React.ReactNode; req?: boolean; wide?: boolean }) {
  return (
    <div className={`grid items-start gap-3 ${wide ? "grid-cols-[9rem_1fr]" : "space-y-1"}`}>
      {wide
        ? <Label className="pt-2 text-sm text-muted-foreground">{label} {req && <Req />}</Label>
        : <Label className="text-xs text-muted-foreground">{label} {req && <Req />}</Label>
      }
      <div>{children}</div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function SaleBillingForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = !!id;

  const [form, setForm] = useState<DocForm>(blankForm());
  const [lines, setLines] = useState<DocLine[]>([blankLine()]);
  const [initial, setInitial] = useState(JSON.stringify({ form: blankForm(), lines: [blankLine()] }));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);

  const set = <K extends keyof DocForm>(k: K, v: DocForm[K]) => setForm(f => ({ ...f, [k]: v }));

  const setLine = (i: number, patch: Partial<DocLine>) =>
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));

  // Load document for edit
  useEffect(() => {
    if (!editing || !id) return;
    setLoading(true);
    phase2Api.salesDocuments.get(Number(id))
      .then((full: ApiRow) => {
        const next: DocForm = {
          document_type:    full.document_type ?? "quotation",
          customer_name:    full.customer_name ?? "",
          customer_phone:   full.customer_phone ?? "",
          customer_email:   full.customer_email ?? "",
          customer_gstin:   full.customer_gstin ?? "",
          customer_state:   full.customer_state ?? "Tamil Nadu",
          customer_address: full.customer_address ?? "",
          seller_state:     full.seller_state ?? "Tamil Nadu",
          ship_to:          full.ship_to ?? "",
          document_date:    (String(full.document_date ?? today())).slice(0, 10),
          valid_until:      (String(full.valid_until ?? today())).slice(0, 10),
          due_date:         (String(full.due_date ?? today())).slice(0, 10),
          subject:          full.subject ?? "",
          delivery_fee:     String(full.delivery_fee ?? 0),
          discount:         String(full.discount ?? 0),
          terms:            full.terms ?? "",
        };
        const nextLines: DocLine[] = (full.items ?? []).length
          ? (full.items as ApiRow[]).map((it: ApiRow) => ({
              description: String(it.description ?? ""),
              hsn_code:    String(it.hsn_code ?? ""),
              quantity:    String(it.quantity ?? 1),
              unit:        String(it.unit ?? "Nos"),
              unit_price:  String(it.unit_price ?? 0),
              gst_rate:    String(it.gst_rate ?? 18),
            }))
          : [blankLine()];
        setForm(next);
        setLines(nextLines);
        setInitial(JSON.stringify({ form: next, lines: nextLines }));
      })
      .catch((e: unknown) => toast.error(e instanceof Error ? e.message : "Failed to load document"))
      .finally(() => setLoading(false));
  }, [id, editing]);

  const dirty = useMemo(
    () => JSON.stringify({ form, lines }) !== initial,
    [form, lines, initial],
  );
  useUnsavedChanges(dirty && !saving, "sale-billing-form");

  const buildItems = () =>
    lines
      .filter(l => String(l.description ?? "").trim())
      .map(l => ({
        description: l.description,
        hsn_code:    l.hsn_code || undefined,
        quantity:    num(l.quantity),
        unit:        l.unit || "Nos",
        unit_price:  num(l.unit_price),
        gst_rate:    num(l.gst_rate),
      }));

  const handleSubmit = async () => {
    if (!form.customer_name.trim()) { toast.error("Customer name is required"); return; }
    const items = buildItems();
    if (items.length === 0) { toast.error("Add at least one line item with a description"); return; }
    if (items.some(it => it.quantity <= 0 || it.unit_price < 0)) {
      toast.error("Each line needs a quantity > 0 and a non-negative price");
      return;
    }

    const payload: ApiRow = {
      ...form,
      delivery_fee: num(form.delivery_fee),
      discount:     num(form.discount),
      items,
    };

    setSaving(true);
    try {
      if (editing && id) {
        await phase2Api.salesDocuments.update(Number(id), payload);
        toast.success("Document updated");
      } else {
        await phase2Api.salesDocuments.create(payload);
        toast.success("Document created");
      }
      setInitial(JSON.stringify({ form, lines }));
      navigate("/sales-billing");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // Live subtotal preview
  const subtotal = useMemo(
    () => lines.reduce((s, l) => s + num(l.quantity) * num(l.unit_price), 0),
    [lines],
  );

  return (
    <FormPage
      title={editing ? "Edit Sales Document" : "New Sales Document"}
      description="Quotation, proforma invoice, delivery challan or sales order."
      icon={<FilePlus2 className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/sales-billing")}
      backLabel="Sales & Billing"
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/sales-billing")} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || loading}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Saving…</> : editing ? "Save Changes" : "Create Document"}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading document…</p>
      ) : (
        <div className="space-y-8">

          {/* ── Section 1: Document type & dates ─────────────────────────────── */}
          <section className="space-y-4">
            <h3 className="text-sm font-semibold text-foreground">Document</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl">
              <Field label="Type" req>
                <Select value={form.document_type} onValueChange={v => set("document_type", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {DOCUMENT_TYPES.map(t => (
                      <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Document Date">
                <Input type="date" value={form.document_date} onChange={e => set("document_date", e.target.value)} />
              </Field>
              <Field label="Valid Until">
                <Input type="date" value={form.valid_until} onChange={e => set("valid_until", e.target.value)} />
              </Field>
              <Field label="Due Date">
                <Input type="date" value={form.due_date} onChange={e => set("due_date", e.target.value)} />
              </Field>
            </div>
            <div className="max-w-xl">
              <Field label="Subject">
                <Input value={form.subject} onChange={e => set("subject", e.target.value)} placeholder="Brief subject line" />
              </Field>
            </div>
          </section>

          {/* ── Section 2: Customer details ───────────────────────────────────── */}
          <section className="space-y-4 border-t pt-5">
            <h3 className="text-sm font-semibold text-foreground">Customer</h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 max-w-4xl">
              <Field label="Customer Name" req>
                <Input value={form.customer_name} onChange={e => set("customer_name", e.target.value)} placeholder="Company or person" />
              </Field>
              <Field label="Phone">
                <Input value={form.customer_phone} onChange={e => set("customer_phone", e.target.value)} placeholder="+91 …" />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.customer_email} onChange={e => set("customer_email", e.target.value)} placeholder="email@example.com" />
              </Field>
              <Field label="GSTIN">
                <Input value={form.customer_gstin} onChange={e => set("customer_gstin", e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" className="font-mono" />
              </Field>
              <Field label="Customer State">
                <Input value={form.customer_state} onChange={e => set("customer_state", e.target.value)} placeholder="e.g. Tamil Nadu" />
              </Field>
              <Field label="Seller State">
                <Input value={form.seller_state} onChange={e => set("seller_state", e.target.value)} placeholder="e.g. Tamil Nadu" />
              </Field>
            </div>
            <div className="max-w-xl space-y-3">
              <Field label="Address">
                <Textarea rows={2} value={form.customer_address} onChange={e => set("customer_address", e.target.value)} placeholder="Street, city, pincode…" />
              </Field>
              <Field label="Ship To">
                <Input value={form.ship_to} onChange={e => set("ship_to", e.target.value)} placeholder="Shipping address (if different)" />
              </Field>
            </div>
          </section>

          {/* ── Section 3: Line items ──────────────────────────────────────────── */}
          <section className="space-y-3 border-t pt-5">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">
                Line Items <span className="text-destructive text-xs">*</span>
              </h3>
              <Button size="sm" variant="outline" onClick={() => setLines(ls => [...ls, blankLine()])}>
                <Plus className="h-4 w-4" /> Add line
              </Button>
            </div>

            <ScrollableX className="border rounded-lg">
              <table className="w-full min-w-[800px] text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-3 py-2">Description</th>
                    <th className="text-left px-3 py-2 w-24">HSN/SAC</th>
                    <th className="text-right px-3 py-2 w-20">Qty</th>
                    <th className="text-left px-3 py-2 w-20">Unit</th>
                    <th className="text-right px-3 py-2 w-28">Unit Price</th>
                    <th className="text-right px-3 py-2 w-24">GST %</th>
                    <th className="text-right px-3 py-2 w-28">Line Total</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((l, i) => {
                    const lineTotal = num(l.quantity) * num(l.unit_price);
                    return (
                      <tr key={i} className="border-t">
                        <td className="px-3 py-1">
                          <Input value={l.description} onChange={e => setLine(i, { description: e.target.value })} placeholder="Item / service description" />
                        </td>
                        <td className="px-3 py-1 w-24">
                          <Input value={l.hsn_code} onChange={e => setLine(i, { hsn_code: e.target.value })} placeholder="44013" />
                        </td>
                        <td className="px-3 py-1 w-20">
                          <Input type="number" min="0.01" step="0.01" value={l.quantity} onChange={e => setLine(i, { quantity: e.target.value })} className="text-right" />
                        </td>
                        <td className="px-3 py-1 w-20">
                          <Input value={l.unit} onChange={e => setLine(i, { unit: e.target.value })} placeholder="Nos" />
                        </td>
                        <td className="px-3 py-1 w-28">
                          <Input type="number" min="0" step="0.01" value={l.unit_price} onChange={e => setLine(i, { unit_price: e.target.value })} className="text-right" placeholder="0" />
                        </td>
                        <td className="px-3 py-1 w-24">
                          <Select value={String(l.gst_rate)} onValueChange={v => setLine(i, { gst_rate: v })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {GST_RATES.map(r => <SelectItem key={r} value={r}>{r}%</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2 text-right font-medium text-card-foreground whitespace-nowrap">
                          {inr(lineTotal)}
                        </td>
                        <td className="px-3 py-1 text-center">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={lines.length === 1}
                            onClick={() => setLines(ls => ls.filter((_, idx) => idx !== i))}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </ScrollableX>

            {/* Totals row */}
            <div className="flex justify-end">
              <p className="text-sm text-muted-foreground">
                Subtotal: <span className="font-semibold text-foreground">{inr(subtotal)}</span>
                <span className="text-xs ml-2">(GST &amp; grand total calculated on save)</span>
              </p>
            </div>
          </section>

          {/* ── Section 4: Adjustments & Terms ────────────────────────────────── */}
          <section className="space-y-4 border-t pt-5">
            <h3 className="text-sm font-semibold text-foreground">Adjustments &amp; Terms</h3>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl">
              <Field label="Delivery Fee (₹)">
                <Input type="number" min="0" step="0.01" value={form.delivery_fee} onChange={e => set("delivery_fee", e.target.value)} placeholder="0" />
              </Field>
              <Field label="Discount (₹)">
                <Input type="number" min="0" step="0.01" value={form.discount} onChange={e => set("discount", e.target.value)} placeholder="0" />
              </Field>
            </div>
            <div className="max-w-2xl">
              <Field label="Terms &amp; Conditions">
                <Textarea rows={4} value={form.terms} onChange={e => set("terms", e.target.value)} placeholder="Payment terms, delivery conditions, warranty…" />
              </Field>
            </div>
          </section>

        </div>
      )}
    </FormPage>
  );
}
