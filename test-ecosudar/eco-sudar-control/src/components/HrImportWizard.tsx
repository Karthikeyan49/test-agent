/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useMemo, useState } from "react";
import {
  AlertTriangle, ArrowLeft, ArrowRight, CheckCircle2, Download, FileSpreadsheet,
  Loader2, Sparkles, Upload, Users, Fingerprint, ListChecks,
} from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { cn } from "@/lib/utils";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";

export type HrImportKind = "employees" | "attendance" | "tasks";

/** Maps the wizard kind to the DataImportMapper module key (templates + AI map). */
const MODULE_KEY: Record<HrImportKind, string> = { employees: "employees", attendance: "attendance_punches", tasks: "tms_tasks" };

/** Target fields, mirroring the backend schema (DataImportMapper::modules). */
const TARGET_FIELDS: Record<HrImportKind, { name: string; required: boolean; hint: string }[]> = {
  employees: [
    { name: "employee_key", required: true, hint: "EMP-001" },
    { name: "name", required: true, hint: "Employee name" },
    { name: "phone", required: true, hint: "9876543210" },
    { name: "email", required: false, hint: "employee@example.com" },
    { name: "department", required: false, hint: "Production" },
    { name: "designation", required: false, hint: "Operator" },
    { name: "employment_type", required: false, hint: "permanent" },
    { name: "base_salary", required: false, hint: "18000" },
    { name: "joined_at", required: false, hint: "2026-04-01" },
  ],
  attendance: [
    { name: "employee_key", required: true, hint: "EMP-001" },
    { name: "timestamp", required: true, hint: "2026-04-01 09:00:00" },
    { name: "direction", required: false, hint: "in / out" },
    { name: "punch_id", required: false, hint: "DEVICE-0001" },
  ],
  tasks: [
    { name: "employee_key", required: true, hint: "EMP-001" },
    { name: "task_date", required: true, hint: "2026-04-01" },
    { name: "status", required: true, hint: "Yes / No" },
    { name: "task", required: false, hint: "Daily route delivery" },
  ],
};

const TITLES: Record<HrImportKind, { title: string; icon: any; blurb: string }> = {
  employees: {
    title: "Employee Data Upload",
    icon: Users,
    blurb: "Bulk create or update employees from any HR software export. Existing employees are matched by Employee ID and updated — no duplicates.",
  },
  attendance: {
    title: "TMS / Attendance Device Upload",
    icon: Fingerprint,
    blurb: "Upload punch logs from your biometric / time-management device. In–out punches are paired per day and converted into attendance with shift-aware late and overtime.",
  },
  tasks: {
    title: "Task Status (TMS) Upload",
    icon: ListChecks,
    blurb: "Upload each employee's daily task completion. Status Yes = green (done), anything else = red (not done). Re-uploading the same employee, date and task updates the mark — no duplicates.",
  },
};

const IGNORE = "__ignore";

export function HrImportWizard({ kind, open, onClose, onDone }: {
  kind: HrImportKind;
  open: boolean;
  onClose: () => void;
  onDone?: () => void;
}) {
  const [step, setStep] = useState(1);
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ApiRow | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [dryJob, setDryJob] = useState<ApiRow | null>(null);
  const [result, setResult] = useState<ApiRow | null>(null);
  const [busy, setBusy] = useState<"" | "upload" | "ai" | "dry" | "commit">("");

  const meta = TITLES[kind];
  const fields = TARGET_FIELDS[kind];
  const headers: string[] = useMemo(
    () => ((job?.headers as string[]) ?? []).filter(Boolean),
    [job],
  );

  // Reset whenever the dialog (re)opens
  useEffect(() => {
    if (open) { setStep(1); setFile(null); setJob(null); setMapping({}); setDryJob(null); setResult(null); setBusy(""); }
  }, [open, kind]);

  const requiredCovered = useMemo(() => {
    const mappedTargets = new Set(Object.values(mapping));
    return fields.filter((f) => f.required).map((f) => ({ field: f.name, ok: mappedTargets.has(f.name) }));
  }, [mapping, fields]);
  const allRequiredCovered = requiredCovered.every((r) => r.ok);

  const invalidRows: ApiRow[] = useMemo(
    () => ((dryJob?.rows as ApiRow[]) ?? []).filter((r) => r.status === "invalid"),
    [dryJob],
  );

  // ── actions ────────────────────────────────────────────────────────────
  const doUpload = async () => {
    if (!file) return toast.error("Choose a CSV file first");
    setBusy("upload");
    try {
      const created = await phase2Api.hrImport.upload(kind, file);
      setJob(created);
      // Seed mapping: auto-match identical header/field names so trivial files need zero clicks
      const seed: Record<string, string> = {};
      const names = new Set(fields.map((f) => f.name));
      ((created.headers as string[]) ?? []).forEach((h) => {
        const k = String(h).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
        if (names.has(k)) seed[h] = k;
      });
      setMapping(seed);
      setStep(2);
    } catch (e: any) {
      toast.error(e?.message || "Upload failed");
    } finally { setBusy(""); }
  };

  const doAiMap = async () => {
    if (!job?.job_id) return;
    setBusy("ai");
    try {
      const res = await phase2Api.interop.aiMap(MODULE_KEY[kind], Number(job.job_id));
      const ai = (res.mapping ?? {}) as Record<string, string>;
      setMapping((cur) => ({ ...cur, ...ai }));
      const n = Object.keys(ai).length;
      const missing: string[] = (res.unmapped_required ?? []) as string[];
      toast.success(`AI matched ${n} column${n === 1 ? "" : "s"}${missing.length ? ` — still needed: ${missing.join(", ")}` : ""}`);
    } catch (e: any) {
      toast.error(e?.message || "AI mapping unavailable — map manually below");
    } finally { setBusy(""); }
  };

  const doDryRun = async () => {
    if (!job?.job_id) return;
    if (!allRequiredCovered) return toast.error("Map all required fields first");
    setBusy("dry");
    try {
      const res = await phase2Api.hrImport.run(kind, { job_id: job.job_id, mapping });
      setDryJob(res);
      setStep(3);
    } catch (e: any) {
      toast.error(e?.message || "Validation failed");
    } finally { setBusy(""); }
  };

  const doCommit = async () => {
    if (!job?.job_id) return;
    setBusy("commit");
    try {
      const res = await phase2Api.hrImport.run(kind, { job_id: job.job_id, mapping, action: "commit" });
      setResult(res);
      setStep(4);
      onDone?.();
    } catch (e: any) {
      toast.error(e?.message || "Import failed");
    } finally { setBusy(""); }
  };

  const downloadErrors = () => {
    if (job?.job_id) phase2Api.hrImport.errors(kind, Number(job.job_id)).catch((e) => toast.error(e.message));
  };

  const summary = (result?.commit_summary ?? {}) as Record<string, number>;
  const Icon = meta.icon;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && busy === "" && onClose()}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()} className="max-w-3xl max-h-[92vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Icon className="h-5 w-5 text-primary" /> {meta.title}</DialogTitle>
        </DialogHeader>

        {/* Stepper */}
        <div className="flex items-center gap-1 text-xs">
          {["Upload", "Match columns", "Preview", "Done"].map((label, i) => (
            <div key={label} className="flex items-center gap-1">
              {i > 0 && <div className={cn("h-px w-6", step > i ? "bg-primary" : "bg-border")} />}
              <span className={cn(
                "flex h-5 w-5 items-center justify-center rounded-full border text-[10px] font-semibold",
                step > i + 1 ? "border-primary bg-primary text-primary-foreground"
                  : step === i + 1 ? "border-primary text-primary" : "border-border text-muted-foreground")}>
                {step > i + 1 ? "✓" : i + 1}
              </span>
              <span className={cn(step === i + 1 ? "font-medium text-foreground" : "text-muted-foreground")}>{label}</span>
            </div>
          ))}
        </div>

        {/* Step 1 — upload */}
        {step === 1 && (
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{meta.blurb}</p>
            <div className="rounded-lg border border-dashed p-5 text-center space-y-3">
              <FileSpreadsheet className="mx-auto h-8 w-8 text-muted-foreground" />
              <Input type="file" accept=".csv" className="mx-auto max-w-xs" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <p className="text-xs text-muted-foreground">CSV export from any software — columns are matched in the next step, so the format doesn't have to match ours.</p>
            </div>
            <div className="flex flex-wrap gap-1.5 text-[11px]">
              <span className="text-muted-foreground">Fields we can fill:</span>
              {fields.map((f) => (
                <span key={f.name} className={cn("rounded-full px-2 py-0.5", f.required ? "bg-primary/10 text-primary font-medium" : "bg-muted text-muted-foreground")}>
                  {f.name}{f.required ? " *" : ""}
                </span>
              ))}
            </div>
            <div className="flex justify-between">
              <Button variant="outline" className="gap-1.5" onClick={() => phase2Api.interop.template(MODULE_KEY[kind]).catch((e) => toast.error(e.message))}>
                <Download className="h-4 w-4" /> Sample template
              </Button>
              <Button onClick={doUpload} disabled={!file || busy !== ""} className="gap-1.5">
                {busy === "upload" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />} Upload &amp; continue
              </Button>
            </div>
          </div>
        )}

        {/* Step 2 — match columns */}
        {step === 2 && job && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm text-muted-foreground">
                {headers.length} columns found · {Number(job.total_rows ?? 0)} data rows. Match each file column to a field — or let AI do it.
              </p>
              <Button variant="outline" size="sm" onClick={doAiMap} disabled={busy !== ""} className="gap-1.5">
                {busy === "ai" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />} AI Auto-map
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground -mt-2">Privacy: only the column titles are sent to the AI — never your data rows.</p>

            <div className="max-h-72 overflow-y-auto rounded-lg border divide-y">
              {headers.map((h) => (
                <div key={h} className="flex items-center gap-3 px-3 py-2">
                  <span className="min-w-0 flex-1 truncate text-sm font-medium" title={h}>{h}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <Select value={mapping[h] ?? IGNORE} onValueChange={(v) => setMapping((m) => {
                    const next = { ...m };
                    if (v === IGNORE) delete next[h]; else next[h] = v;
                    return next;
                  })}>
                    <SelectTrigger className="h-8 w-56 shrink-0"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value={IGNORE}>— ignore —</SelectItem>
                      {fields.map((f) => (
                        <SelectItem key={f.name} value={f.name}>{f.name}{f.required ? " *" : ""} <span className="text-muted-foreground">({f.hint})</span></SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              ))}
            </div>

            <div className="flex flex-wrap gap-1.5 text-[11px]">
              {requiredCovered.map((r) => (
                <span key={r.field} className={cn("flex items-center gap-1 rounded-full px-2 py-0.5",
                  r.ok ? "bg-emerald-100 text-emerald-700" : "bg-red-100 text-red-700")}>
                  {r.ok ? <CheckCircle2 className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />}{r.field}
                </span>
              ))}
            </div>

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Back</Button>
              <Button onClick={doDryRun} disabled={!allRequiredCovered || busy !== ""} className="gap-1.5">
                {busy === "dry" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />} Validate
              </Button>
            </div>
          </div>
        )}

        {/* Step 3 — preview */}
        {step === 3 && dryJob && (
          <div className="space-y-4">
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg border p-3"><p className="text-2xl font-bold">{Number(dryJob.total_rows ?? 0)}</p><p className="text-xs text-muted-foreground">rows in file</p></div>
              <div className="rounded-lg border p-3"><p className="text-2xl font-bold text-emerald-600">{Number(dryJob.valid_rows ?? 0)}</p><p className="text-xs text-muted-foreground">will import</p></div>
              <div className="rounded-lg border p-3"><p className={cn("text-2xl font-bold", Number(dryJob.error_rows ?? 0) ? "text-red-600" : "")}>{Number(dryJob.error_rows ?? 0)}</p><p className="text-xs text-muted-foreground">skipped (errors)</p></div>
            </div>

            {invalidRows.length > 0 && (
              <div className="rounded-lg border">
                <div className="flex items-center justify-between border-b px-3 py-2">
                  <p className="text-xs font-medium text-red-600">Rows with problems (will be skipped)</p>
                  <Button size="sm" variant="ghost" className="h-7 gap-1 text-xs" onClick={downloadErrors}><Download className="h-3.5 w-3.5" /> Error report</Button>
                </div>
                <ScrollableX>
                  <div className="max-h-44 overflow-y-auto">
                    <table className="w-full min-w-[480px] text-xs">
                      <tbody>
                        {invalidRows.slice(0, 50).map((r) => (
                          <tr key={r.row_id} className="border-t">
                            <td className="px-3 py-1.5 font-mono text-muted-foreground">row {r.row_number}</td>
                            <td className="px-3 py-1.5 text-red-600">{r.error_text}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </ScrollableX>
              </div>
            )}

            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)} className="gap-1.5"><ArrowLeft className="h-4 w-4" /> Fix mapping</Button>
              <Button onClick={doCommit} disabled={Number(dryJob.valid_rows ?? 0) === 0 || busy !== ""} className="gap-1.5">
                {busy === "commit" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />}
                Import {Number(dryJob.valid_rows ?? 0)} row{Number(dryJob.valid_rows ?? 0) === 1 ? "" : "s"}
              </Button>
            </div>
          </div>
        )}

        {/* Step 4 — done */}
        {step === 4 && result && (
          <div className="space-y-4 py-2 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
            <p className="font-semibold">Import complete</p>
            <div className="mx-auto flex max-w-sm flex-wrap justify-center gap-2">
              {Object.entries(summary).map(([k, v]) => (
                <Badge key={k} variant="outline" className="px-3 py-1 text-sm font-normal">
                  <span className="font-semibold mr-1">{v}</span>{k.replace(/_/g, " ")}
                </Badge>
              ))}
            </div>
            {Number(result.error_rows ?? 0) > 0 && (
              <Button variant="ghost" size="sm" className="gap-1 text-xs" onClick={downloadErrors}>
                <Download className="h-3.5 w-3.5" /> Download report of {Number(result.error_rows)} skipped rows
              </Button>
            )}
            <div><Button onClick={onClose}>Close</Button></div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
