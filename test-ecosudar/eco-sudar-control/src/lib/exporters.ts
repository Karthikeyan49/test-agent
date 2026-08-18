/**
 * Shared exporters: PDF (jsPDF) and Excel (xlsx).
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import * as XLSX from "xlsx";

export interface ExportColumn<T> {
  header: string;
  key: keyof T | ((row: T) => string | number);
  align?: "left" | "right" | "center";
}

function valueOf<T>(row: T, key: ExportColumn<T>["key"]): string | number {
  if (typeof key === "function") return key(row);
  const v = row[key as keyof T];
  return v == null ? "" : (v as unknown as string | number);
}

export function exportToPdf<T>(opts: {
  title: string;
  subtitle?: string;
  columns: ExportColumn<T>[];
  rows: T[];
  filename: string;
}) {
  const doc = new jsPDF({ orientation: "landscape", unit: "pt", format: "a4" });
  doc.setFontSize(16);
  doc.text(opts.title, 40, 40);
  if (opts.subtitle) {
    doc.setFontSize(10);
    doc.setTextColor(100);
    doc.text(opts.subtitle, 40, 58);
  }
  autoTable(doc, {
    startY: 75,
    head: [opts.columns.map((c) => c.header)],
    body: opts.rows.map((r) => opts.columns.map((c) => String(valueOf(r, c.key)))),
    headStyles: { fillColor: [38, 132, 89], textColor: 255 },
    styles: { fontSize: 9, cellPadding: 6 },
    alternateRowStyles: { fillColor: [245, 247, 245] },
  });
  doc.save(opts.filename.endsWith(".pdf") ? opts.filename : `${opts.filename}.pdf`);
}

export function exportToExcel<T>(opts: {
  sheetName: string;
  columns: ExportColumn<T>[];
  rows: T[];
  filename: string;
}) {
  const aoa: (string | number)[][] = [
    opts.columns.map((c) => c.header),
    ...opts.rows.map((r) => opts.columns.map((c) => valueOf(r, c.key))),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, opts.sheetName.slice(0, 31));
  XLSX.writeFile(wb, opts.filename.endsWith(".xlsx") ? opts.filename : `${opts.filename}.xlsx`);
}

/** One worksheet: a tab name plus flat row objects (column = object key). */
export interface SheetSpec {
  name: string;
  rows: Record<string, unknown>[];
}

function sanitizeSheetName(name: string): string {
  // Excel: max 31 chars, none of : \ / ? * [ ]
  return name.replace(/[:\\/?*[\]]/g, " ").slice(0, 31) || "Sheet1";
}

/**
 * Multi-sheet workbook download. Columns per sheet are the union of the rows'
 * keys, first-seen order. Filename gets a YYYY-MM-DD stamp and .xlsx suffix.
 */
export function exportWorkbook(filenameBase: string, sheets: SheetSpec[]) {
  const wb = XLSX.utils.book_new();
  const used = new Set<string>();
  const list = sheets.length ? sheets : [{ name: "Sheet1", rows: [] as Record<string, unknown>[] }];

  for (const sheet of list) {
    let name = sanitizeSheetName(sheet.name);
    let n = 2;
    while (used.has(name.toLowerCase())) name = sanitizeSheetName(`${sheet.name} ${n++}`);
    used.add(name.toLowerCase());
    const ws = XLSX.utils.json_to_sheet(sheet.rows.length ? sheet.rows : [{}]);
    XLSX.utils.book_append_sheet(wb, ws, name);
  }

  const stamp = new Date().toISOString().slice(0, 10);
  XLSX.writeFile(wb, `${filenameBase}-${stamp}.xlsx`);
}
