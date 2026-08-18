import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { CalendarClock, Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import {
  meetingsApi, RACI_ROLES, RACI_LABELS,
  type Meeting, type ActionItem, type ActionStatus, type RaciRole,
} from "@/lib/api/meetings";
import { employeesApi, type Employee } from "@/lib/api/hr";

const todayStr = () => new Date().toISOString().slice(0, 10);
const newRaciRow = () => ({ id: crypto.randomUUID(), deliverable: "", assignments: {} as Record<string, RaciRole> });
const newAction = (): ActionItem => ({
  id: crypto.randomUUID(), description: "", ownerId: "", dueDate: todayStr(), status: "Open",
});

type FormState = {
  title: string;
  date: string;
  time: string;
  location: string;
  agenda: string;
  notes: string;
  attendees: string[];
  raci: { id: string; deliverable: string; assignments: Record<string, RaciRole> }[];
  actionItems: ActionItem[];
};

const emptyForm = (): FormState => ({
  title: "", date: todayStr(), time: "10:00", location: "", agenda: "", notes: "",
  attendees: [], raci: [newRaciRow()], actionItems: [],
});

function Field({ label, children, req }: { label: React.ReactNode; children: React.ReactNode; req?: boolean }) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-sm text-muted-foreground">{label} {req && <Req />}</Label>
      <div>{children}</div>
    </div>
  );
}

export default function MeetingForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = !!id;

  const [form, setForm] = useState<FormState>(emptyForm());
  const [initial, setInitial] = useState(JSON.stringify(emptyForm()));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const set = <K extends keyof FormState>(k: K, v: FormState[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const empMap = useMemo(
    () => Object.fromEntries(employees.map((e) => [e.id, e])),
    [employees],
  );

  useEffect(() => {
    const loadData = async () => {
      setLoading(true);
      try {
        if (editing && id) {
          const [meeting, emps] = await Promise.all([meetingsApi.getById(id), employeesApi.list()]);
          setEmployees(emps);
          const next: FormState = {
            title: meeting.title,
            date: meeting.date,
            time: meeting.time,
            location: meeting.location ?? "",
            agenda: meeting.agenda ?? "",
            notes: meeting.notes ?? "",
            attendees: meeting.attendees ?? [],
            raci: meeting.raci ?? [],
            actionItems: meeting.actionItems ?? [],
          };
          setForm(next);
          setInitial(JSON.stringify(next));
        } else {
          const emps = await employeesApi.list();
          setEmployees(emps);
          const next = emptyForm();
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
  useUnsavedChanges(dirty && !saving, "meeting-form");

  const toggleAttendee = (empId: string) => setForm((f) => ({
    ...f,
    attendees: f.attendees.includes(empId)
      ? f.attendees.filter((x) => x !== empId)
      : [...f.attendees, empId],
  }));

  const setRaci = (rowId: string, empId: string, role: RaciRole) => setForm((f) => ({
    ...f,
    raci: f.raci.map((r) => r.id === rowId
      ? { ...r, assignments: { ...r.assignments, [empId]: role } }
      : r),
  }));

  const updateActionItem = <K extends keyof ActionItem>(aid: string, k: K, v: ActionItem[K]) => {
    setForm((f) => ({
      ...f,
      actionItems: f.actionItems.map((a) => a.id === aid ? { ...a, [k]: v } : a),
    }));
  };

  const submit = async () => {
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    if (form.attendees.length === 0) { toast.error("Add at least one attendee"); return; }
    setSaving(true);
    try {
      // Send both key names so PHP backend receives action items regardless of case convention
      const payload = {
        title: form.title,
        date: form.date,
        time: form.time,
        location: form.location,
        agenda: form.agenda,
        notes: form.notes,
        attendees: form.attendees,
        raci: form.raci,
        actionItems: form.actionItems,
        action_items: form.actionItems,
      };
      if (editing && id) {
        await meetingsApi.update(id, payload as Partial<Meeting>);
        toast.success("Meeting updated");
      } else {
        await meetingsApi.create(form as Omit<Meeting, "id" | "meeting_id" | "createdAt" | "created_at">);
        toast.success("Meeting created");
      }
      setInitial(JSON.stringify(form));
      navigate("/meetings");
    } catch (e: any) {
      toast.error(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title={editing ? `Edit Meeting` : "New Meeting"}
      description="Schedule, log notes, assign RACI roles and capture action items."
      icon={<CalendarClock className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/meetings")}
      backLabel="Meetings"
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/meetings")} disabled={saving}>Cancel</Button>
          <Button onClick={submit} disabled={saving || loading}>
            {saving
              ? <><Loader2 className="h-4 w-4 animate-spin mr-1" />Saving…</>
              : editing ? "Save Meeting" : "Create Meeting"}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <Tabs defaultValue="details" className="w-full">
          <TabsList>
            <TabsTrigger value="details">Details</TabsTrigger>
            <TabsTrigger value="attendees">
              Attendees {form.attendees.length > 0 && <span className="ml-1 text-xs opacity-70">({form.attendees.length})</span>}
            </TabsTrigger>
            <TabsTrigger value="raci">RACI Matrix</TabsTrigger>
            <TabsTrigger value="actions">
              Action Items {form.actionItems.length > 0 && <span className="ml-1 text-xs opacity-70">({form.actionItems.length})</span>}
            </TabsTrigger>
          </TabsList>

          {/* ── Details ── */}
          <TabsContent value="details" className="pt-4">
            <section className="max-w-2xl space-y-3">
              <Field label="Title" req>
                <Input
                  value={form.title}
                  onChange={(e) => set("title", e.target.value)}
                  placeholder="Meeting title"
                />
              </Field>
              <Field label="Date">
                <Input
                  type="date"
                  value={form.date}
                  onChange={(e) => set("date", e.target.value)}
                  className="max-w-[200px]"
                />
              </Field>
              <Field label="Time">
                <Input
                  type="time"
                  value={form.time}
                  onChange={(e) => set("time", e.target.value)}
                  className="max-w-[160px]"
                />
              </Field>
              <Field label="Location">
                <Input
                  value={form.location}
                  onChange={(e) => set("location", e.target.value)}
                  placeholder="Conference room, Zoom link…"
                />
              </Field>
              <Field label="Agenda">
                <Textarea
                  rows={3}
                  value={form.agenda}
                  onChange={(e) => set("agenda", e.target.value)}
                  placeholder="Topics to discuss"
                />
              </Field>
              <Field label="Notes / Minutes">
                <Textarea
                  rows={4}
                  value={form.notes}
                  onChange={(e) => set("notes", e.target.value)}
                  placeholder="Decisions made, key points…"
                />
              </Field>
            </section>
          </TabsContent>

          {/* ── Attendees ── */}
          <TabsContent value="attendees" className="pt-4">
            <section className="space-y-4">
              <p className="text-sm text-muted-foreground">Click to add or remove employees from this meeting.</p>
              <div className="flex flex-wrap gap-2">
                {employees.map((e) => {
                  const sel = form.attendees.includes(e.id);
                  return (
                    <button
                      key={e.id} type="button" onClick={() => toggleAttendee(e.id)}
                      className={`text-sm px-4 py-2 rounded-full border transition-colors ${
                        sel
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-card hover:bg-muted text-muted-foreground border-border"
                      }`}
                    >
                      {e.name}
                    </button>
                  );
                })}
              </div>
              {form.attendees.length === 0 && (
                <p className="text-sm text-destructive">At least one attendee is required to save.</p>
              )}
            </section>
          </TabsContent>

          {/* ── RACI Matrix ── */}
          <TabsContent value="raci" className="pt-4">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Assign responsibility per deliverable for each attendee.</p>
                <Button
                  type="button" size="sm" variant="outline"
                  onClick={() => set("raci", [...form.raci, newRaciRow()])}
                >
                  <Plus className="h-4 w-4" /> Add Deliverable
                </Button>
              </div>

              {form.attendees.length === 0 ? (
                <p className="text-sm text-muted-foreground">Pick attendees first to assign RACI roles.</p>
              ) : (
                <>
                  <ScrollableX className="rounded-lg border">
                    <table className="w-full text-xs">
                      <thead className="bg-muted/50 text-muted-foreground">
                        <tr>
                          <th className="text-left px-3 py-2 font-medium min-w-[200px]">Deliverable</th>
                          {form.attendees.map((empId) => (
                            <th key={empId} className="px-2 py-2 font-medium text-center min-w-[110px]">
                              {empMap[empId]?.name.split(" ")[0] ?? empId}
                            </th>
                          ))}
                          <th className="w-10" />
                        </tr>
                      </thead>
                      <tbody>
                        {form.raci.map((r) => (
                          <tr key={r.id} className="border-t">
                            <td className="px-2 py-1">
                              <Input
                                value={r.deliverable}
                                onChange={(e) =>
                                  set("raci", form.raci.map((x) => x.id === r.id ? { ...x, deliverable: e.target.value } : x))
                                }
                                placeholder="e.g. Weekly QC report"
                              />
                            </td>
                            {form.attendees.map((empId) => (
                              <td key={empId} className="px-1 py-1">
                                <Select
                                  value={r.assignments[empId] ?? "-"}
                                  onValueChange={(v) => setRaci(r.id, empId, v as RaciRole)}
                                >
                                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    {RACI_ROLES.map((role) => (
                                      <SelectItem key={role} value={role}>
                                        {role === "-" ? "—" : `${role} · ${RACI_LABELS[role].label}`}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </td>
                            ))}
                            <td className="px-1">
                              <Button
                                size="icon" variant="ghost"
                                onClick={() => set("raci", form.raci.filter((x) => x.id !== r.id))}
                              >
                                <X className="h-4 w-4 text-destructive" />
                              </Button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </ScrollableX>
                  <div className="flex flex-wrap gap-3 text-[11px] text-muted-foreground">
                    {RACI_ROLES.filter((r) => r !== "-").map((r) => (
                      <div key={r} className="flex items-center gap-1">
                        <span className={`w-4 h-4 rounded-full text-[10px] font-bold flex items-center justify-center ${RACI_LABELS[r].color}`}>{r}</span>
                        {RACI_LABELS[r].label}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </section>
          </TabsContent>

          {/* ── Action Items ── */}
          <TabsContent value="actions" className="pt-4">
            <section className="space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-sm text-muted-foreground">Track follow-up actions with owners and deadlines.</p>
                <Button
                  size="sm" variant="outline"
                  onClick={() => set("actionItems", [...form.actionItems, newAction()])}
                >
                  <Plus className="h-4 w-4" /> Add Action
                </Button>
              </div>

              {form.actionItems.length === 0 ? (
                <p className="text-sm text-muted-foreground">No action items yet.</p>
              ) : (
                <div className="rounded-lg border overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2">Description</th>
                        <th className="text-left px-3 py-2 w-44">Owner</th>
                        <th className="text-left px-3 py-2 w-36">Due Date</th>
                        <th className="text-left px-3 py-2 w-36">Status</th>
                        <th className="w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {form.actionItems.map((a) => (
                        <tr key={a.id} className="border-t">
                          <td className="px-2 py-1">
                            <Input
                              value={a.description}
                              onChange={(e) => updateActionItem(a.id, "description", e.target.value)}
                              placeholder="What needs to be done?"
                            />
                          </td>
                          <td className="px-2 py-1">
                            <Select
                              value={a.ownerId}
                              onValueChange={(v) => updateActionItem(a.id, "ownerId", v)}
                            >
                              <SelectTrigger className="h-9"><SelectValue placeholder="Owner" /></SelectTrigger>
                              <SelectContent>
                                {employees.map((e) => (
                                  <SelectItem key={e.id} value={e.id}>{e.name}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-2 py-1">
                            <Input
                              type="date"
                              value={a.dueDate}
                              onChange={(e) => updateActionItem(a.id, "dueDate", e.target.value)}
                            />
                          </td>
                          <td className="px-2 py-1">
                            <Select
                              value={a.status}
                              onValueChange={(v) => updateActionItem(a.id, "status", v as ActionStatus)}
                            >
                              <SelectTrigger className="h-9"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {(["Open", "In Progress", "Done"] as ActionStatus[]).map((s) => (
                                  <SelectItem key={s} value={s}>{s}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </td>
                          <td className="px-1">
                            <Button
                              size="icon" variant="ghost"
                              onClick={() => set("actionItems", form.actionItems.filter((x) => x.id !== a.id))}
                            >
                              <X className="h-4 w-4 text-destructive" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </TabsContent>
        </Tabs>
      )}
    </FormPage>
  );
}
