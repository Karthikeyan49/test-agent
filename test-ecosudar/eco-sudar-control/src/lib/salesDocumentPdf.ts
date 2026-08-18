/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * PDF generator for Sales Documents (Quotation / Proforma Invoice).
 *
 * The regular Tax Invoice uses a pre-printed template PNG (titled "TAX INVOICE"),
 * which would be legally misleading on a quotation or proforma. So these documents
 * get their own clean, self-contained jsPDF layout with the correct title and a
 * "not a tax invoice" disclaimer. GST splits (CGST/SGST vs IGST) come straight from
 * the server payload — the server is the source of truth for amounts.
 */
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";
import { formatTemplateDate, placeOfSupplyLabel, TERMS_AND_CONDITIONS } from "./invoiceTemplatePdf";

const COMPANY = {
  name: "ECO SUDAR BIO ENERGY LLP",
  lines: ["Biomass Pellet Manufacturer", "Kancheepuram, Tamil Nadu", "GSTIN: 33AANFE..."],
};

const BANK_DETAILS = [
  "BANK DETAILS:",
  "ECO SUDAR BIO ENERGY LLP",
  "A/C No: 606605028604 · IFSC: ICIC0006066",
  "ICICI BANK, KANCHEEPURAM · CURRENT ACCOUNT",
];

const inr = (n: any) => `Rs. ${Number(n || 0).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function docTitle(type: string): string {
  switch (String(type).toLowerCase()) {
    case "proforma":         return "PROFORMA INVOICE";
    case "delivery_challan": return "DELIVERY CHALLAN";
    case "sales_order":      return "SALES ORDER";
    default:                 return "QUOTATION";
  }
}

function addressBlock(d: any): string {
  return [
    d.customer_name,
    d.customer_address,
    [d.customer_city, d.customer_pincode].filter(Boolean).join(" - "),
    d.customer_state,
    d.customer_gstin ? `GSTIN: ${d.customer_gstin}` : "",
    d.customer_phone ? `Phone: ${d.customer_phone}` : "",
    d.customer_email || "",
  ].filter((x) => x && String(x).trim()).join("\n");
}

export function downloadSalesDocumentPdf(d: any): void {
  const doc = new jsPDF({ orientation: "portrait", unit: "pt", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const M = 40; // margin
  const title = docTitle(d.document_type);
  const interState = Number(d.igst_amount || 0) > 0;
  let y = 46;

  // ── Header: company (left) + document title block (right) ─────────────────
  doc.setFont("helvetica", "bold").setFontSize(15).setTextColor(20, 90, 60);
  doc.text(COMPANY.name, M, y);
  doc.setFont("helvetica", "normal").setFontSize(8.5).setTextColor(90, 90, 90);
  COMPANY.lines.forEach((l, i) => doc.text(l, M, y + 14 + i * 11));

  doc.setFont("helvetica", "bold").setFontSize(18).setTextColor(20, 90, 60);
  doc.text(title, W - M, y, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(50, 50, 50);
  const meta = [
    `No: ${d.document_number || "—"}`,
    `Date: ${formatTemplateDate(d.document_date) || "—"}`,
    d.valid_until ? `Valid until: ${formatTemplateDate(d.valid_until)}` : "",
    d.due_date ? `Due: ${formatTemplateDate(d.due_date)}` : "",
  ].filter(Boolean);
  meta.forEach((l, i) => doc.text(l, W - M, y + 18 + i * 12, { align: "right" }));

  y += 70;
  doc.setDrawColor(20, 90, 60).setLineWidth(1).line(M, y, W - M, y);
  y += 18;

  // ── Bill To + Place of supply ─────────────────────────────────────────────
  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(20, 90, 60);
  doc.text("BILL TO", M, y);
  doc.setFont("helvetica", "normal").setFontSize(9).setTextColor(40, 40, 40);
  const billLines = doc.splitTextToSize(addressBlock(d), 300);
  doc.text(billLines, M, y + 13);

  doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(20, 90, 60);
  doc.text("Place of Supply", W - M, y, { align: "right" });
  doc.setFont("helvetica", "normal").setTextColor(40, 40, 40);
  doc.text(d.place_of_supply || placeOfSupplyLabel(d.customer_state || "Tamil Nadu"), W - M, y + 13, { align: "right" });
  if (d.ship_to) {
    doc.setFont("helvetica", "bold").setTextColor(20, 90, 60);
    doc.text("Ship To", W - M, y + 30, { align: "right" });
    doc.setFont("helvetica", "normal").setTextColor(40, 40, 40);
    doc.text(doc.splitTextToSize(String(d.ship_to), 220), W - M, y + 43, { align: "right" });
  }

  y += Math.max(billLines.length * 11, 50) + 18;

  // ── Subject ───────────────────────────────────────────────────────────────
  if (d.subject) {
    doc.setFont("helvetica", "bold").setFontSize(9).setTextColor(40, 40, 40);
    doc.text(`Subject: ${d.subject}`, M, y);
    y += 16;
  }

  // ── Items table ───────────────────────────────────────────────────────────
  const items: any[] = Array.isArray(d.items) ? d.items : [];
  const head = interState
    ? [["#", "Item & Description", "HSN", "Qty", "Rate", "IGST %", "IGST Amt", "Amount"]]
    : [["#", "Item & Description", "HSN", "Qty", "Rate", "CGST %", "CGST", "SGST %", "SGST", "Amount"]];

  const body = items.map((it, i) => {
    const qty = Number(it.quantity || 0);
    const rate = Number(it.unit_price || 0);
    const base = qty * rate;
    const gst = Number(it.gst_rate || 0);
    const gstAmt = (base * gst) / 100;
    const desc = [it.description || it.product_name || "", it.unit ? `(${it.unit})` : ""].filter(Boolean).join(" ");
    const amount = inr(base);
    if (interState) {
      return [String(i + 1), desc, it.hsn_code || "—", String(qty), inr(rate), `${gst}%`, inr(gstAmt), amount];
    }
    const half = gst / 2;
    return [String(i + 1), desc, it.hsn_code || "—", String(qty), inr(rate), `${half}%`, inr(gstAmt / 2), `${half}%`, inr(gstAmt / 2), amount];
  });

  autoTable(doc, {
    startY: y,
    head,
    body,
    margin: { left: M, right: M },
    styles: { fontSize: 7.6, cellPadding: 4, lineColor: [220, 220, 220], lineWidth: 0.5 },
    headStyles: { fillColor: [20, 90, 60], textColor: 255, fontSize: 7.8, halign: "center" },
    columnStyles: { 0: { halign: "center", cellWidth: 20 }, 1: { halign: "left" } },
    bodyStyles: { halign: "right" },
    didParseCell: (data: any) => {
      if (data.column.index === 1) data.cell.styles.halign = "left";
      if (data.column.index === 0) data.cell.styles.halign = "center";
    },
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  let sy = (doc as any).lastAutoTable.finalY + 14;
  const labelX = W - M - 200;
  const valX = W - M;
  const summary: [string, string, boolean?][] = [["Subtotal", inr(d.subtotal)]];
  if (Number(d.discount || 0) > 0) summary.push(["Discount", `- ${inr(d.discount)}`]);
  if (interState) {
    summary.push([`IGST`, inr(d.igst_amount)]);
  } else {
    summary.push(["CGST", inr(d.cgst_amount)]);
    summary.push(["SGST", inr(d.sgst_amount)]);
  }
  if (Number(d.delivery_fee || 0) > 0) summary.push(["Delivery", inr(d.delivery_fee)]);
  summary.push(["TOTAL", inr(d.total), true]);

  doc.setFontSize(9);
  summary.forEach(([label, val, bold]) => {
    doc.setFont("helvetica", bold ? "bold" : "normal").setTextColor(bold ? 20 : 60, bold ? 90 : 60, bold ? 60 : 60);
    if (bold) { doc.setDrawColor(20, 90, 60).setLineWidth(0.5).line(labelX, sy - 10, valX, sy - 10); }
    doc.text(label, labelX, sy);
    doc.text(val, valX, sy, { align: "right" });
    sy += bold ? 16 : 13;
  });

  // ── Terms & bank ──────────────────────────────────────────────────────────
  let ty = Math.max(sy + 16, (doc as any).lastAutoTable.finalY + 14);
  const pageH = doc.internal.pageSize.getHeight();
  if (ty > pageH - 170) { doc.addPage(); ty = 46; }

  doc.setFont("helvetica", "bold").setFontSize(8.5).setTextColor(20, 90, 60);
  doc.text("Terms & Conditions", M, ty);
  ty += 12;
  doc.setFont("helvetica", "normal").setFontSize(7.2).setTextColor(70, 70, 70);
  const terms = d.terms ? String(d.terms).split("\n") : TERMS_AND_CONDITIONS;
  terms.forEach((t: string) => {
    const lines = doc.splitTextToSize(t, W - M * 2);
    doc.text(lines, M, ty);
    ty += lines.length * 9 + 2;
  });

  ty += 8;
  doc.setFont("helvetica", "bold").setFontSize(7.6).setTextColor(40, 40, 40);
  BANK_DETAILS.forEach((b, i) => doc.text(b, M, ty + i * 10));

  // Disclaimer + signature
  doc.setFont("helvetica", "italic").setFontSize(7).setTextColor(150, 150, 150);
  doc.text(
    title === "QUOTATION"
      ? "This is a quotation and not a tax invoice. Prices valid until the date shown above."
      : "This is a proforma invoice for advance reference and not a tax invoice / demand for payment.",
    M,
    pageH - 30
  );
  doc.setFont("helvetica", "bold").setFontSize(8).setTextColor(40, 40, 40);
  doc.text("For ECO SUDAR BIO ENERGY LLP", W - M, pageH - 45, { align: "right" });
  doc.setFont("helvetica", "normal").setFontSize(7.5).setTextColor(120, 120, 120);
  doc.text("Authorised Signatory", W - M, pageH - 32, { align: "right" });

  doc.save(`${(d.document_number || title).replace(/[^\w.-]+/g, "_")}.pdf`);
}
