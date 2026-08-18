import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowDownUp } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { inventoryApi, type RawMaterial, type StockItem, type MovementInput } from "@/lib/api/inventory";

const today = () => new Date().toISOString().slice(0, 10);

function Field({ label, children, req }: { label: React.ReactNode; children: React.ReactNode; req?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-sm text-muted-foreground">{label} {req && <Req />}</Label>
      <div>{children}</div>
    </div>
  );
}

const emptyMove = (): MovementInput => ({
  movement_type: "in",
  quantity: 0,
  reference: "",
  notes: "",
  movement_date: today(),
});

export default function MovementForm() {
  const navigate = useNavigate();

  const [itemKind, setItemKind] = useState<"finished" | "raw">("raw");
  const [rawMaterials, setRawMaterials] = useState<RawMaterial[]>([]);
  const [stockItems, setStockItems] = useState<StockItem[]>([]);
  const [selectedId, setSelectedId] = useState<number>(0);
  const [move, setMove] = useState<MovementInput>(emptyMove());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const setM = <K extends keyof MovementInput>(k: K, v: MovementInput[K]) =>
    setMove(m => ({ ...m, [k]: v }));

  useEffect(() => {
    Promise.all([inventoryApi.rawMaterials(), inventoryApi.stock()])
      .then(([raw, stock]) => { setRawMaterials(raw); setStockItems(stock); })
      .catch(() => toast.error("Failed to load items"))
      .finally(() => setLoading(false));
  }, []);

  const submit = async () => {
    if (!selectedId) { toast.error("Select an item"); return; }
    if (!move.quantity || move.quantity <= 0) { toast.error("Quantity must be greater than 0"); return; }
    setSaving(true);
    try {
      if (itemKind === "raw") {
        await inventoryApi.rawMovement(selectedId, move);
      } else {
        await inventoryApi.stockMovement(selectedId, move);
      }
      toast.success("Movement recorded");
      navigate("/inventory/movements");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record movement");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title="Record Stock Movement"
      description="Manually adjust stock in or out for any item."
      icon={<ArrowDownUp className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/inventory/movements")}
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/inventory/movements")} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || loading}>
            {saving ? "Saving…" : "Record Movement"}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="max-w-2xl space-y-3">
          <Field label="Item Type" req>
            <Select
              value={itemKind}
              onValueChange={v => { setItemKind(v as "finished" | "raw"); setSelectedId(0); }}
            >
              <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="raw">Raw Material</SelectItem>
                <SelectItem value="finished">Finished Good</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label="Item" req>
            <Select value={selectedId ? String(selectedId) : ""} onValueChange={v => setSelectedId(Number(v))}>
              <SelectTrigger><SelectValue placeholder="Select item" /></SelectTrigger>
              <SelectContent>
                {itemKind === "raw"
                  ? rawMaterials.map(m => (
                      <SelectItem key={m.raw_material_id} value={String(m.raw_material_id)}>
                        {m.name}
                      </SelectItem>
                    ))
                  : stockItems.map(s => (
                      <SelectItem key={s.product_id} value={String(s.product_id)}>
                        {s.product_name}
                      </SelectItem>
                    ))
                }
              </SelectContent>
            </Select>
          </Field>

          <Field label="Movement Type" req>
            <Select
              value={move.movement_type}
              onValueChange={v => setM("movement_type", v as MovementInput["movement_type"])}
            >
              <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="in">Stock In</SelectItem>
                <SelectItem value="out">Stock Out</SelectItem>
                <SelectItem value="adjust">Adjust / Correction</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          <Field label={move.movement_type === "adjust" ? "New Stock Level" : "Quantity"} req>
            <Input
              type="number" min={0} step={0.01}
              value={move.quantity}
              onChange={e => setM("quantity", Number(e.target.value))}
              className="max-w-[160px]"
            />
          </Field>

          <Field label="Date">
            <Input
              type="date"
              value={move.movement_date ?? today()}
              onChange={e => setM("movement_date", e.target.value)}
              className="max-w-[200px]"
            />
          </Field>

          <Field label="Reference">
            <Input
              placeholder="PO / invoice #"
              value={move.reference ?? ""}
              onChange={e => setM("reference", e.target.value)}
            />
          </Field>

          <Field label="Notes">
            <Textarea
              rows={2}
              placeholder="Optional notes…"
              value={move.notes ?? ""}
              onChange={e => setM("notes", e.target.value)}
            />
          </Field>
        </div>
      )}
    </FormPage>
  );
}
