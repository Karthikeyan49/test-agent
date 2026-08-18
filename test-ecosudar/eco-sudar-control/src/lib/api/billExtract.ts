/**
 * billExtract.ts
 * Hybrid OCR strategy:
 *   1. Try backend Groq Llama 4 Scout Vision API (structured JSON output)
 *   2. If backend returns fallback:true (quota exceeded) → run Tesseract.js in-browser
 *   3. Returns structured { date, vendor, amount, category, description }
 */
import { apiFetch } from "./client";
import { toast } from "sonner";

export interface ExtractedBill {
  date: string;       // YYYY-MM-DD or ""
  vendor: string;
  amount: number;
  category: string;
  description: string;
}

interface ExtractResponse extends ExtractedBill {
  fallback: boolean;
  reason?: string;
}

// ── Category keyword map ─────────────────────────────────────────────────────
const CATEGORY_KEYWORDS: Record<string, string[]> = {
  "Fuel & Transport":      ["petrol", "diesel", "fuel", "transport", "cab", "uber", "ola", "auto", "bus", "train", "flight", "travel", "highway", "toll", "parking"],
  "Utilities":             ["electricity", "water", "gas", "internet", "broadband", "phone", "mobile", "recharge", "bsnl", "airtel", "jio", "vi ", "vodafone", "tangedco", "bescom", "msedcl", "tneb"],
  "Office Stationery":     ["stationery", "pen", "paper", "printer", "ink", "toner", "notebook", "folder", "stapler", "file", "envelope"],
  "Raw Material":          ["biomass", "wood", "coal", "material", "raw", "supply", "chemicals", "pellet", "aggregate", "sand", "cement", "scrap", "metal"],
  "Maintenance & Repairs": ["repair", "maintenance", "service", "servicing", "fix", "plumber", "electrician", "carpenter", "welding", "painting", "labour"],
  "Salary & Wages":        ["salary", "wages", "labour", "worker", "staff", "payroll", "advance", "bonus"],
  "Marketing":             ["advertising", "ad ", "ads", "banner", "hording", "digital", "social media", "promotion", "campaign"],
  "Food & Hospitality":    ["food", "hotel", "restaurant", "catering", "tea", "canteen", "lunch", "dinner", "snacks", "beverages", "mess", "tiffin", "meals"],
  "Logistics & Freight":   ["freight", "courier", "delivery", "shipping", "lorry", "truck", "vehicle hire", "loading", "unloading", "transport charge"],
  "Professional Services": ["consultant", "legal", "audit", "accounting", "professional", "chartered", "advocate", "notary", "architect"],
  "IT & Software":         ["software", "license", "subscription", "cloud", "hosting", "domain", "amazon", "google", "microsoft", "zoho", "tally"],
  "Equipment Purchase":    ["machine", "equipment", "tool", "generator", "pump", "motor", "lathe", "compressor", "grinder", "drill"],
  "Printing & Packaging":  ["printing", "packaging", "carton", "box", "bag", "wrapper", "label", "sticker", "flex"],
  "Bank Charges":          ["bank charge", "service charge", "interest", "emi", "commission", "transaction fee", "processing fee"],
  "Taxes & Compliance":    ["gst", "cgst", "sgst", "igst", "tax", "vat", "income tax", "tds", "compliance", "challan", "pt "],
};

function guessCategory(text: string): string {
  const lower = text.toLowerCase();
  let best = "Miscellaneous";
  let bestScore = 0;
  for (const [cat, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    const score = keywords.reduce((s, k) => s + (lower.includes(k) ? 1 : 0), 0);
    if (score > bestScore) { bestScore = score; best = cat; }
  }
  return best;
}

function extractAmount(text: string): number {
  // Tesseract often OCRs ₹ incorrectly. We look for labeled totals first, 
  // then fall back to collecting all numbers and returning the maximum.
  
  const amounts: number[] = [];

  // Priority 1: Labeled total lines (most reliable)
  const labeledPatterns = [
    /(?:grand\s*total|net\s*payable|net\s*amount|total\s*amount|amount\s*due|bill\s*amount|payable\s*amount|total\s*payable)[^\d]*([0-9]+[,.]?[0-9]*(?:[,.]?[0-9]+)?)/gi,
    /(?:total|subtotal|sub\s*total)[^\d]{0,5}([0-9]+[,.]?[0-9]*(?:[,.]?[0-9]+)?)/gi,
  ];
  for (const p of labeledPatterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const n = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(n) && n > 0) amounts.push(n);
    }
  }

  // Priority 2: Currency symbols (₹ or Rs, but Tesseract may garble)
  const currencyPatterns = [
    /[₹Rs.]+\s*([0-9]+[,.]?[0-9]*(?:[,.]?[0-9]+)?)/gi,
  ];
  for (const p of currencyPatterns) {
    let m;
    while ((m = p.exec(text)) !== null) {
      const n = parseFloat(m[1].replace(/,/g, ""));
      if (!isNaN(n) && n > 0) amounts.push(n);
    }
  }

  if (amounts.length) {
    // Return the largest found amount (Grand Total is usually the biggest)
    return Math.max(...amounts);
  }

  // Fallback: collect ALL numbers > 10 from the text and return the largest
  const allNums: number[] = [];
  const numRe = /\b([0-9]{2,}(?:[,.][0-9]+)?)\b/g;
  let nm;
  while ((nm = numRe.exec(text)) !== null) {
    const n = parseFloat(nm[1].replace(/,/g, ""));
    if (!isNaN(n) && n > 10) allNums.push(n);
  }
  return allNums.length ? Math.max(...allNums) : 0;
}

function extractDate(text: string): string {
  // Indian bills usually use DD/MM/YYYY or DD-MM-YYYY
  const patterns: Array<[RegExp, "dmy" | "ymd"]> = [
    [/\b(\d{2})[\/\-.](\d{2})[\/\-.](\d{4})\b/, "dmy"],   // DD/MM/YYYY
    [/\b(\d{4})[\/\-.](\d{2})[\/\-.](\d{2})\b/, "ymd"],   // YYYY-MM-DD
    [/\b(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2})\b/, "dmy"], // DD/MM/YY
  ];
  for (const [p, fmt] of patterns) {
    const m = text.match(p);
    if (!m) continue;
    if (fmt === "ymd") return `${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const [d, mo] = [m[1].padStart(2, "0"), m[2].padStart(2, "0")];
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${mo}-${d}`;
  }
  return "";
}

function extractVendor(lines: string[]): string {
  // Skip very short lines, lines that are all numbers, and common header noise
  const noise = /^(invoice|bill|receipt|tax|date|gst|gstin|phone|mobile|address|no[.:]\s*\d|serial|sl\.?\s*no|page)/i;
  for (const line of lines.slice(0, 8)) {
    const clean = line.trim();
    // Must be 3–70 chars, contain at least one letter, not noisy
    if (clean.length >= 3 && clean.length <= 70 &&
        /[A-Za-z]/.test(clean) && !noise.test(clean) &&
        !/^\d/.test(clean)) {
      return clean;
    }
  }
  return "";
}

async function runTesseract(imageDataUrl: string): Promise<ExtractedBill> {
  const toastId = toast.loading("Scanning bill with Tesseract OCR…");
  try {
    const { createWorker, PSM } = await import("tesseract.js");
    const worker = await createWorker("eng");
    
    // PSM (Page Segmentation Mode) 11 = "Sparse text. Find as much text as possible in no particular order."
    // This is significantly better for receipts / bills than the default layout analysis.
    // We also remove the character whitelist, as strict whitelists disable Tesseract's internal dictionaries, causing garbled text.
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.SPARSE_TEXT,
    });
    const { data: { text } } = await worker.recognize(imageDataUrl);
    await worker.terminate();

    // Debug: log raw OCR so user can see what Tesseract picked up
    console.debug("[Tesseract OCR raw text]\n", text);

    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const amount   = extractAmount(text);
    const date     = extractDate(text);
    const vendor   = extractVendor(lines);
    const category = guessCategory(text);

    console.debug("[Tesseract extracted]", { date, vendor, amount, category });

    toast.dismiss(toastId);
    toast.info(
      `Tesseract: amount=${amount > 0 ? amount : "not found"}, ` +
      `category=${category}, vendor="${vendor || "not found"}"`,
      { duration: 6000 }
    );

    return {
      date,
      vendor,
      amount,
      category,
      description: lines.slice(0, 5).join(" | ").slice(0, 300),
    };
  } catch (err) {
    toast.dismiss(toastId);
    throw err;
  }
}

// ── Public function ─────────────────────────────────────────────────────────
export async function extractBillData(imageDataUrl: string): Promise<ExtractedBill> {
  // 1. Try Gemini via backend
  try {
    const res = await apiFetch<{ success: boolean; data: ExtractResponse }>(
      "/admin/expenses/extract-bill",
      { method: "POST", body: JSON.stringify({ image: imageDataUrl }) }
    );

    if (res.data && !res.data.fallback) {
      const { fallback: _, reason: __, ...fields } = res.data;
      console.debug("[Gemini extracted]", fields);
      return fields as ExtractedBill;
    }

    // Gemini daily quota hit
    console.warn("[billExtract] Groq quota exceeded — switching to Tesseract.js");
    toast.warning("Groq quota exceeded. Using Tesseract OCR (less accurate).");
  } catch (err: any) {
    console.warn("[billExtract] Groq error, falling back to Tesseract:", err.message);
    toast.warning("Groq unavailable — using Tesseract OCR as fallback.");
  }

  // 2. Fall back to Tesseract.js
  return runTesseract(imageDataUrl);
}
