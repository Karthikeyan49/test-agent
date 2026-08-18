import { Search, Home, Briefcase, MapPin, KeyRound, Plus, MoreHorizontal } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Pagination, usePagedRows } from "@/components/Pagination";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { fetchCustomers, fetchCustomerOrderStats, updateCustomerStatus, mapApiUserToUI } from "@/lib/api/customers";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { exportToExcel, type ExportColumn } from "@/lib/exporters";
export interface Customer {
  id: number;
  name: string;
  phone: string;
  email: string;
  userType: "Customer" | "Dealer";
  deliveryAddress: string;
  city: string;
  pincode: string;
  orders: number;
  lastOrder: string;
  totalSpent: string;
  cancelledOrders: number;
  accountCreatedDate: string;
  activeOrders: number;
  deliveredOrders: number;
  isActive: boolean;
}

export default function Customers() {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Customer | null>(null);
  const [open, setOpen] = useState(false);
  const [statsLoading, setStatsLoading] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    setLoading(true);
    fetchCustomers(100, "customer")
      .then(apiData => {
        setCustomers(apiData.map(u => mapApiUserToUI(u)));
      })
      .catch(() => toast.error("Failed to load customers"))
      .finally(() => setLoading(false));
  }, []);

  const filtered = customers.filter(c =>
    c.name.toLowerCase().includes(search.toLowerCase()) ||
    c.email.toLowerCase().includes(search.toLowerCase()) ||
    c.phone.includes(search)
  );

  const paged = usePagedRows(filtered);

  const view = (c: Customer) => {
    setSelected(c);
    setOpen(true);
    // Fetch real per-status order stats from the backend
    setStatsLoading(true);
    fetchCustomerOrderStats(c.id)
      .then((stats) => {
        setSelected((prev) =>
          prev && prev.id === c.id
            ? {
                ...prev,
                orders: stats.total_orders,
                activeOrders: stats.active_orders,
                deliveredOrders: stats.delivered_orders,
                cancelledOrders: stats.cancelled_orders,
                returnedOrders: stats.returned_orders,
                totalSpent: `₹${stats.total_spent.toLocaleString("en-IN")}`,
              }
            : prev
        );
      })
      .catch(() => toast.error("Could not load order stats"))
      .finally(() => setStatsLoading(false));
  };

  const exportCustomers = () => {
    if (!filtered.length) { toast.error("No customers to export"); return; }
    const columns: ExportColumn<Customer>[] = [
      { header: "Name", key: "name" },
      { header: "Email", key: "email" },
      { header: "Phone", key: "phone" },
      { header: "Type", key: "userType" },
      { header: "City", key: "city" },
      { header: "Pincode", key: "pincode" },
      { header: "Orders", key: "orders" },
      { header: "Total Spent", key: "totalSpent" },
      { header: "Last Order", key: "lastOrder" },
      { header: "Active", key: (c) => (c.isActive ? "Yes" : "No") },
    ];
    exportToExcel({ sheetName: "Customers", columns, rows: filtered, filename: "customers" });
    toast.success(`Exported ${filtered.length} customers`);
  };

  const handleResetPassword = () => {
    if (selected) {
      toast.success(`Password reset email sent to ${selected.email}`);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Customers</h1>
          <p className="text-muted-foreground">Users registered as "Customer" in the mobile app</p>
        </div>
        <div className="flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="icon">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={exportCustomers}>
                Export to Excel
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button className="gap-2" onClick={() => navigate("/customers/new")}>
            <Plus className="h-4 w-4" />
            New Customer
          </Button>
        </div>
      </div>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogScrollContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Customer Details</DialogTitle>
            <DialogDescription>Profile filled by user in the mobile app</DialogDescription>
          </DialogHeader>
          <div>
          {selected && (
            <Tabs defaultValue="profile" className="mt-2">
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="profile">Profile</TabsTrigger>
                <TabsTrigger value="stats">Order Stats</TabsTrigger>
              </TabsList>

              <TabsContent value="profile" className="space-y-3 py-2">
                <div className="bg-muted/30 rounded-lg p-4 space-y-2.5 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">User Type & Status</span>
                    <div className="flex gap-2">
                      <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">Customer</Badge>
                      {selected.isActive ? (
                         <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">Active</Badge>
                      ) : (
                         <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Inactive</Badge>
                      )}
                    </div>
                  </div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">Full Name</span><span className="text-card-foreground font-medium">{selected.name}</span></div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">Email Address</span><span className="text-card-foreground">{selected.email}</span></div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">Phone Number</span><span className="text-card-foreground">{selected.phone}</span></div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">Delivery Address</span><span className="text-card-foreground text-right max-w-[200px]">{selected.deliveryAddress}</span></div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">City</span><span className="text-card-foreground">{selected.city}</span></div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">Pincode</span><span className="text-card-foreground">{selected.pincode}</span></div>
                  <div className="border-t border-border" />
                  <div className="flex justify-between"><span className="text-muted-foreground">Account Created</span><span className="text-card-foreground">{selected.accountCreatedDate}</span></div>
                </div>
                <div className="pt-2 flex justify-between">
                  <Button 
                    variant={selected.isActive ? "destructive" : "default"} 
                    size="sm" 
                    onClick={async () => {
                      try {
                        const newStatus = !selected.isActive;
                        await updateCustomerStatus(selected.id, newStatus);
                        const updated = { ...selected, isActive: newStatus };
                        setCustomers(customers.map(c => c.id === selected.id ? updated : c));
                        setSelected(updated);
                        toast.success(`Customer ${newStatus ? 'activated' : 'deactivated'} successfully`);
                      } catch (err) {
                        toast.error("Failed to update status");
                      }
                    }}
                  >
                    {selected.isActive ? "Deactivate Account" : "Activate Account"}
                  </Button>

                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <Button variant="outline" size="sm" className="gap-2"><KeyRound className="h-4 w-4" /> Reset Password</Button>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Reset Password?</AlertDialogTitle>
                        <AlertDialogDescription>A password reset email will be sent to {selected.email}.</AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={handleResetPassword}>Send Reset Email</AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </div>
              </TabsContent>

              <TabsContent value="stats" className="py-2">
                {statsLoading ? (
                  <div className="grid grid-cols-2 gap-4 text-sm">
                    {[...Array(5)].map((_, i) => (
                      <div key={i} className={`p-3 border rounded-lg text-center animate-pulse ${i === 4 ? 'col-span-2' : ''}`}>
                        <div className="h-8 bg-muted rounded mb-1 mx-auto w-16" />
                        <div className="h-3 bg-muted rounded mx-auto w-20" />
                      </div>
                    ))}
                  </div>
                ) : (
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-card-foreground">{selected.orders}</p>
                    <p className="text-xs text-muted-foreground">Total Orders</p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-primary">{selected.totalSpent}</p>
                    <p className="text-xs text-muted-foreground">Total Spent</p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-status-shipped">{selected.activeOrders}</p>
                    <p className="text-xs text-muted-foreground">Active Orders</p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-primary">{selected.deliveredOrders}</p>
                    <p className="text-xs text-muted-foreground">Delivered</p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-destructive">{selected.cancelledOrders}</p>
                    <p className="text-xs text-muted-foreground">Cancelled Orders</p>
                  </div>
                  <div className="p-3 border rounded-lg text-center">
                    <p className="text-2xl font-bold text-muted-foreground">{(selected as any).returnedOrders ?? 0}</p>
                    <p className="text-xs text-muted-foreground">Returned</p>
                  </div>
                </div>
                )}
              </TabsContent>
            </Tabs>
          )}
          </div>
          <DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter>
        </DialogScrollContent>
      </Dialog>

      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-4 border-b">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search customers..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <ScrollableX>
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Full Name</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Phone</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Email</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">City</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Orders</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Total Spent</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((c, i) => (
                <tr key={i} className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer" onClick={() => view(c)}>
                  <td className="px-6 py-4 text-sm font-medium text-card-foreground">{c.name}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{c.phone}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{c.email}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{c.city}</td>
                  <td className="px-6 py-4 text-sm font-medium text-card-foreground">{c.orders}</td>
                  <td className="px-6 py-4 text-sm font-medium text-primary">{c.totalSpent}</td>
                  <td className="px-6 py-4 text-sm">
                    {c.isActive
                      ? <Badge variant="outline" className="bg-primary/10 text-primary border-primary/30">Active</Badge>
                      : <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30">Inactive</Badge>
                    }
                  </td>
                </tr>
              ))}
              {loading && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">Loading customers...</td></tr>
              )}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={7} className="px-6 py-8 text-center text-muted-foreground">No customers found</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun="customers" />
      </div>
    </div>
  );
}
