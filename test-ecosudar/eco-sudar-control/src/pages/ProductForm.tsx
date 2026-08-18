import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Package, X, Plus } from "lucide-react";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import { toast } from "sonner";
import { Req } from "@/components/Req";
import { FormPage } from "@/components/FormPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  fetchProducts, createProduct, updateProduct, toProductType,
  type SizePrice,
} from "@/lib/api/products";

const CATEGORIES = [
  "Pellets", "Biomass Stove", "Biomass Burner",
  "Eco-Friendly Plates", "Eco-Friendly Bowls", "Eco-Friendly Cups",
  "Cutlery", "Food Containers", "Straws & Stirrers",
];

interface SubPurposeMap { [purpose: string]: string[] }

interface FormState {
  product: string;
  sizes: SizePrice[];
  purposes: string[];
  subPurposes: SubPurposeMap;
  newPurpose: string;
  newSubPurpose: string;
  activePurposeForSub: string;
  description: string;
  category: string;
  imageUrl: string;
}

const emptyForm = (): FormState => ({
  product: "",
  sizes: [{ size: "", price: "" }],
  purposes: [],
  subPurposes: {},
  newPurpose: "",
  newSubPurpose: "",
  activePurposeForSub: "",
  description: "",
  category: "Pellets",
  imageUrl: "",
});

function parsePrice(s: string): number {
  const n = parseFloat(s.replace(/[^0-9.]/g, ""));
  return isNaN(n) ? 0 : n;
}

export default function ProductForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;

  const [form, setForm] = useState<FormState>(emptyForm());
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  // Capture the baseline once (after any edit-load) so we can detect edits.
  const initialSnapshot = useRef<string | null>(null);
  useEffect(() => {
    if (!loading && initialSnapshot.current === null) initialSnapshot.current = JSON.stringify(form);
  }, [loading, form]);
  useUnsavedChanges(
    !saving && initialSnapshot.current !== null && JSON.stringify(form) !== initialSnapshot.current,
    "product-form",
  );

  const set = <K extends keyof FormState>(key: K, val: FormState[K]) =>
    setForm(f => ({ ...f, [key]: val }));

  useEffect(() => {
    if (!id) return;
    fetchProducts()
      .then(all => {
        const p = all.find(x => x.id === Number(id));
        if (!p) { toast.error("Product not found"); navigate("/products"); return; }
        setForm({
          product: p.product,
          sizes: [...p.sizes],
          purposes: [...p.purposes],
          subPurposes: JSON.parse(JSON.stringify(p.subPurposes)),
          newPurpose: "", newSubPurpose: "",
          activePurposeForSub: p.purposes[0] || "",
          description: p.description,
          category: p.category,
          imageUrl: p.imageUrl,
        });
      })
      .catch(() => toast.error("Failed to load product"))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  const buildConfigurations = (sizes: SizePrice[]) => {
    const configs: { size: string; purpose: string; sub_purpose?: string; price: number }[] = [];
    const valid = sizes.filter(s => s.size && s.price);
    for (const s of valid) {
      const price = parsePrice(s.price);
      if (form.purposes.length === 0) {
        configs.push({ size: s.size, purpose: "General", price });
      } else {
        for (const pur of form.purposes) {
          const subs = form.subPurposes[pur] ?? [];
          if (subs.length === 0) {
            configs.push({ size: s.size, purpose: pur, price });
          } else {
            for (const sub of subs) {
              configs.push({ size: s.size, purpose: pur, sub_purpose: sub, price });
            }
          }
        }
      }
    }
    return configs;
  };

  const handleSubmit = async () => {
    const validSizes = form.sizes.filter(s => s.size && s.price);
    if (!form.product.trim()) { toast.error("Product name is required"); return; }
    if (validSizes.length === 0) { toast.error("Add at least one size with price"); return; }
    setSaving(true);
    try {
      const payload = {
        product_name: form.product,
        product_type: toProductType(form.category),
        description: form.description,
        base_price: parsePrice(validSizes[0].price),
        category: form.category,
        image_url: form.imageUrl,
        configurations: buildConfigurations(validSizes),
      };
      if (isEdit && id) {
        await updateProduct(Number(id), payload);
        toast.success(`Product "${form.product}" updated`);
      } else {
        await createProduct({ ...payload, is_available: true });
        toast.success(`Product "${form.product}" added`);
      }
      navigate("/products");
    } catch (err) {
      toast.error("Failed to save product: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setSaving(false);
    }
  };

  const updateSize = (i: number, field: keyof SizePrice, val: string) =>
    setForm(f => {
      const sizes = [...f.sizes];
      sizes[i] = { ...sizes[i], [field]: val };
      return { ...f, sizes };
    });

  const addPurpose = () => {
    const p = form.newPurpose.trim();
    if (!p) return;
    setForm(f => ({
      ...f,
      purposes: [...f.purposes, p],
      subPurposes: { ...f.subPurposes, [p]: [] },
      newPurpose: "",
      activePurposeForSub: p,
    }));
  };
  const removePurpose = (i: number) =>
    setForm(f => {
      const removed = f.purposes[i];
      const sp = { ...f.subPurposes };
      delete sp[removed];
      const np = f.purposes.filter((_, j) => j !== i);
      return { ...f, purposes: np, subPurposes: sp, activePurposeForSub: np[0] || "" };
    });

  const addSubPurpose = () => {
    const sp = form.newSubPurpose.trim();
    if (!sp || !form.activePurposeForSub) return;
    setForm(f => ({
      ...f,
      subPurposes: {
        ...f.subPurposes,
        [f.activePurposeForSub]: [...(f.subPurposes[f.activePurposeForSub] || []), sp],
      },
      newSubPurpose: "",
    }));
  };
  const removeSubPurpose = (pur: string, i: number) =>
    setForm(f => ({
      ...f,
      subPurposes: { ...f.subPurposes, [pur]: f.subPurposes[pur].filter((_, j) => j !== i) },
    }));

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) { toast.error("Please upload an image file"); return; }
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      if (img.width !== 300 || img.height !== 300) {
        toast.error(`Image must be 300×300 px (uploaded: ${img.width}×${img.height})`);
        URL.revokeObjectURL(url); return;
      }
      const reader = new FileReader();
      reader.onloadend = () => setForm(f => ({ ...f, imageUrl: reader.result as string }));
      reader.readAsDataURL(file);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-muted-foreground">
        Loading product…
      </div>
    );
  }

  return (
    <FormPage
      title={isEdit ? "Edit Product" : "New Product"}
      description="Products are visible in the mobile app"
      icon={<Package className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/products")}
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/products")} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save Changes" : "Add Product"}
          </Button>
        </>
      }
    >
      {/* Basic Info */}
      <section className="space-y-3">
        <h3 className="text-sm font-semibold text-foreground">Basic Information</h3>
        <div className="max-w-2xl space-y-3">

          <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
            <span className="pt-2 text-sm text-muted-foreground">Product Name <Req /></span>
            <Input
              placeholder="e.g. Biomass Pellets"
              value={form.product}
              onChange={e => set("product", e.target.value)}
            />
          </div>

          <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
            <span className="pt-2 text-sm text-muted-foreground">Category <Req /></span>
            <Select value={form.category} onValueChange={v => set("category", v)}>
              <SelectTrigger className="max-w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CATEGORIES.map(c => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
            <span className="pt-2 text-sm text-muted-foreground">Description</span>
            <Textarea
              placeholder="Brief product description…"
              value={form.description}
              onChange={e => set("description", e.target.value)}
              rows={2}
              className="resize-none"
            />
          </div>

          <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
            <span className="pt-2 text-sm text-muted-foreground">Product Image</span>
            <div className="flex items-center gap-4">
              {form.imageUrl ? (
                <div className="relative group">
                  <img src={form.imageUrl} alt="Product" className="h-20 w-20 rounded-lg object-cover border" />
                  <button
                    type="button"
                    onClick={() => set("imageUrl", "")}
                    className="absolute -top-2 -right-2 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              ) : (
                <label className="flex flex-col items-center justify-center h-20 w-20 rounded-lg border-2 border-dashed border-muted-foreground/30 cursor-pointer hover:border-primary/50 transition-colors">
                  <Plus className="h-5 w-5 text-muted-foreground" />
                  <span className="text-[10px] text-muted-foreground mt-0.5">Upload</span>
                  <input type="file" accept="image/*" className="hidden" onChange={handleImageUpload} />
                </label>
              )}
              <p className="text-xs text-muted-foreground">300 × 300 px<br />JPG, PNG or WebP</p>
            </div>
          </div>
        </div>
      </section>

      {/* Sizes & Prices */}
      <section className="space-y-3 border-t pt-5 mt-5">
        <h3 className="text-sm font-semibold text-foreground">Sizes & Prices <Req /></h3>
        <div className="max-w-2xl space-y-2">
          {form.sizes.map((sp, i) => (
            <div key={i} className="flex gap-2 items-center">
              <Input
                placeholder="Size (e.g. 6mm)"
                value={sp.size}
                onChange={e => updateSize(i, "size", e.target.value)}
                className="flex-1"
              />
              <Input
                placeholder="Price (e.g. ₹8.50/kg)"
                value={sp.price}
                onChange={e => updateSize(i, "price", e.target.value)}
                className="flex-1"
              />
              {form.sizes.length > 1 && (
                <button
                  type="button"
                  onClick={() => setForm(f => ({ ...f, sizes: f.sizes.filter((_, j) => j !== i) }))}
                  className="p-1.5 hover:bg-destructive/10 rounded-lg"
                >
                  <X className="h-4 w-4 text-destructive" />
                </button>
              )}
            </div>
          ))}
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setForm(f => ({ ...f, sizes: [...f.sizes, { size: "", price: "" }] }))}
          >
            + Add Size
          </Button>
        </div>
      </section>

      {/* Purposes */}
      <section className="space-y-3 border-t pt-5 mt-5">
        <h3 className="text-sm font-semibold text-foreground">Purposes</h3>
        <div className="max-w-2xl space-y-3">
          <div className="flex flex-wrap gap-2">
            {form.purposes.map((p, i) => (
              <span key={i} className="inline-flex items-center gap-1 bg-primary/10 text-primary text-xs px-2.5 py-1 rounded-full">
                {p}
                <button type="button" onClick={() => removePurpose(i)}>
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
          <div className="flex gap-2">
            <Input
              placeholder="e.g. Commercial Kitchen"
              value={form.newPurpose}
              onChange={e => set("newPurpose", e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addPurpose(); } }}
              className="max-w-xs"
            />
            <Button type="button" variant="outline" size="sm" onClick={addPurpose}>Add</Button>
          </div>
        </div>
      </section>

      {/* Sub-Purposes */}
      {form.purposes.length > 0 && (
        <section className="space-y-3 border-t pt-5 mt-5">
          <h3 className="text-sm font-semibold text-foreground">Sub-Purposes</h3>
          <p className="text-xs text-muted-foreground">Optional sub-purpose options shown per purpose in the app</p>
          <div className="max-w-2xl space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {form.purposes.map(p => (
                <button
                  key={p}
                  type="button"
                  onClick={() => set("activePurposeForSub", p)}
                  className={`text-xs px-3 py-1.5 rounded-full border transition-colors ${
                    form.activePurposeForSub === p
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted/50 text-muted-foreground border-border hover:bg-muted"
                  }`}
                >
                  {p}
                </button>
              ))}
            </div>
            {form.activePurposeForSub && (
              <div className="border rounded-lg p-3 bg-muted/20">
                <p className="text-xs font-medium text-foreground mb-2">
                  Sub-purposes for "{form.activePurposeForSub}"
                </p>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {(form.subPurposes[form.activePurposeForSub] || []).map((sp, i) => (
                    <span key={i} className="inline-flex items-center gap-1 bg-accent/60 text-accent-foreground text-xs px-2.5 py-1 rounded-full">
                      {sp}
                      <button type="button" onClick={() => removeSubPurpose(form.activePurposeForSub, i)}>
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                  {(form.subPurposes[form.activePurposeForSub] || []).length === 0 && (
                    <span className="text-xs text-muted-foreground italic">No sub-purposes yet</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <Input
                    placeholder="e.g. Restaurant Kitchen"
                    value={form.newSubPurpose}
                    onChange={e => set("newSubPurpose", e.target.value)}
                    onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addSubPurpose(); } }}
                    className="text-sm max-w-xs"
                  />
                  <Button type="button" variant="outline" size="sm" onClick={addSubPurpose}>Add</Button>
                </div>
              </div>
            )}
          </div>
        </section>
      )}
    </FormPage>
  );
}
