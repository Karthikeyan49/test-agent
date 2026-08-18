import { useRef, useState } from "react";
import { Upload, ChevronRight, ChevronLeft, Check, AlertCircle, FileText } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import * as XLSX from "xlsx";

export interface ImportFieldDef {
  key: string;
  label: string;
  required?: boolean;
}

interface ImportDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  fields: ImportFieldDef[];
  onImport: (rows: Record<string, string>[]) => Promise<void>;
  maxRows?: number;
}

type Step = "upload" | "mapping" | "preview";

const NONE = "__none__";

function parseFile(file: File): Promise<{ headers: string[]; rows: string[][] }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = new Uint8Array(e.target!.result as ArrayBuffer);
        const wb   = XLSX.read(data, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const aoa  = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, defval: "" });
        if (aoa.length < 2) { reject(new Error("File must have at least a header row and one data row")); return; }
        const headers = (aoa[0] as string[]).map((h) => String(h ?? "").trim());
        const rows    = (aoa.slice(1) as string[][]).map((r) => headers.map((_, i) => String(r[i] ?? "").trim()));
        resolve({ headers, rows });
      } catch {
        reject(new Error("Could not parse file — please use .xlsx or .csv"));
      }
    };
    reader.onerror = () => reject(new Error("File read error"));
    reader.readAsArrayBuffer(file);
  });
}

export function ImportDialog({ open, onOpenChange, title, fields, onImport, maxRows = 1000 }: ImportDialogProps) {
  const [step,    setStep]    = useState<Step>("upload");
  const [headers, setHeaders] = useState<string[]>([]);
  const [rawRows, setRawRows] = useState<string[][]>([]);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [saving,  setSaving]  = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reset = () => {
    setStep("upload"); setHeaders([]); setRawRows([]);
    setMapping({}); setSaving(false); setError(null);
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleFile = async (file: File) => {
    setError(null);
    try {
      const { headers: h, rows: r } = await parseFile(file);
      if (r.length > maxRows) { setError(`File has ${r.length} rows — max allowed is ${maxRows}. Split the file and import in batches.`); return; }
      setHeaders(h);
      setRawRows(r);
      const autoMap: Record<string, string> = {};
      fields.forEach((f) => {
        const match = h.find((hdr) => hdr.toLowerCase() === f.key.toLowerCase() || hdr.toLowerCase() === f.label.toLowerCase());
        if (match) autoMap[f.key] = match;
      });
      setMapping(autoMap);
      setStep("mapping");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to parse file");
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) handleFile(file);
  };

  const mappedRows = rawRows.map((row) => {
    const out: Record<string, string> = {};
    fields.forEach((f) => {
      const hdr = mapping[f.key];
      if (hdr) {
        const idx = headers.indexOf(hdr);
        out[f.key] = idx >= 0 ? (row[idx] ?? "") : "";
      }
    });
    return out;
  });

  const missingRequired = fields.filter((f) => f.required && !mapping[f.key]);

  const handleImport = async () => {
    setSaving(true);
    setError(null);
    try {
      await onImport(mappedRows);
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setSaving(false);
    }
  };

  const steps: Step[] = ["upload", "mapping", "preview"];
  const stepLabels    = ["Upload", "Map Fields", "Preview"];
  const stepIdx       = steps.indexOf(step);

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()} className="max-w-2xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Import {title}</DialogTitle>
        </DialogHeader>

        <div className="flex items-center gap-2 pb-2">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center gap-2">
              <div className={cn(
                "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
                i < stepIdx  ? "bg-primary text-primary-foreground" :
                i === stepIdx ? "bg-primary text-primary-foreground ring-2 ring-primary/30" :
                "bg-muted text-muted-foreground",
              )}>
                {i < stepIdx ? <Check className="h-3 w-3" /> : i + 1}
              </div>
              <span className={cn("text-xs", i === stepIdx ? "text-foreground font-medium" : "text-muted-foreground")}>
                {stepLabels[i]}
              </span>
              {i < steps.length - 1 && <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
          ))}
        </div>

        <div className="flex-1 overflow-y-auto space-y-4">
          {step === "upload" && (
            <div className="space-y-4">
              <div
                onDragOver={(e) => e.preventDefault()}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
                className="flex flex-col items-center justify-center gap-3 rounded-xl border-2 border-dashed border-border hover:border-primary/50 bg-muted/20 p-10 cursor-pointer transition-colors"
              >
                <Upload className="h-8 w-8 text-muted-foreground" />
                <div className="text-center">
                  <p className="text-sm font-medium text-foreground">Drop a file here, or click to browse</p>
                  <p className="text-xs text-muted-foreground mt-1">Supports .xlsx and .csv — max {maxRows.toLocaleString()} rows</p>
                </div>
                <input
                  ref={fileRef}
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); }}
                />
              </div>
              <div className="rounded-lg bg-muted/40 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium text-foreground">Expected columns:</p>
                <p>{fields.map((f) => `${f.label}${f.required ? " *" : ""}`).join(", ")}</p>
                <p className="mt-1">* Required. Column names are matched automatically — exact match or case-insensitive.</p>
              </div>
            </div>
          )}

          {step === "mapping" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Match each required field to a column from your file ({rawRows.length} rows detected).
              </p>
              <div className="grid grid-cols-2 gap-3">
                {fields.map((f) => (
                  <div key={f.key} className="space-y-1">
                    <label className="text-xs font-medium text-foreground">
                      {f.label} {f.required && <span className="text-destructive">*</span>}
                    </label>
                    <Select
                      value={mapping[f.key] ?? NONE}
                      onValueChange={(v) => setMapping((prev) => ({ ...prev, [f.key]: v === NONE ? "" : v }))}
                    >
                      <SelectTrigger className="text-sm">
                        <SelectValue placeholder="— skip —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={NONE}>— skip —</SelectItem>
                        {headers.map((h) => (
                          <SelectItem key={h} value={h}>{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>
          )}

          {step === "preview" && (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">
                Showing first 5 of {mappedRows.length} rows. Review before confirming.
              </p>
              <div className="overflow-x-auto rounded-lg border">
                <table className="w-full text-xs">
                  <thead className="bg-muted/50">
                    <tr>
                      {fields.filter((f) => mapping[f.key]).map((f) => (
                        <th key={f.key} className="px-3 py-2 text-left font-medium text-muted-foreground uppercase tracking-wider">{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {mappedRows.slice(0, 5).map((row, i) => (
                      <tr key={i} className="border-t">
                        {fields.filter((f) => mapping[f.key]).map((f) => (
                          <td key={f.key} className="px-3 py-2 text-card-foreground max-w-[160px] truncate">{row[f.key] || <span className="text-muted-foreground">—</span>}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {mappedRows.length > 5 && (
                <p className="text-xs text-muted-foreground">…and {mappedRows.length - 5} more rows</p>
              )}
            </div>
          )}

          {error && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
        </div>

        <div className="flex items-center justify-between pt-3 border-t">
          <Button variant="outline" onClick={() => { if (step === "mapping") setStep("upload"); else if (step === "preview") setStep("mapping"); else { reset(); onOpenChange(false); } }}>
            {step === "upload" ? "Cancel" : <><ChevronLeft className="h-4 w-4 mr-1" /> Back</>}
          </Button>
          <div className="flex items-center gap-2">
            {step !== "upload" && (
              <span className="text-xs text-muted-foreground flex items-center gap-1">
                <FileText className="h-3.5 w-3.5" /> {rawRows.length} rows
              </span>
            )}
            {step === "mapping" && (
              <Button
                disabled={missingRequired.length > 0}
                onClick={() => setStep("preview")}
                title={missingRequired.length > 0 ? `Map required: ${missingRequired.map((f) => f.label).join(", ")}` : undefined}
              >
                Preview <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
            {step === "preview" && (
              <Button onClick={handleImport} disabled={saving}>
                {saving ? "Importing…" : `Import ${mappedRows.length} rows`}
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
