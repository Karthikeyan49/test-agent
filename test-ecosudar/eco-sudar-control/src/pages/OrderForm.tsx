import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ShoppingCart, Plus, X, Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Req } from "@/components/Req";

import { FormPage } from "@/components/FormPage";
import { PhoneInput } from "@/components/PhoneInput";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";

import { fetchCustomers, type ApiUser } from "@/lib/api/customers";
import { fetchProducts, type UIProduct } from "@/lib/api/products";
import { createOrder } from "@/lib/api/orders";
import { apiFetch } from "@/lib/api/client";
import { DEFAULT_COUNTRY_CODE } from "@/lib/countryCodes";

// ─── Internal types ───────────────────────────────────────────────────────────

interface OrderLineItem {
  key: number;
  product: UIProduct;
  selectedSize: string;
  unitPrice: number;
  qty: number;
}

interface NewCustomerForm {
  name: string;
  email: string;
  phone_code: string;
  phone: string;
  city: string;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const PAYMENT_METHODS: { label: string; value: string }[] = [
  { label: "COD",         value: "cod" },
  { label: "UPI",         value: "upi" },
  { label: "Online",      value: "online" },
  { label: "Net Banking", value: "net_banking" },
  { label: "Wallet",      value: "wallet" },
];

function emptyNewCustomer(): NewCustomerForm {
  return { name: "", email: "", phone_code: DEFAULT_COUNTRY_CODE, phone: "", city: "" };
}

function parseSizePrice(priceStr: string): number {
  return parseFloat(priceStr.replace(/[^0-9.]/g, "")) || 0;
}

function fmtRupees(n: number): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function OrderForm() {
  const navigate = useNavigate();

  // ── Data loading ──────────────────────────────────────────────────────────
  const [customers, setCustomers] = useState<ApiUser[]>([]);
  const [products, setProducts]   = useState<UIProduct[]>([]);

  useEffect(() => {
    fetchCustomers(200).then(setCustomers).catch(() => toast.error("Failed to load customers"));
    fetchProducts().then(setProducts).catch(() => toast.error("Failed to load products"));
  }, []);

  // ── Customer section ──────────────────────────────────────────────────────
  const [customerSearch, setCustomerSearch]     = useState("");
  const [selectedCustomer, setSelectedCustomer] = useState<ApiUser | null>(null);

  const filteredCustomers: ApiUser[] = customerSearch.trim()
    ? customers.filter(c => {
        const q = customerSearch.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          c.email.toLowerCase().includes(q)
        );
      })
    : customers.slice(0, 5);

  // ── New customer dialog ───────────────────────────────────────────────────
  const [newCustOpen,   setNewCustOpen]   = useState(false);
  const [newCust,       setNewCust]       = useState<NewCustomerForm>(emptyNewCustomer());
  const [newCustSaving, setNewCustSaving] = useState(false);

  const setNC = (key: keyof NewCustomerForm, value: string) =>
    setNewCust(f => ({ ...f, [key]: value }));

  const handleCreateCustomer = async () => {
    if (!newCust.name.trim()) { toast.error("Name is required"); return; }
    setNewCustSaving(true);
    try {
      const res = await apiFetch<{ data: ApiUser }>("/admin/users", {
        method: "POST",
        body: JSON.stringify({
          name:      newCust.name.trim(),
          email:     newCust.email.trim() || undefined,
          phone:     `${newCust.phone_code}${newCust.phone}`,
          user_type: "customer",
          city:      newCust.city.trim() || undefined,
        }),
      });
      const created = res.data;
      setCustomers(prev => [created, ...prev]);
      setSelectedCustomer(created);
      setCustomerSearch("");
      setNewCustOpen(false);
      setNewCust(emptyNewCustomer());
      toast.success("Customer created");
    } catch (err) {
      toast.error("Failed to create customer: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setNewCustSaving(false);
    }
  };

  // ── Order items ───────────────────────────────────────────────────────────
  const [items,          setItems]          = useState<OrderLineItem[]>([]);
  const [pickerOpen,     setPickerOpen]     = useState(false);
  const [productSearch,  setProductSearch]  = useState("");
  const [pickedProduct,  setPickedProduct]  = useState<UIProduct | null>(null);
  const [pickedSize,     setPickedSize]     = useState("");
  const [keyCounter,     setKeyCounter]     = useState(0);

  const filteredProducts: UIProduct[] = productSearch.trim()
    ? products.filter(p => p.product.toLowerCase().includes(productSearch.toLowerCase()))
    : products;

  const priceForSize = (product: UIProduct, size: string): number => {
    const sp = product.sizes.find(s => s.size === size);
    return sp ? parseSizePrice(sp.price) : 0;
  };

  const handlePickProduct = (product: UIProduct) => {
    setPickedProduct(product);
    setPickedSize(product.sizes[0]?.size ?? "");
  };

  const handleAddItem = () => {
    if (!pickedProduct) return;
    const size = pickedSize || (pickedProduct.sizes[0]?.size ?? "");
    const unitPrice = priceForSize(pickedProduct, size);
    const key = keyCounter;
    setKeyCounter(k => k + 1);
    setItems(prev => [...prev, { key, product: pickedProduct, selectedSize: size, unitPrice, qty: 1 }]);
    setPickerOpen(false);
    setPickedProduct(null);
    setPickedSize("");
    setProductSearch("");
  };

  const closeProductPicker = () => {
    setPickerOpen(false);
    setPickedProduct(null);
    setPickedSize("");
    setProductSearch("");
  };

  const updateItem = (
    key: number,
    patch: Partial<Pick<OrderLineItem, "qty" | "unitPrice" | "selectedSize">>,
  ) =>
    setItems(prev =>
      prev.map(it => {
        if (it.key !== key) return it;
        const updated = { ...it, ...patch };
        if (patch.selectedSize !== undefined) {
          updated.unitPrice = priceForSize(it.product, patch.selectedSize);
        }
        return updated;
      }),
    );

  const removeItem = (key: number) => setItems(prev => prev.filter(it => it.key !== key));

  // ── Delivery details ──────────────────────────────────────────────────────
  const [deliveryAddress, setDeliveryAddress] = useState("");
  const [deliveryCity,    setDeliveryCity]    = useState("");
  const [deliveryState,   setDeliveryState]   = useState("");
  const [deliveryPincode, setDeliveryPincode] = useState("");
  const [deliveryFee,     setDeliveryFee]     = useState("0");

  // ── Payment & Notes ───────────────────────────────────────────────────────
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes,         setNotes]         = useState("");

  // ── Totals ────────────────────────────────────────────────────────────────
  const subtotal   = items.reduce((sum, it) => sum + it.qty * it.unitPrice, 0);
  const fee        = parseFloat(deliveryFee) || 0;
  const grandTotal = subtotal + fee;

  // ── Submit ────────────────────────────────────────────────────────────────
  const [saving, setSaving] = useState(false);
  useUnsavedChanges(!saving && (!!selectedCustomer || items.length > 0 || deliveryAddress.trim() !== ""), "order-form");

  const handleSubmit = async () => {
    if (!selectedCustomer) { toast.error("Please select a customer"); return; }
    if (items.length === 0) { toast.error("Add at least one item"); return; }
    if (items.some(it => it.qty <= 0)) { toast.error("All items must have quantity greater than 0"); return; }

    setSaving(true);
    try {
      const result = await createOrder({
        customer_id:      selectedCustomer.user_id,
        items: items.map(it => ({
          product_id: it.product.id,
          quantity:   it.qty,
          unit_price: it.unitPrice,
          size:       it.selectedSize || undefined,
          purpose:    it.product.purposes[0] || undefined,
        })),
        delivery_address: deliveryAddress.trim() || undefined,
        delivery_city:    deliveryCity.trim() || undefined,
        delivery_state:   deliveryState.trim() || undefined,
        delivery_pincode: deliveryPincode.trim() || undefined,
        payment_method:   paymentMethod || undefined,
        notes:            notes.trim() || undefined,
        delivery_fee:     fee > 0 ? fee : undefined,
      });
      toast.success(`Order ${result.order_number} created successfully`);
      navigate("/orders");
    } catch (err) {
      toast.error("Failed to create order: " + (err instanceof Error ? err.message : "Unknown error"));
    } finally {
      setSaving(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <>
      <FormPage
        title="New Sales Order"
        description="Create a manual sales order"
        icon={<ShoppingCart className="h-6 w-6 text-primary" />}
        onBack={() => navigate("/orders")}
        footer={
          <>
            <Button variant="outline" onClick={() => navigate("/orders")} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={saving}>
              {saving ? "Creating…" : "Create Sales Order"}
            </Button>
          </>
        }
      >
        {/* ── Section 1: Customer ─────────────────────────────────────────── */}
        <section className="space-y-3">
          <h3 className="text-sm font-semibold text-foreground">Customer</h3>
          <div className="max-w-2xl space-y-3">

            {selectedCustomer ? (
              /* Selected customer card */
              <div className="flex items-start justify-between rounded-lg border bg-muted/30 px-4 py-3">
                <div className="space-y-0.5">
                  <p className="text-sm font-medium">{selectedCustomer.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {selectedCustomer.phone} · {selectedCustomer.email}
                  </p>
                  {selectedCustomer.city && (
                    <p className="text-xs text-muted-foreground">{selectedCustomer.city}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 shrink-0"
                  type="button"
                  onClick={() => { setSelectedCustomer(null); setCustomerSearch(""); }}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ) : (
              <>
                {/* Search input */}
                <div className="relative">
                  <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Search by name, phone, or email…"
                    className="pl-9"
                    value={customerSearch}
                    onChange={e => setCustomerSearch(e.target.value)}
                  />
                </div>

                {/* Customer list */}
                {customers.length > 0 && (
                  <div className="max-h-48 overflow-y-auto rounded-md border divide-y">
                    {filteredCustomers.map(c => (
                      <button
                        key={c.user_id}
                        type="button"
                        className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/50 transition-colors"
                        onClick={() => { setSelectedCustomer(c); setCustomerSearch(""); }}
                      >
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{c.name}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {c.phone} · {c.email}
                          </p>
                        </div>
                        {c.city && (
                          <Badge variant="secondary" className="shrink-0 text-xs">
                            {c.city}
                          </Badge>
                        )}
                      </button>
                    ))}
                    {filteredCustomers.length === 0 && (
                      <p className="px-3 py-4 text-center text-sm text-muted-foreground">
                        No customers match your search
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            <Button
              variant="outline"
              size="sm"
              type="button"
              className="gap-2"
              onClick={() => setNewCustOpen(true)}
            >
              <UserPlus className="h-4 w-4" />
              Create New Customer
            </Button>
          </div>
        </section>

        {/* ── Section 2: Order Items ───────────────────────────────────────── */}
        <section className="space-y-3 border-t pt-5 mt-5">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Order Items</h3>
            <Button
              variant="outline"
              size="sm"
              type="button"
              className="gap-2"
              onClick={() => setPickerOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Add Item
            </Button>
          </div>

          {items.length === 0 ? (
            <div className="rounded-md border border-dashed px-4 py-8 text-center">
              <p className="text-sm text-muted-foreground">
                No items added yet. Click "Add Item" to begin.
              </p>
            </div>
          ) : (
            <ScrollableX className="rounded-md border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50">
                  <tr>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Product</th>
                    <th className="px-3 py-2 text-left font-medium text-muted-foreground">Size</th>
                    <th className="w-32 px-3 py-2 text-left font-medium text-muted-foreground">
                      Unit Price (₹)
                    </th>
                    <th className="w-24 px-3 py-2 text-left font-medium text-muted-foreground">Qty</th>
                    <th className="px-3 py-2 text-right font-medium text-muted-foreground">Total</th>
                    <th className="w-10 px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {items.map(it => (
                    <tr key={it.key} className="hover:bg-muted/20">
                      <td className="px-3 py-2 font-medium">{it.product.product}</td>
                      <td className="px-3 py-2">
                        {it.product.sizes.length > 1 ? (
                          <Select
                            value={it.selectedSize}
                            onValueChange={v => updateItem(it.key, { selectedSize: v })}
                          >
                            <SelectTrigger className="h-8 w-36 text-xs">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {it.product.sizes.map(sp => (
                                <SelectItem key={sp.size} value={sp.size}>
                                  {sp.size}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : (
                          <span className="text-muted-foreground">{it.selectedSize || "—"}</span>
                        )}
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          step={0.01}
                          className="h-8 w-28 text-sm"
                          value={it.unitPrice}
                          onChange={e =>
                            updateItem(it.key, { unitPrice: parseFloat(e.target.value) || 0 })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={1}
                          step={1}
                          className="h-8 w-20 text-sm"
                          value={it.qty}
                          onChange={e =>
                            updateItem(it.key, {
                              qty: Math.max(1, parseInt(e.target.value, 10) || 1),
                            })
                          }
                        />
                      </td>
                      <td className="px-3 py-2 text-right font-medium tabular-nums">
                        {fmtRupees(it.qty * it.unitPrice)}
                      </td>
                      <td className="px-3 py-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          type="button"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => removeItem(it.key)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </ScrollableX>
          )}
        </section>

        {/* ── Section 3: Delivery Details ──────────────────────────────────── */}
        <section className="space-y-3 border-t pt-5 mt-5">
          <h3 className="text-sm font-semibold text-foreground">Delivery Details</h3>
          <div className="max-w-2xl space-y-3">

            <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
              <span className="pt-2 text-sm text-muted-foreground">Address</span>
              <Textarea
                placeholder="Street address, landmark…"
                value={deliveryAddress}
                onChange={e => setDeliveryAddress(e.target.value)}
                rows={2}
                className="resize-none"
              />
            </div>

            <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
              <span className="pt-2 text-sm text-muted-foreground">City</span>
              <Input
                placeholder="City"
                value={deliveryCity}
                onChange={e => setDeliveryCity(e.target.value)}
                className="max-w-[240px]"
              />
            </div>

            <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
              <span className="pt-2 text-sm text-muted-foreground">State</span>
              <Input
                placeholder="State"
                value={deliveryState}
                onChange={e => setDeliveryState(e.target.value)}
                className="max-w-[240px]"
              />
            </div>

            <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
              <span className="pt-2 text-sm text-muted-foreground">Pincode</span>
              <Input
                placeholder="6-digit pincode"
                value={deliveryPincode}
                onChange={e => setDeliveryPincode(e.target.value)}
                className="max-w-[140px]"
              />
            </div>

            <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
              <span className="pt-2 text-sm text-muted-foreground">Delivery Fee</span>
              <Input
                type="number"
                min={0}
                step={0.01}
                placeholder="0"
                value={deliveryFee}
                onChange={e => setDeliveryFee(e.target.value)}
                className="max-w-[140px]"
              />
            </div>
          </div>
        </section>

        {/* ── Section 4: Payment & Notes ───────────────────────────────────── */}
        <section className="space-y-3 border-t pt-5 mt-5">
          <h3 className="text-sm font-semibold text-foreground">Payment & Notes</h3>
          <div className="max-w-2xl space-y-3">

            <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
              <span className="pt-2 text-sm text-muted-foreground">Payment Method</span>
              <Select value={paymentMethod} onValueChange={setPaymentMethod}>
                <SelectTrigger className="max-w-[200px]">
                  <SelectValue placeholder="Select method" />
                </SelectTrigger>
                <SelectContent>
                  {PAYMENT_METHODS.map(m => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid grid-cols-[10rem_1fr] items-start gap-4">
              <span className="pt-2 text-sm text-muted-foreground">Notes</span>
              <Textarea
                placeholder="Any additional notes or instructions…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
                rows={3}
                className="resize-none"
              />
            </div>
          </div>
        </section>

        {/* ── Order Summary ────────────────────────────────────────────────── */}
        {(items.length > 0 || fee > 0) && (
          <div className="mt-6 ml-auto max-w-xs rounded-lg bg-muted/40 p-4 space-y-2">
            <h4 className="text-sm font-semibold text-foreground">Order Summary</h4>
            <div className="space-y-1.5 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Item Subtotal</span>
                <span className="tabular-nums">{fmtRupees(subtotal)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Delivery Fee</span>
                <span className="tabular-nums">{fmtRupees(fee)}</span>
              </div>
              <div className="flex justify-between border-t pt-2 font-semibold">
                <span>Grand Total</span>
                <span className="tabular-nums">{fmtRupees(grandTotal)}</span>
              </div>
            </div>
          </div>
        )}
      </FormPage>

      {/* ── New Customer Dialog ───────────────────────────────────────────── */}
      <Dialog open={newCustOpen} onOpenChange={setNewCustOpen}>
        <DialogScrollContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Create New Customer</DialogTitle>
            <DialogDescription>
              Add a new customer to the system and select them for this order.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="space-y-1">
              <Label htmlFor="nc-name">Name <Req /></Label>
              <Input
                id="nc-name"
                placeholder="Full name"
                value={newCust.name}
                onChange={e => setNC("name", e.target.value)}
                disabled={newCustSaving}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="nc-email">Email</Label>
              <Input
                id="nc-email"
                type="email"
                placeholder="email@example.com"
                value={newCust.email}
                onChange={e => setNC("email", e.target.value)}
                disabled={newCustSaving}
              />
            </div>

            <div className="space-y-1">
              <Label>Phone</Label>
              <PhoneInput
                code={newCust.phone_code}
                number={newCust.phone}
                onCodeChange={v => setNC("phone_code", v)}
                onNumberChange={v => setNC("phone", v)}
                disabled={newCustSaving}
              />
            </div>

            <div className="space-y-1">
              <Label htmlFor="nc-city">City</Label>
              <Input
                id="nc-city"
                placeholder="City"
                value={newCust.city}
                onChange={e => setNC("city", e.target.value)}
                disabled={newCustSaving}
              />
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              type="button"
              disabled={newCustSaving}
              onClick={() => { setNewCustOpen(false); setNewCust(emptyNewCustomer()); }}
            >
              Cancel
            </Button>
            <Button type="button" disabled={newCustSaving} onClick={handleCreateCustomer}>
              {newCustSaving ? "Creating…" : "Create"}
            </Button>
          </DialogFooter>
        </DialogScrollContent>
      </Dialog>

      {/* ── Product Picker Dialog ─────────────────────────────────────────── */}
      <Dialog open={pickerOpen} onOpenChange={open => { if (!open) closeProductPicker(); else setPickerOpen(true); }}>
        <DialogScrollContent onInteractOutside={(e) => e.preventDefault()} className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Add Product</DialogTitle>
            <DialogDescription>
              Search and select a product to add to the order.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                autoFocus
                placeholder="Search products…"
                className="pl-9"
                value={productSearch}
                onChange={e => setProductSearch(e.target.value)}
              />
            </div>

            <div className="max-h-60 overflow-y-auto rounded-md border divide-y">
              {filteredProducts.map(p => {
                const isSelected = pickedProduct?.id === p.id;
                return (
                  <div
                    key={p.id}
                    className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2.5 transition-colors ${
                      isSelected ? "bg-primary/10" : "hover:bg-muted/50"
                    }`}
                    onClick={() => handlePickProduct(p)}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{p.product}</p>
                      <p className="text-xs text-muted-foreground">{p.category}</p>
                    </div>

                    {isSelected ? (
                      /* Size picker shown inline when this product is selected */
                      p.sizes.length > 0 && (
                        <Select value={pickedSize} onValueChange={setPickedSize}>
                          <SelectTrigger
                            className="h-8 w-40 shrink-0 text-xs"
                            onClick={e => e.stopPropagation()}
                          >
                            <SelectValue placeholder="Pick size" />
                          </SelectTrigger>
                          <SelectContent onClick={e => e.stopPropagation()}>
                            {p.sizes.map(sp => (
                              <SelectItem key={sp.size} value={sp.size}>
                                {sp.size} — {sp.price}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )
                    ) : (
                      /* Size badges shown for unselected products */
                      <div className="flex shrink-0 gap-1">
                        {p.sizes.slice(0, 2).map(sp => (
                          <Badge key={sp.size} variant="secondary" className="text-xs">
                            {sp.size}
                          </Badge>
                        ))}
                        {p.sizes.length > 2 && (
                          <Badge variant="secondary" className="text-xs">
                            +{p.sizes.length - 2}
                          </Badge>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

              {filteredProducts.length === 0 && (
                <p className="px-3 py-6 text-center text-sm text-muted-foreground">
                  No products found
                </p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" type="button" onClick={closeProductPicker}>
              Cancel
            </Button>
            <Button type="button" disabled={!pickedProduct} onClick={handleAddItem}>
              Add to Order
            </Button>
          </DialogFooter>
        </DialogScrollContent>
      </Dialog>
    </>
  );
}
