import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Archive, DatabaseBackup, Download, FileSpreadsheet, PlayCircle, RefreshCw, Save, Sparkles, Upload } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { StatCard } from "@/components/StatCard";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";

const today = () => new Date().toISOString().slice(0, 10);
const minus = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

function Field({ label, children }: { label: string; children: ReactNode }) {
  return <div className="space-y-1"><Label className="text-xs">{label}</Label>{children}</div>;
}

function DataTable({ columns, rows, empty = "No records found." }: { columns: string[]; rows: ReactNode[][]; empty?: string }) {
  return (
    <div className="rounded-xl border bg-card shadow-sm overflow-hidden">
      <ScrollableX>
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-muted-foreground"><tr>{columns.map((c) => <th key={c} className="px-4 py-3 text-left font-medium whitespace-nowrap">{c}</th>)}</tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={columns.length} className="px-4 py-10 text-center text-muted-foreground">{empty}</td></tr>}
            {rows.map((row, i) => <tr key={i} className="border-t hover:bg-muted/30">{row.map((cell, j) => <td key={j} className="px-4 py-3 align-top whitespace-nowrap">{cell}</td>)}</tr>)}
          </tbody>
        </table>
      </ScrollableX>
    </div>
  );
}

export default function DataInterop() {
  const [modulesData, setModulesData] = useState<ApiRow | null>(null);
  const [jobsData, setJobsData] = useState<ApiRow[]>([]);
  const [backupData, setBackupData] = useState<ApiRow | null>(null);
  const [jobDetailData, setJobDetailData] = useState<ApiRow | null>(null);
  const [runBusy, setRunBusy] = useState(false);
  const [module, setModule] = useState("");
  const [exportModule, setExportModule] = useState("");
  const [from, setFrom] = useState(minus(30));
  const [to, setTo] = useState(today());
  const [file, setFile] = useState<File | null>(null);
  const [job, setJob] = useState<ApiRow | null>(null);
  const [mapping, setMapping] = useState("{}");
  const [dryRun, setDryRun] = useState<ApiRow | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const loadModules = useCallback(async () => {
    try { setModulesData(await phase2Api.interop.modules()); } catch { /* ignore */ }
  }, []);
  const loadJobs = useCallback(async () => {
    try { setJobsData(await phase2Api.interop.jobs()); } catch { /* ignore */ }
  }, []);
  const loadBackup = useCallback(async () => {
    try { setBackupData(await phase2Api.interop.backupStatus()); } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadModules(); loadJobs(); loadBackup(); }, [loadModules, loadJobs, loadBackup]);

  useEffect(() => {
    if (!job?.job_id) { setJobDetailData(null); return; }
    phase2Api.interop.job(job.job_id, true).then(setJobDetailData).catch(() => {});
  }, [job?.job_id]);

  const aiAutoMap = async () => {
    if (!module) return toast.error("Select a module first");
    if (!job?.job_id) return toast.error("Upload a file first");
    setAiBusy(true);
    try {
      const res = await phase2Api.interop.aiMap(module, job.job_id);
      setMapping(JSON.stringify(res.mapping ?? {}, null, 2));
      const mapped = Object.keys(res.mapping ?? {}).length;
      const missing: string[] = (res.unmapped_required ?? []) as string[];
      toast.success(`AI matched ${mapped} column${mapped === 1 ? "" : "s"}${missing.length ? ` · please set: ${missing.join(", ")}` : " — review & dry-run"}`);
    } catch (e: any) {
      toast.error(e?.message || "AI mapping failed");
    } finally {
      setAiBusy(false);
    }
  };

  const doRun = async (action: string, payload?: any) => {
    setRunBusy(true);
    try {
      let result: any;
      if (action === "upload") result = await phase2Api.interop.upload(payload.module, payload.file);
      if (action === "map") result = await phase2Api.interop.map(payload.module, payload.jobId, payload.mapping);
      if (action === "dry") result = await phase2Api.interop.dryRun(payload.module, payload.jobId, payload.mapping);
      if (action === "commit") result = await phase2Api.interop.commit(payload.module, payload.jobId);
      if (action === "backup") result = await phase2Api.interop.runBackup();
      if (action === "upload") setJob(result as ApiRow);
      if (action === "dry") setDryRun(result as ApiRow);
      toast.success("Data operation completed");
      loadJobs(); loadBackup();
      return result;
    } catch (e: any) {
      toast.error(e?.message || "Operation failed");
      throw e;
    } finally {
      setRunBusy(false);
    }
  };

  const importModules: string[] = useMemo(() => {
    const value = modulesData?.import_modules || modulesData?.imports || [];
    if (Array.isArray(value)) return value.map((m: any) => typeof m === "string" ? m : m.key || m.module || m.name).filter(Boolean);
    if (value && typeof value === "object") return Object.keys(value);
    return [];
  }, [modulesData]);
  const exportModules: string[] = useMemo(() => {
    const value = modulesData?.export_modules || modulesData?.exports || [];
    if (Array.isArray(value)) return value.map((m: any) => typeof m === "string" ? m : m.key || m.module || m.name).filter(Boolean);
    if (value && typeof value === "object") return Object.keys(value);
    return [];
  }, [modulesData]);

  const uploadFile = async () => {
    if (!module || !file) return toast.error("Select module and file");
    await doRun("upload", { module, file });
  };

  const parseMapping = () => {
    try {
      const parsed = JSON.parse(mapping);
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
      return parsed;
    } catch {
      toast.error("Mapping must be a JSON object");
      return null;
    }
  };

  const saveMapping = async () => {
    if (!module || !job?.job_id) return toast.error("Upload a file first");
    const parsed = parseMapping();
    if (!parsed) return;
    await doRun("map", { module, jobId: job.job_id, mapping: parsed });
  };

  const dryRunImport = async () => {
    if (!module || !job?.job_id) return toast.error("Upload a file first");
    const parsed = parseMapping();
    if (!parsed) return;
    await doRun("dry", { module, jobId: job.job_id, mapping: parsed });
  };

  const commitImport = async () => {
    if (!module || !job?.job_id) return toast.error("Upload and dry-run first");
    await doRun("commit", { module, jobId: job.job_id });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Data Migration & Interoperability</h1>
          <p className="text-muted-foreground">Guided imports, export packs, and backup/restore readiness.</p>
        </div>
        <Button variant="outline" onClick={() => { loadModules(); loadBackup(); }}><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard title="Import Modules" value={String(importModules.length)} subtitle="mapped import targets" icon={Upload} />
        <StatCard title="Export Modules" value={String(exportModules.length)} subtitle="downloadable datasets" icon={Download} />
        <StatCard title="Last Backup" value={backupData?.last_backup_at?.slice(0, 10) || "—"} subtitle={backupData?.status || "not recorded"} icon={DatabaseBackup} />
        <StatCard title="Current Job" value={job?.job_id ? `#${job.job_id}` : "—"} subtitle={job?.status || "no active import"} icon={FileSpreadsheet} />
      </div>

      <Tabs defaultValue="import" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="import">Guided Import</TabsTrigger>
          <TabsTrigger value="export">Exports</TabsTrigger>
          <TabsTrigger value="backup">Backups</TabsTrigger>
        </TabsList>

        <TabsContent value="import" className="space-y-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <Field label="Module"><Select value={module} onValueChange={setModule}><SelectTrigger><SelectValue placeholder="Select module" /></SelectTrigger><SelectContent>{importModules.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></Field>
            <Button variant="outline" disabled={!module} onClick={() => phase2Api.interop.template(module).catch((e) => toast.error(e.message))}><Download className="h-4 w-4" /> Template</Button>
            <div className="md:col-span-2"><Input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setFile(e.target.files?.[0] ?? null)} /></div>
            <Button onClick={uploadFile}><Upload className="h-4 w-4" /> Upload</Button>
          </div>

          <div className="rounded-xl border bg-card p-4 shadow-sm space-y-3">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <div>
                <h3 className="font-semibold">Field Mapping</h3>
                <p className="text-xs text-muted-foreground">Let AI match the columns, then review. Only the column titles are sent to the AI — never your data rows.</p>
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button variant="outline" disabled={aiBusy || !job?.job_id} onClick={aiAutoMap} className="gap-1.5">
                  <Sparkles className="h-4 w-4" /> {aiBusy ? "Matching…" : "AI Auto-map"}
                </Button>
                <Button variant="outline" onClick={saveMapping}><Save className="h-4 w-4" /> Save Mapping</Button>
                <Button variant="outline" onClick={dryRunImport}><PlayCircle className="h-4 w-4" /> Dry Run</Button>
                <Button onClick={commitImport}>Commit</Button>
              </div>
            </div>
            <Textarea className="font-mono min-h-32" value={mapping} onChange={(e) => setMapping(e.target.value)} placeholder='{"Vendor Name":"name","Phone":"phone"}' />
          </div>

          <DataTable
            columns={["Job", "Module", "Status", "Rows", "Valid", "Invalid", "Created"]}
            rows={(job || jobDetailData ? [jobDetailData || job] : []).map((j: ApiRow) => [
              `#${j.job_id}`,
              j.module,
              <Badge variant="outline">{j.status}</Badge>,
              j.total_rows ?? j.rows_count ?? "—",
              j.valid_rows ?? "—",
              j.invalid_rows ?? "—",
              j.created_at?.slice(0, 16) || "—",
            ])}
            empty="Upload a file to create an import job."
          />

          {dryRun && (
            <DataTable
              columns={["Result", "Value"]}
              rows={Object.entries(dryRun).map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)])}
            />
          )}

          <DataTable
            columns={["Job", "Module", "Status", "Rows", "Valid", "Errors", "Created", "Error File"]}
            rows={(jobsData ?? []).map((j) => [
              `#${j.job_id}`,
              j.module,
              <Badge variant="outline">{j.status}</Badge>,
              j.total_rows ?? "—",
              j.valid_rows ?? "—",
              j.error_rows ?? j.invalid_rows ?? "—",
              j.created_at?.slice(0, 16) || "—",
              <Button size="sm" variant="outline" onClick={() => phase2Api.interop.errors(j.job_id).catch((e) => toast.error(e.message))}>Download</Button>,
            ])}
            empty="No import job history yet."
          />
        </TabsContent>

        <TabsContent value="export" className="space-y-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm grid grid-cols-1 md:grid-cols-5 gap-3 items-end">
            <Field label="Module"><Select value={exportModule} onValueChange={setExportModule}><SelectTrigger><SelectValue placeholder="Select export" /></SelectTrigger><SelectContent>{exportModules.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <Button variant="outline" disabled={!exportModule} onClick={() => phase2Api.interop.exportModule(exportModule, { from, to }).catch((e) => toast.error(e.message))}><FileSpreadsheet className="h-4 w-4" /> Export Module</Button>
            <Button onClick={() => phase2Api.interop.exportAll({ from, to }).catch((e) => toast.error(e.message))}><Archive className="h-4 w-4" /> Export All</Button>
          </div>
          <DataTable columns={["Available Export Modules"]} rows={exportModules.map((m) => [m])} empty="No export modules returned by backend." />
        </TabsContent>

        <TabsContent value="backup" className="space-y-4">
          <div className="rounded-xl border bg-card p-5 shadow-sm flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h3 className="font-semibold">Backup Status</h3>
              <p className="text-sm text-muted-foreground">Last backup: {backupData?.last_backup_at || "not available"} · Location: {backupData?.backup_path || backupData?.path || "configured on server"}</p>
            </div>
            <Button onClick={() => doRun("backup")}><DatabaseBackup className="h-4 w-4" /> Run Backup</Button>
          </div>
          <DataTable
            columns={["Key", "Value"]}
            rows={Object.entries(backupData || {}).map(([key, value]) => [key, typeof value === "object" ? JSON.stringify(value) : String(value)])}
            empty="Backup service has not returned status yet."
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
