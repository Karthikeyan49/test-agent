import { Search, Plus, Edit, Trash2, Key, Eye, Mail, CheckCircle } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Req } from "@/components/Req";
import { fetchDealers, createDealer, updateDealer, deleteDealer, mapApiDealerToUI } from "@/lib/api/dealers";
import {
  Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { ExportMenu, type ExportColumnDef } from "@/components/ExportMenu";
import { TableSkeleton } from "@/components/TableSkeleton";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";

interface Dealer {
  id: number;
  contactPerson: string;
  businessName: string;
  email: string;
  phone: string;
  udyamNumber: string;
  address: string;
  city: string;
  pincode: string;
  orders: number;
  commission: string;
  status: string;
}

const emptyDealer: Dealer & { password: string } = {
  id: 0, contactPerson: "", businessName: "", email: "", phone: "", udyamNumber: "", address: "", city: "", pincode: "", orders: 0, commission: "₹0", status: "Active", password: "",
};

const EXPORT_COLUMNS: ExportColumnDef<Dealer>[] = [
  { header: "Contact Person", key: "contactPerson" },
  { header: "Business Name",  key: "businessName" },
  { header: "Phone",          key: "phone" },
  { header: "Email",          key: "email" },
  { header: "City",           key: "city" },
  { header: "Orders",         key: "orders" },
  { header: "Commission",     key: "commission" },
  { header: "Status",         key: "status" },
  { header: "UDYAM Number",   key: "udyamNumber",  group: "detail", defaultChecked: false },
  { header: "Address",        key: "address",      group: "detail", defaultChecked: false },
  { header: "Pincode",        key: "pincode",      group: "detail", defaultChecked: false },
];

export default function Dealers() {
  const navigate = useNavigate();
  const [dealers, setDealers] = useState<Dealer[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [addOpen, setAddOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [viewOpen, setViewOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [createdDealer, setCreatedDealer] = useState<{ name: string; email: string } | null>(null);
  const [viewDealer, setViewDealer] = useState<Dealer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Dealer | null>(null);
  const [form, setForm] = useState({ ...emptyDealer });

  const loadDealers = async () => {
    setLoading(true);
    try {
      const data = await fetchDealers();
      setDealers(data.map(mapApiDealerToUI));
    } catch {
      toast.error("Failed to load dealers");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadDealers(); }, []);

  const filtered = dealers.filter(d =>
    d.contactPerson.toLowerCase().includes(search.toLowerCase()) ||
    d.businessName.toLowerCase().includes(search.toLowerCase()) ||
    d.phone.includes(search) ||
    d.email.toLowerCase().includes(search.toLowerCase())
  );

  const paged = usePagedRows(filtered);

  const validateEmail = (email: string) => {
    if (!email) return true; // email is optional
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  };

  const validatePhone = (phone: string) => {
    return /^[6-9]\d{9}$/.test(phone);
  };

  const validatePincode = (pincode: string) => {
    if (!pincode) return true;
    return /^\d{6}$/.test(pincode);
  };

  const validateForm = () => {
    if (!form.contactPerson.trim()) { toast.error("Contact person is required"); return false; }
    if (!validatePhone(form.phone)) { toast.error("Enter a valid 10-digit Indian phone number"); return false; }
    if (form.email && !validateEmail(form.email)) { toast.error("Enter a valid email address"); return false; }
    if (form.pincode && !validatePincode(form.pincode)) { toast.error("Pincode must be 6 digits"); return false; }
    return true;
  };

  const handleAdd = async () => {
    if (!form.password) { toast.error("Password is required"); return; }
    if (!validateForm()) return;
    try {
      await createDealer({
        name: form.contactPerson,
        phone: form.phone,
        password: form.password,
        email: form.email || undefined,
        company_name: form.businessName || undefined,
        address: form.address || undefined,
        city: form.city || undefined,
        pincode: form.pincode || undefined,
        udyam_number: form.udyamNumber || undefined,
      });
      await loadDealers();
      setCreatedDealer({ name: form.contactPerson, email: form.email });
      setForm({ ...emptyDealer });
      setAddOpen(false);
      setSuccessOpen(true);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to create dealer");
    }
  };

  const handleEdit = async () => {
    if (!validateForm()) return;
    try {
      await updateDealer(form.id, {
        name: form.contactPerson,
        email: form.email || undefined,
        phone: form.phone,
        company_name: form.businessName || undefined,
        address: form.address || undefined,
        city: form.city || undefined,
        pincode: form.pincode || undefined,
        udyam_number: form.udyamNumber || undefined,
        new_password: form.password || undefined,
      });
      await loadDealers();
      setEditOpen(false);
      toast.success(`Dealer "${form.contactPerson}" updated${form.password ? " & password changed" : ""}`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to update dealer");
    }
  };

  const handleDelete = async (d: Dealer) => {
    try {
      await deleteDealer(d.id);
      setDealers(prev => prev.filter(x => x.id !== d.id));
      toast.success(`Dealer "${d.contactPerson}" deleted`);
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : "Failed to delete dealer");
    }
  };

  const openEdit = (d: Dealer) => { setForm({ ...d, password: "" }); setEditOpen(true); };
  const openView = (d: Dealer) => {
    setViewDealer(d);
    setViewOpen(true);
  };

  const renderForm = (onSubmit: () => void, submitLabel: string, showPassword: boolean, isEdit = false) => (
    <div className="space-y-4 py-2 max-h-[60vh] overflow-y-auto pr-1">
      {showPassword && !isEdit && <p className="text-xs text-muted-foreground">Dealer will login with their phone number and the password you set below.</p>}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-card-foreground">Contact Person <Req /></label>
          <Input value={form.contactPerson} onChange={e => setForm(f => ({ ...f, contactPerson: e.target.value }))} placeholder="Full name" className="mt-1" />
        </div>
        <div>
          <label className="text-sm font-medium text-card-foreground">Business Name</label>
          <Input value={form.businessName} onChange={e => setForm(f => ({ ...f, businessName: e.target.value }))} placeholder="Company name" className="mt-1" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-card-foreground">Email</label>
          <Input value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))} placeholder="email@example.com" className={`mt-1 ${form.email && !validateEmail(form.email) ? "border-destructive" : ""}`} />
          {form.email && !validateEmail(form.email) && <p className="text-xs text-destructive mt-1">Invalid email format</p>}
        </div>
        <div>
          <label className="text-sm font-medium text-card-foreground">Phone (Login ID) <Req /></label>
          <Input value={form.phone} onChange={e => setForm(f => ({ ...f, phone: e.target.value.replace(/\D/g, "").slice(0, 10) }))} placeholder="9876543210" maxLength={10} className={`mt-1 ${form.phone && !validatePhone(form.phone) ? "border-destructive" : ""}`} />
          {form.phone && !validatePhone(form.phone) && <p className="text-xs text-destructive mt-1">Must be 10 digits starting with 6-9</p>}
        </div>
      </div>
      <div>
        <label className="text-sm font-medium text-card-foreground">UDYAM Number</label>
        <Input value={form.udyamNumber} onChange={e => setForm(f => ({ ...f, udyamNumber: e.target.value }))} placeholder="UDYAM-XX-00-0000000" className="mt-1" />
      </div>
      <div>
        <label className="text-sm font-medium text-card-foreground">Address</label>
        <Input value={form.address} onChange={e => setForm(f => ({ ...f, address: e.target.value }))} placeholder="Full address" className="mt-1" />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-sm font-medium text-card-foreground">City</label>
          <Input value={form.city} onChange={e => setForm(f => ({ ...f, city: e.target.value }))} placeholder="City" className="mt-1" />
        </div>
        <div>
          <label className="text-sm font-medium text-card-foreground">Pincode</label>
          <Input value={form.pincode} onChange={e => setForm(f => ({ ...f, pincode: e.target.value.replace(/\D/g, "").slice(0, 6) }))} placeholder="600001" maxLength={6} className={`mt-1 ${form.pincode && !validatePincode(form.pincode) ? "border-destructive" : ""}`} />
          {form.pincode && !validatePincode(form.pincode) && <p className="text-xs text-destructive mt-1">Pincode must be 6 digits</p>}
        </div>
      </div>
      {showPassword && (
        <div>
          <label className="text-sm font-medium text-card-foreground">
            {isEdit ? "New Password" : "Password *"}
          </label>
          <Input type="password" value={form.password} onChange={e => setForm(f => ({ ...f, password: e.target.value }))} placeholder={isEdit ? "Leave blank to keep current password" : "Set login password"} className="mt-1" />
          {isEdit && <p className="text-xs text-muted-foreground mt-1">Leave blank to keep current password. A notification will be sent if changed.</p>}
        </div>
      )}
      <DialogFooter>
        <DialogClose asChild><Button variant="outline">Cancel</Button></DialogClose>
        <Button onClick={onSubmit} className="gap-2">
          {showPassword && !isEdit && <Key className="h-4 w-4" />} {submitLabel}
        </Button>
      </DialogFooter>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Dealer Network</h1>
          <p className="text-muted-foreground">Users registered as "Dealer" in the mobile app</p>
        </div>
        <Dialog open={addOpen} onOpenChange={v => { setAddOpen(v); if (v) setForm({ ...emptyDealer }); }}>
          <DialogScrollContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Create Dealer Credentials</DialogTitle>
              <DialogDescription>Set up a new dealer with phone number login.</DialogDescription>
            </DialogHeader>
            {renderForm(handleAdd, "Create Credentials", true)}
          </DialogScrollContent>
        </Dialog>
        <div className="flex items-center gap-2">
          <ExportMenu title="Dealers" columns={EXPORT_COLUMNS} rows={filtered} filename="dealers" />
          <Button onClick={() => navigate("/dealers/new")} className="gap-2"><Plus className="h-4 w-4" /> Add Dealer</Button>
        </div>
      </div>

      {/* Edit Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogScrollContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>Edit Dealer</DialogTitle>
            <DialogDescription>Update dealer information.</DialogDescription>
          </DialogHeader>
          {renderForm(handleEdit, "Save Changes", true, true)}
        </DialogScrollContent>
      </Dialog>

      {/* View Dialog */}
      <Dialog open={viewOpen} onOpenChange={setViewOpen}>
        <DialogScrollContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Dealer Details</DialogTitle>
            <DialogDescription>Profile filled by user in the mobile app</DialogDescription>
          </DialogHeader>
          {viewDealer && (
            <div className="bg-muted/30 rounded-lg p-4 space-y-2.5 text-sm">
              <div className="flex justify-between items-center">
                <span className="text-muted-foreground">User Type</span>
                <Badge variant="outline" className="bg-indigo-500/10 text-indigo-400 border-indigo-500/30">Dealer</Badge>
              </div>
              <div className="border-t border-border" />
              <div className="flex justify-between"><span className="text-muted-foreground">Business Name</span><span className="text-card-foreground font-medium">{viewDealer.businessName || "—"}</span></div>
              <div className="border-t border-border" />
              <div className="flex justify-between"><span className="text-muted-foreground">Contact Person</span><span className="text-card-foreground font-medium">{viewDealer.contactPerson}</span></div>
              <div className="border-t border-border" />
              <div className="flex justify-between"><span className="text-muted-foreground">Email</span><span className="text-card-foreground">{viewDealer.email || "—"}</span></div>
              <div className="border-t border-border" />
              <div className="flex justify-between"><span className="text-muted-foreground">Phone</span><span className="text-card-foreground">{viewDealer.phone}</span></div>
              <div className="border-t border-border" />
              <div className="flex justify-between"><span className="text-muted-foreground">UDYAM Number</span><span className="text-card-foreground">{viewDealer.udyamNumber || "—"}</span></div>
              <div className="border-t border-border" />
              <div className="flex justify-between"><span className="text-muted-foreground">Address</span><span className="text-card-foreground text-right max-w-[200px]">{viewDealer.address || "—"}</span></div>
              <div className="border-t border-border" />
              <div className="flex justify-between"><span className="text-muted-foreground">City</span><span className="text-card-foreground">{viewDealer.city || "—"}</span></div>
              <div className="border-t border-border" />
              <div className="flex justify-between"><span className="text-muted-foreground">Pincode</span><span className="text-card-foreground">{viewDealer.pincode || "—"}</span></div>
            </div>
          )}
          <DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter>
        </DialogScrollContent>
      </Dialog>
      {/* Credentials Sent Success Dialog */}
      <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
        <DialogScrollContent className="max-w-sm text-center">
          <div className="flex flex-col items-center gap-4 py-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <CheckCircle className="h-8 w-8 text-primary" />
            </div>
            <DialogHeader className="text-center">
              <DialogTitle className="text-center">Credentials Sent!</DialogTitle>
              <DialogDescription className="text-center">
                Login credentials for <span className="font-semibold text-card-foreground">{createdDealer?.name}</span> have been sent to:
              </DialogDescription>
            </DialogHeader>
            <div className="w-full space-y-2 text-sm">
              <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2.5">
                <Mail className="h-4 w-4 text-primary shrink-0" />
                <div className="text-left">
                  <p className="text-xs text-muted-foreground">Dealer Email</p>
                  <p className="font-medium text-card-foreground">{createdDealer?.email || "Not provided"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2 bg-muted/50 rounded-lg px-3 py-2.5">
                <Mail className="h-4 w-4 text-primary shrink-0" />
                <div className="text-left">
                  <p className="text-xs text-muted-foreground">Admin Email</p>
                  <p className="font-medium text-card-foreground">admin@ecosudar.com</p>
                </div>
              </div>
            </div>
            <Button onClick={() => setSuccessOpen(false)} className="w-full mt-2">Done</Button>
          </div>
        </DialogScrollContent>
      </Dialog>

      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-4 border-b">
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input placeholder="Search dealers..." className="pl-10" value={search} onChange={e => setSearch(e.target.value)} />
          </div>
        </div>
        <ScrollableX>
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Dealer</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Phone (Login)</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Email</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">City</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Orders</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Commission</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={8} />}
              {!loading && paged.rows.map((d) => (
                <tr key={d.id} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-card-foreground">{d.contactPerson}</p>
                    <p className="text-xs text-muted-foreground">{d.businessName || "—"}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground font-mono">{d.phone}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{d.email || "—"}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{d.city || "—"}</td>
                  <td className="px-6 py-4 text-sm text-card-foreground font-medium">{d.orders}</td>
                  <td className="px-6 py-4 text-sm text-primary font-semibold">{d.commission}</td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-3 py-1 rounded-full font-medium ${d.status === "Active" ? "bg-primary/10 text-primary" : "bg-muted text-status-pending"}`}>
                      {d.status}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right flex items-center justify-end gap-1">
                    <button onClick={() => openView(d)} className="p-1.5 hover:bg-muted rounded-lg"><Eye className="h-4 w-4 text-muted-foreground" /></button>
                    <button onClick={() => navigate(`/dealers/${d.id}/edit`)} className="p-1.5 hover:bg-muted rounded-lg"><Edit className="h-4 w-4 text-muted-foreground" /></button>
                    <button onClick={() => setDeleteTarget(d)} className="p-1.5 hover:bg-destructive/10 rounded-lg"><Trash2 className="h-4 w-4 text-destructive" /></button>
                  </td>
                </tr>
              ))}
              {!loading && filtered.length === 0 && (
                <tr><td colSpan={8} className="px-6 py-8 text-center text-muted-foreground">No dealers found</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableX>
      </div>
      {!loading && filtered.length > 0 && (
        <Pagination {...paged} onPage={paged.setPage} noun="dealers" />
      )}

      <ConfirmDeleteDialog
        open={!!deleteTarget}
        onOpenChange={(v) => { if (!v) setDeleteTarget(null); }}
        onConfirm={async () => { if (deleteTarget) { await handleDelete(deleteTarget); setDeleteTarget(null); } }}
        description={`Delete dealer "${deleteTarget?.contactPerson}"? This will remove their login credentials and all data.`}
      />
    </div>
  );
}
