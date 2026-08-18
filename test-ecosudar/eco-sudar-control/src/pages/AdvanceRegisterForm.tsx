import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { WalletCards, Loader2 } from "lucide-react";
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
  employeeAdvancesApi,
  employeesApi,
  type Employee,
  type EmployeeAdvance,
  type EmployeeAdvancePayload,
} from "@/lib/api/hr";

const today = () => new Date().toISOString().slice(0, 10);
const currentMonth = () => new Date().toISOString().slice(0, 7);

const empty = (): EmployeeAdvancePayload => ({
  employeeId: "",
  advanceDate: today(),
  payrollMonth: currentMonth(),
  amount: 0,
  notes: "",
});

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

export default function AdvanceRegisterForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();
  const editing = !!id;

  // For edit: advance record passed via navigation state
  const stateAdvance = location.state?.advance as EmployeeAdvance | undefined;

  const [form, setForm] = useState<EmployeeAdvancePayload>(() => {
    if (editing && stateAdvance) {
      return {
        employeeId: stateAdvance.employeeId,
        advanceDate: stateAdvance.advanceDate,
        payrollMonth: stateAdvance.payrollMonth,
        amount: stateAdvance.amount,
        notes: stateAdvance.notes ?? "",
      };
    }
    return empty();
  });
  const [initial, setInitial] = useState(JSON.stringify(form));
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const set = <K extends keyof EmployeeAdvancePayload>(
    k: K,
    v: EmployeeAdvancePayload[K]
  ) => setForm((f) => ({ ...f, [k]: v }));

  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial]);
  useUnsavedChanges(dirty && !saving, "advance-register-form");

  useEffect(() => {
    employeesApi
      .list()
      .then((emps) => {
        setEmployees(emps);
        // For new records: pre-select first active employee
        if (!editing && emps.length > 0) {
          const first = emps.find((e) => e.active)?.id ?? emps[0].id;
          setForm((f) => ({ ...f, employeeId: first }));
          setInitial(JSON.stringify({ ...empty(), employeeId: first }));
        }
      })
      .catch(() => toast.error("Failed to load employees"))
      .finally(() => setLoading(false));
  }, [editing]);

  const submit = async () => {
    if (!form.employeeId) { toast.error("Employee is required"); return; }
    if (!form.advanceDate) { toast.error("Advance date is required"); return; }
    if (!form.payrollMonth) { toast.error("Payroll month is required"); return; }
    if (Number(form.amount) <= 0) {
      toast.error("Advance amount must be greater than zero");
      return;
    }

    setSaving(true);
    try {
      if (editing) {
        await employeeAdvancesApi.update(Number(id), form);
        toast.success("Advance updated");
      } else {
        await employeeAdvancesApi.create(form);
        toast.success("Advance added");
      }
      setInitial(JSON.stringify(form));
      navigate("/advance-register");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title={editing ? "Edit Advance" : "Add Advance"}
      description="Advance amount is deducted when payroll is generated for the selected month."
      icon={<WalletCards className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/advance-register")}
      backLabel="Advance Register"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => navigate("/advance-register")}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || loading}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                Saving…
              </>
            ) : editing ? (
              "Save Changes"
            ) : (
              "Add Advance"
            )}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="max-w-xl space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-9 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="max-w-xl space-y-4">
          <Field label="Employee" req>
            <Select
              value={form.employeeId}
              onValueChange={(v) => set("employeeId", v)}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select employee" />
              </SelectTrigger>
              <SelectContent>
                {employees.map((e) => (
                  <SelectItem key={e.id} value={e.id}>
                    {e.name} ({e.id})
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Advance Date" req>
            <Input
              type="date"
              value={form.advanceDate}
              onChange={(e) => set("advanceDate", e.target.value)}
              className="max-w-[200px]"
            />
          </Field>

          <Field label="Payroll Month" req>
            <Input
              type="month"
              value={form.payrollMonth}
              onChange={(e) => set("payrollMonth", e.target.value)}
              className="max-w-[180px]"
            />
          </Field>

          <Field label="Amount (₹)" req>
            <Input
              type="text"
              inputMode="decimal"
              value={form.amount ? String(form.amount) : ""}
              onChange={(e) => {
                const cleaned = e.target.value
                  .replace(/[^\d.]/g, "")
                  .replace(/^0+(?=\d)/, "");
                set("amount", cleaned === "" ? 0 : Number(cleaned));
              }}
              placeholder="0"
              className="max-w-[200px]"
            />
          </Field>

          <Field label="Notes">
            <Textarea
              value={form.notes ?? ""}
              onChange={(e) => set("notes", e.target.value)}
              rows={3}
              placeholder="Optional reason or note"
            />
          </Field>
        </div>
      )}
    </FormPage>
  );
}
