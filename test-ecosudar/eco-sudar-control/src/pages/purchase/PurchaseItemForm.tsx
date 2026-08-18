import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Package } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { phase2Api } from "@/lib/api/phase2";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import { UOM_OPTIONS, GST_RATES } from "@/lib/uom";
import { isNumeric, firstError } from "@/lib/validate";

const empty = () => ({
  name: "", category: "", item_type: "stock", unit: "nos", hsn_code: "",
  rate: "", gst_rate: "18", specification: "",
});
type Form = ReturnType<typeof empty>;

export default function PurchaseItemForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = !!id;

  const [form, setForm] = useState<Form>(empty());
  const [initial, setInitial] = useState(JSON.stringify(empty()));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);

  const set = <K extends keyof Form>(k: K, v: string) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!editing) return;
    setLoading(true);
    phase2Api.purchaseItems.get(Number(id))
      .then((row) => {
        const f: Form = {
          name: String(row.name ?? ""),
          category: String(row.category ?? ""),
          item_type: ["raw_material", "pellet"].includes(String(row.item_type)) ? String(row.item_type) : "stock",
          unit: String(row.unit ?? "nos"),
          hsn_code: String(row.hsn_code ?? ""),
          rate: String(row.rate ?? ""),
          gst_rate: String(row.gst_rate ?? "18"),
          specification: String(row.specification ?? ""),
        };
        setForm(f);
        setInitial(JSON.stringify(f));
      })
      .catch(() => toast.error("Failed to load item"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, editing]);

  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial]);
  useUnsavedChanges(dirty && !saving, "purchase-item-form");

  const submit = async () => {
    const error = firstError([
      [form.name.trim() !== "", "Item name is required"],
      [form.rate === "" || isNumeric(form.rate), "Rate must be a number ≥ 0"],
      [isNumeric(form.gst_rate), "GST rate must be a number"],
    ]);
    if (error) { toast.error(error); return; }

    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        category: form.category.trim() || null,
        item_type: form.item_type || "stock",
        unit: form.unit || "nos",
        hsn_code: form.hsn_code.trim() || null,
        rate: Number(form.rate || 0),
        gst_rate: Number(form.gst_rate || 0),
        specification: form.specification.trim() || null,
      };
      if (editing) { await phase2Api.purchaseItems.update(Number(id), payload); toast.success("Item updated"); }
      else { await phase2Api.purchaseItems.create(payload); toast.success("Item created"); }
      setInitial(JSON.stringify(form));
      navigate("/purchase/items");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title={editing ? "Edit Item" : "New Item"}
      description="A purchasable item — its rate and GST auto-fill when picked on a purchase order."
      icon={<Package className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/purchase/items")}
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/purchase/items")} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || loading}>{saving ? "Saving…" : editing ? "Save Item" : "Create Item"}</Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <section className="max-w-3xl space-y-4 rounded-lg border bg-muted/30 p-4">
          <h3 className="text-sm font-semibold text-foreground">Item Details</h3>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <Label>Name <Req /></Label>
              <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. HDPE Woven Bag 25kg" />
            </div>
            <div className="space-y-1.5">
              <Label>Category</Label>
              <Input value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="e.g. Packaging" />
            </div>
            <div className="space-y-1.5">
              <Label>Type <Req /></Label>
              <Select value={form.item_type} onValueChange={(v) => set("item_type", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="stock">Spares &amp; Assets</SelectItem>
                  <SelectItem value="raw_material">Raw Material</SelectItem>
                  <SelectItem value="pellet">Pellet (finished)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Unit of Measurement</Label>
              <Select value={form.unit} onValueChange={(v) => set("unit", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {UOM_OPTIONS.map((u) => <SelectItem key={u} value={u}>{u}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Rate (₹)</Label>
              <Input type="number" min={0} step="0.01" value={form.rate} onChange={(e) => set("rate", e.target.value)} placeholder="0.00" />
            </div>
            <div className="space-y-1.5">
              <Label>GST %</Label>
              <Select value={form.gst_rate} onValueChange={(v) => set("gst_rate", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {GST_RATES.map((r) => <SelectItem key={r} value={r}>{r}%</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>HSN / SAC Code</Label>
              <Input value={form.hsn_code} onChange={(e) => set("hsn_code", e.target.value)} placeholder="Optional" />
            </div>
            <div className="space-y-1.5 md:col-span-2">
              <Label>Specification</Label>
              <Textarea rows={2} value={form.specification} onChange={(e) => set("specification", e.target.value)} placeholder="Size, grade, material, brand…" />
            </div>
          </div>
        </section>
      )}
    </FormPage>
  );
}
