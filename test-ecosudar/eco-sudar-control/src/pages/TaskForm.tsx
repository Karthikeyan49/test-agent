import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ListTodo, Loader2, X } from "lucide-react";
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
  tasksApi, TASK_STATUSES, TASK_PRIORITIES,
  type Task, type TaskStatus, type TaskPriority,
} from "@/lib/api/tasks";
import { employeesApi, type Employee } from "@/lib/api/hr";
import { useAuth } from "@/contexts/AuthContext";

const plus = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

type FormState = Omit<Task, "id" | "createdAt" | "completedAt">;

const emptyForm = (): FormState => ({
  title: "", description: "", assigneeId: "", assignedBy: "",
  priority: "Medium", status: "Pending", dueDate: plus(3), tags: [],
});

function Field({ label, children, req }: { label: React.ReactNode; children: React.ReactNode; req?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-sm text-muted-foreground">{label} {req && <Req />}</Label>
      <div>{children}</div>
    </div>
  );
}

export default function TaskForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const { adminEmail } = useAuth();
  const editing = !!id;

  const [form, setForm] = useState<FormState>(emptyForm());
  const [initial, setInitial] = useState(JSON.stringify(emptyForm()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);
  const [tagInput, setTagInput] = useState("");

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        if (editing && id) {
          const [tasks, emps] = await Promise.all([tasksApi.list(), employeesApi.list()]);
          setEmployees(emps);
          const task = tasks.find((t) => t.id === id);
          if (!task) { toast.error("Task not found"); navigate("/tasks"); return; }
          const { id: _id, createdAt: _c, completedAt: _ca, ...rest } = task;
          setForm(rest);
          setInitial(JSON.stringify(rest));
        } else {
          const emps = await employeesApi.list();
          setEmployees(emps);
          const next: FormState = { ...emptyForm(), assigneeId: emps[0]?.id ?? "", assignedBy: adminEmail };
          setForm(next);
          setInitial(JSON.stringify(next));
        }
      } catch (e: any) {
        toast.error(e.message ?? "Failed to load");
      } finally {
        setLoading(false);
      }
    };
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, editing]);

  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial]);
  useUnsavedChanges(dirty && !saving, "task-form");

  const addTag = () => {
    const tg = tagInput.trim();
    if (!tg || form.tags.includes(tg)) return;
    set("tags", [...form.tags, tg]);
    setTagInput("");
  };

  const submit = async () => {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    if (!form.assigneeId) { toast.error("Please assign to an employee"); return; }
    setSaving(true);
    try {
      if (editing && id) {
        await tasksApi.update(id, form);
        toast.success("Task updated");
      } else {
        await tasksApi.create(form);
        toast.success("Task created");
      }
      setInitial(JSON.stringify(form));
      navigate("/tasks");
    } catch (e: any) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title={editing ? `Edit ${id}` : "New Task"}
      description="Assign work to an employee with a due date and priority."
      icon={<ListTodo className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/tasks")}
      backLabel="Tasks"
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/tasks")} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || loading}>
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Saving…</>
              : editing ? "Save Task" : "Create Task"}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <div className="max-w-2xl space-y-8">

          {/* Task Details */}
          <section className="space-y-3">
            <h3 className="text-sm font-semibold text-foreground">Task Details</h3>
            <Field label="Title" req>
              <Input
                value={form.title}
                onChange={(e) => set("title", e.target.value)}
                placeholder="Describe the task"
              />
            </Field>
            <Field label="Description">
              <Textarea
                rows={3}
                value={form.description}
                onChange={(e) => set("description", e.target.value)}
                placeholder="Additional context or instructions"
              />
            </Field>
            <Field label="Priority" req>
              <Select value={form.priority} onValueChange={(v) => set("priority", v as TaskPriority)}>
                <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Status">
              <Select value={form.status} onValueChange={(v) => set("status", v as TaskStatus)}>
                <SelectTrigger className="max-w-[200px]"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Due Date" req>
              <Input
                type="date"
                value={form.dueDate}
                onChange={(e) => set("dueDate", e.target.value)}
                className="max-w-[200px]"
              />
            </Field>
            <Field label="Tags">
              <div className="space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={tagInput}
                    onChange={(e) => setTagInput(e.target.value)}
                    placeholder="e.g. QC, Daily, Dispatch"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addTag(); } }}
                    className="max-w-[280px]"
                  />
                  <Button type="button" variant="outline" onClick={addTag}>Add</Button>
                </div>
                {form.tags.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {form.tags.map((tg) => (
                      <span key={tg} className="text-xs px-2 py-1 rounded bg-secondary text-secondary-foreground inline-flex items-center gap-1">
                        {tg}
                        <button
                          type="button"
                          onClick={() => set("tags", form.tags.filter((x) => x !== tg))}
                          className="hover:text-destructive"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </Field>
          </section>

          {/* Assignment */}
          <section className="space-y-3 border-t pt-5">
            <h3 className="text-sm font-semibold text-foreground">Assignment</h3>
            <Field label="Assignee" req>
              <Select value={form.assigneeId} onValueChange={(v) => set("assigneeId", v)}>
                <SelectTrigger className="max-w-[260px]"><SelectValue placeholder="Pick employee" /></SelectTrigger>
                <SelectContent>
                  {employees.map((e) => <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Assigned By">
              <Input
                value={form.assignedBy}
                onChange={(e) => set("assignedBy", e.target.value)}
                className="max-w-[260px]"
                placeholder="Admin"
              />
            </Field>
          </section>

        </div>
      )}
    </FormPage>
  );
}
