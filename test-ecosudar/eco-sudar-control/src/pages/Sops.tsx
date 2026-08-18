import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, FileText, Upload, History, Shield, CheckCircle2, XCircle, Trash2, Download, Filter } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle, DialogFooter, DialogTrigger, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { StatCard } from "@/components/StatCard";
import { toast } from "sonner";
import { Req } from "@/components/Req";
import { ExportMenu, type ExportColumnDef } from "@/components/ExportMenu";
import {
  sopsApi,
  Sop,
  SopVersion,
  SOP_DEPARTMENTS,
  SopDepartment,
  SOP_ROLES,
  SopAccessRole,
  SOP_STATUS_COLOR,
  SopStatus,
  SopOwner,
} from "@/lib/api/sops";

const EXPORT_COLUMNS: ExportColumnDef<Sop>[] = [
  { header: "Code",        key: "code" },
  { header: "Title",       key: "title" },
  { header: "Department",  key: "department" },
  { header: "Access Role", key: "accessRole" },
  { header: "Created",     key: "createdAt" },
  { header: "Updated",     key: "updatedAt" },
  { header: "Description", key: "description", group: "detail", defaultChecked: false },
];

const formatBytes = (b?: number | null) => {
  const bytes = Number(b || 0);
  if (!bytes) return "—";
  return bytes < 1024 ? `${bytes} B` : bytes < 1_048_576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1_048_576).toFixed(2)} MB`;
};
const formatDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" }) : "—";
const getErrorMessage = (error: unknown, fallback: string) => error instanceof Error ? error.message : fallback;
const currentVersion = (sop: Sop): SopVersion | undefined =>
  sop.versions?.find((v) => v.id === sop.currentVersionId) ?? sop.versions?.[0];
const userLabel = (id?: string | number | null, name?: string | null) => name || (id ? `User #${id}` : "Admin");

export default function Sops() {
  const [sops, setSops] = useState<Sop[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<SopDepartment | "all">("all");
  const [statusFilter, setStatusFilter] = useState<SopStatus | "all">("all");

  const [viewSop, setViewSop] = useState<Sop | null>(null);
  const [versionOpen, setVersionOpen] = useState(false);

  const navigate = useNavigate();

  const reload = async () => {
    setLoading(true);
    try {
      const s = await sopsApi.list();
      setSops(s);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to load SOPs"));
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { reload(); }, []);

  const filtered = useMemo(() => {
    return sops.filter((s) => {
      if (deptFilter !== "all" && s.department !== deptFilter) return false;
      const cur = currentVersion(s);
      if (statusFilter !== "all" && cur?.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        return (
          s.title.toLowerCase().includes(q) ||
          s.code.toLowerCase().includes(q) ||
          s.tags.some((t) => t.toLowerCase().includes(q))
        );
      }
      return true;
    });
  }, [sops, deptFilter, statusFilter, search]);

  const grouped = useMemo(() => {
    const map = new Map<SopDepartment, Sop[]>();
    filtered.forEach((s) => {
      const list = map.get(s.department) ?? [];
      list.push(s); map.set(s.department, list);
    });
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  const stats = useMemo(() => {
    const total = sops.length;
    const approved = sops.filter((s) => currentVersion(s)?.status === "Approved").length;
    const pending = sops.filter((s) => currentVersion(s)?.status === "Pending Approval").length;
    const drafts = sops.filter((s) => currentVersion(s)?.status === "Draft").length;
    return { total, approved, pending, drafts };
  }, [sops]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Standard Operating Procedures</h1>
          <p className="text-muted-foreground mt-1">Centralized SOP library with version control and role-based access.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu title="SOPs" columns={EXPORT_COLUMNS} rows={filtered} filename="sops" />
          <Button onClick={() => navigate("/sops/new")}><Plus className="h-4 w-4" /> New SOP</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total SOPs" value={stats.total.toString()} subtitle="Across all departments" icon={FileText} />
        <StatCard title="Approved" value={stats.approved.toString()} subtitle="Live & in use" icon={CheckCircle2} />
        <StatCard title="Pending Approval" value={stats.pending.toString()} subtitle="Awaiting sign-off" icon={History} />
        <StatCard title="Drafts" value={stats.drafts.toString()} subtitle="Work in progress" icon={Shield} />
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title, code or tag..." className="pl-9" />
          </div>
          <Select value={deptFilter} onValueChange={(v) => setDeptFilter(v as any)}>
            <SelectTrigger className="w-[200px]"><Filter className="h-4 w-4" /><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Departments</SelectItem>
              {SOP_DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
            </SelectContent>
          </Select>
          <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as any)}>
            <SelectTrigger className="w-[180px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="Draft">Draft</SelectItem>
              <SelectItem value="Pending Approval">Pending Approval</SelectItem>
              <SelectItem value="Approved">Approved</SelectItem>
              <SelectItem value="Archived">Archived</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </Card>

      {loading ? (
        <Card className="p-8 text-center text-muted-foreground">Loading SOPs...</Card>
      ) : grouped.length === 0 ? (
        <Card className="p-8 text-center text-muted-foreground">No SOPs match your filters.</Card>
      ) : (
        <div className="space-y-6">
          {grouped.map(([dept, list]) => (
            <div key={dept}>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-lg font-semibold text-foreground">{dept}</h2>
                <Badge variant="secondary">{list.length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                {list.map((sop) => {
                  const cur = currentVersion(sop);
                  return (
                    <Card key={sop.id} className="p-4 hover:shadow-md transition-shadow cursor-pointer flex flex-col" onClick={() => setViewSop(sop)}>
                      <div className="flex items-start justify-between gap-2 mb-2">
                        <Badge variant="outline" className="font-mono text-xs">{sop.code}</Badge>
                        {cur && <Badge className={SOP_STATUS_COLOR[cur.status]}>{cur.status}</Badge>}
                        {!cur && <Badge className="bg-muted text-muted-foreground">No Version</Badge>}
                      </div>
                      <h3 className="font-semibold text-foreground mb-1 line-clamp-2">{sop.title}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3 flex-1">{sop.description}</p>
                      <div className="flex items-center justify-between text-xs text-muted-foreground pt-3 border-t">
                        <span className="flex items-center gap-1"><History className="h-3 w-3" /> {cur ? `v${cur.version}` : 'No version'}</span>
                        <span className="flex items-center gap-1"><Shield className="h-3 w-3" /> {sop.accessRole}</span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Detail dialog */}
      <Dialog open={!!viewSop} onOpenChange={(o) => !o && setViewSop(null)}>
        {viewSop && (
          <SopDetailDialog
            sop={viewSop}
            onUpload={() => setVersionOpen(true)}
            onChanged={async () => {
              const list = await sopsApi.list();
              setSops(list);
              setViewSop(list.find((s) => s.id === viewSop.id) ?? null);
            }}
            onDeleted={async () => { setViewSop(null); reload(); }}
          />
        )}
      </Dialog>

      {/* New version dialog */}
      <Dialog open={versionOpen} onOpenChange={setVersionOpen}>
        {viewSop && (
          <NewVersionDialog
            sop={viewSop}
            onDone={async () => {
              setVersionOpen(false);
              const list = await sopsApi.list();
              setSops(list);
              setViewSop(list.find((s) => s.id === viewSop.id) ?? null);
            }}
          />
        )}
      </Dialog>
    </div>
  );
}

/* ---------------- Create dialog ---------------- */
function CreateSopDialog({ owners, onCreated }: { owners: SopOwner[]; onCreated: () => void }) {
  const [code, setCode] = useState("");
  const [title, setTitle] = useState("");
  const [department, setDepartment] = useState<SopDepartment>("Production");
  const [description, setDescription] = useState("");
  const [ownerId, setOwnerId] = useState<string>(owners[0]?.id ?? "");
  const [accessRole, setAccessRole] = useState<SopAccessRole>("Department Only");
  const [tags, setTags] = useState("");
  const [document, setDocument] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState("");
  const [showErrorDialog, setShowErrorDialog] = useState(false);

  const submit = async () => {
    if (!code.trim() || !title.trim() || !document) {
      toast.error("Please fill code, title and upload the SOP document."); return;
    }
    setSubmitting(true);
    try {
      await sopsApi.create({
        code: code.trim().toUpperCase(),
        title: title.trim(),
        department,
        description: description.trim(),
        ownerId: ownerId || undefined,
        accessRole,
        tags: tags.split(",").map((t) => t.trim()).filter(Boolean),
        document,
      });
      toast.success("SOP created.");
      onCreated();
    } catch (error) {
      // Show alert dialog for errors
      setErrorMessage(getErrorMessage(error, "Failed to create SOP"));
      setShowErrorDialog(true);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <>
      <DialogScrollContent onInteractOutside={(e) => e.preventDefault()} className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Create New SOP</DialogTitle>
          <DialogDescription>Add a new standard operating procedure with its initial version.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 gap-4">
          <div><Label>Code <Req /></Label><Input value={code} onChange={(e) => setCode(e.target.value)} placeholder="PROD-002" /></div>
          <div>
            <Label>Department <Req /></Label>
            <Select value={department} onValueChange={(v) => setDepartment(v as SopDepartment)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SOP_DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2"><Label>Title <Req /></Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
          <div className="col-span-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
          <div>
            <Label>Owner</Label>
            <Select value={ownerId || "current-admin"} onValueChange={(value) => setOwnerId(value === "current-admin" ? "" : value)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="current-admin">Current admin</SelectItem>
                {owners.map((owner) => <SelectItem key={owner.id} value={owner.id}>{owner.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Access Role</Label>
            <Select value={accessRole} onValueChange={(v) => setAccessRole(v as SopAccessRole)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{SOP_ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="col-span-2"><Label>Tags (comma-separated)</Label><Input value={tags} onChange={(e) => setTags(e.target.value)} placeholder="production, safety" /></div>
          <div className="col-span-2">
            <Label>SOP Document <Req /></Label>
            <Input
              type="file"
              accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
              onChange={(e) => setDocument(e.target.files?.[0] ?? null)}
            />
            {document && <p className="mt-1 text-xs text-muted-foreground">{document.name} · {formatBytes(document.size)}</p>}
          </div>
        </div>
        <DialogFooter><Button onClick={submit} disabled={submitting}>{submitting ? "Creating..." : "Create SOP"}</Button></DialogFooter>
      </DialogScrollContent>

      {/* Error Alert Dialog */}
      <AlertDialog open={showErrorDialog} onOpenChange={setShowErrorDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Error</AlertDialogTitle>
            <AlertDialogDescription>{errorMessage}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogAction>OK</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/* ---------------- Detail dialog ---------------- */
function SopDetailDialog({
  sop, onUpload, onChanged, onDeleted,
}: {
  sop: Sop;
  onUpload: () => void; onChanged: () => void; onDeleted: () => void;
}) {
  const cur = currentVersion(sop);
  const [busyVersionId, setBusyVersionId] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);

  const approve = async (vid: string) => {
    setBusyVersionId(vid);
    try {
      await sopsApi.setVersionStatus(sop.id, vid, "Approved");
      toast.success("SOP version approved.");
      onChanged();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to approve SOP version"));
    } finally {
      setBusyVersionId(null);
    }
  };
  const archive = async (vid: string) => {
    setBusyVersionId(vid);
    try {
      await sopsApi.setVersionStatus(sop.id, vid, "Archived");
      toast.success("SOP version archived.");
      onChanged();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to archive SOP version"));
    } finally {
      setBusyVersionId(null);
    }
  };
  const download = async (v: SopVersion) => {
    if (!v.id) return;
    setBusyVersionId(v.id);
    try {
      await sopsApi.downloadVersion(sop.id, v.id, v.fileName || `${sop.code}-v${v.version}`);
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to download SOP document"));
    } finally {
      setBusyVersionId(null);
    }
  };
  const remove = () => setDeleteOpen(true);

  return (
    <>
    <DialogScrollContent className="max-w-3xl">
      <DialogHeader>
        <div className="flex items-start justify-between gap-3 pr-6">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <Badge variant="outline" className="font-mono">{sop.code}</Badge>
              {cur ? <Badge className={SOP_STATUS_COLOR[cur.status]}>{cur.status}</Badge> : <Badge variant="secondary">No document</Badge>}
              {cur && <Badge variant="secondary">v{cur.version}</Badge>}
            </div>
            <DialogTitle className="text-xl">{sop.title}</DialogTitle>
            <DialogDescription className="mt-1">{sop.department} · Owner: {userLabel(sop.ownerId, sop.ownerName || sop.owner_name)} · Access: {sop.accessRole}</DialogDescription>
          </div>
        </div>
      </DialogHeader>

      <Tabs defaultValue="overview" className="mt-2">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="versions">Versions ({sop.versions?.length ?? 0})</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 pt-4">
          <div>
            <Label className="text-xs text-muted-foreground">Description</Label>
            <p className="text-sm text-foreground mt-1">{sop.description || "—"}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {sop.tags.map((t) => <Badge key={t} variant="outline">#{t}</Badge>)}
          </div>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div><Label className="text-xs text-muted-foreground">Created</Label><p>{formatDate(sop.createdAt)}</p></div>
            <div><Label className="text-xs text-muted-foreground">Last Updated</Label><p>{formatDate(sop.updatedAt)}</p></div>
          </div>
        </TabsContent>

        <TabsContent value="versions" className="space-y-3 pt-4">
          {!sop.versions?.length && (
            <Card className="p-6 text-center text-muted-foreground">
              No SOP document uploaded yet.
            </Card>
          )}
          {[...(sop.versions ?? [])].reverse().map((v) => (
            <Card key={v.id} className={`p-4 ${v.id === sop.currentVersionId ? "border-primary" : ""}`}>
              <div className="flex items-start justify-between gap-3 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold text-foreground">v{v.version}</span>
                    <Badge className={SOP_STATUS_COLOR[v.status]}>{v.status}</Badge>
                    {v.id === sop.currentVersionId && <Badge variant="outline">Current</Badge>}
                  </div>
                  <p className="text-sm text-muted-foreground">{v.changeLog || "—"}</p>
                  <div className="text-xs text-muted-foreground mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
                    <span>{v.fileName} · {formatBytes(v.fileSize)}</span>
                    <span>·</span>
                    <span>Uploaded by {userLabel(v.uploadedBy, v.uploaded_by_name)} on {formatDate(v.uploadedAt)}</span>
                    {v.approvedBy && <><span>·</span><span>Approved by {userLabel(v.approvedBy, v.approved_by_name)}</span></>}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button size="sm" variant="ghost" onClick={() => download(v)} disabled={busyVersionId === v.id} title="Download document">
                    <Download className="h-4 w-4" />
                  </Button>
                  {v.status !== "Approved" && v.status !== "Archived" && (
                    <Button size="sm" variant="ghost" onClick={() => v.id && approve(v.id)} disabled={!v.id || busyVersionId === v.id} title="Approve">
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    </Button>
                  )}
                  {v.status === "Approved" && (
                    <Button size="sm" variant="ghost" onClick={() => v.id && archive(v.id)} disabled={!v.id || busyVersionId === v.id} title="Archive">
                      <XCircle className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          ))}
        </TabsContent>
      </Tabs>

      <DialogFooter className="flex-row justify-between sm:justify-between">
        <Button variant="ghost" size="sm" onClick={remove}><Trash2 className="h-4 w-4" /> Delete SOP</Button>
        <Button onClick={onUpload}><Upload className="h-4 w-4" /> Upload New Version</Button>
      </DialogFooter>
    </DialogScrollContent>

    <ConfirmDeleteDialog
      open={deleteOpen}
      onOpenChange={setDeleteOpen}
      onConfirm={async () => {
        try {
          await sopsApi.remove(sop.id);
          toast.success("SOP deleted.");
          setDeleteOpen(false);
          onDeleted();
        } catch (error) {
          toast.error(getErrorMessage(error, "Failed to delete SOP"));
        }
      }}
      description={`Delete SOP ${sop.code}? This cannot be undone.`}
    />
    </>
  );
}

/* ---------------- New version dialog ---------------- */
function NewVersionDialog({ sop, onDone }: { sop: Sop; onDone: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [changeLog, setChangeLog] = useState("");
  const [major, setMajor] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!file || !changeLog.trim()) { toast.error("Document and change log are required."); return; }
    setSubmitting(true);
    try {
      await sopsApi.addVersion(sop.id, { file, changeLog: changeLog.trim(), major });
      toast.success("SOP version uploaded.");
      onDone();
    } catch (error) {
      toast.error(getErrorMessage(error, "Failed to upload SOP version"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <DialogScrollContent className="max-w-lg">
      <DialogHeader>
        <DialogTitle>Upload New Version — {sop.code}</DialogTitle>
        <DialogDescription>Add a revised version. It will go to Pending Approval.</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>Document <Req /></Label>
          <Input
            type="file"
            accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
          />
          {file && <p className="mt-1 text-xs text-muted-foreground">{file.name} · {formatBytes(file.size)}</p>}
        </div>
        <div><Label>Change Log <Req /></Label><Textarea value={changeLog} onChange={(e) => setChangeLog(e.target.value)} rows={3} placeholder="What changed in this version?" /></div>
        <div className="flex items-center justify-between rounded-md border p-3">
          <div>
            <Label>Major version bump</Label>
            <p className="text-xs text-muted-foreground">Off = minor (1.x), On = major (x.0)</p>
          </div>
          <Switch checked={major} onCheckedChange={setMajor} />
        </div>
      </div>
      <DialogFooter><Button onClick={submit} disabled={submitting}>{submitting ? "Uploading..." : "Upload Version"}</Button></DialogFooter>
    </DialogScrollContent>
  );
}
