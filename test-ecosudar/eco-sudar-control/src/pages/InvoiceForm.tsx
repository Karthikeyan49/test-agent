import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FileText, Plus, Trash2, ChevronsUpDown, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";

import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { ScrollableX } from "@/components/ui/scrollable-x";

import { apiFetch } from "@/lib/api/client";
import { GST_RATES } from "@/lib/api/invoices";
import { fetchGstinDetails, gstinCompanyName } from "@/lib/api/gstinLookup";
import { TERMS_AND_CONDITIONS } from "@/lib/invoiceTemplatePdf";
import { cn } from "@/lib/utils";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";

// ─── Types ────────────────────────────────────────────────────────────────────

interface InvoiceLine {
  description: string;
  hsn_code: string;
  quantity: number;
  unit: string;
  unit_price: number;
  gst_rate: number;
}

interface IForm {
  customer_name: string;
  customer_gstin: string;
  customer_state: string;
  address_line: string;
  city: string;
  pincode: string;
  country: string;
  seller_state: string;
  due_date: string;
  invoice_number: string;
  invoice_date: string;
  payment_terms: string;
  place_of_supply: string;
  ship_different: boolean;   // ship to an address other than billing
  ship_name: string;         // shipping recipient / display name
  ship_address: string;      // shipping address (multi-line)
  subject: string;
  delivery_fee: string;
  discount: string;
  payment_method: string;
  payment_status: string;
  status: string;
  notes: string;
  terms_and_conditions: string;
  lines: InvoiceLine[];
}

interface CompanySuggestion {
  label: string;
  gstin: string;
  state: string;
  address: string;
}

interface ProductSuggestion {
  id: number;
  name: string;
  hsn_code: string;
  price: number;
  gst_rate: number;
  unit: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const GST_STATE_MAP: Record<string, string> = {
  "01":"Jammu & Kashmir","02":"Himachal Pradesh","03":"Punjab","04":"Chandigarh",
  "05":"Uttarakhand","06":"Haryana","07":"Delhi","08":"Rajasthan","09":"Uttar Pradesh",
  "10":"Bihar","11":"Sikkim","12":"Arunachal Pradesh","13":"Nagaland","14":"Manipur",
  "15":"Mizoram","16":"Tripura","17":"Meghalaya","18":"Assam","19":"West Bengal",
  "20":"Jharkhand","21":"Odisha","22":"Chhattisgarh","23":"Madhya Pradesh","24":"Gujarat",
  "25":"Daman & Diu","26":"Dadra & Nagar Haveli","27":"Maharashtra","28":"Andhra Pradesh",
  "29":"Karnataka","30":"Goa","31":"Lakshadweep","32":"Kerala","33":"Tamil Nadu",
  "34":"Puducherry","35":"Andaman & Nicobar","36":"Telangana","37":"Andhra Pradesh","38":"Ladakh",
};

const stateFromGstin = (gstin: string): string =>
  gstin.length >= 2 ? (GST_STATE_MAP[gstin.slice(0, 2)] ?? "") : "";

const defaultTerms = TERMS_AND_CONDITIONS.join("\n");
const defaultNote = "Thank you for choosing ECO Sudar and supporting green and sustainable energy.";
const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

const UNIT_OPTIONS = ["-", "Nos", "Kg", "Gram", "Ton", "Quintal", "Bags", "Litre", "ml", "Metre", "Feet", "Box", "Piece", "Set", "Pair", "Dozen", "Roll", "Sheet"];

function UnitSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const current = value || "Nos";
  const opts = UNIT_OPTIONS.includes(current) ? UNIT_OPTIONS : [current, ...UNIT_OPTIONS];
  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
      <SelectContent>
        {opts.map(u => <SelectItem key={u} value={u}>{u === "-" ? "None ( - )" : u}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}

const emptyLine = (): InvoiceLine => ({
  description: "", hsn_code: "", quantity: 1, unit: "Nos", unit_price: 0, gst_rate: 18,
});

const emptyForm = (): IForm => ({
  customer_name: "", customer_gstin: "", customer_state: "Tamil Nadu",
  address_line: "", city: "", pincode: "", country: "India",
  seller_state: "Tamil Nadu",
  due_date: "", invoice_number: "", invoice_date: "",
  payment_terms: "", place_of_supply: "",
  ship_different: false, ship_name: "", ship_address: "", subject: "",
  delivery_fee: "", discount: "",
  payment_method: "", payment_status: "unpaid", status: "Draft",
  notes: defaultNote,
  terms_and_conditions: (() => { try { return localStorage.getItem("eco_inv_terms") || defaultTerms; } catch { return defaultTerms; } })(),
  lines: [emptyLine()],
});

function toNum(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

// ─── Local Field component ────────────────────────────────────────────────────

function Field({ label, children, req }: { label: React.ReactNode; children: React.ReactNode; req?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-sm text-muted-foreground">{label} {req && <Req />}</Label>
      <div>{children}</div>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function InvoiceForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = !!id;

  const [form, setForm] = useState<IForm>(emptyForm());
  const [initial, setInitial] = useState(JSON.stringify(emptyForm()));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);

  const [companies, setCompanies] = useState<CompanySuggestion[]>([]);
  const [companyPopOpen, setCompanyPopOpen] = useState(false);
  const [gstFetching, setGstFetching] = useState(false);

  const [products, setProducts] = useState<ProductSuggestion[]>([]);
  const [linePopOpen, setLinePopOpen] = useState<number | null>(null);
  const [customDescs, setCustomDescs] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem("eco_inv_descs") || "[]"); } catch { return []; }
  });
  const [hsnMap] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem("eco_inv_hsns") || "{}"); } catch { return {}; }
  });

  const set = <K extends keyof IForm>(k: K, v: IForm[K]) => setForm(f => ({ ...f, [k]: v }));

  const setLine = (idx: number, patch: Partial<InvoiceLine>) =>
    setForm(f => ({ ...f, lines: f.lines.map((l, i) => i === idx ? { ...l, ...patch } : l) }));

  // Load companies for combobox
  useEffect(() => {
    apiFetch<{ data: Array<{ customer_name: string | null; customer_gstin: string | null; customer_state: string | null; customer_address: string | null }> }>("/admin/invoices?limit=500")
      .then(res => {
        const seen = new Set<string>();
        const list: CompanySuggestion[] = [];
        for (const inv of res.data ?? []) {
          const label = inv.customer_name?.trim();
          if (!label || seen.has(label.toLowerCase())) continue;
          seen.add(label.toLowerCase());
          list.push({ label, gstin: inv.customer_gstin ?? "", state: inv.customer_state ?? "Tamil Nadu", address: inv.customer_address ?? "" });
        }
        setCompanies(list.sort((a, b) => a.label.localeCompare(b.label)));
      })
      .catch(() => {});
  }, []);

  // Load product catalog
  useEffect(() => {
    apiFetch<{ data: Array<{ id: number; name: string; hsn_code: string | null; unit_price: number; gst_rate: number; unit: string | null }> }>("/admin/invoice-products")
      .then(res => setProducts((res.data ?? []).map(p => ({ id: p.id, name: p.name, hsn_code: p.hsn_code ?? "", price: p.unit_price, gst_rate: p.gst_rate, unit: p.unit ?? "" }))))
      .catch(() => {});
  }, []);

  // Load invoice for edit
  useEffect(() => {
    if (!editing || !id) return;
    setLoading(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    apiFetch<{ success: boolean; data: any }>(`/admin/invoices/${id}`)
      .then(res => {
        const row = res.data;
        const items: InvoiceLine[] = (row.items ?? []).map((i: { description?: string; hsn_code?: string; quantity?: number; unit?: string; unit_price?: number; gst_rate?: number }) => ({
          description: i.description ?? "",
          hsn_code:    i.hsn_code ?? "",
          quantity:    Number(i.quantity) || 1,
          unit:        i.unit || "Nos",
          unit_price:  toNum(i.unit_price),
          gst_rate:    toNum(i.gst_rate ?? row.gst_rate ?? 18),
        }));
        const termsVal = (() => { try { return localStorage.getItem("eco_inv_terms") || defaultTerms; } catch { return defaultTerms; } })();
        // ship_to is stored as a single text column: first line = recipient/display
        // name, the rest = address. Split it back into the structured fields.
        const rawShip = (row.ship_to ?? "").trim();
        const shipLines = rawShip.split("\n");
        const next: IForm = {
          customer_name:    row.customer_name ?? "",
          customer_gstin:   row.customer_gstin ?? row.order_customer_gstin ?? "",
          customer_state:   row.customer_state || row.order_customer_state || "Tamil Nadu",
          address_line:     row.customer_address ?? "",
          city:             row.customer_city    ?? "",
          pincode:          row.customer_pincode ?? "",
          country:          row.customer_country ?? "India",
          seller_state:     row.seller_state || "Tamil Nadu",
          due_date:         (row.due_date || "").slice(0, 10),
          invoice_number:   row.invoice_number ?? "",
          invoice_date:     (row.invoice_date || "").slice(0, 10),
          payment_terms:    row.payment_terms ?? "",
          place_of_supply:  row.place_of_supply ?? "",
          ship_different:   !!rawShip,
          ship_name:        rawShip ? (shipLines[0] ?? "") : "",
          ship_address:     rawShip ? shipLines.slice(1).join("\n") : "",
          subject:          row.subject ?? "",
          delivery_fee:     String(toNum(row.delivery_fee) || 0),
          discount:         String(toNum(row.discount) || 0),
          payment_method:   row.payment_method ?? "",
          payment_status:   ["paid","pending","refunded"].includes(String(row.payment_status)) ? String(row.payment_status) : "unpaid",
          status:           ["Draft","Sent","Cancelled"].find(o => o.toLowerCase() === (row.status || "").trim().toLowerCase()) || "Draft",
          notes:            row.notes || defaultNote,
          terms_and_conditions: termsVal,
          lines:            items.length ? items : [emptyLine()],
        };
        setForm(next);
        setInitial(JSON.stringify(next));
      })
      .catch(e => toast.error(e instanceof Error ? e.message : "Failed to load invoice"))
      .finally(() => setLoading(false));
  }, [id, editing]);

  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial]);
  useUnsavedChanges(dirty && !saving, "invoice-form");

  const fetchGstDetails = async () => {
    const gstin = form.customer_gstin.trim().toUpperCase();
    if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
      toast.error("Enter a valid 15-character GSTIN first");
      return;
    }
    setGstFetching(true);
    try {
      const d = await fetchGstinDetails(gstin, form.seller_state);
      const name = gstinCompanyName(d);
      const addr = (d.address_line || d.address || "").trim();
      setForm(f => ({
        ...f,
        customer_gstin:  gstin,
        customer_state:  d.state || f.customer_state,
        ...(addr     ? { address_line: addr }  : {}),
        ...(d.city   ? { city: d.city }         : {}),
        ...(d.pincode ? { pincode: d.pincode }  : {}),
        ...(name     ? { customer_name: name }  : {}),
      }));
      const filled = [name && `name: ${name}`, addr && "address", d.city && `city: ${d.city}`, d.pincode && `pincode: ${d.pincode}`].filter(Boolean);
      if (filled.length) toast.success(`Filled — ${filled.join(", ")}`);
      else if (d.lookup_status === "fallback") toast.info(d.lookup_error || "GST portal unavailable. State filled.");
      else toast.info("GSTIN valid. Business details unavailable — fill manually.");
    } catch (e) {
      const state = stateFromGstin(gstin);
      if (state) { setForm(f => ({ ...f, customer_gstin: gstin, customer_state: state })); toast.info(`State filled: ${state}`); }
      else toast.error(e instanceof Error ? e.message : "GST lookup failed");
    } finally {
      setGstFetching(false);
    }
  };

  const handleSubmit = async () => {
    if (!form.customer_name.trim()) { toast.error("Customer name is required"); return; }
    if (!form.customer_state.trim()) { toast.error("Customer state is required"); return; }
    if (form.lines.some(l => !l.description.trim())) { toast.error("All line items need a description"); return; }
    if (form.lines.some(l => l.quantity <= 0)) { toast.error("Quantity must be greater than 0"); return; }

    // Compose the structured shipping fields into the single ship_to text column
    // (line 1 = recipient/display name, remaining lines = address). Empty when
    // shipping to the billing address.
    const shipToText = form.ship_different
      ? [form.ship_name.trim(), form.ship_address.trim()].filter(Boolean).join("\n")
      : "";

    setSaving(true);
    try {
      const basePayload = {
        customer_name:    form.customer_name.trim(),
        customer_gstin:   form.customer_gstin.trim() || null,
        customer_state:   form.customer_state.trim(),
        customer_address: form.address_line.trim() || null,
        customer_city:    form.city.trim()         || null,
        customer_pincode: form.pincode.trim()      || null,
        customer_country: form.country.trim()      || null,
        seller_state:     form.seller_state.trim(),
        due_date:         form.due_date || null,
        delivery_fee:     parseFloat(form.delivery_fee) || 0,
        discount:         parseFloat(form.discount) || 0,
        payment_method:   form.payment_method || null,
        payment_status:   form.payment_status || "unpaid",
        status:           form.status,
        notes:            form.notes.trim() || null,
        items: form.lines.filter(l => l.description.trim()).map(l => ({
          description: l.description.trim(),
          hsn_code:    l.hsn_code.trim() || null,
          quantity:    l.quantity,
          unit:        l.unit.trim() || "Nos",
          unit_price:  l.unit_price,
          gst_rate:    l.gst_rate,
        })),
      };

      if (editing && id) {
        await apiFetch(`/admin/invoices/${id}`, {
          method: "PUT",
          body: JSON.stringify({
            ...basePayload,
            invoice_number:  form.invoice_number.trim() || null,
            invoice_date:    form.invoice_date || "",
            payment_terms:   form.payment_terms.trim(),
            place_of_supply: form.place_of_supply.trim(),
            ship_to:         shipToText,
            subject:         form.subject.trim(),
          }),
        });
      } else {
        // /admin/invoices/gst assigns the number/date and ignores the header-only
        // fields (ship_to, subject, place_of_supply, payment_terms); persist those
        // with a follow-up PUT so a single-panel create saves everything.
        const created = await apiFetch<{ data?: { invoice_id?: number } }>(
          "/admin/invoices/gst",
          { method: "POST", body: JSON.stringify(basePayload) }
        );
        const newId = created?.data?.invoice_id;
        const extra: Record<string, string> = {};
        if (shipToText)                  extra.ship_to         = shipToText;
        if (form.subject.trim())         extra.subject         = form.subject.trim();
        if (form.place_of_supply.trim()) extra.place_of_supply = form.place_of_supply.trim();
        if (form.payment_terms.trim())   extra.payment_terms   = form.payment_terms.trim();
        if (newId && Object.keys(extra).length) {
          await apiFetch(`/admin/invoices/${newId}`, { method: "PUT", body: JSON.stringify(extra) }).catch(() => {});
        }
        // Save product catalog entries
        const knownNames = new Set(products.map(p => p.name.toLowerCase()));
        for (const l of form.lines) {
          const name = l.description.trim();
          if (!name) continue;
          apiFetch("/admin/invoice-products", {
            method: "POST",
            body: JSON.stringify({ name, hsn_code: l.hsn_code.trim() || null, unit_price: l.unit_price, gst_rate: l.gst_rate }),
          }).catch(() => {});
          if (!knownNames.has(name.toLowerCase())) knownNames.add(name.toLowerCase());
        }
        // Persist manual descriptions to localStorage
        const newDescs = form.lines.map(l => l.description.trim()).filter(d => d && !products.some(p => p.name === d));
        if (newDescs.length) {
          const merged = [...new Set([...newDescs, ...customDescs])].slice(0, 60);
          setCustomDescs(merged);
          try { localStorage.setItem("eco_inv_descs", JSON.stringify(merged)); } catch { /* ok */ }
        }
      }
      toast.success(editing ? "Invoice updated" : "Invoice created");
      setInitial(JSON.stringify(form));
      navigate("/invoices");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  // Live totals
  const totals = useMemo(() => {
    const subtotal   = form.lines.reduce((s, l) => s + l.quantity * l.unit_price, 0);
    const rawGst     = form.lines.reduce((s, l) => s + l.quantity * l.unit_price * l.gst_rate / 100, 0);
    const delivery   = parseFloat(form.delivery_fee) || 0;
    const discount   = parseFloat(form.discount) || 0;
    const taxable    = Math.max(0, subtotal - discount);
    const gstTotal   = subtotal > 0 ? rawGst * (taxable / subtotal) : 0;
    const rawTotal   = taxable + gstTotal + delivery;
    const total      = Math.round(rawTotal);
    const roundOff   = total - rawTotal;
    const interState = form.customer_state.trim().toLowerCase() !== form.seller_state.trim().toLowerCase();
    return { subtotal, gstTotal, delivery, discount, total, roundOff, interState };
  }, [form.lines, form.delivery_fee, form.discount, form.customer_state, form.seller_state]);

  return (
    <FormPage
      title={editing ? "Edit Invoice" : "New Invoice"}
      description="Manual GST invoice not linked to any order."
      icon={<FileText className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/invoices")}
      backLabel="Invoices"
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/invoices")} disabled={saving}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={saving || loading}>
            {saving ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Saving…</> : editing ? "Save Changes" : "Create Invoice"}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading invoice…</p>
      ) : (
        <div className="space-y-8">

            {/* Customer section */}
            <section className="max-w-3xl space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Customer</h3>

              <Field label="Display Name" req>
                <Popover open={companyPopOpen} onOpenChange={setCompanyPopOpen}>
                  <PopoverTrigger asChild>
                    <button
                      type="button"
                      role="combobox"
                      aria-expanded={companyPopOpen}
                      className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-muted px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring"
                    >
                      <span className={cn("truncate", !form.customer_name && "text-muted-foreground")}>
                        {form.customer_name || "Search or type a new name…"}
                      </span>
                      <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="w-[340px] p-0" align="start">
                    <Command>
                      <CommandInput
                        placeholder="Search company or type new…"
                        value={form.customer_name}
                        onValueChange={v => set("customer_name", v)}
                      />
                      <CommandList>
                        <CommandEmpty>
                          <div className="px-4 py-3 text-sm text-muted-foreground">
                            No match — <span className="font-medium text-foreground">"{form.customer_name}"</span> will be used.
                          </div>
                        </CommandEmpty>
                        <CommandGroup heading="Existing customers">
                          {companies.map(c => (
                            <CommandItem
                              key={c.label}
                              value={c.label}
                              onSelect={() => {
                                setForm(f => ({ ...f, customer_name: c.label, customer_gstin: c.gstin || f.customer_gstin, customer_state: c.state || f.customer_state, address_line: c.address || f.address_line }));
                                setCompanyPopOpen(false);
                              }}
                            >
                              <Check className={cn("h-4 w-4 shrink-0 mr-2", form.customer_name === c.label ? "opacity-100" : "opacity-0")} />
                              <div className="min-w-0">
                                <p className="truncate font-medium">{c.label}</p>
                                {c.gstin && <p className="text-xs text-muted-foreground font-mono truncate">{c.gstin}</p>}
                              </div>
                            </CommandItem>
                          ))}
                        </CommandGroup>
                      </CommandList>
                    </Command>
                  </PopoverContent>
                </Popover>
              </Field>

              <Field label="GSTIN">
                <div className="flex gap-2">
                  <Input
                    value={form.customer_gstin}
                    onChange={e => {
                      const v = e.target.value.toUpperCase();
                      const state = stateFromGstin(v);
                      setForm(f => ({ ...f, customer_gstin: v, ...(state ? { customer_state: state } : {}) }));
                    }}
                    placeholder="e.g. 33AABCI1234A1Z5"
                    className="font-mono flex-1"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={fetchGstDetails} disabled={gstFetching} className="shrink-0">
                    {gstFetching ? <Loader2 className="h-4 w-4 animate-spin" /> : "Fetch"}
                  </Button>
                </div>
              </Field>

              <Field label="Customer State" req>
                <Input value={form.customer_state} onChange={e => set("customer_state", e.target.value)} placeholder="e.g. Tamil Nadu" />
              </Field>
              <Field label="Seller State">
                <Input value={form.seller_state} onChange={e => set("seller_state", e.target.value)} placeholder="e.g. Tamil Nadu" />
              </Field>
            </section>

            {/* Billing Address section */}
            <section className="max-w-3xl space-y-3 border-t pt-5">
              <h3 className="text-sm font-semibold text-foreground">Billing Address</h3>
              <Field label="Address">
                <Input value={form.address_line} onChange={e => set("address_line", e.target.value)} placeholder="Street / Area / Building" />
              </Field>
              <Field label="City / Pincode">
                <div className="grid grid-cols-3 gap-2">
                  <Input value={form.city} onChange={e => set("city", e.target.value)} placeholder="City" />
                  <Input value={form.pincode} onChange={e => set("pincode", e.target.value)} placeholder="Pincode" maxLength={10} />
                  <Input value={form.country} onChange={e => set("country", e.target.value)} placeholder="Country" />
                </div>
              </Field>
            </section>

            {/* Shipping Address section */}
            <section className="max-w-3xl space-y-3 border-t pt-5">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-foreground">Shipping Address</h3>
                <label className="flex items-center gap-2 text-sm text-muted-foreground cursor-pointer">
                  Ship to a different address
                  <Switch checked={form.ship_different} onCheckedChange={v => set("ship_different", v)} />
                </label>
              </div>
              {form.ship_different ? (
                <>
                  <Field label="Display Name">
                    <Input value={form.ship_name} onChange={e => set("ship_name", e.target.value)} placeholder="Recipient / consignee name" />
                  </Field>
                  <Field label="Address">
                    <Textarea rows={3} value={form.ship_address} onChange={e => set("ship_address", e.target.value)} placeholder="Shipping address, city, state, pincode…" />
                  </Field>
                  <p className="text-xs text-muted-foreground">Printed in the “Ship To” box on the invoice PDF.</p>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">Same as the billing address above.</p>
              )}
            </section>

            {/* Invoice metadata section */}
            <section className="max-w-3xl space-y-3 border-t pt-5">
              <h3 className="text-sm font-semibold text-foreground">Invoice Details</h3>

              {editing && (
                <Field label="Invoice No.">
                  <Input value={form.invoice_number} onChange={e => set("invoice_number", e.target.value)} placeholder="INV-2026-0001" />
                </Field>
              )}
              {editing && (
                <Field label="Invoice Date">
                  <Input type="date" value={form.invoice_date} onChange={e => set("invoice_date", e.target.value)} className="max-w-[200px]" />
                </Field>
              )}
              <Field label="Due Date">
                <Input type="date" value={form.due_date} onChange={e => set("due_date", e.target.value)} className="max-w-[200px]" />
              </Field>
              <Field label="Status">
                <Select value={form.status} onValueChange={v => set("status", v)}>
                  <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Draft">Draft</SelectItem>
                    <SelectItem value="Sent">Sent</SelectItem>
                    <SelectItem value="Cancelled">Cancelled</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Payment Method">
                <Select value={form.payment_method || "__none"} onValueChange={v => set("payment_method", v === "__none" ? "" : v)}>
                  <SelectTrigger className="max-w-[200px]"><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none">—</SelectItem>
                    {["cod","upi","online","net_banking","cheque","cash"].map(m => (
                      <SelectItem key={m} value={m}>{m.replace(/_/g, " ")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Payment Status">
                <Select value={form.payment_status} onValueChange={v => set("payment_status", v)}>
                  <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="unpaid">Unpaid</SelectItem>
                    <SelectItem value="paid">Paid</SelectItem>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="refunded">Refunded</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Payment Terms">
                <Input value={form.payment_terms} onChange={e => set("payment_terms", e.target.value)} placeholder="Due on Receipt" className="max-w-[260px]" />
              </Field>
              <Field label="Place of Supply">
                <Input value={form.place_of_supply} onChange={e => set("place_of_supply", e.target.value)} placeholder="33-Tamil Nadu" />
              </Field>
              <Field label="Subject">
                <Input value={form.subject} onChange={e => set("subject", e.target.value)} placeholder="Auto from products if left blank" />
              </Field>
              <Field label="Notes">
                <Input value={form.notes} onChange={e => set("notes", e.target.value)} />
              </Field>
              <Field label="Terms & Conditions">
                <Textarea
                  rows={5}
                  className="font-mono text-xs"
                  value={form.terms_and_conditions}
                  onChange={e => {
                    const v = e.target.value;
                    set("terms_and_conditions", v);
                    try { localStorage.setItem("eco_inv_terms", v); } catch { /* ok */ }
                  }}
                />
                <p className="text-xs text-muted-foreground mt-1">Each line = one term. Saved as default for future invoices.</p>
              </Field>
            </section>

            {/* ── Line Items ─────────────────────────────────────────────────── */}
            <section className="space-y-3 border-t pt-5">
            <div className="flex items-center justify-between">
              <p className="text-xs font-semibold text-muted-foreground uppercase">
                Line Items <span className="text-destructive">*</span>
              </p>
              <Button size="sm" variant="outline" onClick={() => setForm(f => ({ ...f, lines: [...f.lines, emptyLine()] }))}>
                <Plus className="h-4 w-4" /> Add line
              </Button>
            </div>

            <ScrollableX className="border rounded-lg">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="text-left px-2 py-2 min-w-52">Product / Description</th>
                    <th className="text-left px-2 py-2 w-28">HSN/SAC</th>
                    <th className="text-right px-2 py-2 w-24">Qty</th>
                    <th className="text-left px-2 py-2 w-24">Unit</th>
                    <th className="text-right px-2 py-2 w-32">Rate (₹)</th>
                    <th className="text-right px-2 py-2 w-28">GST</th>
                    <th className="text-right px-2 py-2 w-28">Line Total</th>
                    <th className="w-10"></th>
                  </tr>
                </thead>
                <tbody>
                  {form.lines.map((line, idx) => {
                    const lineTotal = line.quantity * line.unit_price;
                    return (
                      <tr key={idx} className="border-t">
                        <td className="px-2 py-1 min-w-[240px]">
                          <Popover open={linePopOpen === idx} onOpenChange={open => setLinePopOpen(open ? idx : null)}>
                            <PopoverTrigger asChild>
                              <Button variant="outline" role="combobox" className="w-full justify-between h-9 font-normal text-sm truncate">
                                <span className={cn("truncate", !line.description && "text-muted-foreground")}>
                                  {line.description || "Type or pick a product…"}
                                </span>
                                <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
                              </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-72 p-0" align="start">
                              <Command>
                                <CommandInput
                                  placeholder="Search or type description…"
                                  value={line.description}
                                  onValueChange={v => setLine(idx, { description: v })}
                                />
                                <CommandList>
                                  <CommandEmpty>
                                    <span className="text-xs text-muted-foreground">No match — will use typed text</span>
                                  </CommandEmpty>
                                  {products.length > 0 && (
                                    <CommandGroup heading="Products">
                                      {products.map(p => (
                                        <CommandItem
                                          key={`prod-${p.id}`}
                                          value={p.name}
                                          onSelect={() => {
                                            setLine(idx, { description: p.name, unit_price: p.price, hsn_code: p.hsn_code || hsnMap[p.name] || "", gst_rate: p.gst_rate, unit: p.unit || "Nos" });
                                            setLinePopOpen(null);
                                          }}
                                        >
                                          <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", line.description === p.name ? "opacity-100" : "opacity-0")} />
                                          <span className="flex-1">{p.name}</span>
                                          <span className="text-xs text-muted-foreground ml-2">₹{p.price.toLocaleString("en-IN")} · {p.gst_rate}% GST</span>
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  )}
                                  {customDescs.length > 0 && (
                                    <CommandGroup heading="Previously used">
                                      {customDescs.map(d => (
                                        <CommandItem
                                          key={`custom-${d}`}
                                          value={d}
                                          onSelect={() => {
                                            setLine(idx, { description: d, hsn_code: hsnMap[d] || "" });
                                            setLinePopOpen(null);
                                          }}
                                        >
                                          <Check className={cn("mr-2 h-3.5 w-3.5 shrink-0", line.description === d ? "opacity-100" : "opacity-0")} />
                                          {d}
                                        </CommandItem>
                                      ))}
                                    </CommandGroup>
                                  )}
                                </CommandList>
                              </Command>
                            </PopoverContent>
                          </Popover>
                        </td>
                        <td className="px-2 py-1 w-28">
                          <Input value={line.hsn_code} onChange={e => setLine(idx, { hsn_code: e.target.value })} placeholder="44013" className="w-full" />
                        </td>
                        <td className="px-2 py-1 w-24">
                          <Input type="number" min="0.01" step="0.01" value={String(line.quantity)} onChange={e => setLine(idx, { quantity: toNum(e.target.value) })} className="text-right w-full" />
                        </td>
                        <td className="px-2 py-1 w-24">
                          <UnitSelect value={line.unit} onChange={v => setLine(idx, { unit: v })} />
                        </td>
                        <td className="px-2 py-1 w-32">
                          <Input type="number" min="0" step="0.01" value={String(line.unit_price)} onChange={e => setLine(idx, { unit_price: toNum(e.target.value) })} className="text-right w-full" />
                        </td>
                        <td className="px-2 py-1 w-28">
                          <Select value={String(line.gst_rate)} onValueChange={v => setLine(idx, { gst_rate: toNum(v) })}>
                            <SelectTrigger><SelectValue /></SelectTrigger>
                            <SelectContent>{GST_RATES.map(r => <SelectItem key={r} value={String(r)}>{r}%</SelectItem>)}</SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-2 text-right font-medium text-card-foreground">{inr(lineTotal)}</td>
                        <td className="px-2 py-1 text-center">
                          <Button
                            size="icon"
                            variant="ghost"
                            disabled={form.lines.length === 1}
                            onClick={() => setForm(f => ({ ...f, lines: f.lines.filter((_, i) => i !== idx) }))}
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
            <p className="text-xs text-muted-foreground">CGST+SGST when customer state = seller state; IGST for inter-state.</p>
            </section>

            {/* ── Tax & Totals ───────────────────────────────────────────────── */}
            <div className="space-y-6 border-t pt-5">
            <section className="max-w-3xl space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Adjustments</h3>
              <Field label="Delivery Fee (₹)">
                <Input type="number" min="0" step="0.01" value={form.delivery_fee} onChange={e => set("delivery_fee", e.target.value)} placeholder="0" className="max-w-[200px]" />
              </Field>
              <Field label="Discount (₹)">
                <Input type="number" min="0" step="0.01" value={form.discount} onChange={e => set("discount", e.target.value)} placeholder="0" className="max-w-[200px]" />
              </Field>
            </section>

            <section className="max-w-sm rounded-xl border bg-muted/30 p-4 space-y-2">
              <h3 className="text-sm font-semibold text-foreground">Summary</h3>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Subtotal</span><span>{inr(totals.subtotal)}</span>
                </div>
                {totals.interState
                  ? <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span>{inr(totals.gstTotal)}</span></div>
                  : <>
                      <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span>{inr(totals.gstTotal / 2)}</span></div>
                      <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span>{inr(totals.gstTotal / 2)}</span></div>
                    </>
                }
                {totals.delivery > 0 && (
                  <div className="flex justify-between"><span className="text-muted-foreground">Delivery</span><span>{inr(totals.delivery)}</span></div>
                )}
                {totals.discount > 0 && (
                  <div className="flex justify-between text-destructive"><span>Discount</span><span>− {inr(totals.discount)}</span></div>
                )}
                {Math.abs(totals.roundOff) >= 0.005 && (
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Round Off</span>
                    <span>{totals.roundOff >= 0 ? "+" : "−"} ₹{Math.abs(totals.roundOff).toFixed(2)}</span>
                  </div>
                )}
                <div className="flex justify-between border-t pt-1 font-bold">
                  <span>Total</span><span className="text-primary">{inr(totals.total)}</span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {totals.interState ? "Inter-state — IGST applies." : "Intra-state — CGST + SGST applies."}
              </p>
            </section>
            </div>
        </div>
      )}
    </FormPage>
  );
}
