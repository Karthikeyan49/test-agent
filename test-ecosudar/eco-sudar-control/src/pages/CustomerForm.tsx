import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { User } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { PhoneInput } from "@/components/PhoneInput";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { createCustomer } from "@/lib/api/customers";
import { DEFAULT_COUNTRY_CODE } from "@/lib/countryCodes";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";

const SALUTATIONS = ["Mr.", "Mrs.", "Ms.", "Dr.", "Prof."];

const empty = () => ({
  salutation: "",
  first_name: "",
  last_name: "",
  display_name: "",
  email: "",
  password: "",
  phone_code: DEFAULT_COUNTRY_CODE,
  phone: "",
  alt_phone_code: DEFAULT_COUNTRY_CODE,
  alt_phone: "",
  address: "",
  city: "",
  pincode: "",
  user_type: "customer",
});

export default function CustomerForm() {
  const navigate = useNavigate();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(empty());
  const [initialSnapshot] = useState(() => JSON.stringify(empty()));
  useUnsavedChanges(!saving && JSON.stringify(form) !== initialSnapshot, "customer-form");

  const set = (key: keyof ReturnType<typeof empty>, value: string) =>
    setForm(f => ({ ...f, [key]: value }));

  useEffect(() => {
    const parts = [form.salutation, form.first_name, form.last_name].filter(Boolean);
    setForm(f => ({ ...f, display_name: parts.join(" ") }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form.salutation, form.first_name, form.last_name]);

  const handleSubmit = async () => {
    if (!form.first_name.trim()) { toast.error("First name is required"); return; }
    if (!form.email.trim()) { toast.error("Email is required"); return; }
    if (!form.password.trim()) { toast.error("Password is required"); return; }
    if (form.password.length < 6) { toast.error("Password must be at least 6 characters"); return; }
    if (!form.phone.trim()) { toast.error("Mobile number is required"); return; }
    setSaving(true);
    try {
      await createCustomer({
        name: form.display_name || `${form.first_name} ${form.last_name}`.trim(),
        email: form.email.trim(),
        password: form.password,
        phone: `${form.phone_code}${form.phone}`,
        user_type: form.user_type as "customer" | "dealer",
        city: form.city.trim() || undefined,
        address: form.address.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
        send_welcome_email: true,
      });
      toast.success("Customer created. Welcome email sent.");
      navigate("/customers");
    } catch (err) {
      toast.error("Failed to create customer: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title="New Customer"
      description="Create a customer account and send login credentials by email"
      icon={<User className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/customers")}
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/customers")} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Creating…" : "Create Customer"}
          </Button>
        </>
      }
    >
      {/* Personal Information */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Personal Information</h3>
        <div className="max-w-2xl space-y-3">

          {/* Name row */}
          <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
            <span className="pt-2 text-sm text-muted-foreground">Name <Req /></span>
            <div className="space-y-1">
              <div className="grid grid-cols-[7rem_minmax(0,1fr)_minmax(0,1fr)] gap-2">
                <Select value={form.salutation} onValueChange={v => set("salutation", v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Title" />
                  </SelectTrigger>
                  <SelectContent>
                    {SALUTATIONS.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                <Input
                  placeholder="First name"
                  value={form.first_name}
                  onChange={e => set("first_name", e.target.value)}
                />
                <Input
                  placeholder="Last name"
                  value={form.last_name}
                  onChange={e => set("last_name", e.target.value)}
                />
              </div>
              {form.display_name && (
                <p className="text-xs text-muted-foreground">
                  Display name:{" "}
                  <span className="font-medium text-foreground">{form.display_name}</span>
                </p>
              )}
            </div>
          </div>

          {/* Account type */}
          <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
            <span className="pt-2 text-sm text-muted-foreground">Account Type</span>
            <Select value={form.user_type} onValueChange={v => set("user_type", v)}>
              <SelectTrigger className="max-w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">Customer</SelectItem>
                <SelectItem value="dealer">Dealer</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </section>

      {/* Contact Details */}
      <section className="space-y-3 border-t pt-5 mt-5">
        <h3 className="text-sm font-semibold text-foreground">Contact Details</h3>
        <div className="max-w-2xl space-y-3">

          <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
            <span className="pt-2 text-sm text-muted-foreground">Email <Req /></span>
            <Input
              type="email"
              placeholder="customer@example.com"
              value={form.email}
              onChange={e => set("email", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
            <span className="pt-2 text-sm text-muted-foreground">Password <Req /></span>
            <div className="space-y-1">
              <Input
                type="password"
                placeholder="Min. 6 characters"
                value={form.password}
                onChange={e => set("password", e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                Will be sent to the customer via welcome email
              </p>
            </div>
          </div>

          <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
            <span className="pt-2 text-sm text-muted-foreground">Mobile <Req /></span>
            <PhoneInput
              code={form.phone_code}
              number={form.phone}
              onCodeChange={v => set("phone_code", v)}
              onNumberChange={v => set("phone", v)}
              placeholder="Mobile number"
            />
          </div>

          <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
            <span className="pt-2 text-sm text-muted-foreground">Alt. Phone</span>
            <PhoneInput
              code={form.alt_phone_code}
              number={form.alt_phone}
              onCodeChange={v => set("alt_phone_code", v)}
              onNumberChange={v => set("alt_phone", v)}
              placeholder="Alternate number (optional)"
            />
          </div>
        </div>
      </section>

      {/* Address */}
      <section className="space-y-3 border-t pt-5 mt-5">
        <h3 className="text-sm font-semibold text-foreground">Address</h3>
        <div className="max-w-2xl space-y-3">

          <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
            <span className="pt-2 text-sm text-muted-foreground">Address</span>
            <Textarea
              placeholder="Street address, landmark…"
              value={form.address}
              onChange={e => set("address", e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>

          <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
            <span className="pt-2 text-sm text-muted-foreground">City</span>
            <Input
              placeholder="City"
              value={form.city}
              onChange={e => set("city", e.target.value)}
              className="max-w-[240px]"
            />
          </div>

          <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
            <span className="pt-2 text-sm text-muted-foreground">Pincode</span>
            <Input
              placeholder="6-digit pincode"
              value={form.pincode}
              onChange={e => set("pincode", e.target.value)}
              className="max-w-[140px]"
            />
          </div>
        </div>
      </section>
    </FormPage>
  );
}
