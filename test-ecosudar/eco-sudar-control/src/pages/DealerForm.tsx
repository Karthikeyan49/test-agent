import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Loader2, Users2 } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { PhoneInput } from "@/components/PhoneInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import { fetchDealers, createDealer, updateDealer } from "@/lib/api/dealers";
import { DEFAULT_COUNTRY_CODE } from "@/lib/countryCodes";

const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Dr.", "M/s."];

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

const empty = () => ({
  salutation: "",
  name: "",
  email: "",
  phone_code: DEFAULT_COUNTRY_CODE,
  phone: "",
  alt_phone_code: DEFAULT_COUNTRY_CODE,
  alt_phone: "",
  company_name: "",
  gst_number: "",
  udyam_number: "",
  address: "",
  city: "",
  state: "",
  pincode: "",
  password: "",
});
type Form = ReturnType<typeof empty>;

const err = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

function Field({ label, children, req }: { label: React.ReactNode; children: React.ReactNode; req?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-sm text-muted-foreground">{label} {req && <Req />}</Label>
      <div>{children}</div>
    </div>
  );
}

export default function DealerForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const editing = !!id;

  const [form, setForm] = useState<Form>(empty());
  const [initial, setInitial] = useState(JSON.stringify(empty()));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!editing || !id) return;
    setLoading(true);
    fetchDealers()
      .then(dealers => {
        const d = dealers.find(x => String(x.user_id) === id);
        if (!d) { toast.error("Dealer not found"); navigate("/dealers"); return; }
        const next: Form = {
          salutation: "",
          name: d.name ?? "",
          email: d.email?.endsWith("@noemail.ecosudar.local") ? "" : (d.email ?? ""),
          phone_code: DEFAULT_COUNTRY_CODE,
          phone: d.phone ?? "",
          alt_phone_code: DEFAULT_COUNTRY_CODE,
          alt_phone: d.alternate_phone ?? "",
          company_name: d.company_name ?? "",
          gst_number: d.gst_number ?? "",
          udyam_number: d.udyam_number ?? "",
          address: d.address ?? "",
          city: d.city ?? "",
          state: d.state ?? "",
          pincode: d.pincode ?? "",
          password: "",
        };
        setForm(next);
        setInitial(JSON.stringify(next));
      })
      .catch(e => toast.error(err(e)))
      .finally(() => setLoading(false));
  }, [id, editing, navigate]);

  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial]);
  useUnsavedChanges(dirty && !saving, "dealer-form");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim()) { toast.error("Contact name is required"); return; }
    if (!form.phone.trim()) { toast.error("Phone number is required"); return; }
    if (!editing && !form.password) { toast.error("Password is required"); return; }
    if (!editing && form.password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    setSaving(true);
    try {
      const payload = {
        name: [form.salutation, form.name].filter(Boolean).join(" "),
        email: form.email || undefined,
        phone: form.phone,
        alternate_phone: form.alt_phone || undefined,
        company_name: form.company_name || undefined,
        gst_number: form.gst_number || undefined,
        udyam_number: form.udyam_number || undefined,
        address: form.address || undefined,
        city: form.city || undefined,
        state: form.state || undefined,
        pincode: form.pincode || undefined,
      };
      if (editing) {
        await updateDealer(Number(id), { ...payload, new_password: form.password || undefined });
        toast.success("Dealer updated");
      } else {
        await createDealer({ ...payload, password: form.password });
        toast.success("Dealer created. Login credentials sent.");
      }
      navigate("/dealers");
    } catch (e) {
      toast.error(err(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title={editing ? "Edit Dealer" : "New Dealer"}
      description={editing
        ? "Update dealer information."
        : "Dealer will login with their phone number. Credentials will be emailed on creation."}
      icon={<Users2 className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/dealers")}
      backLabel="Dealers"
    >
      {loading ? (
        <div className="space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <form onSubmit={handleSubmit}>
          <Tabs defaultValue="contact">
            <TabsList className="mb-6">
              <TabsTrigger value="contact">Contact Info</TabsTrigger>
              <TabsTrigger value="business">Business Details</TabsTrigger>
              <TabsTrigger value="address">Address</TabsTrigger>
              <TabsTrigger value="account">Account</TabsTrigger>
            </TabsList>

            {/* ── Contact Info ────────────────────────────────── */}
            <TabsContent value="contact" className="space-y-4">
              <Field label="Salutation">
                <Select value={form.salutation} onValueChange={v => set("salutation", v)}>
                  <SelectTrigger className="w-32"><SelectValue placeholder="Select" /></SelectTrigger>
                  <SelectContent>
                    {SALUTATIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Full Name" req>
                <Input
                  value={form.name}
                  onChange={e => set("name", e.target.value)}
                  placeholder="Contact person's name"
                />
              </Field>

              <Field label="Email">
                <Input
                  type="email"
                  value={form.email}
                  onChange={e => set("email", e.target.value)}
                  placeholder="dealer@example.com"
                />
              </Field>

              <Field label="Phone (Login)" req>
                <PhoneInput
                  code={form.phone_code}
                  number={form.phone}
                  onCodeChange={v => set("phone_code", v)}
                  onNumberChange={v => set("phone", v)}
                  placeholder="Mobile number"
                />
              </Field>

              <Field label="Alternate Phone">
                <PhoneInput
                  code={form.alt_phone_code}
                  number={form.alt_phone}
                  onCodeChange={v => set("alt_phone_code", v)}
                  onNumberChange={v => set("alt_phone", v)}
                  placeholder="Alternate number (optional)"
                />
              </Field>
            </TabsContent>

            {/* ── Business Details ────────────────────────────── */}
            <TabsContent value="business" className="space-y-4">
              <Field label="Company Name">
                <Input
                  value={form.company_name}
                  onChange={e => set("company_name", e.target.value)}
                  placeholder="Business / firm name"
                />
              </Field>

              <Field label="GST Number">
                <Input
                  value={form.gst_number}
                  onChange={e => set("gst_number", e.target.value.toUpperCase())}
                  placeholder="29AAAAA0000A1Z5"
                  maxLength={15}
                  className="font-mono"
                />
              </Field>

              <Field label="UDYAM Number">
                <Input
                  value={form.udyam_number}
                  onChange={e => set("udyam_number", e.target.value.toUpperCase())}
                  placeholder="UDYAM-XX-00-0000000"
                />
              </Field>
            </TabsContent>

            {/* ── Address ─────────────────────────────────────── */}
            <TabsContent value="address" className="space-y-4">
              <Field label="Street Address">
                <Textarea
                  rows={2}
                  value={form.address}
                  onChange={e => set("address", e.target.value)}
                  placeholder="Street, building, landmark"
                  className="resize-none"
                />
              </Field>

              <Field label="City">
                <Input
                  value={form.city}
                  onChange={e => set("city", e.target.value)}
                  placeholder="City"
                  className="max-w-xs"
                />
              </Field>

              <Field label="State">
                <Select value={form.state} onValueChange={v => set("state", v)}>
                  <SelectTrigger className="w-56"><SelectValue placeholder="Select state" /></SelectTrigger>
                  <SelectContent>
                    {INDIAN_STATES.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>

              <Field label="Pincode">
                <Input
                  value={form.pincode}
                  onChange={e => set("pincode", e.target.value.replace(/\D/g, "").slice(0, 6))}
                  placeholder="600001"
                  maxLength={6}
                  className="max-w-[140px]"
                />
              </Field>
            </TabsContent>

            {/* ── Account ─────────────────────────────────────── */}
            <TabsContent value="account" className="space-y-4">
              <Field label={editing ? "New Password" : "Password"} req={!editing}>
                <div className="space-y-1">
                  <Input
                    type="password"
                    value={form.password}
                    onChange={e => set("password", e.target.value)}
                    placeholder={editing ? "Leave blank to keep current" : "Min 6 characters"}
                  />
                  {editing && (
                    <p className="text-xs text-muted-foreground">
                      Leave blank to keep current password. A notification email will be sent if changed.
                    </p>
                  )}
                </div>
              </Field>
            </TabsContent>
          </Tabs>

          <div className="flex justify-end gap-2 pt-6 border-t mt-6">
            <Button type="button" variant="outline" onClick={() => navigate("/dealers")} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving
                ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Saving…</>
                : editing ? "Save Dealer" : "Create Dealer"}
            </Button>
          </div>
        </form>
      )}
    </FormPage>
  );
}
