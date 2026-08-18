import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Calculator, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { payrollApi, workingDaysInMonth } from "@/lib/api/hr";

const currentMonth = () => new Date().toISOString().slice(0, 7);

function Field({
  label,
  hint,
  children,
}: {
  label: React.ReactNode;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <div className="pt-2">
        <Label className="text-sm text-muted-foreground">{label}</Label>
        {hint && <p className="text-xs text-muted-foreground mt-0.5">{hint}</p>}
      </div>
      <div>{children}</div>
    </div>
  );
}

export default function PayrollForm() {
  const navigate = useNavigate();

  const [month, setMonth] = useState(currentMonth());
  const [workingDays, setWorkingDays] = useState(() =>
    workingDaysInMonth(currentMonth())
  );
  const [saving, setSaving] = useState(false);

  const handleMonthChange = (m: string) => {
    setMonth(m);
    setWorkingDays(workingDaysInMonth(m));
  };

  const submit = async () => {
    if (!month) { toast.error("Month is required"); return; }
    if (workingDays < 1 || workingDays > 31) {
      toast.error("Working days must be between 1 and 31");
      return;
    }
    setSaving(true);
    try {
      await payrollApi.run(month, workingDays, {}, {});
      toast.success(`Payroll computed for ${month}`);
      navigate("/payroll");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to run payroll");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title="Run Payroll"
      description="Compute salary for all active employees for the selected month."
      icon={<Calculator className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/payroll")}
      backLabel="Payroll"
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/payroll")} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                Computing…
              </>
            ) : (
              "Compute Payroll"
            )}
          </Button>
        </>
      }
    >
      <div className="max-w-xl space-y-5">
        <div className="rounded-lg border bg-muted/30 p-4 text-sm text-muted-foreground space-y-1">
          <p>
            This will compute gross pay, leave deductions and net salaries from
            attendance data for the chosen month.
          </p>
          <p>
            You can adjust overtime hours and leave credits for individual
            employees on the Payroll list page after running.
          </p>
        </div>

        <Field label="Month" hint="YYYY-MM">
          <Input
            type="month"
            value={month}
            onChange={(e) => handleMonthChange(e.target.value)}
            className="max-w-[180px]"
          />
        </Field>

        <Field
          label="Working Days"
          hint="Business days in this month"
        >
          <Input
            type="number"
            min={1}
            max={31}
            value={String(workingDays)}
            onChange={(e) => {
              const raw = e.target.value.replace(/^0+(?=\d)/, "");
              setWorkingDays(Math.max(1, Math.min(31, parseInt(raw) || 1)));
            }}
            className="w-20 text-center"
          />
        </Field>
      </div>
    </FormPage>
  );
}
