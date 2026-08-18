// Option A e-way bill helpers: build the NIC bulk-generation JSON (upload on the
// portal to get the EWB number) and print a slip. No number is minted here.

export const GST_STATE_CODES: Record<string, number> = {
  "Jammu and Kashmir": 1, "Himachal Pradesh": 2, Punjab: 3, Chandigarh: 4, Uttarakhand: 5,
  Haryana: 6, Delhi: 7, Rajasthan: 8, "Uttar Pradesh": 9, Bihar: 10, Sikkim: 11,
  "Arunachal Pradesh": 12, Nagaland: 13, Manipur: 14, Mizoram: 15, Tripura: 16, Meghalaya: 17,
  Assam: 18, "West Bengal": 19, Jharkhand: 20, Odisha: 21, Chhattisgarh: 22, "Madhya Pradesh": 23,
  Gujarat: 24, "Daman and Diu": 25, "Dadra and Nagar Haveli": 26, Maharashtra: 27, Karnataka: 29,
  Goa: 30, Lakshadweep: 31, Kerala: 32, "Tamil Nadu": 33, Puducherry: 34,
  "Andaman and Nicobar Islands": 35, Telangana: 36, "Andhra Pradesh": 37, Ladakh: 38,
};
export const stateCode = (name: string): number => GST_STATE_CODES[(name || "").trim()] ?? 0;

// NIC unit quantity codes (UQC) for the common units used here.
const UQC: Record<string, string> = {
  kg: "KGS", kgs: "KGS", g: "GMS", gram: "GMS", grams: "GMS", ton: "TON", tonne: "TON", tonnes: "TON",
  nos: "NOS", no: "NOS", pcs: "PCS", piece: "PCS", pieces: "PCS", bag: "BAG", bags: "BAG",
  box: "BOX", set: "SET", pair: "PAC", roll: "ROL", metre: "MTR", meter: "MTR", m: "MTR", feet: "OTH",
  litre: "OTH", ltr: "OTH", l: "OTH", ml: "OTH", quintal: "QTL",
};
const uqc = (u: string) => UQC[(u || "").toLowerCase().trim()] ?? "OTH";

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;
const dmy = (iso: string): string => {
  const m = (iso || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : (iso || "");
};

export interface EwayForm {
  supply_type: string; sub_supply: string; doc_type: string;
  trans_mode: string; vehicle_no: string; vehicle_type: string;
  transporter_id: string; transporter_name: string; transport_doc_no: string; transport_doc_date: string;
  distance_km: string;
  from_gstin: string; from_name: string; from_addr: string; from_place: string; from_pincode: string; from_state: string;
  to_place: string; to_pincode: string;
  ewb_no: string; ewb_date: string; valid_until: string; notes: string;
}

export const emptyEwayForm = (): EwayForm => ({
  supply_type: "O", sub_supply: "1", doc_type: "INV",
  trans_mode: "1", vehicle_no: "", vehicle_type: "R",
  transporter_id: "", transporter_name: "", transport_doc_no: "", transport_doc_date: "",
  distance_km: "",
  from_gstin: "", from_name: "", from_addr: "", from_place: "", from_pincode: "", from_state: "Tamil Nadu",
  to_place: "", to_pincode: "",
  ewb_no: "", ewb_date: "", valid_until: "", notes: "",
});

export interface EwayLine { product: string; hsn: string; qty: number; unit: string; unitPrice: number; gstRate: number }
export interface EwayInvoiceData {
  invoiceNumber: string; invoiceDate: string;
  customer: string; customerGstin: string; customerState: string; customerAddress: string; customerCity: string;
  interState: boolean; cgst: number; sgst: number; igst: number; taxable: number; total: number;
  lines: EwayLine[];
}

export function buildEwayJson(inv: EwayInvoiceData, f: EwayForm): Record<string, unknown> {
  const fromSC = stateCode(f.from_state || "Tamil Nadu");
  const toSC = stateCode(inv.customerState);
  return {
    version: "1.0.1118",
    billLists: [{
      userGstin: f.from_gstin || "",
      supplyType: f.supply_type || "O",
      subSupplyType: f.sub_supply || "1",
      docType: f.doc_type || "INV",
      docNo: inv.invoiceNumber,
      docDate: dmy(inv.invoiceDate),
      fromGstin: f.from_gstin || "",
      fromTrdName: f.from_name || "",
      fromAddr1: f.from_addr || "",
      fromPlace: f.from_place || "",
      fromPincode: Number(f.from_pincode) || 0,
      fromStateCode: fromSC,
      actualFromStateCode: fromSC,
      toGstin: inv.customerGstin || "URP",
      toTrdName: inv.customer || "",
      toAddr1: inv.customerAddress || "",
      toPlace: f.to_place || inv.customerCity || "",
      toPincode: Number(f.to_pincode) || 0,
      toStateCode: toSC,
      actualToStateCode: toSC,
      transactionType: 1,
      totalValue: r2(inv.taxable),
      cgstValue: r2(inv.cgst),
      sgstValue: r2(inv.sgst),
      igstValue: r2(inv.igst),
      cessValue: 0,
      totInvValue: r2(inv.total),
      transporterId: f.transporter_id || "",
      transporterName: f.transporter_name || "",
      transDocNo: f.transport_doc_no || "",
      transMode: f.trans_mode || "1",
      transDistance: String(Number(f.distance_km) || 0),
      transDocDate: f.transport_doc_date ? dmy(f.transport_doc_date) : "",
      vehicleNo: (f.vehicle_no || "").toUpperCase().replace(/\s/g, ""),
      vehicleType: f.vehicle_type || "R",
      itemList: inv.lines.map((it, i) => ({
        itemNo: i + 1,
        productName: it.product,
        productDesc: it.product,
        hsnCode: Number(String(it.hsn).replace(/\D/g, "")) || 0,
        quantity: it.qty,
        qtyUnit: uqc(it.unit),
        taxableAmount: r2(it.qty * it.unitPrice),
        cgstRate: inv.interState ? 0 : it.gstRate / 2,
        sgstRate: inv.interState ? 0 : it.gstRate / 2,
        igstRate: inv.interState ? it.gstRate : 0,
        cessRate: 0,
      })),
    }],
  };
}

export function downloadEwayJson(inv: EwayInvoiceData, f: EwayForm): void {
  const blob = new Blob([JSON.stringify(buildEwayJson(inv, f), null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `EWB-${(inv.invoiceNumber || "invoice").replace(/[^\w.-]+/g, "_")}.json`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const esc = (s: string) => (s || "").replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string));

/** Open a print window with an e-way bill slip. */
export function printEwaySlip(inv: EwayInvoiceData, f: EwayForm): void {
  const modeLabel = ({ "1": "Road", "2": "Rail", "3": "Air", "4": "Ship" } as Record<string, string>)[f.trans_mode] || "Road";
  const rows = inv.lines.map((it) =>
    `<tr><td>${esc(it.product)}</td><td>${esc(it.hsn)}</td><td style="text-align:right">${it.qty} ${esc(it.unit)}</td><td style="text-align:right">${(it.qty * it.unitPrice).toLocaleString("en-IN")}</td></tr>`
  ).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>E-Way Bill ${esc(inv.invoiceNumber)}</title>
<style>body{font-family:Arial,sans-serif;font-size:12px;color:#111;padding:24px}h1{font-size:18px;margin:0 0 4px}
.muted{color:#555}.box{border:1px solid #999;border-radius:6px;padding:10px 12px;margin:8px 0}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:8px}
table{width:100%;border-collapse:collapse;margin-top:8px}th,td{border:1px solid #bbb;padding:4px 6px;font-size:11px}
th{background:#f2f2f2;text-align:left}.big{font-size:15px;font-weight:bold}</style></head><body>
<h1>e-Way Bill</h1>
<div class="muted">Invoice ${esc(inv.invoiceNumber)} · ${esc(dmy(inv.invoiceDate))}</div>
<div class="box grid">
  <div><b>EWB No:</b> <span class="big">${esc(f.ewb_no) || "—"}</span></div>
  <div><b>Valid until:</b> ${esc(dmy(f.valid_until)) || "—"}</div>
  <div><b>EWB Date:</b> ${esc(dmy(f.ewb_date)) || "—"}</div>
  <div><b>Mode / Distance:</b> ${modeLabel} · ${esc(f.distance_km) || "0"} km</div>
</div>
<div class="grid">
  <div class="box"><b>From</b><br>${esc(f.from_name)}<br>${esc(f.from_addr)}<br>${esc(f.from_place)} ${esc(f.from_pincode)}<br>GSTIN: ${esc(f.from_gstin) || "—"}</div>
  <div class="box"><b>To</b><br>${esc(inv.customer)}<br>${esc(inv.customerAddress)}<br>${esc(f.to_place || inv.customerCity)} ${esc(f.to_pincode)}<br>GSTIN: ${esc(inv.customerGstin) || "URP"}</div>
</div>
<div class="box"><b>Transporter:</b> ${esc(f.transporter_name) || "—"} ${f.transporter_id ? "(" + esc(f.transporter_id) + ")" : ""} &nbsp; | &nbsp; <b>Vehicle:</b> ${esc(f.vehicle_no) || "—"} &nbsp; | &nbsp; <b>Doc:</b> ${esc(f.transport_doc_no) || "—"}</div>
<table><thead><tr><th>Item</th><th>HSN</th><th style="text-align:right">Qty</th><th style="text-align:right">Taxable ₹</th></tr></thead><tbody>${rows}</tbody></table>
<div class="box grid" style="margin-top:8px">
  <div>Taxable: ₹${inv.taxable.toLocaleString("en-IN")}</div>
  <div>${inv.interState ? "IGST" : "CGST+SGST"}: ₹${(inv.cgst + inv.sgst + inv.igst).toLocaleString("en-IN")}</div>
  <div class="big">Invoice value: ₹${inv.total.toLocaleString("en-IN")}</div>
</div>
<p class="muted" style="margin-top:16px">Generated from ${esc(inv.invoiceNumber)}. This slip reflects the details entered; the legal EWB number is issued by the e-way bill portal.</p>
<script>window.onload=function(){window.print();}</script>
</body></html>`;
  const w = window.open("", "_blank", "width=820,height=900");
  if (!w) return;
  w.document.open(); w.document.write(html); w.document.close();
}
