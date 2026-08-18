import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { GitBranch, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import {
  workflowsApi,
  WORKFLOW_TYPES,
  type WorkflowType,
  type WorkflowPriority,
} from "@/lib/api/workflows";
import { employeesApi, type Employee } from "@/lib/api/hr";

const PRIORITIES: WorkflowPriority[] = ["Low", "Medium", "High", "Urgent"];

function Field({
  label,
  children,
  req,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  req?: boolean;
}) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-sm text-muted-foreground">
        {label} {req && <Req />}
      </Label>
      <div>{children}</div>
    </div>
  );
}

const empty = () => ({
  title: "",
  type: "Purchase Request" as WorkflowType,
  priority: "Medium" as WorkflowPriority,
  description: "",
  requesterId: "",
  approverId: "",
  amount: "",
  dueDate: "",
});
type Form = ReturnType<typeof empty>;

export default function WorkflowForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = !!id;

  const [form, setForm] = useState<Form>(empty());
  const [initial, setInitial] = useState(JSON.stringify(empty()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial]);
  useUnsavedChanges(dirty && !saving, "workflow-form");

  useEffect(() => {
    const loadData = async () => {
      try {
        const emps = await employeesApi.list();
        setEmployees(emps);

        if (editing) {
          const wf = await workflowsApi.getById(id);
          const next: Form = {
            title: wf.title ?? "",
            type: (wf.type ?? "Purchase Request") as WorkflowType,
            priority: (wf.priority ?? "Medium") as WorkflowPriority,
            description: wf.description ?? "",
            requesterId: wf.requesterId ?? wf.requester_id?.toString() ?? "",
            approverId: wf.approverId ?? wf.approver_id?.toString() ?? "",
            amount: wf.amount != null ? String(wf.amount) : "",
            dueDate: wf.dueDate ?? wf.due_date ?? "",
          };
          setForm(next);
          setInitial(JSON.stringify(next));
        } else {
          // Pre-select first employee for both fields
          const first = emps[0]?.id ?? "";
          const defaults: Form = { ...empty(), requesterId: first, approverId: first };
          setForm(defaults);
          setInitial(JSON.stringify(defaults));
        }
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Failed to load data");
      } finally {
        setLoading(false);
      }
    };
    void loadData();
  }, [id, editing]);

  const submit = async () => {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    if (!form.requesterId) { toast.error("Requester is required"); return; }
    if (!form.approverId) { toast.error("Approver is required"); return; }

    setSaving(true);
    try {
      await workflowsApi.create({
        title: form.title.trim(),
        type: form.type,
        priority: form.priority,
        description: form.description.trim(),
        requesterId: form.requesterId,
        approverId: form.approverId,
        amount: form.amount ? Number(form.amount) : undefined,
        dueDate: form.dueDate || undefined,
      });
      toast.success("Workflow submitted");
      setInitial(JSON.stringify(form));
      navigate("/workflows");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title={editing ? "View Workflow" : "New Workflow Request"}
      description="Submit a request into the approval pipeline."
      icon={<GitBranch className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/workflows")}
      backLabel="Workflows"
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/workflows")} disabled={saving}>
            Cancel
          </Button>
          {!editing && (
            <Button onClick={submit} disabled={saving || loading}>
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-1" />
                  Submitting…
                </>
              ) : (
                "Submit Request"
              )}
            </Button>
          )}
        </>
      }
    >
      {loading ? (
        <div className="max-w-2xl space-y-4">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="h-9 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="max-w-2xl space-y-4">
          {editing && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-700">
              Workflows cannot be edited after creation. Use the pipeline view to move this
              request forward.
            </div>
          )}

          <Field label="Title" req>
            <Input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
              disabled={editing}
            />
          </Field>

          <Field label="Type">
            <Select
              value={form.type}
              onValueChange={(v) => set("type", v as WorkflowType)}
              disabled={editing}
            >
              <SelectTrigger className="max-w-[280px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WORKFLOW_TYPES.map((t) => (
                  <SelectItem key={t} value={t}>
                    {t}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Priority">
            <Select
              value={form.priority}
              onValueChange={(v) => set("priority", v as WorkflowPriority)}
              disabled={editing}
            >
              <SelectTrigger className="max-w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITIES.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
              disabled={editing}
            />
          </Field>

          <Field label="Requester" req>
            <Select
              value={form.requesterId}
              onValueChange={(v) => set("requesterId", v)}
              disabled={editing}
            >
              <SelectTrigger className="max-w-[280px]">
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Approver" req>
            <Select
              value={form.approverId}
              onValueChange={(v) => set("approverId", v)}
              disabled={editing}
            >
              <SelectTrigger className="max-w-[280px]">
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Amount (₹)">
            <Input
              type="number"
              value={form.amount}
              onChange={(e) => set("amount", e.target.value)}
              placeholder="Optional"
              className="max-w-[200px]"
              disabled={editing}
            />
          </Field>

          <Field label="Due Date">
            <Input
              type="date"
              value={form.dueDate}
              onChange={(e) => set("dueDate", e.target.value)}
              className="max-w-[200px]"
              disabled={editing}
            />
          </Field>
        </div>
      )}
    </FormPage>
  );
}
