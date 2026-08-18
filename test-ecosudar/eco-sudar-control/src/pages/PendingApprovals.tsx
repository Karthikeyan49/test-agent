import { Check, XCircle, Clock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { apiFetch } from "@/lib/api/client";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { ExportMenu, type ExportColumnDef } from "@/components/ExportMenu";
import { TableSkeleton } from "@/components/TableSkeleton";

interface PendingUser {
  user_id: string;
  name: string;
  email: string;
  phone: string;
  user_type: string;
  company_name?: string;
  approval_status: string;
  created_at: string;
  address?: string;
  city?: string;
  state?: string;
  pincode?: string;
  gst_number?: string;
  udyam_number?: string;
}

const EXPORT_COLUMNS: ExportColumnDef<PendingUser>[] = [
  { header: "Name",         key: "name" },
  { header: "Email",        key: "email" },
  { header: "Phone",        key: "phone" },
  { header: "Account Type", key: "user_type" },
  { header: "Company",      key: "company_name" },
  { header: "Registered At",key: "created_at" },
  { header: "Status",       key: "approval_status" },
  { header: "GST Number",   key: "gst_number",   group: "detail", defaultChecked: false },
  { header: "Udyam Number", key: "udyam_number", group: "detail", defaultChecked: false },
  { header: "Address",      key: "address",      group: "detail", defaultChecked: false },
  { header: "City",         key: "city",         group: "detail", defaultChecked: false },
];

export default function PendingApprovals() {
  const [users, setUsers] = useState<PendingUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedUser, setSelectedUser] = useState<PendingUser | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  const [isRejectOpen, setIsRejectOpen] = useState(false);
  const [isReviewOpen, setIsReviewOpen] = useState(false);

  const paged = usePagedRows(users);

  const fetchPending = () => {
    setLoading(true);
    apiFetch<{ data: { users: PendingUser[], count: number } }>('/admin/users/pending')
      .then(res => setUsers(res.data?.users || []))
      .catch((e: Error) => toast.error("Failed to load pending users: " + e.message))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    fetchPending();
  }, []);

  const handleApprove = async () => {
    if (!selectedUser) return;
    try {
      await apiFetch(`/admin/users/${selectedUser.user_id}/approve`, { method: 'POST' });
      toast.success(`${selectedUser.name} has been approved.`);
      setIsReviewOpen(false);
      setSelectedUser(null);
      fetchPending();
    } catch (e: any) {
      toast.error(e.message || "Failed to approve user");
    }
  };

  const handleReject = async () => {
    if (!selectedUser || !rejectReason.trim()) {
      toast.error("Rejection reason is required.");
      return;
    }
    
    try {
      await apiFetch(`/admin/users/${selectedUser.user_id}/reject`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ reason: rejectReason })
      });
      toast.success(`${selectedUser.name} has been rejected.`);
      setIsRejectOpen(false);
      setIsReviewOpen(false);
      setRejectReason("");
      setSelectedUser(null);
      fetchPending();
    } catch (e: any) {
      toast.error(e.message || "Failed to reject user");
    }
  };

  const openReviewDialog = (user: PendingUser) => {
    setSelectedUser(user);
    setIsReviewOpen(true);
  };

  const openRejectDialog = () => {
    setRejectReason("");
    setIsRejectOpen(true);
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Pending Approvals</h1>
          <p className="text-muted-foreground">Review and approve new Customer and Dealer registrations</p>
        </div>
        <ExportMenu title="Pending Approvals" columns={EXPORT_COLUMNS} rows={users} dateField="created_at" filename="pending-approvals" />
      </div>

      <Dialog open={isReviewOpen} onOpenChange={setIsReviewOpen}>
        <DialogScrollContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>Review Application</DialogTitle>
            <DialogDescription>
              Review the details of this registration before approving or rejecting.
            </DialogDescription>
          </DialogHeader>
          
          {selectedUser && (
            <div className="grid gap-3 py-4 text-sm">
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground font-medium">Name:</span>
                <span className="col-span-2 font-semibold text-foreground">{selectedUser.name}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground font-medium">Email:</span>
                <span className="col-span-2">{selectedUser.email}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground font-medium">Phone:</span>
                <span className="col-span-2">{selectedUser.phone}</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                <span className="text-muted-foreground font-medium">Account Type:</span>
                <span className="col-span-2">
                  <Badge variant={selectedUser.user_type === 'dealer' ? "default" : "secondary"}>
                    {selectedUser.user_type.toUpperCase()}
                  </Badge>
                </span>
              </div>

              <div className="border-t border-border my-2 px-0"></div>

              {selectedUser.company_name && (
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-muted-foreground font-medium">Company:</span>
                  <span className="col-span-2">{selectedUser.company_name}</span>
                </div>
              )}
              {selectedUser.gst_number && (
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-muted-foreground font-medium">GST Number:</span>
                  <span className="col-span-2">{selectedUser.gst_number}</span>
                </div>
              )}
              {selectedUser.udyam_number && (
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-muted-foreground font-medium">Udyam No:</span>
                  <span className="col-span-2">{selectedUser.udyam_number}</span>
                </div>
              )}
              {selectedUser.address && (
                <div className="grid grid-cols-3 gap-2">
                  <span className="text-muted-foreground font-medium">Location:</span>
                  <span className="col-span-2">{selectedUser.address}, {selectedUser.city}, {selectedUser.state} - {selectedUser.pincode}</span>
                </div>
              )}
            </div>
          )}

          <DialogFooter className="mt-4 gap-2 sm:gap-0">
            <Button variant="outline" className="text-destructive hover:bg-destructive/10 hover:text-destructive" onClick={openRejectDialog}>
              <XCircle className="w-4 h-4 mr-2" /> Reject User
            </Button>
            <Button onClick={handleApprove} className="bg-primary hover:bg-primary/90">
              <Check className="w-4 h-4 mr-2" /> Approve
            </Button>
          </DialogFooter>
        </DialogScrollContent>
      </Dialog>

      <Dialog open={isRejectOpen} onOpenChange={setIsRejectOpen}>
        <DialogScrollContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Reject Registration</DialogTitle>
            <DialogDescription>
              Provide a reason for rejecting <strong>{selectedUser?.name}</strong>. This exact reason will be included in the email sent to the user.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-3">
            <Textarea
              placeholder="e.g. Invalid GST Number provided..."
              value={rejectReason}
              onChange={(e) => setRejectReason(e.target.value)}
              className="resize-none h-24"
            />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsRejectOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={handleReject}>Confirm Rejection</Button>
          </DialogFooter>
        </DialogScrollContent>
      </Dialog>

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm text-left">
            <thead className="bg-muted/50 text-muted-foreground uppercase text-xs">
              <tr>
                <th className="px-5 py-4 font-medium">User Profile</th>
                <th className="px-5 py-4 font-medium">Type</th>
                <th className="px-5 py-4 font-medium">Registered At</th>
                <th className="px-5 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {loading ? (
                <TableSkeleton cols={4} />
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-5 py-12 text-center">
                    <div className="flex flex-col items-center justify-center space-y-3">
                      <div className="h-12 w-12 rounded-full bg-primary/10 flex items-center justify-center">
                         <Check className="h-6 w-6 text-primary" />
                      </div>
                      <p className="text-muted-foreground text-base">All caught up! No pending approvals.</p>
                    </div>
                  </td>
                </tr>
              ) : (
                paged.rows.map((u) => (
                  <tr key={u.user_id} className="hover:bg-muted/30 transition-colors">
                    <td className="px-5 py-4">
                      <div className="font-medium text-foreground">{u.name}</div>
                      <div className="text-muted-foreground text-xs">{u.email}</div>
                      <div className="text-muted-foreground text-xs">{u.phone}</div>
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={u.user_type === 'dealer' ? "default" : "secondary"}>
                        {u.user_type.toUpperCase()}
                      </Badge>
                      {u.company_name && <div className="text-xs text-muted-foreground mt-1">{u.company_name}</div>}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      <div className="flex items-center gap-1">
                         <Clock className="w-3 h-3"/>
                         {formatDate(u.created_at)}
                      </div>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex items-center justify-end">
                        <Button size="sm" onClick={() => openReviewDialog(u)}>
                          Review Details
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableX>
      </div>
      {!loading && users.length > 0 && (
        <Pagination {...paged} onPage={paged.setPage} noun="requests" />
      )}
    </div>
  );
}
