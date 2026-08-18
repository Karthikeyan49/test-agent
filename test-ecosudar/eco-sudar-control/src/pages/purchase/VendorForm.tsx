import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Building2, ArrowDown } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";

const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Dr.", "M/s."];

const empty = () => ({
  salutation: "", first_name: "", last_name: "", company_name: "",
  name: "", email: "", phone: "", mobile: "",
  gstin: "", pan: "", msme_registered: false, opening_balance: "", payment_terms: "",
  billing_attention: "", billing_country: "", address: "", billing_street2: "",
  city: "", state: "", pincode: "", billing_phone: "", billing_fax: "",
  shipping_attention: "", shipping_country: "", shipping_street1: "", shipping_street2: "",
  shipping_city: "", shipping_state: "", shipping_pincode: "", shipping_phone: "", shipping_fax: "",
  bank_account_holder: "", bank_name: "", bank_account_number: "", bank_ifsc: "",
  notes: "",
});
type Form = ReturnType<typeof empty>;

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);

/** Compact labelled field. */
function Field({ label, children, req }: { label: React.ReactNode; children: React.ReactNode; req?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-sm text-muted-foreground">{label} {req && <Req />}</Label>
      <div>{children}</div>
    </div>
  );
}

export default function VendorForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = !!id;

  const [form, setForm] = useState<Form>(empty());
  const [initial, setInitial] = useState<string>(JSON.stringify(empty()));
  const [reAccount, setReAccount] = useState("");
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!editing) return;
    setLoading(true);
    phase2Api.vendors.get(Number(id))
      .then((v: ApiRow) => {
        const next: Form = { ...empty() };
        (Object.keys(next) as (keyof Form)[]).forEach((k) => {
          if (k === "msme_registered") next[k] = !!v[k] as Form[typeof k];
          else if (k === "opening_balance") next[k] = (v[k] != null ? String(v[k]) : "") as Form[typeof k];
          else next[k] = (v[k] ?? "") as Form[typeof k];
        });
        setForm(next);
        setInitial(JSON.stringify(next));
        setReAccount(String(v.bank_account_number ?? ""));
      })
      .catch((e) => toast.error(err(e, "Failed to load vendor")))
      .finally(() => setLoading(false));
  }, [id, editing]);

  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial]);
  useUnsavedChanges(dirty && !saving, "vendor-form");

  const copyBillingToShipping = () => setForm((f) => ({
    ...f,
    shipping_attention: f.billing_attention, shipping_country: f.billing_country,
    shipping_street1: f.address, shipping_street2: f.billing_street2,
    shipping_city: f.city, shipping_state: f.state, shipping_pincode: f.pincode,
    shipping_phone: f.billing_phone, shipping_fax: f.billing_fax,
  }));

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Display Name is required"); return; }
    if (form.bank_account_number && form.bank_account_number !== reAccount) {
      toast.error("Account number and re-entered account number do not match"); return;
    }
    setSaving(true);
    try {
      const payload: ApiRow = {
        ...form,
        // keep the legacy Contact column in sync for lists/search
        contact_name: [form.salutation, form.first_name, form.last_name].filter(Boolean).join(" ").trim(),
        opening_balance: form.opening_balance === "" ? 0 : Number(form.opening_balance),
      };
      if (editing) { await phase2Api.vendors.update(Number(id), payload); toast.success("Vendor updated"); }
      else { await phase2Api.vendors.create(payload); toast.success("Vendor created"); }
      setInitial(JSON.stringify(form)); // clear dirty before navigating
      navigate("/purchase/vendors");
    } catch (e) { toast.error(err(e, "Save failed")); }
    finally { setSaving(false); }
  };

  return (
    <FormPage
      title={editing ? "Edit Vendor" : "New Vendor"}
      description="Supplier of raw materials, goods or services."
      icon={<Building2 className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/purchase/vendors")}
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/purchase/vendors")} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || loading}>{saving ? "Saving…" : editing ? "Save Vendor" : "Create Vendor"}</Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading vendor…</p>
      ) : (
      <div className="space-y-6">
        {/* Primary contact + identity */}
        <section className="max-w-3xl space-y-3">
          <Field label="Primary Contact">
            <div className="grid grid-cols-[7rem_1fr_1fr] gap-2">
              <Select value={form.salutation} onValueChange={(v) => set("salutation", v)}>
                <SelectTrigger><SelectValue placeholder="Title" /></SelectTrigger>
                <SelectContent>{SALUTATIONS.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
              </Select>
              <Input placeholder="First Name" value={form.first_name} onChange={(e) => set("first_name", e.target.value)} />
              <Input placeholder="Last Name" value={form.last_name} onChange={(e) => set("last_name", e.target.value)} />
            </div>
          </Field>
          <Field label="Company Name"><Input value={form.company_name} onChange={(e) => set("company_name", e.target.value)} /></Field>
          <Field label="Display Name" req>
            <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="How this vendor appears everywhere" />
          </Field>
          <Field label="Email Address"><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Phone">
            <div className="grid grid-cols-2 gap-2">
              <Input placeholder="Work Phone" value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              <Input placeholder="Mobile" value={form.mobile} onChange={(e) => set("mobile", e.target.value)} />
            </div>
          </Field>
        </section>

        <Tabs defaultValue="other" className="w-full">
          <TabsList>
            <TabsTrigger value="other">Other Details</TabsTrigger>
            <TabsTrigger value="address">Address</TabsTrigger>
            <TabsTrigger value="bank">Bank Details</TabsTrigger>
            <TabsTrigger value="remarks">Remarks</TabsTrigger>
          </TabsList>

          {/* Other Details */}
          <TabsContent value="other" className="pt-4">
            <section className="max-w-3xl space-y-3">
              <Field label="GSTIN"><Input value={form.gstin} onChange={(e) => set("gstin", e.target.value.toUpperCase())} placeholder="29ABCDE1234F1Z5" /></Field>
              <Field label="PAN"><Input value={form.pan} onChange={(e) => set("pan", e.target.value.toUpperCase())} className="max-w-[220px]" /></Field>
              <Field label="MSME Registered?">
                <div className="flex items-center gap-2 pt-1">
                  <Switch checked={form.msme_registered} onCheckedChange={(v) => set("msme_registered", v)} />
                  <span className="text-sm text-muted-foreground">This vendor is MSME registered</span>
                </div>
              </Field>
              <Field label="Opening Balance">
                <div className="flex items-center gap-2">
                  <span className="rounded-md border bg-muted px-2 py-2 text-xs text-muted-foreground">INR</span>
                  <Input type="number" step="0.01" value={form.opening_balance} onChange={(e) => set("opening_balance", e.target.value)} className="max-w-[220px]" />
                </div>
              </Field>
              <Field label="Payment Terms">
                <Select value={form.payment_terms || undefined} onValueChange={(v) => set("payment_terms", v)}>
                  <SelectTrigger className="max-w-[260px]"><SelectValue placeholder="Select terms" /></SelectTrigger>
                  <SelectContent>
                    {["Due on Receipt", "Net 15", "Net 30", "Net 45", "Net 60"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            </section>
          </TabsContent>

          {/* Address */}
          <TabsContent value="address" className="pt-4">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
              <AddressBlock title="Billing Address" f={form} set={set} prefix="billing" />
              <div>
                <div className="flex items-center gap-3 mb-3">
                  <h3 className="text-sm font-semibold text-foreground">Shipping Address</h3>
                  <Button type="button" variant="link" size="sm" className="h-auto p-0 text-primary" onClick={copyBillingToShipping}>
                    <ArrowDown className="h-3.5 w-3.5" /> Copy billing address
                  </Button>
                </div>
                <AddressBlock f={form} set={set} prefix="shipping" bare />
              </div>
            </div>
          </TabsContent>

          {/* Bank Details */}
          <TabsContent value="bank" className="pt-4">
            <section className="max-w-2xl space-y-3">
              <Field label="Account Holder"><Input value={form.bank_account_holder} onChange={(e) => set("bank_account_holder", e.target.value)} /></Field>
              <Field label="Bank Name"><Input value={form.bank_name} onChange={(e) => set("bank_name", e.target.value)} /></Field>
              <Field label="Account Number"><Input value={form.bank_account_number} onChange={(e) => set("bank_account_number", e.target.value)} /></Field>
              <Field label="Re-enter Account No.">
                <Input value={reAccount} onChange={(e) => setReAccount(e.target.value)} />
                {form.bank_account_number && reAccount && form.bank_account_number !== reAccount && (
                  <p className="text-xs text-destructive mt-1">Account numbers do not match.</p>
                )}
              </Field>
              <Field label="IFSC"><Input value={form.bank_ifsc} onChange={(e) => set("bank_ifsc", e.target.value.toUpperCase())} className="max-w-[220px]" /></Field>
            </section>
          </TabsContent>

          {/* Remarks */}
          <TabsContent value="remarks" className="pt-4">
            <section className="max-w-3xl">
              <Field label="Remarks"><Textarea rows={4} value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Internal notes about this vendor" /></Field>
            </section>
          </TabsContent>
        </Tabs>
      </div>
      )}
    </FormPage>
  );
}

/** Billing/shipping address block. `prefix` selects which set of form keys to bind. */
function AddressBlock({
  title, f, set, prefix, bare,
}: {
  title?: string;
  f: Form;
  set: <K extends keyof Form>(k: K, v: Form[K]) => void;
  prefix: "billing" | "shipping";
  bare?: boolean;
}) {
  // Billing street1/city/state/pincode reuse the legacy columns.
  const k = {
    attention: `${prefix}_attention` as keyof Form,
    country: `${prefix}_country` as keyof Form,
    street1: (prefix === "billing" ? "address" : "shipping_street1") as keyof Form,
    street2: `${prefix}_street2` as keyof Form,
    city: (prefix === "billing" ? "city" : "shipping_city") as keyof Form,
    state: (prefix === "billing" ? "state" : "shipping_state") as keyof Form,
    pincode: (prefix === "billing" ? "pincode" : "shipping_pincode") as keyof Form,
    phone: `${prefix}_phone` as keyof Form,
    fax: `${prefix}_fax` as keyof Form,
  };
  const val = (key: keyof Form) => String(f[key] ?? "");
  return (
    <section className="space-y-3">
      {!bare && title && <h3 className="text-sm font-semibold text-foreground mb-3">{title}</h3>}
      <Field label="Attention"><Input value={val(k.attention)} onChange={(e) => set(k.attention, e.target.value as never)} /></Field>
      <Field label="Country/Region"><Input value={val(k.country)} onChange={(e) => set(k.country, e.target.value as never)} placeholder="India" /></Field>
      <Field label="Address">
        <div className="space-y-2">
          <Input placeholder="Street 1" value={val(k.street1)} onChange={(e) => set(k.street1, e.target.value as never)} />
          <Input placeholder="Street 2" value={val(k.street2)} onChange={(e) => set(k.street2, e.target.value as never)} />
        </div>
      </Field>
      <Field label="City"><Input value={val(k.city)} onChange={(e) => set(k.city, e.target.value as never)} /></Field>
      <Field label="State"><Input value={val(k.state)} onChange={(e) => set(k.state, e.target.value as never)} /></Field>
      <Field label="Pin Code"><Input value={val(k.pincode)} onChange={(e) => set(k.pincode, e.target.value as never)} className="max-w-[160px]" /></Field>
      <Field label="Phone"><Input value={val(k.phone)} onChange={(e) => set(k.phone, e.target.value as never)} /></Field>
      <Field label="Fax"><Input value={val(k.fax)} onChange={(e) => set(k.fax, e.target.value as never)} /></Field>
    </section>
  );
}
