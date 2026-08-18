import { useState, useMemo } from "react";
import { format, parseISO, isValid } from "date-fns";
import { FileDown, Lock, Calendar } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { exportToExcel, type ExportColumn } from "@/lib/exporters";
import { cn } from "@/lib/utils";

export interface ExportColumnDef<T = Record<string, unknown>> {
  header: string;
  key: ExportColumn<T>["key"];
  defaultChecked?: boolean;
  group?: "table" | "detail";
}

interface ExportDialogProps<T extends Record<string, unknown>> {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  columns: ExportColumnDef<T>[];
  rows: T[];
  dateField?: keyof T;
  filename?: string;
}

function parseDate(v: unknown): Date | null {
  if (!v) return null;
  if (typeof v === "string") {
    const d = parseISO(v);
    return isValid(d) ? d : null;
  }
  return null;
}

export function ExportDialog<T extends Record<string, unknown>>({
  open,
  onOpenChange,
  title,
  columns,
  rows,
  dateField,
  filename,
}: ExportDialogProps<T>) {
  const tableColumns  = columns.filter((c) => (c.group ?? "table") === "table");
  const detailColumns = columns.filter((c) => c.group === "detail");

  const [checked, setChecked] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    columns.forEach((c) => { init[String(c.header)] = c.defaultChecked !== false; });
    return init;
  });

  const [dateFrom,     setDateFrom]     = useState("");
  const [dateTo,       setDateTo]       = useState("");
  const [usePassword,  setUsePassword]  = useState(false);
  const [password,     setPassword]     = useState("");
  const [showPass,     setShowPass]     = useState(false);

  const toggleAll = (group: "table" | "detail", value: boolean) => {
    const cols = group === "table" ? tableColumns : detailColumns;
    setChecked((prev) => {
      const next = { ...prev };
      cols.forEach((c) => { next[c.header] = value; });
      return next;
    });
  };

  const selectedColumns = useMemo(
    () => columns.filter((c) => checked[c.header]),
    [columns, checked],
  );

  const filteredRows = useMemo(() => {
    if (!dateField) return rows;
    const from = dateFrom ? parseISO(dateFrom) : null;
    const to   = dateTo   ? parseISO(dateTo)   : null;
    if (!from && !to) return rows;
    return rows.filter((r) => {
      const d = parseDate(r[dateField as string]);
      if (!d) return true;
      if (from && d < from) return false;
      if (to) {
        const toEnd = new Date(to);
        toEnd.setHours(23, 59, 59, 999);
        if (d > toEnd) return false;
      }
      return true;
    });
  }, [rows, dateField, dateFrom, dateTo]);

  const handleExport = () => {
    if (selectedColumns.length === 0) return;
    const exportCols: ExportColumn<T>[] = selectedColumns.map((c) => ({
      header: c.header,
      key: c.key,
    }));
    const dateLabel =
      dateFrom || dateTo
        ? `_${dateFrom || "start"}_to_${dateTo || "end"}`
        : `_${format(new Date(), "yyyy-MM-dd")}`;

    exportToExcel({
      sheetName: title,
      columns: exportCols,
      rows: filteredRows as T[],
      filename: (filename ?? title.toLowerCase().replace(/\s+/g, "_")) + dateLabel,
      password: usePassword && password ? password : undefined,
    });
    onOpenChange(false);
  };

  const reset = () => {
    setDateFrom("");
    setDateTo("");
    setUsePassword(false);
    setPassword("");
    setShowPass(false);
    const init: Record<string, boolean> = {};
    columns.forEach((c) => { init[c.header] = c.defaultChecked !== false; });
    setChecked(init);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) reset(); onOpenChange(v); }}>
      <DialogContent onInteractOutside={(e) => e.preventDefault()} className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Export {title} to Excel</DialogTitle>
        </DialogHeader>

        <div className="space-y-5 mt-1">
          {dateField && (
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
                Date Range <span className="text-muted-foreground font-normal text-xs">(optional)</span>
              </Label>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">From</Label>
                  <Input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs text-muted-foreground">To</Label>
                  <Input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
                </div>
              </div>
              {(dateFrom || dateTo) && (
                <p className="text-xs text-muted-foreground">
                  {filteredRows.length} of {rows.length} rows match this date range
                </p>
              )}
            </div>
          )}

          <Separator />

          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label className="text-sm font-medium">Table Columns</Label>
              <div className="flex gap-2 text-xs">
                <button className="text-primary hover:underline" onClick={() => toggleAll("table", true)}>All</button>
                <button className="text-muted-foreground hover:underline" onClick={() => toggleAll("table", false)}>None</button>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-y-2 gap-x-4">
              {tableColumns.map((c) => (
                <label key={c.header} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={!!checked[c.header]}
                    onCheckedChange={(v) => setChecked((prev) => ({ ...prev, [c.header]: !!v }))}
                  />
                  <span className="text-sm text-card-foreground">{c.header}</span>
                </label>
              ))}
            </div>
          </div>

          {detailColumns.length > 0 && (
            <>
              <Separator />
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div>
                    <Label className="text-sm font-medium">Additional Fields</Label>
                    <p className="text-xs text-muted-foreground">From the detail page — not shown in the list table</p>
                  </div>
                  <div className="flex gap-2 text-xs">
                    <button className="text-primary hover:underline" onClick={() => toggleAll("detail", true)}>All</button>
                    <button className="text-muted-foreground hover:underline" onClick={() => toggleAll("detail", false)}>None</button>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-y-2 gap-x-4">
                  {detailColumns.map((c) => (
                    <label key={c.header} className="flex items-center gap-2 cursor-pointer">
                      <Checkbox
                        checked={!!checked[c.header]}
                        onCheckedChange={(v) => setChecked((prev) => ({ ...prev, [c.header]: !!v }))}
                      />
                      <span className="text-sm text-card-foreground">{c.header}</span>
                    </label>
                  ))}
                </div>
              </div>
            </>
          )}

          <Separator />

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="flex items-center gap-1.5 text-sm font-medium">
                <Lock className="h-3.5 w-3.5 text-muted-foreground" />
                Password Protect
              </Label>
              <Switch checked={usePassword} onCheckedChange={setUsePassword} />
            </div>
            {usePassword && (
              <div className="space-y-1.5">
                <div className="relative">
                  <Input
                    type={showPass ? "text" : "password"}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter password for the Excel file"
                    className="pr-16"
                  />
                  <button
                    type="button"
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
                    onClick={() => setShowPass((v) => !v)}
                  >
                    {showPass ? "Hide" : "Show"}
                  </button>
                </div>
                <p className="text-xs text-muted-foreground">
                  The file will require this password to open in Excel.
                </p>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between pt-1">
            <p className={cn("text-xs", selectedColumns.length === 0 ? "text-destructive" : "text-muted-foreground")}>
              {selectedColumns.length === 0
                ? "Select at least one column"
                : `${selectedColumns.length} columns · ${filteredRows.length} rows`}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                disabled={selectedColumns.length === 0 || (usePassword && !password)}
                onClick={handleExport}
              >
                <FileDown className="h-4 w-4 mr-1.5" />
                Export
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
