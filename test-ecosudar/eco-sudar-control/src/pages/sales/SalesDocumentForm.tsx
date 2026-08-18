import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FileText, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { RecordCombobox } from "@/components/RecordCombobox";
import { QuickCreateDialog } from "@/components/QuickCreateDialog";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { fetchCustomers, createCustomer, type ApiUser } from "@/lib/api/customers";
import { inventoryApi, type StockItem } from "@/lib/api/inventory";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";

const today = () => new Date().toISOString().slice(0, 10);
const inr = (n: number) => `₹${Number(n ?? 0).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
const GST_RATES = ["0", "5", "12", "18", "28"];

const DOC_TITLES: Record<string, string> = {
  quotation: "Quotation",
  proforma: "Proforma Invoice",
  sales_order: "Sales Order",
  delivery_challan: "Delivery Challan",
};

const DOC_BACK: Record<string, string> = {
  quotation: "/sales/quotations",
  proforma: "/sales/proforma",
  sales_order: "/sales/sales-orders",
  delivery_challan: "/sales/delivery-challans",
};

interface Line {
  product_id: number | null;
  description: string;
  hsn: string;
  quantity: number;
  unit_price: number;
  gst_rate: string;
}

const blankLine = (): Line => ({ product_id: null, description: "", hsn: "", quantity: 1, unit_price: 0, gst_rate: "18" });

interface DocForm {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
  customer_gstin: string;
  document_date: string;
  valid_until: string;
  subject: string;
  notes: string;
}

const blankDoc = (): DocForm => ({
  customer_name: "", customer_phone: "", customer_email: "", customer_gstin: "",
  document_date: today(), valid_until: today(), subject: "", notes: "",
});

function Field({ label, children, req }: { label: React.ReactNode; children: React.ReactNode; req?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-sm text-muted-foreground">{label} {req && <Req />}</Label>
      <div>{children}</div>
    </div>
  );
}

/** Used at routes: /sales/documents/:docType/new  and  /sales/documents/:docType/:id/edit */
export default function SalesDocumentForm() {
  const navigate = useNavigate();
  const { docType = "quotation", id } = useParams<{ docType: string; id: string }>();
  const editing = !!id;

  const docTitle = DOC_TITLES[docType] ?? "Document";
  const backPath = DOC_BACK[docType] ?? "/sales/quotations";

  const [doc, setDoc] = useState<DocForm>(blankDoc());
  const [lines, setLines] = useState<Line[]>([blankLine()]);
  const [initial, setInitial] = useState(JSON.stringify({ doc: blankDoc(), lines: [blankLine()] }));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);

  // Connectivity: pick an existing customer / finished-stock product (with inline create).
  const [customers, setCustomers] = useState<ApiUser[]>([]);
  const [products, setProducts] = useState<StockItem[]>([]);
  const [customerId, setCustomerId] = useState<number | null>(null);
  const [custOpen, setCustOpen] = useState(false);
  const [custForm, setCustForm] = useState({ name: "", phone: "", email: "" });
  const [custSaving, setCustSaving] = useState(false);

  useEffect(() => {
    fetchCustomers(200).then(setCustomers).catch(() => {});
    inventoryApi.stock().then(setProducts).catch(() => {});
  }, []);

  const pickCustomer = (cid: number | string) => {
    const c = customers.find(x => x.user_id === Number(cid));
    if (!c) return;
    setCustomerId(Number(cid));
    setDoc(d => ({ ...d, customer_name: c.name ?? "", customer_phone: c.phone ?? "", customer_email: c.email ?? "" }));
  };
  const submitCustomer = async () => {
    if (!custForm.name.trim()) { toast.error("Customer name is required"); return; }
    if (!custForm.phone.trim() || !custForm.email.trim()) { toast.error("Phone and email are required to add a customer"); return; }
    setCustSaving(true);
    try {
      const created = await createCustomer({ name: custForm.name.trim(), phone: custForm.phone.trim(), email: custForm.email.trim() });
      toast.success("Customer added");
      setCustomers(await fetchCustomers(200));
      setCustomerId(created.user_id);
      setDoc(d => ({ ...d, customer_name: created.name ?? custForm.name, customer_phone: created.phone ?? custForm.phone, customer_email: created.email ?? custForm.email }));
      setCustOpen(false);
      setCustForm({ name: "", phone: "", email: "" });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not add customer");
    } finally {
      setCustSaving(false);
    }
  };
  // Selecting a finished-stock product fills the line (and links product_id so a
  // delivery challan can deduct that product's stock).
  const pickProduct = (i: number, pid: number | string) => {
    const p = products.find(x => x.product_id === Number(pid));
    if (!p) return;
    setLine(i, { product_id: Number(pid), description: p.product_name, unit_price: Number(p.base_price ?? 0) });
  };

  const setD = <K extends keyof DocForm>(k: K, v: DocForm[K]) => setDoc(d => ({ ...d, [k]: v }));
  const setLine = (i: number, patch: Partial<Line>) =>
    setLines(ls => ls.map((l, idx) => idx === i ? { ...l, ...patch } : l));
  const addLine = () => setLines(ls => [...ls, blankLine()]);
  const rmLine = (i: number) => setLines(ls => ls.length > 1 ? ls.filter((_, idx) => idx !== i) : ls);

  useEffect(() => {
    if (!editing) return;
    setLoading(true);
    phase2Api.salesDocuments.get(Number(id))
      .then((full: ApiRow) => {
        const d: DocForm = {
          customer_name: String(full.customer_name ?? ""),
          customer_phone: String(full.customer_phone ?? ""),
          customer_email: String(full.customer_email ?? ""),
          customer_gstin: String(full.customer_gstin ?? ""),
          document_date: String(full.document_date ?? today()).slice(0, 10),
          valid_until: String(full.valid_until ?? today()).slice(0, 10),
          subject: String(full.subject ?? ""),
          notes: String(full.notes ?? ""),
        };
        setDoc(d);
        const ls: Line[] = Array.isArray(full.items) && (full.items as Line[]).length
          ? (full.items as ApiRow[]).map(it => ({
              product_id: it.product_id != null ? Number(it.product_id) : null,
              description: String(it.description ?? ""),
              hsn: String(it.hsn_code ?? it.hsn ?? ""),
              quantity: Number(it.quantity ?? 1),
              unit_price: Number(it.unit_price ?? 0),
              gst_rate: String(it.gst_rate ?? "18"),
            }))
          : [blankLine()];
        setLines(ls);
        setInitial(JSON.stringify({ doc: d, lines: ls }));
      })
      .catch(() => toast.error("Failed to load document"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, editing]);

  const dirty = useMemo(() => JSON.stringify({ doc, lines }) !== initial, [doc, lines, initial]);
  useUnsavedChanges(dirty && !saving, "sales-doc-form");

  const lineAmount = (l: Line) => l.quantity * l.unit_price;
  const lineTax = (l: Line) => lineAmount(l) * (Number(l.gst_rate) / 100);
  const subtotal = useMemo(() => lines.reduce((s, l) => s + lineAmount(l), 0), [lines]);
  const tax = useMemo(() => lines.reduce((s, l) => s + lineTax(l), 0), [lines]);

  const submit = async () => {
    if (!doc.customer_name.trim()) { toast.error("Customer name is required"); return; }
    const validLines = lines.filter(l => l.description.trim());
    if (!validLines.length) { toast.error("Add at least one line item"); return; }
    setSaving(true);
    try {
      const payload: ApiRow = {
        ...doc,
        document_type: docType,
        items: validLines.map(l => ({
          ...l,
          product_id: l.product_id ?? null,
          quantity: Number(l.quantity),
          unit_price: Number(l.unit_price),
          gst_rate: Number(l.gst_rate),
        })),
      };
      if (editing) {
        await phase2Api.salesDocuments.update(Number(id), payload);
        toast.success(`${docTitle} updated`);
      } else {
        await phase2Api.salesDocuments.create(payload);
        toast.success(`${docTitle} created`);
      }
      setInitial(JSON.stringify({ doc, lines }));
      navigate(backPath);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title={editing ? `Edit ${docTitle}` : `New ${docTitle}`}
      description={`Create a ${docTitle.toLowerCase()} for a customer.`}
      icon={<FileText className="h-6 w-6 text-primary" />}
      onBack={() => navigate(backPath)}
      footer={
        <>
          <Button variant="outline" onClick={() => navigate(backPath)} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || loading}>
            {saving ? "Saving…" : editing ? `Save ${docTitle}` : `Create ${docTitle}`}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-8">
          {/* Customer Details */}
          <section className="max-w-2xl space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Customer Details</h3>
            <Field label="Pick Customer">
              <RecordCombobox
                options={customers}
                value={customerId}
                onSelect={pickCustomer}
                getId={(c) => c.user_id}
                getLabel={(c) => c.name}
                getSecondary={(c) => [c.phone, c.email].filter(Boolean).join(" · ") || undefined}
                placeholder="Search a customer…"
                onAddNew={() => { setCustForm({ name: "", phone: "", email: "" }); setCustOpen(true); }}
                addNewLabel="Add new customer"
              />
            </Field>
            <Field label="Customer Name" req>
              <Input
                placeholder="Customer or company name"
                value={doc.customer_name}
                onChange={e => setD("customer_name", e.target.value)}
              />
            </Field>
            <Field label="Phone">
              <Input
                placeholder="Phone number"
                value={doc.customer_phone}
                onChange={e => setD("customer_phone", e.target.value)}
                className="max-w-[220px]"
              />
            </Field>
            <Field label="Email">
              <Input
                type="email"
                placeholder="email@example.com"
                value={doc.customer_email}
                onChange={e => setD("customer_email", e.target.value)}
              />
            </Field>
            <Field label="GSTIN">
              <Input
                placeholder="Customer GSTIN"
                value={doc.customer_gstin}
                onChange={e => setD("customer_gstin", e.target.value.toUpperCase())}
                className="max-w-[220px]"
              />
            </Field>
          </section>

          {/* Document Details */}
          <section className="max-w-2xl space-y-3 border-t pt-6">
            <h3 className="text-sm font-semibold text-foreground">Document Details</h3>
            <Field label="Date" req>
              <Input
                type="date"
                value={doc.document_date}
                onChange={e => setD("document_date", e.target.value)}
                className="max-w-[200px]"
              />
            </Field>
            <Field label="Valid Until">
              <Input
                type="date"
                value={doc.valid_until}
                onChange={e => setD("valid_until", e.target.value)}
                className="max-w-[200px]"
              />
            </Field>
            <Field label="Subject">
              <Input
                placeholder="Document subject"
                value={doc.subject}
                onChange={e => setD("subject", e.target.value)}
              />
            </Field>
          </section>

          {/* Line Items */}
          <section className="space-y-3 border-t pt-6">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-foreground">Line Items <Req /></h3>
              <Button variant="outline" size="sm" type="button" onClick={addLine}>
                <Plus className="h-4 w-4 mr-1" /> Add row
              </Button>
            </div>

            <ScrollableX className="rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="w-48 text-left px-3 py-2 font-medium text-muted-foreground">Finished Stock</th>
                    <th className="text-left px-3 py-2 font-medium text-muted-foreground">Description</th>
                    <th className="w-28 px-3 py-2 text-left font-medium text-muted-foreground">HSN</th>
                    <th className="w-24 px-3 py-2 text-left font-medium text-muted-foreground">Qty</th>
                    <th className="w-32 px-3 py-2 text-left font-medium text-muted-foreground">Rate (₹)</th>
                    <th className="w-24 px-3 py-2 text-left font-medium text-muted-foreground">GST %</th>
                    <th className="w-28 px-3 py-2 text-right font-medium text-muted-foreground">Amount</th>
                    <th className="w-10 px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {lines.map((l, i) => (
                    <tr key={i} className="hover:bg-muted/20">
                      <td className="px-3 py-2 align-top">
                        <RecordCombobox
                          options={products}
                          value={l.product_id}
                          onSelect={(v) => pickProduct(i, v)}
                          getId={(p) => p.product_id}
                          getLabel={(p) => p.product_name}
                          getSecondary={(p) => [p.category, `${p.stock_quantity} in stock`].filter(Boolean).join(" · ") || undefined}
                          placeholder="Pick stock…"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          placeholder="Item / service description"
                          value={l.description}
                          onChange={e => setLine(i, { description: e.target.value })}
                          className="h-8 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          placeholder="HSN"
                          value={l.hsn}
                          onChange={e => setLine(i, { hsn: e.target.value })}
                          className="h-8 w-24 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number" min={0}
                          value={l.quantity}
                          onChange={e => setLine(i, { quantity: Number(e.target.value) })}
                          className="h-8 w-20 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number" min={0} step={0.01}
                          value={l.unit_price}
                          onChange={e => setLine(i, { unit_price: Number(e.target.value) })}
                          className="h-8 w-28 text-sm"
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Select value={l.gst_rate} onValueChange={v => setLine(i, { gst_rate: v })}>
                          <SelectTrigger className="h-8 w-20 text-xs"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {GST_RATES.map(r => <SelectItem key={r} value={r}>{r}%</SelectItem>)}
                          </SelectContent>
                        </Select>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums font-medium">
                        {inr(lineAmount(l))}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          variant="ghost" size="icon" type="button"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => rmLine(i)}
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableX>

            <div className="flex justify-end">
              <div className="rounded-lg bg-muted/40 p-4 min-w-[220px] space-y-1.5 text-sm">
                <div className="flex justify-between text-muted-foreground">
                  <span>Subtotal</span>
                  <span className="tabular-nums">{inr(subtotal)}</span>
                </div>
                <div className="flex justify-between text-muted-foreground">
                  <span>GST</span>
                  <span className="tabular-nums">{inr(tax)}</span>
                </div>
                <div className="flex justify-between font-semibold border-t pt-2">
                  <span>Total</span>
                  <span className="tabular-nums">{inr(subtotal + tax)}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Notes */}
          <section className="max-w-2xl space-y-3 border-t pt-6">
            <h3 className="text-sm font-semibold text-foreground">Notes</h3>
            <Textarea
              rows={3}
              placeholder="Terms, conditions, or any additional notes…"
              value={doc.notes}
              onChange={e => setD("notes", e.target.value)}
            />
          </section>
        </div>
      )}

      <QuickCreateDialog
        open={custOpen}
        onOpenChange={setCustOpen}
        title="Add Customer"
        description="Create a customer without leaving this document."
        size="md"
        saving={custSaving}
        submitLabel="Add customer"
        onSubmit={submitCustomer}
      >
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name <Req /></Label>
            <Input value={custForm.name} onChange={e => setCustForm(f => ({ ...f, name: e.target.value }))} placeholder="Customer / company name" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Phone <Req /></Label>
              <Input value={custForm.phone} onChange={e => setCustForm(f => ({ ...f, phone: e.target.value }))} placeholder="10-digit" />
            </div>
            <div className="space-y-1.5">
              <Label>Email <Req /></Label>
              <Input type="email" value={custForm.email} onChange={e => setCustForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" />
            </div>
          </div>
        </div>
      </QuickCreateDialog>
    </FormPage>
  );
}
