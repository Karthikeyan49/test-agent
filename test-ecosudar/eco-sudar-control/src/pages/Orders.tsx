import { Search, FileText, Plus, MoreHorizontal, Pencil } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { fetchOrders, fetchOrder, updateOrderStatus, updateOrderPayment, updateOrderPaymentStatus, mapApiOrderToUI } from "@/lib/api/orders";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { exportToExcel, type ExportColumn } from "@/lib/exporters";
import { Pagination, usePagedRows } from "@/components/Pagination";

export interface OrderItem {
  product: string;
  size: string;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  purpose: string;
}

interface DeliveryAddress {
  name: string;
  phone: string;
  address: string;
  landmark: string;
  city: string;
  state: string;
  pincode: string;
  addressType: "Home" | "Office" | "Other";
  preferredDate: string;
  preferredTimeSlot: string;
  deliveryInstructions: string;
}

export interface Order {
  id: string;
  _orderId: number;
  items: OrderItem[];
  deliveryAddress: DeliveryAddress;
  date: string;
  status: string;
  customer: {
    name: string; phone: string; email: string; type: "Customer" | "Dealer";
    // Customer fields
    deliveryAddress?: string; city?: string; pincode?: string;
    // Dealer fields
    businessName?: string; udyamNumber?: string; address?: string;
  };
  trackingNumber: string;
  paymentMethod: string;
  paymentStatus: string;
  cancelReason: string;
  refundStatus: "N/A" | "Initiated" | "Processed";
  subtotal: string;
  gstAmount: string;
  deliveryFee: string;
  discount: string;
  grandTotal: string;
}

const statusFlow = ["Pending", "Confirmed", "Processing", "Shipped", "Out for Delivery", "Delivered", "Cancelled", "Returned"];

const statusColors: Record<string, string> = {
  Delivered: "bg-primary/10 text-primary",
  Shipped: "bg-blue-50 text-status-shipped",
  Processing: "bg-yellow-50 text-status-processing",
  Pending: "bg-muted text-status-pending",
  Confirmed: "bg-indigo-50 text-status-confirmed",
  "Out for Delivery": "bg-orange-50 text-status-out-for-delivery",
  Cancelled: "bg-destructive/10 text-destructive",
  Returned: "bg-purple-50 text-status-returned",
};

const paymentMethods = ["Pending", "COD", "UPI", "Online", "Net Banking", "Wallet"];




export default function Orders() {
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [trackingInput, setTrackingInput] = useState("");
  const [paymentInput, setPaymentInput] = useState("");
  const [paymentStatusInput, setPaymentStatusInput] = useState("");
  const [filterStatus, setFilterStatus] = useState("All");
  const [filterType, setFilterType] = useState("All");

  useEffect(() => {
    setLoading(true);
    fetchOrders(100)
      .then(async apiOrders => {
        const mapped: Order[] = await Promise.all(
          apiOrders.map(async o => {
            const full = await fetchOrder(o.order_id);
            return mapApiOrderToUI(full, full.items ?? []);
          })
        );
        setOrders(mapped);
      })
      .catch(() => toast.error("Failed to load orders"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = orders.filter(o => {
    const matchesSearch =
      o.id.toLowerCase().includes(search.toLowerCase()) ||
      o.customer.name.toLowerCase().includes(search.toLowerCase());
    const matchesFilter = filterStatus === "All" || o.status === filterStatus;
    const matchesType = filterType === "All" || o.customer.type === filterType;
    return matchesSearch && matchesFilter && matchesType;
  });

  const paged = usePagedRows(filtered);

  const exportOrders = () => {
    if (!filtered.length) { toast.error("No orders to export"); return; }
    const columns: ExportColumn<Order>[] = [
      { header: "Order ID", key: "id" },
      { header: "Customer", key: (o) => o.customer.name },
      { header: "Type", key: (o) => o.customer.type },
      { header: "Phone", key: (o) => o.customer.phone },
      { header: "Items", key: (o) => o.items.length },
      { header: "Date", key: "date" },
      { header: "Payment Method", key: "paymentMethod" },
      { header: "Payment Status", key: "paymentStatus" },
      { header: "Status", key: "status" },
      { header: "Subtotal", key: "subtotal" },
      { header: "GST", key: "gstAmount" },
      { header: "Grand Total", key: "grandTotal" },
    ];
    exportToExcel({ sheetName: "Orders", columns, rows: filtered, filename: "orders" });
    toast.success(`Exported ${filtered.length} orders`);
  };

  const viewOrder = (o: Order) => {
    setSelectedOrder({ ...o });
    setTrackingInput(o.trackingNumber);
    setPaymentInput(o.paymentMethod);
    setPaymentStatusInput(o.paymentStatus);
    setCancelReason("");
    setDetailOpen(true);
  };

  const updateStatus = async (newStatus: string) => {
    if (!selectedOrder) return;
    if (newStatus === "Cancelled" && !cancelReason.trim()) {
      toast.error("Cancellation reason is required");
      return;
    }
    const updates: Partial<Order> = { status: newStatus };
    if (newStatus === "Shipped" || newStatus === "Out for Delivery") {
      updates.trackingNumber = trackingInput;
    }
    if (newStatus === "Cancelled") {
      updates.cancelReason = cancelReason;
      updates.refundStatus = "Initiated";
    }
    if (newStatus === "Returned") {
      updates.refundStatus = "Initiated";
    }
    try {
      const res = await updateOrderStatus(selectedOrder._orderId, newStatus.toLowerCase());
      const updated = { ...selectedOrder, ...updates };
      setOrders(orders.map(o => o.id === selectedOrder.id ? updated : o));
      setSelectedOrder(updated);
      toast.success(`Order ${selectedOrder.id} status updated to ${newStatus}`);
      if (res.invoice_generated && res.invoice_number) {
        toast.success(`Invoice ${res.invoice_number} auto-generated`);
      }
    } catch (err) {
      toast.error("Failed to update status: " + (err instanceof Error ? err.message : "Unknown error"));
    }
  };

  const refundBadge: Record<string, string> = {
    "N/A": "bg-muted text-muted-foreground",
    Initiated: "bg-yellow-50 text-status-processing",
    Processed: "bg-primary/10 text-primary",
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Order Management</h1>
          <p className="text-muted-foreground">Current orders from mobile app</p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportOrders}>
                Export to Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button className="gap-2" onClick={() => navigate("/orders/new")}>
            <Plus className="h-4 w-4" />
            New Order
          </Button>
        </div>
      </div>

      <Dialog open={detailOpen} onOpenChange={setDetailOpen}>
        <DialogScrollContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Order Summary — {selectedOrder?.id}</DialogTitle>
            <DialogDescription>Order and customer details from app.</DialogDescription>
          </DialogHeader>
          <div>
          {selectedOrder && (
            <div className="space-y-4 py-2">
              {/* Order Items Table */}
              <h3 className="text-sm font-semibold text-card-foreground">Order Items</h3>
              <ScrollableX className="border rounded-lg">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-muted/50 border-b">
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Product</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Size</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Qty</th>
                      <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Unit Price</th>
                      <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selectedOrder.items.map((item, i) => (
                      <tr key={i} className="border-b last:border-0">
                        <td className="px-3 py-2 font-medium text-card-foreground">{item.product}</td>
                        <td className="px-3 py-2 text-muted-foreground">{item.size}</td>
                        <td className="px-3 py-2 text-muted-foreground">{item.quantity}</td>
                        <td className="px-3 py-2 text-muted-foreground">{item.unitPrice}</td>
                        <td className="px-3 py-2 text-right font-medium text-card-foreground">{item.subtotal}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollableX>

              {/* Price Breakdown */}
              <div className="bg-muted/30 rounded-lg p-3 space-y-1.5 text-sm">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="text-card-foreground">{selectedOrder.subtotal}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">GST (18%)</span><span className="text-card-foreground">{selectedOrder.gstAmount}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Delivery Fee</span><span className="text-card-foreground">{selectedOrder.deliveryFee}</span></div>
                <div className="flex justify-between"><span className="text-muted-foreground">Discount</span><span className="text-primary">-{selectedOrder.discount}</span></div>
                <div className="flex justify-between border-t pt-1.5"><span className="font-semibold text-card-foreground">Grand Total</span><span className="font-bold text-primary text-lg">{selectedOrder.grandTotal}</span></div>
              </div>

              {/* Customer / Dealer Details */}
              <div className="border-t pt-3">
                <div className="flex items-center gap-2 mb-2">
                  {selectedOrder.customer.type === "Dealer" ? (
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
                      <svg className="h-4 w-4 text-indigo-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 7V5a4 4 0 0 0-8 0v2" /></svg>
                      Dealer Details
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-sm font-semibold text-card-foreground">
                      <svg className="h-4 w-4 text-primary" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
                      Customer Details
                    </span>
                  )}
                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${selectedOrder.customer.type === "Dealer" ? "bg-indigo-500/15 text-indigo-400" : "bg-primary/10 text-primary"}`}>{selectedOrder.customer.type}</span>
                </div>
                <div className="bg-muted/30 rounded-lg p-3 space-y-2 text-sm">
                  {selectedOrder.customer.type === "Dealer" ? (
                    <>
                      <div className="flex justify-between"><span className="text-muted-foreground">Business Name</span><span className="text-card-foreground font-medium">{selectedOrder.customer.businessName || "—"}</span></div>
                      <div className="border-t border-border" />
                      <div className="flex justify-between"><span className="text-muted-foreground">Contact Person</span><span className="text-card-foreground font-medium">{selectedOrder.customer.name}</span></div>
                      <div className="border-t border-border" />
                      <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="text-card-foreground">{selectedOrder.customer.email}</span></div>
                      <div className="border-t border-border" />
                      <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span className="text-card-foreground">{selectedOrder.customer.phone}</span></div>
                      <div className="border-t border-border" />
                      <div className="flex justify-between"><span className="text-muted-foreground">UDYAM Number</span><span className="text-card-foreground">{selectedOrder.customer.udyamNumber || "—"}</span></div>
                      <div className="border-t border-border" />
                      <div className="flex justify-between"><span className="text-muted-foreground">Address</span><span className="text-card-foreground text-right max-w-[200px]">{selectedOrder.customer.address || "—"}</span></div>
                      <div className="border-t border-border" />
                      <div className="flex justify-between"><span className="text-muted-foreground">City</span><span className="text-card-foreground">{selectedOrder.customer.city || "—"}</span></div>
                      <div className="border-t border-border" />
                      <div className="flex justify-between"><span className="text-muted-foreground">Pincode</span><span className="text-card-foreground">{selectedOrder.customer.pincode || "—"}</span></div>
                    </>
                  ) : (
                    <>
                      <div className="flex justify-between"><span className="text-muted-foreground">Full Name</span><span className="text-card-foreground font-medium">{selectedOrder.customer.name}</span></div>
                      <div className="border-t border-border" />
                      <div className="flex justify-between"><span className="text-muted-foreground">Email Address</span><span className="text-card-foreground">{selectedOrder.customer.email}</span></div>
                      <div className="border-t border-border" />
                      <div className="flex justify-between"><span className="text-muted-foreground">Phone Number</span><span className="text-card-foreground">{selectedOrder.customer.phone}</span></div>
                      <div className="border-t border-border" />
                      <div className="flex justify-between"><span className="text-muted-foreground">Delivery Address</span><span className="text-card-foreground text-right max-w-[200px]">{selectedOrder.customer.deliveryAddress || "—"}</span></div>
                      <div className="border-t border-border" />
                      <div className="flex justify-between"><span className="text-muted-foreground">City</span><span className="text-card-foreground">{selectedOrder.customer.city || "—"}</span></div>
                      <div className="border-t border-border" />
                      <div className="flex justify-between"><span className="text-muted-foreground">Pincode</span><span className="text-card-foreground">{selectedOrder.customer.pincode || "—"}</span></div>
                    </>
                  )}
                </div>
              </div>


              {/* Shipment Section */}
              <div className="border-t pt-3">
                <h3 className="text-sm font-semibold text-card-foreground mb-2">Shipment</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-muted-foreground">Payment Method:</span>
                    <div className="flex items-center gap-2 mt-1">
                      <Select value={paymentInput} onValueChange={v => setPaymentInput(v)}>
                        <SelectTrigger className="h-8 text-sm w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {paymentMethods.map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}
                        </SelectContent>
                      </Select>
                      {paymentInput !== selectedOrder.paymentMethod && (
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={async () => {
                          try {
                            await updateOrderPayment(selectedOrder._orderId, paymentInput);
                            const updated = { ...selectedOrder, paymentMethod: paymentInput };
                            setOrders(orders.map(o => o.id === selectedOrder.id ? updated : o));
                            setSelectedOrder(updated);
                            toast.success(`Payment method set to ${paymentInput}`);
                          } catch (err) {
                            toast.error("Failed to update payment: " + (err instanceof Error ? err.message : "Unknown"));
                          }
                        }}>Save</Button>
                      )}
                    </div>
                    {selectedOrder.paymentMethod === "Pending" && (
                      <p className="text-xs text-amber-400 mt-1">⚠ Contact customer to confirm payment method</p>
                    )}
                  </div>
                  <div>
                    <span className="text-muted-foreground">Payment Status:</span>
                    <div className="flex items-center gap-2 mt-1">
                      <Select value={paymentStatusInput} onValueChange={v => setPaymentStatusInput(v)}>
                        <SelectTrigger className="h-8 text-sm w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {["pending", "paid", "refunded"].map(s => (
                            <SelectItem key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {paymentStatusInput !== selectedOrder.paymentStatus && (
                        <Button size="sm" variant="outline" className="h-8 text-xs" onClick={async () => {
                          try {
                            const res = await updateOrderPaymentStatus(selectedOrder._orderId, paymentStatusInput);
                            const updated = { ...selectedOrder, paymentStatus: paymentStatusInput };
                            setOrders(orders.map(o => o.id === selectedOrder.id ? updated : o));
                            setSelectedOrder(updated);
                            toast.success(`Payment status set to ${paymentStatusInput}`);
                            if (res.invoice_generated && res.invoice_number) {
                              toast.success(`Invoice ${res.invoice_number} auto-generated`);
                            }
                          } catch (err) {
                            toast.error("Failed to update: " + (err instanceof Error ? err.message : "Unknown"));
                          }
                        }}>Save</Button>
                      )}
                    </div>
                  </div>
                  {(selectedOrder.status === "Shipped" || selectedOrder.status === "Out for Delivery") && (
                    <div>
                      <span className="text-muted-foreground">Tracking Number:</span>
                      <Input
                        value={trackingInput}
                        onChange={e => setTrackingInput(e.target.value)}
                        placeholder="Enter tracking number"
                        className="mt-1 h-8 text-sm"
                      />
                    </div>
                  )}
                  {(selectedOrder.status === "Cancelled" || selectedOrder.status === "Returned") && (
                    <div>
                      <span className="text-muted-foreground">Refund Status:</span>
                      <p><span className={`inline-block mt-1 text-xs px-2.5 py-0.5 rounded-full font-medium ${refundBadge[selectedOrder.refundStatus]}`}>{selectedOrder.refundStatus}</span></p>
                    </div>
                  )}
                </div>
                {selectedOrder.cancelReason && (
                  <div className="mt-2 text-sm"><span className="text-muted-foreground">Cancel Reason:</span><p className="font-medium text-destructive">{selectedOrder.cancelReason}</p></div>
                )}
              </div>

              {/* Status Update */}
              <div className="border-t pt-3 space-y-2">
                <label className="text-sm font-medium text-card-foreground">Update Status</label>
                <Select value={selectedOrder.status} onValueChange={updateStatus}>
                  <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {statusFlow.map(s => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                  </SelectContent>
                </Select>
                {/* Show cancel reason field when status might be changed to Cancelled */}
                {selectedOrder.status !== "Cancelled" && (
                  <div>
                    <label className="text-xs text-muted-foreground">Cancellation Reason (required if cancelling)</label>
                    <Textarea
                      value={cancelReason}
                      onChange={e => setCancelReason(e.target.value)}
                      placeholder="Enter reason for cancellation..."
                      className="mt-1 text-sm"
                      rows={2}
                    />
                  </div>
                )}
              </div>
            </div>
          )}
          </div>
          <DialogFooter className="flex-row gap-2 justify-between sm:justify-between">
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <FileText className="h-3.5 w-3.5" />
              Invoice is generated automatically once the order is confirmed.
            </span>
            <DialogClose asChild><Button variant="outline">Close</Button></DialogClose>
          </DialogFooter>
        </DialogScrollContent>
      </Dialog>

      {/* Filter Tabs */}
      <div className="space-y-2">
        <div className="flex flex-wrap gap-2">
          {["All", "Customer", "Dealer"].map(t => (
            <button
              key={t}
              onClick={() => setFilterType(t)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${filterType === t ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            >
              {t}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          {["All", ...statusFlow].map(s => (
            <button
              key={s}
              onClick={() => setFilterStatus(s)}
              className={`px-3 py-1.5 text-xs font-medium rounded-full transition-colors ${filterStatus === s ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground hover:bg-muted/80"}`}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-4 border-b">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search orders..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <ScrollableX>
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Order ID</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Customer</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Items</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Date</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Payment Method</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Payment Status</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Edit</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((o) => (
                <tr
                  key={o.id}
                  onClick={() => viewOrder(o)}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                >
                  <td className="px-6 py-4 text-sm font-medium text-primary">{o.id}</td>
                  <td className="px-6 py-4">
                    <span className="text-sm text-card-foreground">{o.customer.name}</span>
                    <span className={`ml-2 text-[10px] px-1.5 py-0.5 rounded font-medium ${o.customer.type === "Dealer" ? "bg-indigo-500/15 text-indigo-400" : "bg-primary/10 text-primary"}`}>{o.customer.type}</span>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{o.items.length} item(s) — {o.grandTotal}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{o.date}</td>
                  <td className="px-6 py-4 text-sm">
                    {o.paymentMethod === "Pending"
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-medium">Pending</span>
                      : <span className="text-muted-foreground">{o.paymentMethod}</span>
                    }
                  </td>
                  <td className="px-6 py-4 text-sm">
                    {o.paymentStatus === "paid"
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-primary/10 text-primary font-medium">Paid</span>
                      : o.paymentStatus === "refunded"
                      ? <span className="text-xs px-2 py-0.5 rounded-full bg-purple-50 text-purple-500 font-medium">Refunded</span>
                      : <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/30 font-medium">Pending</span>
                    }
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-3 py-1 rounded-full font-medium ${statusColors[o.status] || "bg-muted text-muted-foreground"}`}>{o.status}</span>
                  </td>
                  <td className="px-6 py-4 text-right">
                    <button
                      onClick={(e) => { e.stopPropagation(); viewOrder(o); }}
                      title="Open & edit order"
                      className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-primary/10 rounded-lg transition-colors"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                  </td>
                </tr>
              ))}
              {loading && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">Loading orders...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">No orders found</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun="orders" />
      </div>
    </div>
  );
}
