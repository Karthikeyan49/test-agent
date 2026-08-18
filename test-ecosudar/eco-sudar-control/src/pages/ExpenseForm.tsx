import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Receipt, Camera, ImageIcon, Sparkles, Loader2, X, Upload, Download } from "lucide-react";
import { z } from "zod";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import { EXPENSE_CATEGORIES, expensesApi, type Expense } from "@/lib/api/expenses";
import { downloadPath } from "@/lib/api/phase2";
import { extractBillData } from "@/lib/api/billExtract";

const PAYMENT_MODES: Expense["paymentMode"][] = ["Cash", "Bank Transfer", "UPI", "Cheque", "Card"];
const OTHER = "Other" as const;

const expenseSchema = z.object({
  date: z.string().min(1, "Date is required"),
  category: z.string().trim().min(2, "Category required").max(60),
  vendor: z.string().trim().min(2, "Vendor required").max(120),
  description: z.string().trim().max(300).optional().default(""),
  amount: z.number().positive("Amount must be > 0").max(10_000_000),
  paymentMode: z.enum(["Cash", "Bank Transfer", "UPI", "Cheque", "Card"]),
  billUrl: z.string().optional(),
});

interface FormState {
  date: string;
  category: string;
  categoryChoice: string;
  vendor: string;
  description: string;
  amount: string;
  paymentMode: Expense["paymentMode"];
  billUrl?: string;
}

const emptyForm = (): FormState => ({
  date: new Date().toISOString().slice(0, 10),
  category: "Office Stationery",
  categoryChoice: "Office Stationery",
  vendor: "",
  description: "",
  amount: "",
  paymentMode: "Bank Transfer",
  billUrl: undefined,
});

function Field({ label, children, req }: { label: React.ReactNode; children: React.ReactNode; req?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-sm text-muted-foreground">{label} {req && <Req />}</Label>
      <div>{children}</div>
    </div>
  );
}

export default function ExpenseForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = !!id;

  const [form, setForm] = useState<FormState>(emptyForm());
  const [initial, setInitial] = useState(JSON.stringify(emptyForm()));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [extracting, setExtracting] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);

  const cameraRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLInputElement>(null);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!editing || !id) return;
    setLoading(true);
    const applyExp = (exp: Expense | undefined) => {
      if (!exp) { toast.error("Expense not found"); navigate("/expenses"); return; }
      setEditingExpense(exp);
      const isPreset = (EXPENSE_CATEGORIES as readonly string[]).includes(exp.category);
      const next: FormState = {
        date: exp.date,
        category: exp.category,
        categoryChoice: isPreset ? exp.category : OTHER,
        vendor: exp.vendor,
        description: exp.description,
        amount: String(exp.amount),
        paymentMode: exp.paymentMode,
        billUrl: exp.billUrl,
      };
      setForm(next);
      setInitial(JSON.stringify(next));
    };
    // A numeric id is a deep-link (e.g. from a billed PO); a code (EXP-…) comes from the list.
    const loader = /^\d+$/.test(id)
      ? expensesApi.get(Number(id)).then(applyExp)
      : expensesApi.list({ search: id }).then(({ items }) => applyExp(items.find((e) => e.id === id)));
    loader
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load expense"))
      .finally(() => setLoading(false));
  }, [id, editing, navigate]);

  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial]);
  useUnsavedChanges(dirty && !saving, "expense-form");

  const onFile = (f: File | undefined) => {
    if (!f) return;
    if (f.size > 5 * 1024 * 1024) { toast.error("File must be under 5MB"); return; }
    if (!/^(image\/|application\/pdf)/.test(f.type)) { toast.error("Only images or PDF allowed"); return; }
    const reader = new FileReader();
    reader.onload = () => set("billUrl", reader.result as string);
    reader.readAsDataURL(f);
  };

  const autoFillFromBill = async () => {
    if (!form.billUrl) { toast.error("Upload a bill first"); return; }
    setExtracting(true);
    try {
      const extracted = await extractBillData(form.billUrl);
      const isPreset = (EXPENSE_CATEGORIES as readonly string[]).includes(extracted.category);
      const categoryChoice = isPreset ? extracted.category : OTHER;
      const category = isPreset ? extracted.category : (extracted.category || "");
      setForm((prev) => ({
        ...prev,
        date: extracted.date || prev.date,
        vendor: extracted.vendor || prev.vendor,
        amount: extracted.amount > 0 ? String(extracted.amount) : prev.amount,
        description: extracted.description || prev.description,
        category,
        categoryChoice,
      }));
      toast.success("Bill scanned — please review and correct any fields.");
    } catch (e: any) {
      toast.error(e?.message ?? "Could not extract bill");
    } finally {
      setExtracting(false);
    }
  };

  const downloadBill = async () => {
    if (!editingExpense) return;
    const ext = editingExpense.billUrl?.includes(".") ? editingExpense.billUrl.split(".").pop() : "jpg";
    try {
      await downloadPath(
        `/admin/expenses/${editingExpense.numericId}/bill?download=1`,
        `${editingExpense.id}.${ext}`,
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not download bill");
    }
  };

  const submit = async () => {
    const parsed = expenseSchema.safeParse({ ...form, amount: Number(form.amount) });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Invalid input"); return; }
    setSaving(true);
    try {
      if (editing && id) {
        await expensesApi.update(id, parsed.data as Partial<Expense>);
        toast.success("Expense updated");
      } else {
        await expensesApi.create(parsed.data as Omit<Expense, "id" | "createdBy">);
        toast.success("Expense added");
      }
      setInitial(JSON.stringify(form));
      navigate("/expenses");
    } catch (e: any) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title={editing ? "Edit Expense" : "New Expense"}
      description="Track and categorise a business expense."
      icon={<Receipt className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/expenses")}
      backLabel="Expenses"
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/expenses")} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || loading}>
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Saving…</>
              : editing ? "Save Expense" : "Add Expense"}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading expense…</p>
      ) : (
        <div className="max-w-2xl space-y-8">

          {/* Bill / Receipt */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Bill / Receipt</h3>
            <div
              className={`rounded-xl border-2 border-dashed bg-muted/30 p-4 space-y-3 transition-colors ${dragOver ? "border-primary bg-primary/5" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); onFile(e.dataTransfer.files?.[0]); }}
            >
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />
              <input ref={galleryRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={(e) => onFile(e.target.files?.[0])} />

              {!form.billUrl ? (
                dragOver ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-2 pointer-events-none">
                    <Upload className="h-8 w-8 text-primary animate-bounce" />
                    <span className="text-sm font-medium text-primary">Drop file here</span>
                  </div>
                ) : (
                  <>
                    <div
                      className="flex flex-col items-center justify-center py-4 gap-1 cursor-pointer rounded-lg hover:bg-muted/50 transition-colors"
                      onClick={() => galleryRef.current?.click()}
                    >
                      <Upload className="h-6 w-6 text-muted-foreground" />
                      <span className="text-sm text-muted-foreground">Drag & drop a file here, or click to browse</span>
                      <span className="text-xs text-muted-foreground">Image or PDF · max 5MB</span>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <Button type="button" variant="outline" onClick={() => cameraRef.current?.click()}>
                        <Camera className="h-4 w-4" /> Take Photo
                      </Button>
                      <Button type="button" variant="outline" onClick={() => galleryRef.current?.click()}>
                        <ImageIcon className="h-4 w-4" /> Upload from Gallery
                      </Button>
                    </div>
                  </>
                )
              ) : (
                <div className="space-y-2">
                  <div className="relative bg-background rounded-lg border overflow-hidden">
                    {form.billUrl.startsWith("data:image") ? (
                      <img src={form.billUrl} alt="Bill preview" className="w-full max-h-48 object-contain bg-muted/40" />
                    ) : form.billUrl.startsWith("data:") ? (
                      <div className="p-6 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
                        <Upload className="h-4 w-4" /> PDF attached
                      </div>
                    ) : (
                      <div className="p-6 text-center text-sm text-muted-foreground flex flex-col items-center justify-center gap-2">
                        <Receipt className="h-5 w-5" /> Bill saved on server
                        {editing && (
                          <Button type="button" size="sm" variant="outline" onClick={downloadBill}>
                            <Download className="h-4 w-4" /> Download
                          </Button>
                        )}
                      </div>
                    )}
                    <Button
                      type="button" size="icon" variant="secondary"
                      className="absolute top-2 right-2 h-7 w-7"
                      onClick={() => set("billUrl", undefined)}
                    >
                      <X className="h-3 w-3" />
                    </Button>
                  </div>
                  <div className="flex gap-2">
                    <Button type="button" size="sm" variant="outline" className="flex-1" onClick={() => galleryRef.current?.click()}>
                      Replace
                    </Button>
                    {form.billUrl.startsWith("data:") && (
                      <Button type="button" size="sm" className="flex-1" disabled={extracting} onClick={autoFillFromBill}>
                        {extracting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                        Auto-fill from photo
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Expense Details */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Expense Details</h3>
            <Field label="Date" req>
              <Input type="date" value={form.date} onChange={(e) => set("date", e.target.value)} className="max-w-[200px]" />
            </Field>
            <Field label="Amount (₹)" req>
              <Input
                type="number" min="1"
                value={form.amount}
                onChange={(e) => set("amount", e.target.value.replace(/^0+(?=\d)/, ""))}
                className="max-w-[220px]"
              />
            </Field>
            <Field label="Category" req>
              <div className="space-y-2">
                <Select
                  value={form.categoryChoice}
                  onValueChange={(v) => setForm((f) => ({ ...f, categoryChoice: v, category: v === OTHER ? "" : v }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {EXPENSE_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
                {form.categoryChoice === OTHER && (
                  <Input
                    autoFocus
                    placeholder="Enter custom category name"
                    value={form.category}
                    onChange={(e) => set("category", e.target.value)}
                  />
                )}
              </div>
            </Field>
            <Field label="Vendor / Payee" req>
              <Input
                value={form.vendor}
                onChange={(e) => set("vendor", e.target.value)}
                placeholder="e.g. Sri Lakshmi Traders"
              />
            </Field>
            <Field label="Description">
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Notes / reference"
              />
            </Field>
          </section>

          {/* Payment Details */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Payment Details</h3>
            <Field label="Payment Mode" req>
              <Select value={form.paymentMode} onValueChange={(v) => set("paymentMode", v as Expense["paymentMode"])}>
                <SelectTrigger className="max-w-[220px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {PAYMENT_MODES.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </section>

        </div>
      )}
    </FormPage>
  );
}
