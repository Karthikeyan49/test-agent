/* eslint-disable @typescript-eslint/no-explicit-any */
import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, Check, ChevronsUpDown, ExternalLink, FileDown, FileUp, ImagePlus, Link2, Loader2, Play, Plus, RefreshCw, Save, ShieldAlert, ShieldCheck, Trash2, Upload, Users, X } from "lucide-react";
import { toast } from "sonner";
import { Req } from "@/components/Req";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { StatCard } from "@/components/StatCard";
import { cn } from "@/lib/utils";
import { employeesApi } from "@/lib/api/hr";
import { meetingsApi } from "@/lib/api/meetings";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { AuthImage } from "@/components/AuthImage";
import { AuthVideo } from "@/components/AuthVideo";

const isPhotoMedia = (m: ApiRow) =>
  m.type === "photo" || String(m.mime_type ?? "").startsWith("image") || m.category === "meeting_photo";
// The list response has no `external_url` field — an external video is identified by
// storage_disk === "external" (or metadata.external), with the URL in file_path.
const externalUrlOf = (m: ApiRow): string | null => {
  const isExt = m.storage_disk === "external" || m.metadata?.external === true || !!m.external_url;
  if (!isExt) return null;
  return String(m.external_url || m.file_path || "") || null;
};

// Locally-stored video (has bytes behind auth). External videos use the URL above instead.
const isLocalVideoMedia = (m: ApiRow) =>
  !externalUrlOf(m) && m.attachment_id && (
    String(m.mime_type ?? "").startsWith("video") ||
    m.category === "meeting_video" ||
    /\.(mp4|mov|webm)$/i.test(String(m.original_name ?? ""))
  );

// Friendly category label + badge colour for a media row.
// External is checked FIRST so it always wins over the meeting_video category.
const mediaCategoryBadge = (m: ApiRow): { label: string; className: string } => {
  if (externalUrlOf(m)) {
    return { label: "External", className: "bg-purple-100 text-purple-700 dark:bg-purple-500/15 dark:text-purple-300" };
  }
  const cat = String(m.category ?? "");
  if (cat === "meeting_photo") {
    return { label: "Photo", className: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300" };
  }
  if (cat === "meeting_video") {
    return { label: "Video", className: "bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300" };
  }
  const label = cat ? cat.charAt(0).toUpperCase() + cat.slice(1) : "Media";
  return { label, className: "bg-muted text-muted-foreground" };
};

// Display title: prefer m.title; else original filename with its extension stripped.
const mediaTitle = (m: ApiRow): string => {
  if (m.title && String(m.title).trim() !== "") return String(m.title);
  const name = String(m.original_name ?? "");
  return name ? name.replace(/\.[^./\\]+$/, "") : "Media";
};

// Standalone captions are stored as "<event> — <caption>". The event name is the
// FIRST segment; the caption is the LAST segment (defensive against legacy records
// that were accidentally combined more than once, e.g. "faizal — hi — bye").
const eventNameOf = (caption: string): string => (caption.split(" — ")[0] || "General").trim();
const captionTextOf = (caption: string): string => {
  const parts = caption.split(" — ");
  return parts.length > 1 ? parts[parts.length - 1].trim() : "";
};

const today = () => new Date().toISOString().slice(0, 10);
const minus = (days: number) => new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);
const inr = (n: any) => `₹${Number(n || 0).toLocaleString("en-IN")}`;
const num = (v: any) => Number(v || 0);
// Coerce an API result into an array — endpoints may return [], { rows: [] },
// { data: [] }, or { items: [] } depending on the backend. Guards against
// "x.map is not a function" when .data is an object instead of a bare array.
const asRows = (v: any): any[] =>
  Array.isArray(v) ? v
  : Array.isArray(v?.rows) ? v.rows
  : Array.isArray(v?.data) ? v.data
  : Array.isArray(v?.items) ? v.items
  : [];

function Field({ label, children }: { label: ReactNode; children: ReactNode }) {
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

export default function HrCompliance() {
  const [from, setFrom] = useState(minus(30));
  const [to, setTo] = useState(today());
  const [complianceOpen, setComplianceOpen] = useState(false);
  const [importOpen, setImportOpen] = useState<"employees" | "attendance" | null>(null);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [mediaMode, setMediaMode] = useState<"link" | "standalone">("link");
  const [standaloneName, setStandaloneName] = useState("");
  const [standalonePopOpen, setStandalonePopOpen] = useState(false);
  const [generalMeetingId, setGeneralMeetingId] = useState("");
  const [mediaMeetingId, setMediaMeetingId] = useState("");
  const [meetingPopOpen, setMeetingPopOpen] = useState(false);
  const [mediaFile, setMediaFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<string | null>(null);
  const [lightbox, setLightbox] = useState<ApiRow | null>(null);
  const [media, setMedia] = useState<ApiRow>({ caption: "", external_url: "" });
  const [importFile, setImportFile] = useState<File | null>(null);
  const [complianceFile, setComplianceFile] = useState<File | null>(null);
  const [compliance, setCompliance] = useState<ApiRow>({ employee_key: "", type: "insurance", provider: "", policy_number: "", coverage_amount: "", premium: "", start_date: today(), expiry_date: "", notes: "" });

  // ── Data state ───────────────────────────────────────────────────────────────
  const [employeesData, setEmployeesData] = useState<any[]>([]);
  const [recordsData, setRecordsData] = useState<any>(null);
  const [expiringData, setExpiringData] = useState<any>(null);
  const [attendanceData, setAttendanceData] = useState<any>(null);
  const [anomaliesData, setAnomaliesData] = useState<any>(null);
  const [meetingMediaData, setMeetingMediaData] = useState<any>(null);
  const [meetingsData, setMeetingsData] = useState<any[]>([]);
  const [runPending, setRunPending] = useState(false);

  // ── Load functions ───────────────────────────────────────────────────────────
  const loadEmployees = () => {
    employeesApi.list().then(setEmployeesData).catch(() => {});
  };
  const loadRecords = () => {
    phase2Api.hrCompliance.compliance().then(setRecordsData).catch(() => {});
  };
  const loadExpiring = () => {
    phase2Api.hrCompliance.expiring(45).then(setExpiringData).catch(() => {});
  };
  const loadAttendance = () => {
    phase2Api.hrCompliance.attendanceAnalytics({ from, to }).then(setAttendanceData).catch(() => {});
  };
  const loadAnomalies = () => {
    phase2Api.hrCompliance.attendanceAnomalies({ from, to }).then(setAnomaliesData).catch(() => {});
  };
  const loadMeetingMedia = () => {
    if (!mediaMeetingId) { setMeetingMediaData(null); return; }
    phase2Api.hrCompliance.meetingMedia(num(mediaMeetingId)).then(setMeetingMediaData).catch(() => {});
  };
  const loadMeetings = () => {
    meetingsApi.list().then(setMeetingsData).catch(() => {});
  };

  // Invalidate all phase2 data (equivalent to qc.invalidateQueries({ queryKey: ["phase2"] }))
  const invalidate = () => {
    loadRecords();
    loadExpiring();
    loadAttendance();
    loadAnomalies();
    loadMeetingMedia();
  };

  // ── Initial load ─────────────────────────────────────────────────────────────
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadEmployees(); loadRecords(); loadExpiring(); loadMeetings(); }, []);

  // Reload attendance/anomalies when date range changes
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadAttendance(); loadAnomalies(); }, [from, to]);

  // Reload meeting media when selected meeting changes
  useEffect(() => {
    if (!mediaMeetingId) { setMeetingMediaData(null); return; }
    phase2Api.hrCompliance.meetingMedia(num(mediaMeetingId)).then(setMeetingMediaData).catch(() => {});
  }, [mediaMeetingId]);

  // Local object-URL preview of the chosen file (before upload). Revoked on change.
  useEffect(() => {
    if (!mediaFile || !mediaFile.type.startsWith("image")) { setMediaPreview(null); return; }
    const url = URL.createObjectURL(mediaFile);
    setMediaPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [mediaFile]);

  // Resolve (and cache) the shared "General / Standalone Media" meeting id.
  const ensureGeneral = async (): Promise<string> => {
    if (generalMeetingId) return generalMeetingId;
    const general = await meetingsApi.general();
    const id = String(general.meeting_id ?? general.id);
    setGeneralMeetingId(id);
    // Refresh the meetings list so the gallery header can resolve the General
    // meeting (it may have just been created on the server).
    loadMeetings();
    return id;
  };

  // When the user is in Standalone mode, load the General meeting's media so
  // existing standalone uploads are visible immediately (on mount or on switch).
  useEffect(() => {
    if (mediaMode !== "standalone") return;
    let cancelled = false;
    ensureGeneral()
      .then((id) => { if (!cancelled) setMediaMeetingId(id); })
      .catch((e: any) => { if (!cancelled) toast.error(e?.message || "Could not load standalone media"); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mediaMode]);

  // ── Mutation helper (replaces useMutation) ───────────────────────────────────
  const doRun = async (action: string, payload?: any): Promise<any> => {
    setRunPending(true);
    try {
      let result: any;
      if (action === "compliance") result = await phase2Api.hrCompliance.createRecord(payload.employee_key, payload.body, payload.file);
      else if (action === "importEmployees") result = await phase2Api.hrCompliance.importEmployees(payload);
      else if (action === "importAttendance") result = await phase2Api.hrCompliance.importAttendance(payload);
      else if (action === "media") result = await phase2Api.hrCompliance.addMeetingMedia(payload.meetingId, payload.body);
      else if (action === "deleteMedia") result = await phase2Api.hrCompliance.removeMeetingMedia(payload.meetingId, payload.attachmentId);
      toast.success("HR action completed");
      invalidate();
      return result;
    } catch (e: any) {
      toast.error(e instanceof Error ? e.message : e?.message ?? "Operation failed");
      throw e;
    } finally {
      setRunPending(false);
    }
  };

  const complianceRows = asRows(recordsData);
  const anomalyRows = asRows(anomaliesData);
  const mediaRows = asRows(meetingMediaData);
  // Previously-used standalone EVENT names (the part before " — "), unique.
  const eventSuggestions = useMemo(
    () => Array.from(new Set(
      mediaRows.map((m) => (m.caption ? eventNameOf(String(m.caption)) : "")).filter(Boolean)
    )),
    [mediaRows],
  );
  const selectedMeeting = useMemo(
    () => (meetingsData ?? []).find((m) => String(m.meeting_id ?? m.id) === mediaMeetingId),
    [meetingsData, mediaMeetingId],
  );
  const stats = useMemo(() => {
    const att: any = attendanceData || {};
    return {
      employees: employeesData?.length ?? 0,
      compliance: complianceRows.length,
      expiring: asRows(expiringData).length,
      anomalies: anomalyRows.length,
      presentRate: att.present_rate ?? att.summary?.present_rate ?? 0,
    };
  }, [employeesData, complianceRows.length, expiringData, anomalyRows.length, attendanceData]);

  const saveCompliance = async () => {
    if (!compliance.employee_key || !compliance.type) return toast.error("Employee and type are required");
    await doRun("compliance", {
      employee_key: compliance.employee_key,
      file: complianceFile || undefined,
      body: {
        type: compliance.type,
        provider: compliance.provider,
        policy_number: compliance.policy_number,
        coverage_amount: num(compliance.coverage_amount),
        premium: num(compliance.premium),
        start_date: compliance.start_date,
        expiry_date: compliance.expiry_date,
        notes: compliance.notes,
      },
    });
    setComplianceOpen(false);
    setComplianceFile(null);
  };

  const uploadImport = async () => {
    if (!importOpen || !importFile) return toast.error("Choose a CSV/XLSX file");
    await doRun(importOpen === "employees" ? "importEmployees" : "importAttendance", importFile);
    setImportOpen(null);
    setImportFile(null);
  };

  const resetMediaForm = () => {
    setMedia({ caption: "", external_url: "" });
    setMediaFile(null);
  };

  const addMedia = async () => {
    if (!media.external_url && !mediaFile) return toast.error("Provide file or external video URL");

    let meetingId: number;
    let body: ApiRow;
    if (mediaMode === "standalone") {
      if (!standaloneName.trim()) return toast.error("Enter an event / meeting name");
      // Standalone media is attached to the shared "General / Standalone Media"
      // meeting; the typed name is stored as the caption (no meeting_name column exists).
      let generalId: string;
      try {
        generalId = await ensureGeneral();
      } catch (e: any) {
        return toast.error(e?.message || "Could not prepare standalone upload");
      }
      meetingId = num(generalId);
      // One backend caption field carries both: "<event> — <caption>". The UI groups
      // by the event part (before " — ") and shows the caption part per card.
      const evt = standaloneName.trim();
      const cap = media.caption?.trim() ?? "";
      body = { ...media, caption: cap ? `${evt} — ${cap}` : evt, file: mediaFile || undefined };
    } else {
      if (!mediaMeetingId) return toast.error("Select a meeting");
      meetingId = num(mediaMeetingId);
      body = { ...media, file: mediaFile || undefined };
    }

    await doRun("media", { meetingId, body });
    setMediaOpen(false);
    resetMediaForm();

    // After a standalone upload, focus the gallery on the General meeting so the
    // new media shows immediately. The useEffect on [mediaMeetingId] will auto-reload.
    if (mediaMode === "standalone") {
      setMediaMeetingId(String(meetingId));
    }
  };

  const renderMediaCard = (m: ApiRow, hideCaption = false) => {
    const photo = isPhotoMedia(m);
    const localVideo = isLocalVideoMedia(m);
    const externalUrl = externalUrlOf(m);
    const isExternal = !!externalUrl;
    const title = mediaTitle(m);
    const badge = mediaCategoryBadge(m);
    return (
      <div key={m.attachment_id} className="rounded-xl border bg-card overflow-hidden shadow-sm flex flex-col">
        {/* Thumbnail / player */}
        <div className="aspect-video bg-muted flex items-center justify-center relative">
          {isExternal ? (
            <div className="text-center text-sm text-muted-foreground px-4">
              <Link2 className="h-6 w-6 mx-auto mb-2" />
              External Video
            </div>
          ) : photo && m.attachment_id ? (
            <AuthImage
              attachmentId={m.attachment_id}
              alt={title}
              className="h-full w-full object-cover cursor-zoom-in"
              onClick={() => setLightbox(m)}
            />
          ) : localVideo ? (
            <button
              type="button"
              onClick={() => setLightbox(m)}
              className="h-full w-full flex items-center justify-center bg-black/5 hover:bg-black/10 transition-colors cursor-pointer"
              aria-label="Play video"
            >
              <div className="rounded-full bg-black/50 p-3"><Play className="h-7 w-7 text-white fill-white" /></div>
            </button>
          ) : (
            <div className="text-center text-sm text-muted-foreground px-4">
              <ImagePlus className="h-6 w-6 mx-auto mb-2" />
              Media file
            </div>
          )}
        </div>

        {/* Details */}
        <div className="p-3 flex flex-col flex-1 gap-2">
          <div className="font-semibold text-sm truncate" title={title}>{title}</div>
          <div>
            <span className={`inline-block text-[10px] font-medium px-2 py-0.5 rounded-full ${badge.className}`}>{badge.label}</span>
          </div>
          {(() => {
            // In grouped (standalone) view the event name is the group header, so
            // only show the caption text (the part after " — "). In link mode show
            // the full caption as stored.
            const text = hideCaption ? captionTextOf(String(m.caption ?? "")) : String(m.caption ?? "");
            return text ? <p className="text-xs text-muted-foreground line-clamp-2">{text}</p> : null;
          })()}
          {isExternal && externalUrl && (
            <a href={externalUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs text-primary hover:underline w-fit">
              <ExternalLink className="h-3.5 w-3.5" /> Open Link →
            </a>
          )}

          {/* Bottom row pinned to bottom: date + delete */}
          <div className="flex items-center justify-between gap-2 pt-1 mt-auto">
            <span className="text-xs text-muted-foreground">{m.created_at?.slice(0, 10) || "—"}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-destructive hover:text-destructive"
              onClick={() => doRun("deleteMedia", { meetingId: num(mediaMeetingId), attachmentId: m.attachment_id }).catch(() => {})}
            >
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-foreground">HR, Compliance & Media</h1>
          <p className="text-muted-foreground">Employee compliance documents, attendance analytics, TMS uploads, and meeting media.</p>
        </div>
        <Button variant="outline" onClick={() => invalidate()}><RefreshCw className="h-4 w-4" /> Refresh</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4">
        <StatCard title="Employees" value={String(stats.employees)} subtitle="HR master" icon={Users} />
        <StatCard title="Compliance Docs" value={String(stats.compliance)} subtitle="insurance/statutory" icon={ShieldCheck} />
        <StatCard title="Expiring Soon" value={String(stats.expiring)} subtitle="45 day window" icon={ShieldAlert} />
        <StatCard title="Attendance Rate" value={`${Number(stats.presentRate || 0).toFixed(1)}%`} subtitle="selected period" icon={CalendarClock} />
        <StatCard title="Anomalies" value={String(stats.anomalies)} subtitle="late/missing punches" icon={AlertTriangle} />
      </div>

      <Tabs defaultValue="compliance" className="space-y-4">
        <TabsList className="flex flex-wrap h-auto">
          <TabsTrigger value="compliance">Compliance</TabsTrigger>
          <TabsTrigger value="attendance">Attendance Analytics</TabsTrigger>
          <TabsTrigger value="imports">Employee/TMS Upload</TabsTrigger>
          <TabsTrigger value="media">Meeting Media</TabsTrigger>
        </TabsList>

        <TabsContent value="compliance" className="space-y-4">
          <div className="flex justify-end"><Button onClick={() => setComplianceOpen(true)}><ShieldCheck className="h-4 w-4" /> Add Compliance</Button></div>
          <DataTable
            columns={["Employee", "Type", "Provider", "Policy", "Coverage", "Premium", "Expiry", "Status", "Document"]}
            rows={complianceRows.map((r: ApiRow) => [
              <div><div className="font-medium">{r.employee_name || r.employee_key}</div><div className="text-xs text-muted-foreground">{r.employee_key}</div></div>,
              r.type,
              r.provider || "—",
              r.policy_number || "—",
              inr(r.coverage_amount),
              inr(r.premium),
              r.expiry_date || "—",
              <Badge variant="outline" className={r.status === "expired" ? "text-red-600" : r.status === "expiring" ? "text-amber-600" : "text-emerald-600"}>{r.status || "active"}</Badge>,
              r.attachment_id || r.file_path ? <Button size="sm" variant="outline" onClick={() => phase2Api.hrCompliance.download(r.compliance_id).catch((e) => toast.error(e.message))}><FileDown className="h-3 w-3" /> Download</Button> : "—",
            ])}
          />
        </TabsContent>

        <TabsContent value="attendance" className="space-y-4">
          <div className="rounded-xl border bg-card p-4 shadow-sm grid grid-cols-1 md:grid-cols-4 gap-3 items-end">
            <Field label="From"><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
            <Field label="To"><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
            <Button variant="outline" onClick={() => { loadAttendance(); loadAnomalies(); }}>Refresh Analytics</Button>
          </div>
          <DataTable
            columns={["Employee", "Date", "Anomaly", "Shift", "Late", "Hours", "Notes"]}
            rows={anomalyRows.map((a) => [
              a.employee_name || a.employee_key,
              a.date,
              <Badge variant="outline" className="text-amber-600">{a.type || a.anomaly_type}</Badge>,
              a.shift_name || "—",
              a.late_minutes ?? "—",
              a.hours_worked ?? "—",
              a.notes || "—",
            ])}
            empty="No attendance anomalies for this date range."
          />
        </TabsContent>

        <TabsContent value="imports" className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <button onClick={() => setImportOpen("employees")} className="rounded-xl border bg-card p-6 text-left hover:bg-muted/30">
              <FileUp className="h-6 w-6 text-primary mb-3" />
              <div className="font-semibold">Employee Data Upload</div>
              <p className="text-sm text-muted-foreground mt-1">Import employee master data from CSV/XLSX.</p>
            </button>
            <button onClick={() => setImportOpen("attendance")} className="rounded-xl border bg-card p-6 text-left hover:bg-muted/30">
              <Upload className="h-6 w-6 text-primary mb-3" />
              <div className="font-semibold">TMS / Attendance Upload</div>
              <p className="text-sm text-muted-foreground mt-1">Import biometric/TMS punch logs into attendance.</p>
            </button>
          </div>
        </TabsContent>

        <TabsContent value="media" className="space-y-4">
          {/* Mode toggle — segmented control */}
          <div className="inline-flex rounded-full bg-muted p-1 text-sm">
            <button
              type="button"
              onClick={() => { setMediaMode("link"); setMediaMeetingId(""); }}
              className={cn("px-4 py-1.5 rounded-full font-medium transition-colors", mediaMode === "link" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              Link to Meeting
            </button>
            <button
              type="button"
              onClick={() => setMediaMode("standalone")}
              className={cn("px-4 py-1.5 rounded-full font-medium transition-colors", mediaMode === "standalone" ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              Standalone
            </button>
          </div>

          <div className="rounded-xl border bg-card p-4 shadow-sm flex flex-wrap gap-3 items-end">
            {mediaMode === "link" ? (
              <>
                <Field label="Meeting">
                  <Popover open={meetingPopOpen} onOpenChange={setMeetingPopOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        role="combobox"
                        aria-expanded={meetingPopOpen}
                        className="flex h-9 min-w-[260px] items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <span className={cn("truncate", !selectedMeeting && "text-muted-foreground")}>
                          {selectedMeeting ? `${selectedMeeting.title} · ${selectedMeeting.date}` : "Select a meeting"}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-[320px] p-0" align="start">
                      <Command>
                        <CommandInput placeholder="Type meeting/event name…" />
                        <CommandList>
                          <CommandEmpty>No meeting found.</CommandEmpty>
                          <CommandGroup>
                            {(meetingsData ?? []).map((m) => {
                              const id = String(m.meeting_id ?? m.id);
                              return (
                                <CommandItem
                                  key={id}
                                  value={`${m.title} ${m.date} ${id}`}
                                  onSelect={() => { setMediaMeetingId(id); setMeetingPopOpen(false); }}
                                  className="flex items-center gap-2"
                                >
                                  <Check className={cn("h-4 w-4 shrink-0", mediaMeetingId === id ? "opacity-100" : "opacity-0")} />
                                  <span className="truncate">{m.title} · {m.date}</span>
                                </CommandItem>
                              );
                            })}
                          </CommandGroup>
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </Field>
                <Button variant="outline" onClick={() => loadMeetingMedia()} disabled={!mediaMeetingId}>Load Media</Button>
                <Button onClick={() => setMediaOpen(true)} disabled={!mediaMeetingId}><ImagePlus className="h-4 w-4" /> Add Media</Button>
              </>
            ) : (
              <>
                <Field label="Event / Meeting name">
                  <Popover open={standalonePopOpen} onOpenChange={setStandalonePopOpen}>
                    <PopoverTrigger asChild>
                      <button
                        type="button"
                        role="combobox"
                        aria-expanded={standalonePopOpen}
                        className="flex h-9 w-64 items-center justify-between rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm ring-offset-background focus:outline-none focus:ring-1 focus:ring-ring"
                      >
                        <span className={cn("truncate", !standaloneName && "text-muted-foreground")}>
                          {standaloneName || "Type or select event name..."}
                        </span>
                        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
                      </button>
                    </PopoverTrigger>
                    <PopoverContent className="w-64 p-0" align="start">
                      <Command>
                        <CommandInput
                          placeholder="Type or select event name..."
                          value={standaloneName}
                          onValueChange={setStandaloneName}
                        />
                        <CommandList>
                          <CommandEmpty>Type an event name to get started</CommandEmpty>
                          {standaloneName.trim() !== "" && !eventSuggestions.includes(standaloneName.trim()) && (
                            <CommandGroup>
                              <CommandItem
                                value={standaloneName}
                                onSelect={() => { setStandaloneName(standaloneName.trim()); setStandalonePopOpen(false); }}
                                className="flex items-center gap-2 text-primary"
                              >
                                <Plus className="h-4 w-4 shrink-0" />
                                <span className="truncate">Create "{standaloneName.trim()}"</span>
                              </CommandItem>
                            </CommandGroup>
                          )}
                          {eventSuggestions.length > 0 && (
                            <CommandGroup heading="Previous events">
                              {eventSuggestions.map((name) => (
                                <CommandItem
                                  key={name}
                                  value={name}
                                  onSelect={() => { setStandaloneName(name); setStandalonePopOpen(false); }}
                                  className="flex items-center gap-2"
                                >
                                  <Check className={cn("h-4 w-4 shrink-0", standaloneName === name ? "opacity-100" : "opacity-0")} />
                                  <span className="truncate">{name}</span>
                                </CommandItem>
                              ))}
                            </CommandGroup>
                          )}
                        </CommandList>
                      </Command>
                    </PopoverContent>
                  </Popover>
                </Field>
                <Button onClick={() => setMediaOpen(true)} disabled={!standaloneName.trim()}><ImagePlus className="h-4 w-4" /> Add Media</Button>
              </>
            )}
          </div>

          {selectedMeeting && (
            <div className="px-1">
              <h3 className="text-lg font-semibold text-foreground">{selectedMeeting.title}</h3>
              <p className="text-sm text-muted-foreground">{selectedMeeting.date} {selectedMeeting.time} · {selectedMeeting.location || "No location"}</p>
            </div>
          )}
          {mediaRows.length === 0 ? (
            <div className="rounded-xl border bg-card p-10 text-center text-sm text-muted-foreground shadow-sm">
              {mediaMeetingId ? "No media attached to this meeting." : "Select a meeting to load media."}
            </div>
          ) : (
            mediaMode === "standalone" ? (
              // Standalone: group cards by event name (caption); no caption → "General".
              <div className="space-y-6">
                {Object.entries(
                  mediaRows.reduce((acc, m) => {
                    const key = m.caption ? eventNameOf(String(m.caption)) : "General";
                    if (!acc[key]) acc[key] = [];
                    acc[key].push(m);
                    return acc;
                  }, {} as Record<string, ApiRow[]>)
                ).map(([groupName, items], gi) => (
                  <div key={groupName} className={gi > 0 ? "border-t pt-4" : undefined}>
                    <h4 className="text-sm font-semibold text-muted-foreground mb-2">{groupName}</h4>
                    <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                      {[...items]
                        .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")))
                        .map((m) => renderMediaCard(m, true))}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-4 gap-4">
                {mediaRows.map((m) => renderMediaCard(m))}
              </div>
            )
          )}

          {/* Lightbox — plays videos with full controls, shows images full-size */}
          {lightbox && (
            <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/80 p-4" onClick={() => setLightbox(null)}>
              <button className="absolute top-4 right-4 text-white/80 hover:text-white" onClick={() => setLightbox(null)}>
                <X className="h-7 w-7" />
              </button>
              <div onClick={(e) => e.stopPropagation()} className="flex items-center justify-center">
                {isLocalVideoMedia(lightbox) ? (
                  <AuthVideo
                    attachmentId={lightbox.attachment_id}
                    mimeType={lightbox.mime_type}
                    fileName={lightbox.original_name}
                    autoPlay
                    className="max-h-[90vh] max-w-[90vw] rounded-lg"
                  />
                ) : (
                  <AuthImage attachmentId={lightbox.attachment_id} alt={lightbox.original_name || "Meeting media"} className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg" />
                )}
              </div>
            </div>
          )}
        </TabsContent>
      </Tabs>

      <Dialog open={complianceOpen} onOpenChange={setComplianceOpen}>
        <DialogScrollContent onInteractOutside={(e) => e.preventDefault()} className="max-w-2xl">
          <DialogHeader><DialogTitle>Add Employee Compliance Record</DialogTitle></DialogHeader>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <Field label={<>Employee <Req /></>}><Select value={compliance.employee_key} onValueChange={(v) => setCompliance({ ...compliance, employee_key: v })}><SelectTrigger><SelectValue placeholder="Employee" /></SelectTrigger><SelectContent>{(employeesData ?? []).map((e) => <SelectItem key={e.id} value={e.id}>{e.name} ({e.id})</SelectItem>)}</SelectContent></Select></Field>
            <Field label={<>Type <Req /></>}><Select value={compliance.type} onValueChange={(v) => setCompliance({ ...compliance, type: v })}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{["insurance", "esi", "pf", "license", "training", "other"].map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent></Select></Field>
            <Field label="Provider"><Input value={compliance.provider} onChange={(e) => setCompliance({ ...compliance, provider: e.target.value })} /></Field>
            <Field label="Policy No"><Input value={compliance.policy_number} onChange={(e) => setCompliance({ ...compliance, policy_number: e.target.value })} /></Field>
            <Field label="Coverage"><Input type="number" value={compliance.coverage_amount} onChange={(e) => setCompliance({ ...compliance, coverage_amount: e.target.value })} /></Field>
            <Field label="Premium"><Input type="number" value={compliance.premium} onChange={(e) => setCompliance({ ...compliance, premium: e.target.value })} /></Field>
            <Field label="Start"><Input type="date" value={compliance.start_date} onChange={(e) => setCompliance({ ...compliance, start_date: e.target.value })} /></Field>
            <Field label="Expiry"><Input type="date" value={compliance.expiry_date} onChange={(e) => setCompliance({ ...compliance, expiry_date: e.target.value })} /></Field>
            <Field label="Document"><Input type="file" accept=".pdf,image/*" onChange={(e) => setComplianceFile(e.target.files?.[0] ?? null)} /></Field>
          </div>
          <Field label="Notes"><Textarea value={compliance.notes} onChange={(e) => setCompliance({ ...compliance, notes: e.target.value })} /></Field>
          <div className="flex justify-end"><Button onClick={saveCompliance}><Save className="h-4 w-4" /> Save Record</Button></div>
        </DialogScrollContent>
      </Dialog>

      <Dialog open={!!importOpen} onOpenChange={(open) => !open && setImportOpen(null)}>
        <DialogScrollContent>
          <DialogHeader><DialogTitle>{importOpen === "attendance" ? "TMS / Attendance Upload" : "Employee Data Upload"}</DialogTitle></DialogHeader>
          <Input type="file" accept=".csv,.xlsx,.xls" onChange={(e) => setImportFile(e.target.files?.[0] ?? null)} />
          <div className="flex justify-end"><Button onClick={uploadImport}><Upload className="h-4 w-4" /> Upload</Button></div>
        </DialogScrollContent>
      </Dialog>

      <Dialog open={mediaOpen} onOpenChange={(open) => { setMediaOpen(open); if (!open) resetMediaForm(); }}>
        <DialogScrollContent onInteractOutside={(e) => e.preventDefault()}>
          <DialogHeader><DialogTitle>{mediaMode === "standalone" ? "Add Standalone Media" : "Add Meeting Media"}</DialogTitle></DialogHeader>
          {mediaMode === "standalone" ? (
            <Field label="Event / Meeting name">
              <Input value={standaloneName} onChange={(e) => setStandaloneName(e.target.value)} placeholder="Event / Meeting name (e.g. Site Visit June)" />
            </Field>
          ) : (
            <Field label="Meeting">
              <Select value={mediaMeetingId} onValueChange={setMediaMeetingId}>
                <SelectTrigger><SelectValue placeholder="Select a meeting" /></SelectTrigger>
                <SelectContent>
                  {(meetingsData ?? []).map((m) => {
                    const id = String(m.meeting_id ?? m.id);
                    return <SelectItem key={id} value={id}>{m.title} · {m.date}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="External video URL">
            <Input
              value={media.external_url}
              disabled={!!mediaFile}
              onChange={(e) => { setMedia({ ...media, external_url: e.target.value }); if (e.target.value) setMediaFile(null); }}
            />
          </Field>
          <Field label={<>Upload photo/video<span className="text-xs text-muted-foreground ml-1">(Images up to 50MB · Videos up to 200MB)</span></>}>
            <Input
              type="file"
              accept="image/*,video/*"
              disabled={!!media.external_url}
              onChange={(e) => { const f = e.target.files?.[0] ?? null; setMediaFile(f); if (f) setMedia({ ...media, external_url: "" }); }}
            />
          </Field>
          <p className="text-xs text-muted-foreground">Upload a file OR provide an external URL, not both.</p>
          {mediaFile && (
            <div className="rounded-lg border bg-muted/30 p-2 flex items-center gap-3">
              {mediaPreview ? (
                <img src={mediaPreview} alt="preview" className="h-16 w-16 rounded object-cover" />
              ) : (
                <div className="h-16 w-16 rounded bg-muted flex items-center justify-center"><ImagePlus className="h-6 w-6 text-muted-foreground" /></div>
              )}
              <div className="min-w-0">
                <p className="text-sm font-medium truncate">{mediaFile.name}</p>
                <p className="text-xs text-muted-foreground">{(mediaFile.size / 1024 / 1024).toFixed(2)} MB</p>
              </div>
            </div>
          )}
          <Field label="Caption"><Textarea value={media.caption} onChange={(e) => setMedia({ ...media, caption: e.target.value })} /></Field>
          <div className="flex justify-end">
            <Button onClick={addMedia} disabled={runPending}>
              {runPending
                ? <><Loader2 className="h-4 w-4 animate-spin" /> Uploading...</>
                : <><ImagePlus className="h-4 w-4" /> Add Media</>}
            </Button>
          </div>
        </DialogScrollContent>
      </Dialog>
    </div>
  );
}
