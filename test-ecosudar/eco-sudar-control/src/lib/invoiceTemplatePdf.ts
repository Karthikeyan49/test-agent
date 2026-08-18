import jsPDF from "jspdf";

interface TemplateFonts {
  regular: string;
  bold: string;
}

interface RowModel {
  line: InvoiceTemplateLine;
  index: number;
  descriptionLines: string[];
  hsnLines: string[];
  height: number;
}

interface TableColumn {
  key: string;
  label: string;
  x: number;
  w: number;
  align: "left" | "center" | "right";
}

interface SummaryRow {
  label: string;
  amount: string;
  bold?: boolean;
}

export interface InvoiceTemplateLine {
  description: string;
  hsn?: string;
  qty: number;
  unit?: string;
  unitPrice: number;
  gstRate: number;
  discount?: number;
}

export interface InvoiceTemplateDraft {
  invoiceNumber: string;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  placeOfSupply: string;
  billTo: string;
  shipTo: string;
  subject: string;
  notes: string;
  termsAndConditions?: string; // editable T&C; falls back to built-in list if omitted
  sellerState: string;
  customerState: string;
  deliveryFee?: number;
  discount?: number;       // invoice-level discount amount
  amountPaid?: number;     // total received so far (0 when nothing paid)
  balanceDue?: number;
  lines: InvoiceTemplateLine[];
}

const PAGE_W = 595.42;
const PAGE_H = 841.69;
const TEMPLATE_URL = new URL("../assets/invoice-template.png", import.meta.url).href;
const UBUNTU_REGULAR_URL = new URL("../assets/fonts/Ubuntu-Regular.ttf", import.meta.url).href;
const UBUNTU_BOLD_URL = new URL("../assets/fonts/Ubuntu-Bold.ttf", import.meta.url).href;
const TEMPLATE_FONT = "UbuntuTemplate";

const TABLE_X = 39.8;
const TABLE_Y = 366.5;
const TABLE_W = 526.2;
const TABLE_HEADER_H = 27.2;
const TABLE_BODY_Y = TABLE_Y + TABLE_HEADER_H;
const TABLE_ROW_MIN_H = 30;
const TABLE_ROW_LINE_H = 9.22;
const TABLE_ROW_PAD_Y = 4.2;
const TABLE_TEXT_SIZE = 7.1;
const TABLE_HEADER_SIZE = 7.4;
const TABLE_CONTINUATION_BOTTOM = 805;
const SUMMARY_RESERVE_H = 132;
const FOOTER_RESERVE_H = 220;
const PAGE_BOTTOM = 820;
const TEMPLATE_ROW_H = 30;
const TEMPLATE_BODY_H = 60;
const TEMPLATE_SUBTOTAL_Y = 466.82;
const TEMPLATE_SUMMARY_GAP = TEMPLATE_SUBTOTAL_Y - (TABLE_BODY_Y + TEMPLATE_BODY_H);
const TEMPLATE_LOWER_DIVIDER_X = 336.5;
const TEMPLATE_TOTALS_BOTTOM_Y = 520.44;
const TEMPLATE_TERMS_Y = 546.92;
const TEMPLATE_TERM_FIRST_LINE_Y = 565.37;
const TEMPLATE_BANK_Y = 712.97;
const TEMPLATE_SIGNATURE_Y = 593.35;
const TEMPLATE_PAGE_NUMBER_Y = 806.2;

// Discount is now an invoice-level field (shown in the summary), so the per-line
// Discount column is removed and the freed width is redistributed.
const AMOUNT_COLUMN: TableColumn = { key: "amount", label: "Amount", x: 510.6, w: 55.4, align: "right" };
const BASE_COLUMNS: TableColumn[] = [
  { key: "serial", label: "#", x: 39.8, w: 22, align: "center" },
  { key: "description", label: "Item & Description", x: 61.8, w: 128.8, align: "left" },
  { key: "hsn", label: "HSN\n/SAC", x: 190.6, w: 42, align: "center" },
  { key: "qty", label: "Qty", x: 232.6, w: 44, align: "right" },
  { key: "rate", label: "Rate", x: 276.6, w: 48, align: "right" },
  { key: "cgstPct", label: "%", x: 324.6, w: 44, align: "right" },
  { key: "cgstAmt", label: "Amt", x: 368.6, w: 49, align: "right" },
  { key: "sgstPct", label: "%", x: 417.6, w: 44, align: "right" },
  { key: "sgstAmt", label: "Amt", x: 461.6, w: 49, align: "right" },
  AMOUNT_COLUMN,
];

const INTERSTATE_COLUMNS: TableColumn[] = [
  ...BASE_COLUMNS.slice(0, 5),
  { key: "igstPct", label: "%", x: 324.6, w: 93, align: "right" },
  { key: "igstAmt", label: "Amt", x: 417.6, w: 93, align: "right" },
  AMOUNT_COLUMN,
];

export const TERMS_AND_CONDITIONS = [
  "1. Payment Terms: 100% advance payment is required before processing the order. If any delay in payment exceeds 7 days, an interest of 24% per annum will be levied on the outstanding invoice amount.",
  "2. Delivery: Delivery is at the customer's scope or actual transport cost will be settled by the customer.",
  "3. Returns & Claims: No returns accepted after delivery. Any quality-related claims must be reported within 48 hours of receipt.",
  "4. Pricing: Prices are subject to change based on raw material costs and market conditions. Please confirm current rate before placing new orders.",
  "5. Taxes: Applicable taxes (GST) are extra and charged as per government norms.",
  "6. Handling & Storage: Store in a dry, ventilated area to maintain pellet quality.",
  "7. Legal: All disputes are subject to Chennai jurisdiction only.",
];

const BANK_DETAILS = [
  "BANK DETAILS:",
  "ECO SUDAR BIO ENERGY LLP",
  "A/C No: 606605028604",
  "IFSC: ICIC0006066",
  "ICICI BANK, KANCHEEPURAM",
  "TYPE: CURRENT ACCOUNT",
];

const GST_STATE_CODES: Record<string, string> = {
  "Jammu and Kashmir": "01",
  "Himachal Pradesh": "02",
  Punjab: "03",
  Chandigarh: "04",
  Uttarakhand: "05",
  Haryana: "06",
  Delhi: "07",
  Rajasthan: "08",
  "Uttar Pradesh": "09",
  Bihar: "10",
  Sikkim: "11",
  "Arunachal Pradesh": "12",
  Nagaland: "13",
  Manipur: "14",
  Mizoram: "15",
  Tripura: "16",
  Meghalaya: "17",
  Assam: "18",
  "West Bengal": "19",
  Jharkhand: "20",
  Odisha: "21",
  Chhattisgarh: "22",
  "Madhya Pradesh": "23",
  Gujarat: "24",
  "Dadra and Nagar Haveli and Daman and Diu": "26",
  Maharashtra: "27",
  Karnataka: "29",
  Goa: "30",
  Lakshadweep: "31",
  Kerala: "32",
  "Tamil Nadu": "33",
  Puducherry: "34",
  "Andaman and Nicobar Islands": "35",
  Telangana: "36",
  "Andhra Pradesh": "37",
  Ladakh: "38",
};

let cachedTemplateDataUrl: string | null = null;
let cachedFonts: Promise<TemplateFonts> | null = null;

export function placeOfSupplyLabel(state: string): string {
  const clean = state.trim() || "Tamil Nadu";
  const code = GST_STATE_CODES[clean];
  return code ? `${clean} (${code})` : clean;
}

export function formatTemplateDate(value: string): string {
  if (!value) return "";
  const isoDate = value.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (isoDate) return `${isoDate[3]}/${isoDate[2]}/${isoDate[1]}`;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return value;
  return [
    String(d.getDate()).padStart(2, "0"),
    String(d.getMonth() + 1).padStart(2, "0"),
    d.getFullYear(),
  ].join("/");
}

/** Build the invoice PDF document (shared by download + preview). */
async function buildInvoiceTemplateDoc(draft: InvoiceTemplateDraft): Promise<jsPDF> {
  const [template, fonts] = await Promise.all([loadTemplateImage(), loadTemplateFonts()]);
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: [PAGE_W, PAGE_H] });
  const totals = calcTotals(draft);
  const isInterState = isDifferentState(draft.customerState, draft.sellerState);

  registerTemplateFonts(doc, fonts);
  doc.setTextColor(0, 0, 0);
  prepareTemplatePage(doc, template, draft, 1);
  writeInvoiceBody(doc, template, draft, totals, isInterState);
  return doc;
}

export async function downloadInvoiceTemplatePdf(draft: InvoiceTemplateDraft): Promise<void> {
  const doc = await buildInvoiceTemplateDoc(draft);
  doc.save(`${safeFilename(draft.invoiceNumber || "invoice")}.pdf`);
}

/**
 * Render the invoice PDF and return an object URL for inline preview (e.g. an
 * <iframe>). The caller owns the URL and should URL.revokeObjectURL() it when done.
 */
export async function invoiceTemplatePdfObjectUrl(draft: InvoiceTemplateDraft): Promise<string> {
  const doc = await buildInvoiceTemplateDoc(draft);
  return URL.createObjectURL(doc.output("blob"));
}

function prepareTemplatePage(doc: jsPDF, template: string, draft: InvoiceTemplateDraft, pageNumber: number): void {
  doc.addImage(template, "PNG", 0, 0, PAGE_W, PAGE_H);
  writeHeader(doc, draft);
  writeParties(doc, draft);
  writeSubject(doc, draft.subject);
  if (pageNumber > 1) {
    doc.setFont(TEMPLATE_FONT, "bold");
    doc.setFontSize(7.2);
    doc.text(`Continuation - Page ${pageNumber}`, 562, 357, { align: "right" });
  }
}

function addPreparedPage(doc: jsPDF, template: string, draft: InvoiceTemplateDraft, pageNumber: number): void {
  doc.addPage([PAGE_W, PAGE_H], "portrait");
  prepareTemplatePage(doc, template, draft, pageNumber);
}

function writeHeader(doc: jsPDF, draft: InvoiceTemplateDraft): void {
  patch(doc, 174, 171, 110, 10);
  patch(doc, 174, 182, 110, 10);
  patch(doc, 174, 193, 115, 10);
  patch(doc, 174, 204, 110, 10);
  patch(doc, 437, 171, 115, 10);

  text(doc, draft.invoiceNumber, 177, 180, { bold: true });
  text(doc, formatTemplateDate(draft.invoiceDate), 177, 191, { bold: true });
  text(doc, draft.terms || "Due on Receipt", 177, 202, { bold: true });
  text(doc, formatTemplateDate(draft.dueDate || draft.invoiceDate), 177, 213, { bold: true });
  text(doc, draft.placeOfSupply || placeOfSupplyLabel(draft.customerState), 440, 180, { bold: true });
}

function writeParties(doc: jsPDF, draft: InvoiceTemplateDraft): void {
  patch(doc, 43, 238, 232, 79);
  patch(doc, 306, 238, 244, 70);
  writeAddressBlock(doc, draft.billTo, 44, 248, 230);
  writeAddressBlock(doc, draft.shipTo, 307, 248, 236);
}

function writeSubject(doc: jsPDF, subject: string): void {
  // Wipe the full table width (not just 250px) so the pre-printed template's
  // table-top border / vertical dividers don't bleed through in the subject row.
  patch(doc, 47, 346, 519, 17);
  text(doc, (subject || "ECO SUDAR BIOMASS PELLET").toUpperCase(), 48, 357);
}

function writeInvoiceBody(
  doc: jsPDF,
  template: string,
  draft: InvoiceTemplateDraft,
  totals: Totals,
  isInterState: boolean
): void {
  const columns = isInterState ? INTERSTATE_COLUMNS : BASE_COLUMNS;
  const rows = buildRows(doc, draft.lines);
  if (canUseTemplateBody(rows)) {
    writeTemplateBody(doc, draft, totals, isInterState, columns, rows);
    return;
  }

  writeReportBody(doc, template, draft, totals, isInterState, columns, rows);
}

function canUseTemplateBody(_rows: RowModel[]): boolean {
  // Always use the custom report body. The pre-printed template still has a
  // Discount column baked in; routing everything through the custom path lets us
  // render the table without that column and keep all invoices visually consistent.
  return false;
}

function writeTemplateBody(
  doc: jsPDF,
  draft: InvoiceTemplateDraft,
  totals: Totals,
  isInterState: boolean,
  columns: TableColumn[],
  rows: RowModel[]
): void {
  clearTemplateDynamicData(doc, isInterState);
  if (isInterState) drawInterstateTemplateHeader(doc, columns);
  const tableBottom = drawTemplateRows(doc, columns, rows, isInterState);
  drawTemplateLowerBorders(doc, tableBottom);
  drawSummary(doc, draft, totals, isInterState, tableBottom + TEMPLATE_SUMMARY_GAP);
}

function writeReportBody(
  doc: jsPDF,
  template: string,
  draft: InvoiceTemplateDraft,
  totals: Totals,
  isInterState: boolean,
  columns: TableColumn[],
  rows: RowModel[]
): void {
  clearDynamicBody(doc);
  let pageNumber = 1;
  let y = drawTableHeader(doc, columns, isInterState);

  rows.forEach((row) => {
    if (y + row.height > TABLE_CONTINUATION_BOTTOM) {
      pageNumber += 1;
      addPreparedPage(doc, template, draft, pageNumber);
      clearDynamicBody(doc);
      y = drawTableHeader(doc, columns, isInterState);
    }
    drawItemRow(doc, columns, row, y, isInterState);
    y += row.height;
  });

  // Close the last row with a bottom border line
  setTableStroke(doc);
  doc.line(TABLE_X, y, TABLE_X + TABLE_W, y);

  // Summary hugs the table directly (no forced gap). Page-break if it won't fit.
  let summaryY = y;
  if (summaryY + SUMMARY_RESERVE_H > PAGE_BOTTOM) {
    pageNumber += 1;
    addPreparedPage(doc, template, draft, pageNumber);
    clearDynamicBody(doc);
    summaryY = TABLE_Y;
  }

  // Draw summary content, then draw box border using the actual returned bottom
  const summaryBottom = drawSummary(doc, draft, totals, isInterState, summaryY);
  drawSummaryBox(doc, summaryY, summaryBottom);

  const footerStartY = summaryBottom + 6;
  if (footerStartY + FOOTER_RESERVE_H > PAGE_BOTTOM) {
    // Footer needs its own page — wipe it clean and place footer near the top.
    // drawStaticFooter draws its own complete bordered boxes, so no template borders needed.
    pageNumber += 1;
    addPreparedPage(doc, template, draft, pageNumber);
    clearDynamicBody(doc);
    drawStaticFooter(doc, draft, TABLE_Y, pageNumber);
  } else {
    drawStaticFooter(doc, draft, footerStartY, pageNumber);
  }
}

function buildRows(doc: jsPDF, lines: InvoiceTemplateLine[]): RowModel[] {
  const source: InvoiceTemplateLine[] = lines.length > 0 ? lines : [{
    description: "Invoice item",
    hsn: "",
    qty: 1,
    unitPrice: 0,
    gstRate: 18,
  }];

  doc.setFont(TEMPLATE_FONT, "normal");
  doc.setFontSize(TABLE_TEXT_SIZE);
  return source.map((line, index) => {
    const descriptionLines = wrap(doc, line.description || "Item", col("description", BASE_COLUMNS).w - 8);
    const hsnLines = wrap(doc, line.hsn || "", col("hsn", BASE_COLUMNS).w - 8);
    const maxLines = Math.max(descriptionLines.length, hsnLines.length, 2);
    return {
      line,
      index,
      descriptionLines,
      hsnLines,
      height: Math.max(TABLE_ROW_MIN_H, maxLines * TABLE_ROW_LINE_H + TABLE_ROW_PAD_Y * 2),
    };
  });
}

function drawTableHeader(doc: jsPDF, columns: TableColumn[], isInterState: boolean): number {
  const y = TABLE_Y;
  const midY = y + 12.5;
  setTableStroke(doc);
  doc.setFillColor(245, 245, 245);
  doc.rect(TABLE_X, y, TABLE_W, TABLE_HEADER_H, "F");
  doc.rect(TABLE_X, y, TABLE_W, TABLE_HEADER_H, "S");

  // The %|Amt sub-dividers inside each GST group are drawn only in the bottom
  // half so the group label ("CGST"/"SGST"/"IGST") sits cleanly above them.
  const gstStartX  = col(isInterState ? "igstPct" : "cgstPct", columns).x;
  const amountX    = col("amount", columns).x;
  const subDividers = isInterState
    ? [col("igstAmt", columns).x]
    : [col("cgstAmt", columns).x, col("sgstAmt", columns).x];

  columns.slice(1).forEach((column) => {
    if (subDividers.includes(column.x)) {
      doc.line(column.x, midY, column.x, y + TABLE_HEADER_H);  // bottom half only
    } else {
      doc.line(column.x, y, column.x, y + TABLE_HEADER_H);     // full height
    }
  });

  // Horizontal split line ONLY across the GST group columns (not the whole width)
  doc.line(gstStartX, midY, amountX, midY);

  doc.setFont(TEMPLATE_FONT, "bold");
  doc.setFontSize(TABLE_HEADER_SIZE);
  headerText(doc, "#", col("serial", columns), y, TABLE_HEADER_H);
  headerText(doc, "Item & Description", col("description", columns), y, TABLE_HEADER_H);
  headerText(doc, ["HSN", "/SAC"], col("hsn", columns), y, TABLE_HEADER_H);
  headerText(doc, "Qty", col("qty", columns), y, TABLE_HEADER_H);
  headerText(doc, "Rate", col("rate", columns), y, TABLE_HEADER_H);

  if (isInterState) {
    groupHeader(doc, "IGST", col("igstPct", columns).x, col("igstPct", columns).w + col("igstAmt", columns).w, y);
    headerText(doc, "%", col("igstPct", columns), y + 12.5, 12.5);
    headerText(doc, "Amt", col("igstAmt", columns), y + 12.5, 12.5);
  } else {
    groupHeader(doc, "CGST", col("cgstPct", columns).x, col("cgstPct", columns).w + col("cgstAmt", columns).w, y);
    groupHeader(doc, "SGST", col("sgstPct", columns).x, col("sgstPct", columns).w + col("sgstAmt", columns).w, y);
    headerText(doc, "%", col("cgstPct", columns), y + 12.5, 12.5);
    headerText(doc, "Amt", col("cgstAmt", columns), y + 12.5, 12.5);
    headerText(doc, "%", col("sgstPct", columns), y + 12.5, 12.5);
    headerText(doc, "Amt", col("sgstAmt", columns), y + 12.5, 12.5);
  }
  headerText(doc, "Amount", col("amount", columns), y, TABLE_HEADER_H);
  return y + TABLE_HEADER_H;
}

function drawItemRow(doc: jsPDF, columns: TableColumn[], row: RowModel, y: number, isInterState: boolean): void {
  setTableStroke(doc);
  doc.rect(TABLE_X, y, TABLE_W, row.height, "S");
  drawVerticals(doc, columns, y, row.height);
  drawItemCells(doc, columns, row, y, isInterState);
}

function drawItemCells(doc: jsPDF, columns: TableColumn[], row: RowModel, y: number, isInterState: boolean): void {
  const line = row.line;
  const lineBase = calcLine(line);
  const tax = (lineBase * number(line.gstRate)) / 100;
  const splitTax = tax / 2;
  const halfRate = number(line.gstRate) / 2;

  doc.setFont(TEMPLATE_FONT, "normal");
  doc.setFontSize(TABLE_TEXT_SIZE);
  drawCell(doc, String(row.index + 1), col("serial", columns), y, row.height, { align: "center", valign: "top" });
  drawCell(doc, row.descriptionLines, col("description", columns), y, row.height, { align: "left", valign: "top" });
  drawCell(doc, row.hsnLines, col("hsn", columns), y, row.height, { align: "center", valign: "top" });
  const qtyVal = number(line.qty);
  const noUnit = (line.unit || "").trim() === "-";   // unit "None" → show "-" for quantity
  const qtyCell = (noUnit || qtyVal <= 0) ? ["-"] : [formatQty(qtyVal), line.unit || "Nos"];
  drawCell(doc, qtyCell, col("qty", columns), y, row.height, { align: "right", valign: "top" });
  drawCell(doc, formatMoney(number(line.unitPrice)), col("rate", columns), y, row.height, { align: "right", valign: "top" });
  if (isInterState) {
    drawCell(doc, `${trimRate(number(line.gstRate))}%`, col("igstPct", columns), y, row.height, { align: "right", valign: "top" });
    drawCell(doc, formatMoney(tax), col("igstAmt", columns), y, row.height, { align: "right", valign: "top" });
  } else {
    drawCell(doc, `${trimRate(halfRate)}%`, col("cgstPct", columns), y, row.height, { align: "right", valign: "top" });
    drawCell(doc, formatMoney(splitTax), col("cgstAmt", columns), y, row.height, { align: "right", valign: "top" });
    drawCell(doc, `${trimRate(halfRate)}%`, col("sgstPct", columns), y, row.height, { align: "right", valign: "top" });
    drawCell(doc, formatMoney(splitTax), col("sgstAmt", columns), y, row.height, { align: "right", valign: "top" });
  }
  drawCell(doc, formatMoney(lineBase), col("amount", columns), y, row.height, { align: "right", valign: "top" });
}

function clearTemplateDynamicData(doc: jsPDF, isInterState: boolean): void {
  patch(doc, TABLE_X - 0.4, TABLE_BODY_Y - 0.4, TABLE_W + 0.8, TEMPLATE_BODY_H + 0.8);
  patch(doc, 43.5, 456.5, 288, 69);
  patch(doc, 410, 454.5, 154, 68.5);
  if (isInterState) {
    patch(doc, 340.1, TABLE_Y + 0.5, 174.5, TABLE_HEADER_H - 1);
  }
}

function drawInterstateTemplateHeader(doc: jsPDF, columns: TableColumn[]): void {
  const pct = col("igstPct", columns);
  const amt = col("igstAmt", columns);
  const amount = col("amount", columns);
  const x = pct.x;
  const w = amount.x - x;

  setTableStroke(doc);
  doc.rect(x, TABLE_Y, w, TABLE_HEADER_H, "S");
  doc.line(x, TABLE_Y + 12.5, x + w, TABLE_Y + 12.5);
  doc.line(amt.x, TABLE_Y + 12.5, amt.x, TABLE_Y + TABLE_HEADER_H);
  doc.line(amount.x, TABLE_Y, amount.x, TABLE_Y + TABLE_HEADER_H);

  doc.setFont(TEMPLATE_FONT, "bold");
  doc.setFontSize(TABLE_HEADER_SIZE);
  groupHeader(doc, "IGST", x, w, TABLE_Y);
  headerText(doc, "%", pct, TABLE_Y + 12.5, 12.5);
  headerText(doc, "Amt", amt, TABLE_Y + 12.5, 12.5);
}

function drawTemplateRows(doc: jsPDF, columns: TableColumn[], rows: RowModel[], isInterState: boolean): number {
  const bodyHeight = rows.reduce((sum, row) => sum + row.height, 0);
  const bodyBottom = TABLE_BODY_Y + bodyHeight;
  let y = TABLE_BODY_Y;

  setTableStroke(doc);
  doc.rect(TABLE_X, TABLE_BODY_Y, TABLE_W, bodyHeight, "S");
  drawVerticals(doc, columns, TABLE_BODY_Y, bodyHeight);

  rows.forEach((row) => {
    drawItemCells(doc, columns, row, y, isInterState);
    y += row.height;
    if (y < bodyBottom - 0.5) {
      doc.line(TABLE_X, y, TABLE_X + TABLE_W, y);
    }
  });

  return bodyBottom;
}

function drawTemplateLowerBorders(doc: jsPDF, tableBottom: number): void {
  if (tableBottom >= TEMPLATE_TOTALS_BOTTOM_Y) return;
  setTableStroke(doc);
  doc.line(TABLE_X, tableBottom, TABLE_X, TEMPLATE_TOTALS_BOTTOM_Y);
  doc.line(TEMPLATE_LOWER_DIVIDER_X, tableBottom, TEMPLATE_LOWER_DIVIDER_X, TEMPLATE_TOTALS_BOTTOM_Y);
  doc.line(TABLE_X + TABLE_W, tableBottom, TABLE_X + TABLE_W, TEMPLATE_TOTALS_BOTTOM_Y);
}

function drawSummary(doc: jsPDF, draft: InvoiceTemplateDraft, totals: Totals, isInterState: boolean, y: number): number {
  const leftX = 45.6;
  const leftW = 285;
  const rightLabelX = 467.6;
  const rightAmountX = 560.6;
  const totalRows = summaryRows(totals, isInterState);
  let leftY = y + 13;

  doc.setFont(TEMPLATE_FONT, "bold");
  doc.setFontSize(7.4);
  doc.text("Total In Words", leftX, leftY);
  leftY += 9.25;
  doc.setFont(TEMPLATE_FONT, "normal");
  doc.setFontSize(7.1);
  const words = wrap(doc, amountInWords(totals.grandTotal), leftW).slice(0, 3);
  doc.text(words, leftX, leftY, { lineHeightFactor: 1.12 });
  leftY += words.length * 9.22 + 11;
  doc.setFont(TEMPLATE_FONT, "bold");
  doc.text("Notes", leftX, leftY);
  leftY += 9.25;
  doc.setFont(TEMPLATE_FONT, "normal");
  const noteLines = wrap(doc, draft.notes.trim() || "Thank you for choosing ECO Sudar and supporting green and sustainable energy.", leftW).slice(0, 5);
  doc.text(noteLines, leftX, leftY, { lineHeightFactor: 1.12 });
  leftY += noteLines.length * 9.22;

  let rowY = y + 13;
  doc.setFontSize(7.35);
  totalRows.forEach((row) => {
    doc.setFont(TEMPLATE_FONT, row.bold ? "bold" : "normal");
    doc.text(row.label, rightLabelX, rowY, { align: "right" });
    doc.text(row.amount, rightAmountX, rowY, { align: "right" });
    rowY += row.bold ? 13.6 : 12.23;
  });

  return Math.max(leftY, rowY) + 4;
}

function summaryRows(totals: Totals, isInterState: boolean): SummaryRow[] {
  const rows: SummaryRow[] = [{ label: "Sub Total", amount: formatMoney(totals.subtotal) }];
  if (totals.discount > 0) {
    rows.push({ label: "Discount", amount: `- ${formatMoney(totals.discount)}` });
  }
  if (isInterState) {
    rows.push({ label: "IGST", amount: formatMoney(totals.igst) });
  } else {
    rows.push(
      { label: "CGST", amount: formatMoney(totals.cgst) },
      { label: "SGST", amount: formatMoney(totals.sgst) }
    );
  }
  if (totals.deliveryFee > 0) rows.push({ label: "Delivery Fee", amount: formatMoney(totals.deliveryFee) });
  rows.push({ label: "Total", amount: formatCurrencyWhole(totals.grandTotal), bold: true });
  // Show what's been received so the "Balance Due" reads true. A fully-paid
  // invoice prints Amount Paid = Total and Balance Due = ₹0.
  if (totals.amountPaid > 0) {
    rows.push({ label: "Amount Paid", amount: `- ${formatCurrencyWhole(totals.amountPaid)}` });
  }
  rows.push({ label: "Balance Due", amount: formatCurrencyWhole(totals.balanceDue), bold: true });
  return rows;
}

function drawStaticFooter(doc: jsPDF, draft: InvoiceTemplateDraft, y: number, pageNumber: number): void {
  const TERM_LH    = 8.4;   // line height for a term line
  const PAD        = 7;     // inner padding

  // Pre-measure the wrapped T&C lines so the box hugs the content
  doc.setFont(TEMPLATE_FONT, "normal");
  doc.setFontSize(6.45);
  const termsSource: string[] = draft.termsAndConditions
    ? draft.termsAndConditions.split("\n").filter(l => l.trim())
    : TERMS_AND_CONDITIONS;
  const wrappedTerms: string[][] = termsSource.map(t => wrap(doc, t, 263).slice(0, 3));
  const termsLineCount = wrappedTerms.reduce((s, l) => s + l.length, 0);

  // T&C box height: header + all term lines, but tall enough to hold the signature on the right
  const headerH   = 12;
  const termsTextH = termsLineCount * TERM_LH + 4;
  const sigBlockH  = 40; // room for "Authorized Signature" + signing space
  const termsBoxH  = Math.max(headerH + termsTextH + PAD, headerH + sigBlockH);
  const termsBottom = y + termsBoxH;

  // Bank box height from its own content
  const bankBoxH    = BANK_DETAILS.length * 9.23 + PAD * 2;
  const bankBottom  = termsBottom + bankBoxH;

  // ── Border boxes ─────────────────────────────────────────────────────────
  setTableStroke(doc);
  doc.rect(TABLE_X, y, TABLE_W, termsBoxH, "S");                              // T&C box
  doc.line(TEMPLATE_LOWER_DIVIDER_X, y, TEMPLATE_LOWER_DIVIDER_X, termsBottom); // divider
  doc.rect(TABLE_X, termsBottom, TABLE_W, bankBoxH, "S");                     // bank box

  // ── T&C heading + text ───────────────────────────────────────────────────
  let leftY = y + PAD + 3;
  doc.setFont(TEMPLATE_FONT, "bold");
  doc.setFontSize(7.2);
  doc.text("Terms & Conditions", 45.6, leftY);
  leftY += 10;
  doc.setFont(TEMPLATE_FONT, "normal");
  doc.setFontSize(6.45);
  wrappedTerms.forEach((lines) => {
    doc.text(lines, 45.6, leftY, { lineHeightFactor: 1.1 });
    leftY += lines.length * TERM_LH;
  });

  // ── Authorized Signature (right column of the T&C box) ─────────────────────
  doc.setFont(TEMPLATE_FONT, "bold");
  doc.setFontSize(7.1);
  doc.text("Authorized Signature", 412.88, termsBottom - 8);

  // ── Bank details text ──────────────────────────────────────────────────────
  let bankY = termsBottom + PAD + 4;
  doc.setFontSize(7.1);
  BANK_DETAILS.forEach((line, idx) => {
    doc.setFont(TEMPLATE_FONT, idx === 0 ? "bold" : "normal");
    doc.text(line, 45.6, bankY);
    bankY += 9.23;
  });

  // ── Page number ──────────────────────────────────────────────────────────
  doc.setFont(TEMPLATE_FONT, "normal");
  doc.setFontSize(5.6);
  doc.text(String(pageNumber), 561.34, TEMPLATE_PAGE_NUMBER_Y, { align: "right" });
}

function drawVerticals(doc: jsPDF, columns: TableColumn[], y: number, h: number): void {
  columns.slice(1).forEach((column) => {
    doc.line(column.x, y, column.x, y + h);
  });
}

function groupHeader(doc: jsPDF, label: string, x: number, w: number, y: number): void {
  doc.text(label, x + w / 2, y + 8.8, { align: "center" });
}

function headerText(doc: jsPDF, value: string | string[], column: TableColumn, y: number, h: number): void {
  const lines = Array.isArray(value) ? value : [value];
  const startY = y + h / 2 - ((lines.length - 1) * 4.2) + 2.4;
  lines.forEach((line, idx) => {
    doc.text(line, column.x + column.w / 2, startY + idx * 8.2, { align: "center" });
  });
}

function drawCell(
  doc: jsPDF,
  value: string | string[],
  column: TableColumn,
  y: number,
  h: number,
  opts: { align?: "left" | "center" | "right"; valign?: "top" | "middle" } = {}
): void {
  const lines = Array.isArray(value) ? value : [value];
  const align = opts.align || column.align;
  const x = align === "left" ? column.x + 4 : align === "right" ? column.x + column.w - 4 : column.x + column.w / 2;
  const textY = opts.valign === "middle"
    ? y + h / 2 - ((lines.length - 1) * TABLE_ROW_LINE_H) / 2 + 2.2
    : y + TABLE_ROW_PAD_Y + 5.2;
  doc.text(lines, x, textY, { align, lineHeightFactor: 1.08 });
}

function col(key: string, columns: TableColumn[]): TableColumn {
  const column = columns.find((entry) => entry.key === key);
  if (!column) throw new Error(`Invoice table column missing: ${key}`);
  return column;
}

function setTableStroke(doc: jsPDF): void {
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.45);
}

/** Draw border box around the summary section (Total in Words / Notes | Totals) */
function drawSummaryBox(doc: jsPDF, top: number, bottom: number): void {
  setTableStroke(doc);
  // Outer rectangle
  doc.rect(TABLE_X, top, TABLE_W, bottom - top, "S");
  // Vertical divider between left (words/notes) and right (sub-totals)
  doc.line(TEMPLATE_LOWER_DIVIDER_X, top, TEMPLATE_LOWER_DIVIDER_X, bottom);
}

function clearDynamicBody(doc: jsPDF): void {
  // Start at 361 (just below the subject line at ~357) so any pre-printed
  // table-top border remnant above TABLE_Y (366.5) is fully wiped — otherwise
  // it shows as a doubled line above the freshly-drawn header.
  patch(doc, 21.5, 361, 552, 459);
}

function writeAddressBlock(doc: jsPDF, value: string, x: number, y: number, maxWidth: number): void {
  const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
  const expanded: string[] = [];
  lines.forEach((line) => expanded.push(...wrap(doc, line, maxWidth)));
  doc.setFontSize(8.2);
  expanded.slice(0, 7).forEach((line, idx) => {
    doc.setFont(TEMPLATE_FONT, idx === 0 ? "bold" : "normal");
    doc.text(line, x, y + idx * 11.25);
  });
}

function patch(doc: jsPDF, x: number, y: number, w: number, h: number): void {
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, w, h, "F");
}

function text(doc: jsPDF, value: string, x: number, y: number, opts: { bold?: boolean } = {}): void {
  doc.setFont(TEMPLATE_FONT, opts.bold ? "bold" : "normal");
  doc.setFontSize(7.7);
  doc.text(String(value || ""), x, y);
}

function wrap(doc: jsPDF, value: string, width: number): string[] {
  return doc.splitTextToSize(String(value || ""), width) as string[];
}

async function loadTemplateImage(): Promise<string> {
  if (cachedTemplateDataUrl) return cachedTemplateDataUrl;
  const response = await fetch(TEMPLATE_URL);
  if (!response.ok) throw new Error("Invoice template image is missing. Rebuild admin assets.");
  const blob = await response.blob();
  if (blob.type && !blob.type.includes("png")) {
    throw new Error("Invoice template did not load as a PNG. Rebuild and redeploy admin assets.");
  }
  cachedTemplateDataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not load invoice template image"));
    reader.readAsDataURL(blob);
  });
  return cachedTemplateDataUrl;
}

function registerTemplateFonts(doc: jsPDF, fonts: TemplateFonts): void {
  doc.addFileToVFS("Ubuntu-Regular.ttf", fonts.regular);
  doc.addFont("Ubuntu-Regular.ttf", TEMPLATE_FONT, "normal");
  doc.addFileToVFS("Ubuntu-Bold.ttf", fonts.bold);
  doc.addFont("Ubuntu-Bold.ttf", TEMPLATE_FONT, "bold");
  doc.setFont(TEMPLATE_FONT, "normal");
}

async function loadTemplateFonts(): Promise<TemplateFonts> {
  cachedFonts ??= Promise.all([
    loadAssetBase64(UBUNTU_REGULAR_URL, "Ubuntu regular font is missing. Rebuild admin assets."),
    loadAssetBase64(UBUNTU_BOLD_URL, "Ubuntu bold font is missing. Rebuild admin assets."),
  ]).then(([regular, bold]) => ({ regular, bold }));
  return cachedFonts;
}

async function loadAssetBase64(url: string, errorMessage: string): Promise<string> {
  const response = await fetch(url);
  if (!response.ok) throw new Error(errorMessage);
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

interface Totals {
  subtotal: number;
  taxableSubtotal: number;
  discount: number;
  cgst: number;
  sgst: number;
  igst: number;
  totalTax: number;
  deliveryFee: number;
  grandTotal: number;
  roundOff: number;
  amountPaid: number;
  balanceDue: number;
  avgGstRate: number;
}

function calcTotals(draft: InvoiceTemplateDraft): Totals {
  const isInterState = isDifferentState(draft.customerState, draft.sellerState);
  let subtotal = 0;
  let rawTax = 0;
  draft.lines.forEach((line) => {
    const base = calcLine(line);
    subtotal += base;
    rawTax += (base * number(line.gstRate)) / 100;
  });

  // Invoice-level discount reduces the taxable value; GST is recomputed proportionally
  const discount = Math.max(0, number(draft.discount));
  const taxableSubtotal = Math.max(0, subtotal - discount);
  const factor = subtotal > 0 ? taxableSubtotal / subtotal : 1;
  const totalTax = rawTax * factor;

  const deliveryFee = number(draft.deliveryFee);
  const cgst = isInterState ? 0 : totalTax / 2;
  const sgst = isInterState ? 0 : totalTax / 2;
  const igst = isInterState ? totalTax : 0;
  const rawGrandTotal = taxableSubtotal + totalTax + deliveryFee;
  const grandTotal = Math.round(rawGrandTotal);        // round off to the nearest whole rupee
  const roundOff = grandTotal - rawGrandTotal;         // adjustment shown on the invoice
  // Balance defaults to the whole invoice when caller gives none. Amount paid is
  // whatever the caller passes, else derived as (total − balance) so a fully-paid
  // invoice (balanceDue = 0) prints "Amount Paid = Total" and "Balance Due = 0".
  const balanceDue = draft.balanceDue === undefined ? grandTotal : Math.max(0, Math.round(number(draft.balanceDue)));
  const amountPaid = draft.amountPaid === undefined
    ? Math.max(0, grandTotal - balanceDue)
    : Math.max(0, Math.round(number(draft.amountPaid)));
  return {
    subtotal,
    taxableSubtotal,
    discount,
    cgst,
    sgst,
    igst,
    totalTax,
    deliveryFee,
    grandTotal,
    roundOff,
    amountPaid,
    balanceDue,
    avgGstRate: taxableSubtotal > 0 ? (totalTax / taxableSubtotal) * 100 : 0,
  };
}

function calcLine(line: InvoiceTemplateLine): number {
  return Math.max(0, number(line.qty) * number(line.unitPrice) - number(line.discount));
}

function isDifferentState(a: string, b: string): boolean {
  return (a || "Tamil Nadu").trim().toLowerCase() !== (b || "Tamil Nadu").trim().toLowerCase();
}

function formatCurrency(value: number): string {
  return `₹${formatMoney(value)}`;
}

function formatCurrencyWhole(value: number): string {
  return `₹${number(value).toLocaleString("en-IN", { maximumFractionDigits: 0 })}`;
}

function formatMoney(value: number): string {
  return number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function formatQty(value: number): string {
  return number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function trimRate(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

function number(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function safeFilename(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, "_").replace(/^_+|_+$/g, "") || "invoice";
}

function amountInWords(value: number): string {
  const rounded = Math.round(number(value));
  return `Indian Rupee ${toIndianWords(rounded)} Only`;
}

function toIndianWords(value: number): string {
  if (value === 0) return "Zero";
  const crore = Math.floor(value / 10000000);
  value %= 10000000;
  const lakh = Math.floor(value / 100000);
  value %= 100000;
  const thousand = Math.floor(value / 1000);
  value %= 1000;
  const hundred = Math.floor(value / 100);
  const rest = value % 100;
  const parts: string[] = [];
  if (crore) parts.push(`${underHundred(crore)} Crore`);
  if (lakh) parts.push(`${underHundred(lakh)} Lakh`);
  if (thousand) parts.push(`${underHundred(thousand)} Thousand`);
  if (hundred) parts.push(`${underHundred(hundred)} Hundred`);
  if (rest) parts.push(underHundred(rest));
  return parts.join(" ");
}

function underHundred(value: number): string {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  if (value >= 100) {
    const hundred = Math.floor(value / 100);
    const rest = value % 100;
    return `${underHundred(hundred)} Hundred${rest ? ` ${underHundred(rest)}` : ""}`;
  }
  if (value < 20) return ones[value];
  const ten = Math.floor(value / 10);
  const one = value % 10;
  return `${tens[ten]}${one ? ` ${ones[one]}` : ""}`;
}
