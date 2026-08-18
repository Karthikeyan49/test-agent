import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Factory, Plus, Trash2, Boxes, Leaf, ClipboardCheck, Wrench } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inventoryApi, qty, type StockItem, type RawMaterial, type SpareAsset, type ProductionInput } from "@/lib/api/inventory";

const today = () => new Date().toISOString().slice(0, 10);

function Field({ label, children, req }: { label: React.ReactNode; children: React.ReactNode; req?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-sm text-muted-foreground">{label} {req && <Req />}</Label>
      <div>{children}</div>
    </div>
  );
}

interface OutLine { product_id: number; quantity: string; unit: string }
interface ConsLine { raw_material_id: number; quantity: string }
interface SpareLine { spare_id: number; quantity: string }
interface QualityForm {
  moisture_pct: string; ash_pct: string; gcv: string; fines_pct: string;
  diameter_mm: string; durability_pct: string; result: "pending" | "pass" | "fail";
  inspector: string; notes: string;
}

const emptyOut = (): OutLine => ({ product_id: 0, quantity: "", unit: "kg" });
const emptyCons = (): ConsLine => ({ raw_material_id: 0, quantity: "" });
const emptySpare = (): SpareLine => ({ spare_id: 0, quantity: "" });
const emptyQuality = (): QualityForm => ({
  moisture_pct: "", ash_pct: "", gcv: "", fines_pct: "", diameter_mm: "", durability_pct: "",
  result: "pending", inspector: "", notes: "",
});

export default function ProductionForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = !!id;

  const [products, setProducts] = useState<StockItem[]>([]);
  const [materials, setMaterials] = useState<RawMaterial[]>([]);
  const [spares, setSpares] = useState<SpareAsset[]>([]);
  const [outputs, setOutputs] = useState<OutLine[]>([emptyOut()]);
  const [consumption, setConsumption] = useState<ConsLine[]>([]);
  const [spareCons, setSpareCons] = useState<SpareLine[]>([]);
  const [quality, setQuality] = useState<QualityForm>(emptyQuality());
  const [meta, setMeta] = useState({ run_date: today(), batch_number: "", shift: "general", operator_name: "", notes: "" });
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const setM = <K extends keyof typeof meta>(k: K, v: string) => setMeta((f) => ({ ...f, [k]: v }));
  const setQ = <K extends keyof QualityForm>(k: K, v: string) => setQuality((q) => ({ ...q, [k]: v }));

  useEffect(() => {
    (async () => {
      try {
        const [stock, raw, sp] = await Promise.all([inventoryApi.stock(), inventoryApi.rawMaterials(), inventoryApi.spares().catch(() => [])]);
        setProducts(stock); setMaterials(raw); setSpares(sp);
        if (editing && id) {
          const run = await inventoryApi.productionRun(Number(id));
          setMeta({ run_date: run.run_date, batch_number: run.batch_number ?? "", shift: run.shift, operator_name: run.operator_name ?? "", notes: run.notes ?? "" });
          setOutputs(run.outputs.length ? run.outputs.map((o) => ({ product_id: o.product_id, quantity: String(o.quantity), unit: o.unit ?? "kg" })) : [emptyOut()]);
          setConsumption(run.consumption.map((c) => ({ raw_material_id: c.raw_material_id, quantity: String(c.quantity) })));
          setSpareCons((run.spare_consumption ?? []).map((c) => ({ spare_id: c.spare_id, quantity: String(c.quantity) })));
          const q = run.quality;
          if (q) setQuality({
            moisture_pct: q.moisture_pct?.toString() ?? "", ash_pct: q.ash_pct?.toString() ?? "", gcv: q.gcv?.toString() ?? "",
            fines_pct: q.fines_pct?.toString() ?? "", diameter_mm: q.diameter_mm?.toString() ?? "", durability_pct: q.durability_pct?.toString() ?? "",
            result: q.result, inspector: q.inspector ?? "", notes: q.notes ?? "",
          });
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing, id]);

  const submit = async () => {
    const outs = outputs.filter((o) => o.product_id > 0 && Number(o.quantity) > 0);
    if (outs.length === 0) { toast.error("Add at least one output (product + quantity)"); return; }
    const cons = consumption.filter((l) => l.raw_material_id > 0 && Number(l.quantity) > 0);
    const spareUse = spareCons.filter((l) => l.spare_id > 0 && Number(l.quantity) > 0);

    const q = quality;
    const qualityHasData =
      [q.moisture_pct, q.ash_pct, q.gcv, q.fines_pct, q.diameter_mm, q.durability_pct, q.inspector, q.notes].some((v) => v.trim() !== "") ||
      q.result !== "pending";

    const body: ProductionInput = {
      run_date: meta.run_date,
      batch_number: meta.batch_number || undefined,
      shift: meta.shift as ProductionInput["shift"],
      operator_name: meta.operator_name || undefined,
      notes: meta.notes || undefined,
      outputs: outs.map((o) => ({ product_id: o.product_id, quantity: Number(o.quantity), unit: o.unit || "kg" })),
      consumption: cons.map((l) => ({ raw_material_id: l.raw_material_id, quantity: Number(l.quantity) })),
      spare_consumption: spareUse.map((l) => ({ spare_id: l.spare_id, quantity: Number(l.quantity) })),
      ...(qualityHasData
        ? {
            quality: {
              moisture_pct: q.moisture_pct ? Number(q.moisture_pct) : null,
              ash_pct: q.ash_pct ? Number(q.ash_pct) : null,
              gcv: q.gcv ? Number(q.gcv) : null,
              fines_pct: q.fines_pct ? Number(q.fines_pct) : null,
              diameter_mm: q.diameter_mm ? Number(q.diameter_mm) : null,
              durability_pct: q.durability_pct ? Number(q.durability_pct) : null,
              result: q.result,
              inspector: q.inspector || null,
              notes: q.notes || null,
            },
          }
        : {}),
    };

    setSaving(true);
    try {
      if (editing && id) {
        await inventoryApi.updateProduction(Number(id), body);
        toast.success("Production run updated — stock adjusted");
        navigate(`/inventory/production/${id}`);
      } else {
        await inventoryApi.createProduction(body);
        toast.success("Production run logged — finished stock updated");
        navigate("/inventory/production");
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save production run");
    } finally {
      setSaving(false);
    }
  };

  const productLabel = (id: number) => products.find((p) => p.product_id === id)?.product_name ?? "";

  return (
    <FormPage
      title={editing ? "Edit Production Run" : "Log Production Run"}
      description={editing ? "Editing re-adjusts stock: the old raw/finished amounts are reversed and the new ones applied." : "Consumes raw materials and adds finished output to stock — all in one atomic entry."}
      icon={<Factory className="h-6 w-6 text-primary" />}
      onBack={() => navigate(editing && id ? `/inventory/production/${id}` : "/inventory/production")}
      footer={
        <>
          <Button variant="outline" onClick={() => navigate(editing && id ? `/inventory/production/${id}` : "/inventory/production")} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || loading}>{saving ? "Saving…" : editing ? "Save changes" : "Log Production Run"}</Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="space-y-8">
          {/* Run details */}
          <section className="max-w-2xl space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Run Details</h3>
            <Field label="Date"><Input type="date" value={meta.run_date} onChange={(e) => setM("run_date", e.target.value)} className="max-w-[200px]" /></Field>
            <Field label="Batch #"><Input placeholder="Optional batch number" value={meta.batch_number} onChange={(e) => setM("batch_number", e.target.value)} className="max-w-[220px]" /></Field>
            <Field label="Shift">
              <Select value={meta.shift} onValueChange={(v) => setM("shift", v)}>
                <SelectTrigger className="max-w-[180px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="general">General</SelectItem>
                  <SelectItem value="day">Day</SelectItem>
                  <SelectItem value="night">Night</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Operator"><Input placeholder="Operator name" value={meta.operator_name} onChange={(e) => setM("operator_name", e.target.value)} /></Field>
          </section>

          {/* Outputs */}
          <section className="space-y-3 border-t pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Boxes className="h-4 w-4 text-primary" /> Finished Output</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Each output is added to finished stock. Add pellets and any byproduct.</p>
              </div>
              <Button variant="outline" size="sm" type="button" onClick={() => setOutputs((o) => [...o, emptyOut()])}><Plus className="h-4 w-4 mr-1" /> Add output</Button>
            </div>
            <div className="max-w-2xl space-y-2">
              {outputs.map((o, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={o.product_id ? String(o.product_id) : ""} onValueChange={(v) => setOutputs((arr) => arr.map((x, idx) => idx === i ? { ...x, product_id: Number(v), unit: products.find((p) => p.product_id === Number(v))?.unit || x.unit } : x))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select product" /></SelectTrigger>
                    <SelectContent>{products.map((p) => <SelectItem key={p.product_id} value={String(p.product_id)}>{p.product_name}</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" min={0} step={0.01} placeholder="Qty" value={o.quantity} onChange={(e) => setOutputs((arr) => arr.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} className="w-28" />
                  <Input placeholder="Unit" value={o.unit} onChange={(e) => setOutputs((arr) => arr.map((x, idx) => idx === i ? { ...x, unit: e.target.value } : x))} className="w-20" />
                  <Button variant="ghost" size="icon" type="button" className="h-8 w-8 text-muted-foreground hover:text-destructive" disabled={outputs.length === 1} onClick={() => setOutputs((arr) => arr.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </section>

          {/* Raw materials consumed */}
          <section className="space-y-3 border-t pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Leaf className="h-4 w-4 text-amber-600" /> Raw Materials Consumed</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Deducted from raw stock when the run is logged.</p>
              </div>
              <Button variant="outline" size="sm" type="button" onClick={() => setConsumption((c) => [...c, emptyCons()])}><Plus className="h-4 w-4 mr-1" /> Add</Button>
            </div>
            <div className="max-w-2xl space-y-2">
              {consumption.length === 0 && <p className="text-xs text-muted-foreground">No raw materials added.</p>}
              {consumption.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={l.raw_material_id ? String(l.raw_material_id) : ""} onValueChange={(v) => setConsumption((arr) => arr.map((x, idx) => idx === i ? { ...x, raw_material_id: Number(v) } : x))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select raw material" /></SelectTrigger>
                    <SelectContent>{materials.map((m) => <SelectItem key={m.raw_material_id} value={String(m.raw_material_id)}>{m.name} ({qty(m.current_stock, m.unit)} left)</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" min={0} step={0.01} placeholder="Qty" value={l.quantity} onChange={(e) => setConsumption((arr) => arr.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} className="w-28" />
                  <Button variant="ghost" size="icon" type="button" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setConsumption((arr) => arr.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </section>

          {/* Spares & consumables used */}
          <section className="space-y-3 border-t pt-6">
            <div className="flex items-center justify-between">
              <div>
                <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><Wrench className="h-4 w-4 text-primary" /> Spares &amp; Consumables Used</h3>
                <p className="text-xs text-muted-foreground mt-0.5">Dies, filters, lubricants and other spares used up this run — deducted from Spares &amp; Assets stock.</p>
              </div>
              <Button variant="outline" size="sm" type="button" onClick={() => setSpareCons((c) => [...c, emptySpare()])}><Plus className="h-4 w-4 mr-1" /> Add</Button>
            </div>
            <div className="max-w-2xl space-y-2">
              {spareCons.length === 0 && <p className="text-xs text-muted-foreground">No spares added.</p>}
              {spareCons.map((l, i) => (
                <div key={i} className="flex items-center gap-2">
                  <Select value={l.spare_id ? String(l.spare_id) : ""} onValueChange={(v) => setSpareCons((arr) => arr.map((x, idx) => idx === i ? { ...x, spare_id: Number(v) } : x))}>
                    <SelectTrigger className="flex-1"><SelectValue placeholder="Select spare / consumable" /></SelectTrigger>
                    <SelectContent>{spares.map((s) => <SelectItem key={s.spare_id} value={String(s.spare_id)}>{s.name} ({qty(s.current_stock, s.unit)} left)</SelectItem>)}</SelectContent>
                  </Select>
                  <Input type="number" min={0} step={0.01} placeholder="Qty" value={l.quantity} onChange={(e) => setSpareCons((arr) => arr.map((x, idx) => idx === i ? { ...x, quantity: e.target.value } : x))} className="w-28" />
                  <Button variant="ghost" size="icon" type="button" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setSpareCons((arr) => arr.filter((_, idx) => idx !== i))}><Trash2 className="h-4 w-4" /></Button>
                </div>
              ))}
            </div>
          </section>

          {/* Quality */}
          <section className="space-y-3 border-t pt-6">
            <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5"><ClipboardCheck className="h-4 w-4 text-primary" /> Quality Check <span className="text-xs font-normal text-muted-foreground">(optional)</span></h3>
            <div className="max-w-2xl grid grid-cols-2 sm:grid-cols-3 gap-3">
              {([
                ["moisture_pct", "Moisture %"], ["ash_pct", "Ash %"], ["gcv", "GCV (kcal/kg)"],
                ["fines_pct", "Fines %"], ["diameter_mm", "Diameter (mm)"], ["durability_pct", "Durability %"],
              ] as [keyof QualityForm, string][]).map(([k, label]) => (
                <div key={k} className="space-y-1">
                  <Label className="text-xs text-muted-foreground">{label}</Label>
                  <Input type="number" step={0.01} value={quality[k]} onChange={(e) => setQ(k, e.target.value)} />
                </div>
              ))}
            </div>
            <div className="max-w-2xl grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Result</Label>
                <Select value={quality.result} onValueChange={(v) => setQ("result", v)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Pending</SelectItem>
                    <SelectItem value="pass">Pass</SelectItem>
                    <SelectItem value="fail">Fail</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Inspector</Label>
                <Input value={quality.inspector} onChange={(e) => setQ("inspector", e.target.value)} placeholder="Name" />
              </div>
            </div>
            <div className="max-w-2xl space-y-1">
              <Label className="text-xs text-muted-foreground">Quality notes</Label>
              <Textarea rows={2} value={quality.notes} onChange={(e) => setQ("notes", e.target.value)} placeholder="Observations, deviations…" />
            </div>
          </section>

          {/* Run notes */}
          <section className="max-w-2xl space-y-2 border-t pt-6">
            <h3 className="text-sm font-semibold text-foreground">Run Notes</h3>
            <Textarea rows={3} placeholder="Optional notes about this run…" value={meta.notes} onChange={(e) => setM("notes", e.target.value)} />
          </section>

          {outputs.some((o) => o.product_id > 0 && Number(o.quantity) > 0) && (
            <p className="text-xs text-muted-foreground">
              Will add {outputs.filter((o) => o.product_id > 0 && Number(o.quantity) > 0).map((o) => `${o.quantity} ${o.unit} ${productLabel(o.product_id)}`).join(", ")} to finished stock.
            </p>
          )}
        </div>
      )}
    </FormPage>
  );
}
