import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Search, ArrowRight, CheckCircle2, XCircle, Clock, PlayCircle, Trophy, IndianRupee, Calendar, History, Trash2 } from "lucide-react";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogScrollContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { StatCard } from "@/components/StatCard";
import { toast } from "sonner";
import { Req } from "@/components/Req";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { ExportMenu, type ExportColumnDef } from "@/components/ExportMenu";
import {
  workflowsApi, Workflow, WorkflowStage, WORKFLOW_STAGES, WORKFLOW_TYPES, WorkflowType,
  WorkflowPriority, ALLOWED_TRANSITIONS, STAGE_COLOR, PRIORITY_COLOR,
} from "@/lib/api/workflows";
import { employeesApi, Employee } from "@/lib/api/hr";
import { ScrollableX } from "@/components/ui/scrollable-x";

const EXPORT_COLUMNS: ExportColumnDef<Workflow>[] = [
  { header: "ID",          key: "id" },
  { header: "Title",       key: "title" },
  { header: "Type",        key: "type" },
  { header: "Stage",       key: "stage" },
  { header: "Priority",    key: "priority" },
  { header: "Amount",      key: "amount" },
  { header: "Due Date",    key: "dueDate" },
  { header: "Updated",     key: "updatedAt" },
  { header: "Description", key: "description", group: "detail", defaultChecked: false },
];

const STAGE_ICONS: Record<WorkflowStage, typeof Clock> = {
  Pending: Clock, "In Progress": PlayCircle, Approved: CheckCircle2, Completed: Trophy, Rejected: XCircle,
};

const formatDate = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
const formatINR = (n: number | null | undefined) => n ? `₹${n.toLocaleString("en-IN")}` : '—';

export default function Workflows() {
  const [items, setItems] = useState<Workflow[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<WorkflowType | "all">("all");
  const [view, setView] = useState<Workflow | null>(null);
  const [transitionTarget, setTransitionTarget] = useState<{ wf: Workflow; toStage: WorkflowStage } | null>(null);
  const [deleteWorkflow, setDeleteWorkflow] = useState<Workflow | null>(null);

  const navigate = useNavigate();

  const reload = async () => {
    setLoading(true);
    const [w, e] = await Promise.all([workflowsApi.list(), employeesApi.list()]);
    setItems(w); setEmployees(e); setLoading(false);
  };
  useEffect(() => { reload(); }, []);

  const empName = (id: string) => employees.find((e) => e.id === id)?.name ?? id;

  const filtered = useMemo(() => items.filter((wf) => {
    if (typeFilter !== "all" && wf.type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return wf.title.toLowerCase().includes(q) || wf.id.toLowerCase().includes(q) || wf.description.toLowerCase().includes(q);
    }
    return true;
  }), [items, typeFilter, search]);

  const paged = usePagedRows(filtered);

  const grouped = useMemo(() => {
    const map = new Map<WorkflowStage, Workflow[]>();
    WORKFLOW_STAGES.forEach((s) => map.set(s, []));
    filtered.forEach((wf) => map.get(wf.stage)!.push(wf));
    return map;
  }, [filtered]);

  const stats = useMemo(() => ({
    pending: items.filter((i) => i.stage === "Pending").length,
    inProgress: items.filter((i) => i.stage === "In Progress").length,
    approved: items.filter((i) => i.stage === "Approved").length,
    completed: items.filter((i) => i.stage === "Completed").length,
  }), [items]);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Workflow & Traffic Management</h1>
          <p className="text-muted-foreground mt-1">Track requests through the approval pipeline.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu title="Workflows" columns={EXPORT_COLUMNS} rows={filtered} dateField="updatedAt" filename="workflows" />
          <Button onClick={() => navigate("/workflows/new")}><Plus className="h-4 w-4" /> New Request</Button>
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Pending" value={stats.pending.toString()} subtitle="Awaiting review" icon={Clock} />
        <StatCard title="In Progress" value={stats.inProgress.toString()} subtitle="Being processed" icon={PlayCircle} />
        <StatCard title="Approved" value={stats.approved.toString()} subtitle="Ready to close" icon={CheckCircle2} />
        <StatCard title="Completed" value={stats.completed.toString()} subtitle="This period" icon={Trophy} />
      </div>

      <Card className="p-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[200px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search by title or ID..." className="pl-9" />
          </div>
          <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as any)}>
            <SelectTrigger className="w-[220px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              {WORKFLOW_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </Card>

      <Tabs defaultValue="board">
        <TabsList>
          <TabsTrigger value="board">Pipeline</TabsTrigger>
          <TabsTrigger value="list">List</TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="pt-4">
          {loading ? (
            <Card className="p-8 text-center text-muted-foreground">Loading workflows...</Card>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
              {WORKFLOW_STAGES.map((stage) => {
                const list = grouped.get(stage) ?? [];
                const Icon = STAGE_ICONS[stage];
                return (
                  <div key={stage} className="bg-muted/30 rounded-lg p-3 min-h-[200px]">
                    <div className="flex items-center justify-between mb-3">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 text-muted-foreground" />
                        <h3 className="font-semibold text-sm text-foreground">{stage}</h3>
                      </div>
                      <Badge variant="secondary" className="text-xs">{list.length}</Badge>
                    </div>
                    <div className="space-y-2">
                      {list.map((wf) => (
                        <Card key={wf.id} onClick={() => setView(wf)} className="p-3 cursor-pointer hover:shadow-md transition-shadow">
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <span className="font-mono text-xs text-muted-foreground">{wf.id}</span>
                            <Badge className={`${PRIORITY_COLOR[wf.priority]} text-[10px] px-1.5 py-0`}>{wf.priority}</Badge>
                          </div>
                          <p className="text-sm font-medium text-foreground line-clamp-2">{wf.title}</p>
                          <p className="text-xs text-muted-foreground mt-1">{wf.type}</p>
                          <div className="flex items-center justify-between text-xs text-muted-foreground mt-2 pt-2 border-t">
                            <span className="truncate">{empName(wf.requesterId)}</span>
                            {wf.amount !== undefined && <span className="font-medium text-foreground">{formatINR(wf.amount)}</span>}
                          </div>
                        </Card>
                      ))}
                      {list.length === 0 && <p className="text-xs text-muted-foreground text-center py-4">No items</p>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </TabsContent>

        <TabsContent value="list" className="pt-4">
          <Card>
            <ScrollableX>
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">ID</th>
                    <th className="px-4 py-3">Title</th>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Requester</th>
                    <th className="px-4 py-3">Approver</th>
                    <th className="px-4 py-3">Priority</th>
                    <th className="px-4 py-3">Stage</th>
                    <th className="px-4 py-3">Updated</th>
                  </tr>
                </thead>
                <tbody>
                  {paged.rows.map((wf) => (
                    <tr key={wf.id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => setView(wf)}>
                      <td className="px-4 py-3 font-mono text-xs">{wf.id}</td>
                      <td className="px-4 py-3 font-medium">{wf.title}</td>
                      <td className="px-4 py-3 text-muted-foreground">{wf.type}</td>
                      <td className="px-4 py-3">{empName(wf.requesterId)}</td>
                      <td className="px-4 py-3">{empName(wf.approverId)}</td>
                      <td className="px-4 py-3"><Badge className={PRIORITY_COLOR[wf.priority]}>{wf.priority}</Badge></td>
                      <td className="px-4 py-3"><Badge className={STAGE_COLOR[wf.stage]}>{wf.stage}</Badge></td>
                      <td className="px-4 py-3 text-muted-foreground text-xs">{formatDate(wf.updatedAt)}</td>
                    </tr>
                  ))}
                  {filtered.length === 0 && (
                    <tr><td colSpan={8} className="px-4 py-8 text-center text-muted-foreground">No workflows found.</td></tr>
                  )}
                </tbody>
              </table>
            </ScrollableX>
          </Card>
          {!loading && filtered.length > 0 && (
            <Pagination {...paged} onPage={paged.setPage} noun="workflows" />
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={!!view} onOpenChange={(o) => !o && setView(null)}>
        {view && (
          <DetailDialog
            wf={view}
            empName={empName}
            onTransition={(toStage) => setTransitionTarget({ wf: view, toStage })}
            onDelete={() => setDeleteWorkflow(view)}
          />
        )}
      </Dialog>

      <Dialog open={!!transitionTarget} onOpenChange={(o) => !o && setTransitionTarget(null)}>
        {transitionTarget && (
          <TransitionDialog
            wf={transitionTarget.wf}
            toStage={transitionTarget.toStage}
            employees={employees}
            onDone={async () => {
              setTransitionTarget(null);
              const list = await workflowsApi.list();
              setItems(list);
              setView(list.find((w) => w.id === transitionTarget.wf.id) ?? null);
            }}
          />
        )}
      </Dialog>

      <ConfirmDeleteDialog
        open={deleteWorkflow !== null}
        onOpenChange={(v) => { if (!v) setDeleteWorkflow(null); }}
        onConfirm={async () => {
          if (!deleteWorkflow) return;
          await workflowsApi.remove(deleteWorkflow.id);
          toast.success("Workflow deleted.");
          setDeleteWorkflow(null);
          setView(null);
          reload();
        }}
        description="This workflow and all its history will be permanently deleted."
      />
    </div>
  );
}
function CreateDialog({ employees, onCreated }: { employees: Employee[]; onCreated: () => void }) {
  const [title, setTitle] = useState("");
  const [type, setType] = useState<WorkflowType>("Purchase Request");
  const [description, setDescription] = useState("");
  const [requesterId, setRequesterId] = useState(employees[0]?.id ?? "");
  const [approverId, setApproverId] = useState(employees[0]?.id ?? "");
  const [priority, setPriority] = useState<WorkflowPriority>("Medium");
  const [amount, setAmount] = useState("");
  const [dueDate, setDueDate] = useState("");

  const submit = async () => {
    if (!title || !requesterId || !approverId) { toast.error("Title, requester and approver are required."); return; }
    await workflowsApi.create({
      title, type, description, requesterId, approverId, priority,
      amount: amount ? Number(amount) : undefined,
      dueDate: dueDate || undefined,
    });
    toast.success("Workflow submitted.");
    onCreated();
  };

  return (
    <DialogScrollContent onInteractOutside={(e) => e.preventDefault()} className="max-w-2xl">
      <DialogHeader>
        <DialogTitle>New Workflow Request</DialogTitle>
        <DialogDescription>Submit a request into the approval pipeline.</DialogDescription>
      </DialogHeader>
      <div className="grid grid-cols-2 gap-4">
        <div className="col-span-2"><Label>Title <Req /></Label><Input value={title} onChange={(e) => setTitle(e.target.value)} /></div>
        <div>
          <Label>Type</Label>
          <Select value={type} onValueChange={(v) => setType(v as WorkflowType)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{WORKFLOW_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Priority</Label>
          <Select value={priority} onValueChange={(v) => setPriority(v as WorkflowPriority)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {(["Low", "Medium", "High", "Urgent"] as WorkflowPriority[]).map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2"><Label>Description</Label><Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} /></div>
        <div>
          <Label>Requester <Req /></Label>
          <Select value={requesterId} onValueChange={setRequesterId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Approver <Req /></Label>
          <Select value={approverId} onValueChange={setApproverId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div><Label>Amount (₹, optional)</Label><Input type="number" value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
        <div><Label>Due Date</Label><Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></div>
      </div>
      <DialogFooter><Button onClick={submit}>Submit Request</Button></DialogFooter>
    </DialogScrollContent>
  );
}

/* ---------------- Detail dialog ---------------- */
function DetailDialog({
  wf, empName, onTransition, onDelete,
}: {
  wf: Workflow; empName: (id: string) => string;
  onTransition: (toStage: WorkflowStage) => void; onDelete: () => void;
}) {
  const allowed = ALLOWED_TRANSITIONS[wf.stage];

  return (
    <DialogScrollContent className="max-w-2xl">
      <DialogHeader>
        <div className="flex items-center gap-2 mb-1">
          <Badge variant="outline" className="font-mono">{wf.id}</Badge>
          <Badge className={STAGE_COLOR[wf.stage]}>{wf.stage}</Badge>
          <Badge className={PRIORITY_COLOR[wf.priority]}>{wf.priority}</Badge>
        </div>
        <DialogTitle className="text-xl">{wf.title}</DialogTitle>
        <DialogDescription>{wf.type}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4">
        {wf.description && <p className="text-sm text-foreground">{wf.description}</p>}

        <div className="grid grid-cols-2 gap-4 text-sm">
          <div><Label className="text-xs text-muted-foreground">Requester</Label><p>{wf.requester_name || empName(wf.requesterId)}</p></div>
          <div><Label className="text-xs text-muted-foreground">Approver</Label><p>{wf.approver_name || empName(wf.approverId)}</p></div>
          {wf.amount !== undefined && (
            <div><Label className="text-xs text-muted-foreground flex items-center gap-1"><IndianRupee className="h-3 w-3" />Amount</Label><p className="font-semibold">{formatINR(wf.amount)}</p></div>
          )}
          {wf.dueDate && (
            <div><Label className="text-xs text-muted-foreground flex items-center gap-1"><Calendar className="h-3 w-3" />Due Date</Label><p>{wf.dueDate}</p></div>
          )}
        </div>

        <div>
          <h4 className="text-sm font-semibold mb-2 flex items-center gap-2"><History className="h-4 w-4" /> History</h4>
          <div className="space-y-2">
            {wf.history.map((ev) => (
              <div key={ev.id} className="flex gap-3 text-sm border-l-2 border-primary/30 pl-3 py-1">
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    {ev.fromStage && <Badge variant="outline" className="text-[10px]">{ev.fromStage}</Badge>}
                    <ArrowRight className="h-3 w-3 text-muted-foreground" />
                    <Badge className={`${STAGE_COLOR[ev.toStage]} text-[10px]`}>{ev.toStage}</Badge>
                    <span className="text-xs text-muted-foreground">by {empName(ev.actorId)}</span>
                  </div>
                  {ev.note && <p className="text-xs text-muted-foreground mt-1">{ev.note}</p>}
                  <p className="text-[10px] text-muted-foreground mt-0.5">{formatDate(ev.at)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <DialogFooter className="flex-col sm:flex-row sm:justify-between gap-2">
        <Button variant="ghost" size="sm" onClick={onDelete}><Trash2 className="h-4 w-4" /> Delete</Button>
        <div className="flex gap-2 flex-wrap justify-end">
          {allowed.length === 0 ? (
            <span className="text-xs text-muted-foreground self-center">No further transitions</span>
          ) : (
            allowed.map((s) => {
              const variant = s === "Rejected" ? "destructive" : s === "Approved" || s === "Completed" ? "default" : "secondary";
              return <Button key={s} size="sm" variant={variant} onClick={() => onTransition(s)}>Move to {s}</Button>;
            })
          )}
        </div>
      </DialogFooter>
    </DialogScrollContent>
  );
}

/* ---------------- Transition dialog ---------------- */
function TransitionDialog({
  wf, toStage, employees, onDone,
}: { wf: Workflow; toStage: WorkflowStage; employees: Employee[]; onDone: () => void }) {
  const [actorId, setActorId] = useState(wf.approverId);
  const [note, setNote] = useState("");

  const submit = async () => {
    await workflowsApi.transition(wf.id, toStage, actorId, note || undefined);
    toast.success(`Moved to ${toStage}.`);
    onDone();
  };

  return (
    <DialogScrollContent onInteractOutside={(e) => e.preventDefault()}>
      <DialogHeader>
        <DialogTitle>Move to {toStage}</DialogTitle>
        <DialogDescription>{wf.id} — {wf.title}</DialogDescription>
      </DialogHeader>
      <div className="space-y-4">
        <div>
          <Label>Acting as</Label>
          <Select value={actorId} onValueChange={setActorId}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>{employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Note (optional)</Label>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Reason or comment for this transition..." />
        </div>
      </div>
      <DialogFooter><Button onClick={submit}>Confirm</Button></DialogFooter>
    </DialogScrollContent>
  );
}