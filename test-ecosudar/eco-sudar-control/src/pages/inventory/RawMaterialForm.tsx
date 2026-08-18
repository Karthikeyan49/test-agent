import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Layers } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { inventoryApi, type RawMaterial } from "@/lib/api/inventory";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";

const emptyForm = () => ({ name: "", unit: "kg", reorder_level: 0, supplier: "", current_stock: 0 });
type Form = ReturnType<typeof emptyForm>;

function Field({ label, children, req }: { label: React.ReactNode; children: React.ReactNode; req?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-sm text-muted-foreground">{label} {req && <Req />}</Label>
      <div>{children}</div>
    </div>
  );
}

export default function RawMaterialForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = !!id;

  const [form, setForm] = useState<Form>(emptyForm());
  const [initial, setInitial] = useState(JSON.stringify(emptyForm()));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!editing) return;
    setLoading(true);
    inventoryApi.rawMaterials()
      .then(all => {
        const m = all.find(r => r.raw_material_id === Number(id));
        if (!m) { toast.error("Raw material not found"); navigate("/inventory/materials"); return; }
        const f: Form = {
          name: m.name,
          unit: m.unit,
          reorder_level: m.reorder_level,
          supplier: m.supplier ?? "",
          current_stock: m.current_stock,
        };
        setForm(f);
        setInitial(JSON.stringify(f));
      })
      .catch(() => toast.error("Failed to load raw material"))
      .finally(() => setLoading(false));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, editing]);

  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial]);
  useUnsavedChanges(dirty && !saving, "raw-material-form");

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    setSaving(true);
    try {
      if (editing) {
        await inventoryApi.updateRawMaterial(Number(id), form as Partial<RawMaterial>);
        toast.success("Raw material updated");
      } else {
        await inventoryApi.createRawMaterial(form as Partial<RawMaterial>);
        toast.success("Raw material added");
      }
      setInitial(JSON.stringify(form));
      navigate("/inventory/materials");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title={editing ? "Edit Raw Material" : "New Raw Material"}
      description="Biomass feedstock and inputs consumed in production."
      icon={<Layers className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/inventory/materials")}
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/inventory/materials")} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || loading}>
            {saving ? "Saving…" : editing ? "Save Changes" : "Add Material"}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="max-w-2xl space-y-3">
          <Field label="Name" req>
            <Input
              placeholder="e.g. Sawdust"
              value={form.name}
              onChange={e => set("name", e.target.value)}
            />
          </Field>
          <Field label="Unit">
            <Input
              placeholder="kg"
              value={form.unit}
              onChange={e => set("unit", e.target.value)}
              className="max-w-[140px]"
            />
          </Field>
          <Field label="Reorder Level">
            <Input
              type="number" min={0}
              value={form.reorder_level}
              onChange={e => set("reorder_level", Number(e.target.value))}
              className="max-w-[160px]"
            />
          </Field>
          {!editing && (
            <Field label="Opening Stock">
              <Input
                type="number" min={0}
                value={form.current_stock}
                onChange={e => set("current_stock", Number(e.target.value))}
                className="max-w-[160px]"
              />
            </Field>
          )}
          <Field label="Supplier">
            <Input
              placeholder="Supplier name"
              value={form.supplier}
              onChange={e => set("supplier", e.target.value)}
            />
          </Field>
        </div>
      )}
    </FormPage>
  );
}
