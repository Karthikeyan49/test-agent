import { Search, Download, Eye, Plus, FileText, Loader2, Pencil, Trash2, CreditCard, IndianRupee, ArrowUp, ArrowDown, ArrowUpDown, Truck } from "lucide-react";
import { EwayBillDialog } from "@/components/EwayBillDialog";
import { type EwayInvoiceData } from "@/lib/ewayBill";
import { StatCard } from "@/components/StatCard";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter, DialogClose,
} from "@/components/ui/dialog";
import { apiFetch } from "@/lib/api/client";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { cn } from "@/lib/utils";
import {
  downloadInvoiceTemplatePdf,
  invoiceTemplatePdfObjectUrl,
  placeOfSupplyLabel,
  TERMS_AND_CONDITIONS,
  type InvoiceTemplateDraft,
} from "@/lib/invoiceTemplatePdf";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { exportToExcel } from "@/lib/exporters";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { ExportMenu, type ExportColumnDef } from "@/components/ExportMenu";

interface InvoiceItem {
  product: string;
  size: string;
  qty: number;
  unit: string;
  hsn: string;
  gstRate: number;
  unitPrice: string;
  unitPriceValue: number;
  lineTotal: string;
  lineTotalValue: number;
  discount: number;
}

interface Invoice {
  id: string;
  orderId: string;
  customer: string;
  gst: string;
  customerState: string;
  customerAddress: string;
  shipToAddress: string;
  sellerState: string;
  items: InvoiceItem[];
  subtotal: string;
  subtotalValue: number;
  gstAmount: string;
  gstAmountValue: number;
  cgstAmountValue: number;
  sgstAmountValue: number;
  igstAmountValue: number;
  deliveryFee: string;
  deliveryFeeValue: number;
  discountValue: number;
  total: string;
  totalValue: number;
  date: string;
  dueDate: string;
  invoiceDate: string;
  paymentTerms: string;
  placeOfSupplyText: string;
  shipToText: string;
  subjectText: string;
  notes: string;
  status: string;         // invoice document status (Draft/Sent/Paid/Overdue/Cancelled)
  orderStatus: string;
  paymentStatus: string;
  paymentMethod: string;
  amountPaidValue: number;
  balanceDueValue: number;
  trackingNumber: string;
  _invoiceId?: number;
}

interface ApiInvoiceRow {
  invoice_id: number;
  invoice_number: string;
  order_id: number | null;
  order_number: string | null;
  customer_name: string | null;
  customer_email?: string | null;
  customer_gstin?: string | null;
  customer_state?: string | null;
  customer_address?: string | null;
  customer_city?: string | null;
  customer_pincode?: string | null;
  customer_country?: string | null;
  seller_state?: string | null;
  due_date?: string | null;
  invoice_date?: string | null;
  payment_terms?: string | null;
  place_of_supply?: string | null;
  ship_to?: string | null;
  subject?: string | null;
  order_customer_name?: string | null;
  order_company_name?: string | null;
  order_customer_gstin?: string | null;
  order_customer_address?: string | null;
  order_customer_city?: string | null;
  order_customer_state?: string | null;
  order_customer_pincode?: string | null;
  delivery_address?: string | null;
  delivery_city?: string | null;
  delivery_state?: string | null;
  delivery_pincode?: string | null;
  order_status?: string | null;
  payment_status?: string | null;
  amount_paid?: number | null;
  balance_due?: number | null;
  subtotal: number;
  gst_rate?: number;
  gst_amount: number;
  cgst_amount?: number;
  sgst_amount?: number;
  igst_amount?: number;
  delivery_fee: number;
  discount?: number | null;
  total: number;
  status: string;
  payment_method: string | null;
  notes?: string | null;
  created_at: string;
  item_count?: number;
  items?: Array<{
    description: string;
    hsn_code: string | null;
    quantity: number;
    unit?: string | null;
    unit_price: number;
    gst_rate?: number;
    line_total: number;
  }>;
}

const inr = (n: number) => `₹${Number(n || 0).toLocaleString("en-IN")}`;

// Numeric-aware compare so INV-2 sorts before INV-10 (not lexicographically).
const cmpId = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
const invDate = (inv: Invoice) => inv.invoiceDate || inv.date || "";

const defaultInvoiceNote = "Thank you for choosing ECO Sudar and supporting green and sustainable energy.";

function addressLines(...parts: Array<string | null | undefined>): string {
  return parts
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join("\n");
}

function firstLine(value: string): string {
  return value.split("\n").find(Boolean) ?? "";
}

function toNumber(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

function normalizeOrderStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase();
  if (s === "delivered") return "Delivered";
  if (s === "shipped") return "Shipped";
  if (s === "pending") return "Pending";
  if (s === "confirmed") return "Confirmed";
  if (s === "cancelled") return "Cancelled";
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "—";
}

function normalizePaymentStatus(raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase();
  if (s === "paid") return "Paid";
  if (s === "partial" || s === "partially_paid") return "Partial";
  if (s === "pending") return "Pending";
  if (s === "unpaid") return "Unpaid";
  if (s === "refunded") return "Refunded";
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "—";
}

function normalizePayment(raw: string | null): string {
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : "—";
}

function rowToInvoice(row: ApiInvoiceRow): Invoice {
  const items: InvoiceItem[] = (row.items ?? []).map((i) => {
    const parts = i.description.split(" - ");
    const unitPriceValue = toNumber(i.unit_price);
    const lineTotalValue = toNumber(i.line_total);
    return {
      product: parts[0] || i.description,
      size: parts[1] || "",
      qty: Number(i.quantity) || 0,
      unit: i.unit || "Nos",
      hsn: i.hsn_code || "",
      gstRate: toNumber(i.gst_rate ?? row.gst_rate ?? 18),
      unitPrice: inr(unitPriceValue),
      unitPriceValue,
      lineTotal: inr(lineTotalValue),
      lineTotalValue,
      discount: 0,
    };
  });
  const displayItemCount = items.length > 0 ? items.length : (row.item_count ?? 0);
  const customer = row.customer_name ?? row.order_company_name ?? row.order_customer_name ?? "—";
  const customerState = row.customer_state || row.delivery_state || row.order_customer_state || "Tamil Nadu";
  const deliveryAddress = addressLines(row.delivery_address, row.delivery_city, row.delivery_state, row.delivery_pincode);
  const registeredAddress = addressLines(row.order_customer_address, row.order_customer_city, row.order_customer_state, row.order_customer_pincode);
  // Bill To = the invoice's own billing address (the Address Line / City / Pincode / Country
  // edited in the dialog). Falls back to the order's delivery address, then the registered one.
  const billingAddress = addressLines(row.customer_address, row.customer_city, row.customer_pincode, row.customer_country);
  const customerAddress = billingAddress || deliveryAddress || registeredAddress;
  // Ship To = the delivery address (where goods go), falling back to the billing address.
  const shipToAddress = deliveryAddress || customerAddress;
  const subtotalValue = toNumber(row.subtotal);
  const gstAmountValue = toNumber(row.gst_amount);
  const deliveryFeeValue = toNumber(row.delivery_fee);
  const discountValue    = toNumber(row.discount);
  const totalValue = toNumber(row.total);
  return {
    id: row.invoice_number,
    orderId: row.order_number ?? "—",
    customer,
    gst: row.customer_gstin ?? row.order_customer_gstin ?? "",
    customerState,
    customerAddress,
    shipToAddress,
    sellerState: row.seller_state || "Tamil Nadu",
    items: items.length > 0 ? items : Array(displayItemCount).fill(null).map((_, i) => ({
      product: `Item ${i + 1}`, size: "", qty: 0, unit: "Nos", hsn: "", gstRate: toNumber(row.gst_rate ?? 18),
      unitPrice: "—", unitPriceValue: 0, lineTotal: "—", lineTotalValue: 0, discount: 0,
    })),
    subtotal: inr(subtotalValue),
    subtotalValue,
    gstAmount: inr(gstAmountValue),
    gstAmountValue,
    cgstAmountValue: toNumber(row.cgst_amount),
    sgstAmountValue: toNumber(row.sgst_amount),
    igstAmountValue: toNumber(row.igst_amount),
    deliveryFee: inr(deliveryFeeValue),
    deliveryFeeValue,
    discountValue,
    total: inr(totalValue),
    totalValue,
    date: (row.created_at || "").slice(0, 10),
    dueDate: (row.due_date || row.created_at || "").slice(0, 10),
    invoiceDate: (row.invoice_date || "").slice(0, 10),
    paymentTerms: row.payment_terms || "",
    placeOfSupplyText: row.place_of_supply || "",
    shipToText: row.ship_to || "",
    subjectText: row.subject || "",
    notes: row.notes || defaultInvoiceNote,
    status: row.status ?? "",
    orderStatus: normalizeOrderStatus(row.order_status),
    paymentStatus: normalizePaymentStatus(row.payment_status),
    paymentMethod: normalizePayment(row.payment_method),
    amountPaidValue: toNumber(row.amount_paid),
    balanceDueValue: row.balance_due === null || row.balance_due === undefined
      ? Math.max(0, totalValue - toNumber(row.amount_paid))
      : toNumber(row.balance_due),
    trackingNumber: "",
    _invoiceId: row.invoice_id,
  };
}

const orderStatusColors: Record<string, string> = {
  // Order fulfilment statuses
  Delivered: "bg-primary/10 text-primary",
  Shipped: "bg-blue-50 text-blue-600",
  Confirmed: "bg-purple-50 text-purple-600",
  Pending: "bg-yellow-50 text-status-processing",
  Cancelled: "bg-red-100 text-red-700",
  // Invoice document statuses
  Paid: "bg-primary/10 text-primary",
  Draft: "bg-muted text-muted-foreground",
  Sent: "bg-blue-50 text-blue-600",
  Overdue: "bg-orange-50 text-orange-600",
};

// The status shown/edited on the invoice is the document status (Draft/Sent/Paid/
// Overdue/Cancelled); fall back to the linked order's fulfilment status.
function displayStatus(inv: Invoice): string {
  if (inv.status) return inv.status.charAt(0).toUpperCase() + inv.status.slice(1).toLowerCase();
  return inv.orderStatus;
}

const paymentStatusColors: Record<string, string> = {
  Paid: "bg-primary/10 text-primary",
  Pending: "bg-yellow-50 text-status-processing",
  Partial: "bg-blue-50 text-blue-600",
  Unpaid: "bg-red-50 text-red-600",
  Refunded: "bg-purple-50 text-purple-600",
};

function invoiceToTemplateDraft(inv: Invoice): InvoiceTemplateDraft {
  const billTo = [
    inv.customer,
    inv.customerAddress,
    inv.gst ? `GSTIN ${inv.gst}` : "",
  ].filter(Boolean).join("\n");
  const shipTo = [
    firstLine(inv.shipToAddress) ? inv.shipToAddress : inv.customerAddress,
    inv.gst ? `GSTIN ${inv.gst}` : "",
  ].filter(Boolean).join("\n");
  const autoSubject = inv.items
    .filter((item) => item.product && !item.product.startsWith("Item "))
    .map((item) => item.product)
    .slice(0, 2)
    .join(", ") || "ECO SUDAR BIOMASS PELLET";

  return {
    invoiceNumber: inv.id,
    invoiceDate: inv.invoiceDate || inv.date,
    dueDate: inv.dueDate || inv.date,
    terms: inv.paymentTerms || "Due on Receipt",
    placeOfSupply: inv.placeOfSupplyText || placeOfSupplyLabel(inv.customerState),
    billTo,
    shipTo: inv.shipToText || shipTo,
    subject: inv.subjectText || autoSubject,
    notes: inv.notes || defaultInvoiceNote,
    termsAndConditions: (() => { try { return localStorage.getItem("eco_inv_terms") || defaultTerms; } catch { return defaultTerms; } })(),
    sellerState: inv.sellerState,
    customerState: inv.customerState,
    deliveryFee: inv.deliveryFeeValue,
    discount: inv.discountValue,
    // A "Paid" invoice always prints ₹0 due (paid in full) even if no receipt was
    // recorded; otherwise use the tracked amount-paid / balance-due figures.
    amountPaid: inv.paymentStatus === "Paid" ? inv.totalValue : inv.amountPaidValue,
    balanceDue: inv.paymentStatus === "Paid" ? 0 : inv.balanceDueValue,
    lines: inv.items.map((item) => ({
      description: [item.product, item.size].filter(Boolean).join(" - "),
      hsn: item.hsn,
      qty: item.qty,
      unit: item.unit,
      unitPrice: item.unitPriceValue,
      gstRate: item.gstRate,
      discount: item.discount,
    })),
  };
}


const defaultTerms = TERMS_AND_CONDITIONS.join("\n");

// Normalise an invoice into the shape the e-way bill builder needs.
function toEwayData(inv: Invoice): EwayInvoiceData {
  return {
    invoiceNumber: inv.id,
    invoiceDate: inv.invoiceDate || inv.date,
    customer: inv.customer,
    customerGstin: inv.gst,
    customerState: inv.customerState,
    customerAddress: inv.customerAddress,
    customerCity: "",
    interState: inv.igstAmountValue > 0,
    cgst: inv.cgstAmountValue,
    sgst: inv.sgstAmountValue,
    igst: inv.igstAmountValue,
    taxable: Math.max(0, inv.subtotalValue - inv.discountValue),
    total: inv.totalValue,
    lines: inv.items.map((it) => ({
      product: it.product, hsn: it.hsn, qty: it.qty, unit: it.unit, unitPrice: it.unitPriceValue, gstRate: it.gstRate,
    })),
  };
}


export default function Invoices() {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Invoice | null>(null);
  const [open, setOpen] = useState(false);
  const [invoicePayments, setInvoicePayments] = useState<ApiRow[]>([]);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [paymentSaving, setPaymentSaving] = useState(false);
  const [paymentForm, setPaymentForm] = useState({
    amount: "",
    payment_mode: "Bank Transfer",
    paid_on: new Date().toISOString().slice(0, 10),
    reference_no: "",
    notes: "",
  });
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  // "current" = live order/GST invoices; "past" = historical invoices imported via Data Upload
  const [view, setView] = useState<"current" | "past">("current");
  // Table sort — by Date (invoice date) or ID (invoice number), asc/desc.
  const [sortKey, setSortKey] = useState<"date" | "id">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // Invoice PDF preview (opened by clicking a row).
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState<string | null>(null);
  const [pdfPreviewInvoice, setPdfPreviewInvoice] = useState<Invoice | null>(null);
  const [pdfPreviewBusy, setPdfPreviewBusy] = useState(false);
  const [historical, setHistorical] = useState<Invoice[]>([]);
  const [historicalLoaded, setHistoricalLoaded] = useState(false);
  const [historicalCount, setHistoricalCount] = useState(0);
  const [historicalSum, setHistoricalSum] = useState(0);
  const [historicalPage, setHistoricalPage] = useState(1);
  const [historicalLoadingMore, setHistoricalLoadingMore] = useState(false);
  const [downloadBusy, setDownloadBusy] = useState(false);
  const [xlsxBusy, setXlsxBusy] = useState(false);
  const [ewayOpen, setEwayOpen] = useState(false);

  const loadInvoices = async () => {
    try {
      const res = await apiFetch<{ success: boolean; data: ApiInvoiceRow[] }>("/admin/invoices?limit=200");
      setInvoices((res.data ?? []).map(rowToInvoice));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load invoices");
    }
  };

  // Load current invoices and (for the summary totals) past invoices on mount.
  useEffect(() => { loadInvoices(); loadHistorical(); }, []);

  const PAST_PAGE_SIZE = 200;

  // Load a page of past invoices. page 1 replaces the list; later pages append ("Load more").
  // The DB-wide count + sum come back in `pagination` so the summary cards stay accurate
  // no matter how many pages are currently loaded.
  const loadHistorical = async (page = 1) => {
    if (page === 1) { /* fresh load */ } else { setHistoricalLoadingMore(true); }
    try {
      const res = await apiFetch<{
        data: ApiInvoiceRow[];
        pagination?: { total?: number; total_amount?: number };
      }>(`/admin/historical-invoices?limit=${PAST_PAGE_SIZE}&page=${page}`, { skipCache: true });
      const mapped = (res.data ?? []).map(rowToInvoice);
      setHistorical(prev => (page === 1 ? mapped : [...prev, ...mapped]));
      setHistoricalCount(res.pagination?.total ?? mapped.length);
      setHistoricalSum(res.pagination?.total_amount ?? 0);
      setHistoricalPage(page);
      setHistoricalLoaded(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load past invoices");
    } finally {
      setHistoricalLoadingMore(false);
    }
  };

  // Build the PDF for a historical invoice straight from the row (no /admin/invoices fetch —
  // past invoices live in a separate table and have no live invoice record).
  const downloadHistorical = async (inv: Invoice) => {
    try {
      setDownloadBusy(true);
      await downloadInvoiceTemplatePdf(invoiceToTemplateDraft(inv));
      toast.success(`Downloaded ${inv.id}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadBusy(false);
    }
  };

  // Download every invoice in the active view (current or past) as an .xlsx file.
  // For past invoices we fetch all pages so the export is complete, not just the
  // rows currently loaded in the table.
  const exportXlsx = async () => {
    setXlsxBusy(true);
    try {
      let rows: Invoice[];
      let label: string;
      if (view === "past") {
        const all: Invoice[] = [];
        let page = 1;
        for (;;) {
          const res = await apiFetch<{
            data: ApiInvoiceRow[];
            pagination?: { total?: number };
          }>(`/admin/historical-invoices?limit=${PAST_PAGE_SIZE}&page=${page}`, { skipCache: true });
          const mapped = (res.data ?? []).map(rowToInvoice);
          all.push(...mapped);
          const total = res.pagination?.total ?? all.length;
          if (mapped.length === 0 || all.length >= total) break;
          page++;
        }
        rows = all;
        label = "past-invoices";
      } else {
        rows = invoices;
        label = "invoices";
      }
      if (!rows.length) { toast.error("No invoices to export"); return; }
      exportToExcel<Invoice>({
        sheetName: view === "past" ? "Past Invoices" : "Invoices",
        filename: `${label}-${new Date().toISOString().slice(0, 10)}.xlsx`,
        columns: [
          { header: "Invoice No", key: "id" },
          { header: "Date", key: (r) => r.invoiceDate || r.date || "" },
          { header: "Customer", key: "customer" },
          { header: "GSTIN", key: "gst" },
          { header: "State", key: "customerState" },
          { header: "Items", key: (r) => r.items.length },
          { header: "Subtotal", key: (r) => r.subtotalValue },
          { header: "GST", key: (r) => r.gstAmountValue },
          { header: "Total", key: (r) => r.totalValue },
          { header: "Status", key: (r) => displayStatus(r) },
          { header: "Payment", key: (r) => r.paymentStatus },
        ],
        rows,
      });
      toast.success(`Exported ${rows.length} invoice(s) to XLSX`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Export failed");
    } finally {
      setXlsxBusy(false);
    }
  };





  const source = view === "past" ? historical : invoices;
  const filtered = source.filter(inv =>
    inv.id.toLowerCase().includes(search.toLowerCase()) ||
    inv.customer.toLowerCase().includes(search.toLowerCase()) ||
    inv.orderId.toLowerCase().includes(search.toLowerCase())
  );

  // Client-side sort of the visible rows — by Date (invoice date) or ID (invoice no.).
  const sorted = [...filtered].sort((a, b) => {
    const c = sortKey === "date"
      ? (invDate(a) === invDate(b) ? cmpId(a.id, b.id) : invDate(a) < invDate(b) ? -1 : 1)
      : cmpId(a.id, b.id);
    return sortDir === "asc" ? c : -c;
  });

  const paged = usePagedRows(sorted);

  const INVOICE_EXPORT_COLUMNS: ExportColumnDef<Invoice>[] = [
    { header: "Invoice #",  key: "id" },
    { header: "Order ID",   key: "orderId" },
    { header: "Customer",   key: "customer" },
    { header: "Date",       key: "invoiceDate" },
    { header: "Total",      key: "total" },
    { header: "GST",        key: "gstAmount" },
    { header: "Status",     key: "status" },
    { header: "Payment",    key: "paymentStatus" },
    { header: "Notes",      key: "notes", group: "detail", defaultChecked: false },
  ];
  const toggleSort = (k: "date" | "id") => {
    if (sortKey === k) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(k); setSortDir(k === "date" ? "desc" : "asc"); }
  };
  const sortIcon = (k: "date" | "id") =>
    sortKey !== k ? <ArrowUpDown className="inline h-3.5 w-3.5 opacity-40" />
      : sortDir === "asc" ? <ArrowUp className="inline h-3.5 w-3.5" /> : <ArrowDown className="inline h-3.5 w-3.5" />;

  // Total sales = sum of invoice totals across the active view (current or past),
  // and the combined total of both, for the summary cards above the table.
  // Cancelled invoices are excluded from revenue (they're voided bills).
  const isCancelled = (inv: Invoice) =>
    inv.status.toLowerCase() === "cancelled" || inv.orderStatus === "Cancelled";
  const currentCounted = invoices.filter(inv => !isCancelled(inv));
  const currentTotal = currentCounted.reduce((s, inv) => s + inv.totalValue, 0);
  const pastTotal = historicalSum; // DB-wide sum (all pages, Cancelled excluded server-side)

const viewInvoice = async (inv: Invoice) => {
    try {
      const numId = inv._invoiceId;
      if (!numId) { toast.error("Invoice ID missing"); return; }
      const full = await apiFetch<{ success: boolean; data: ApiInvoiceRow }>(`/admin/invoices/${numId}`);
      const next = rowToInvoice(full.data);
      setSelected(next);
      try {
        const paymentData = await phase2Api.payments.invoicePayments(numId);
        setInvoicePayments(paymentData.payments ?? []);
      } catch {
        setInvoicePayments([]);
      }
      setOpen(true);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to load invoice");
    }
  };

  const openRecordPayment = () => {
    if (!selected?._invoiceId) return;
    setPaymentForm({
      amount: String(selected.balanceDueValue || selected.totalValue),
      payment_mode: selected.paymentMethod !== "—" ? selected.paymentMethod : "Bank Transfer",
      paid_on: new Date().toISOString().slice(0, 10),
      reference_no: "",
      notes: "",
    });
    setPaymentOpen(true);
  };

  const recordPayment = async () => {
    if (!selected?._invoiceId) return;
    const amount = toNumber(paymentForm.amount);
    if (amount <= 0) { toast.error("Payment amount must be greater than zero"); return; }
    setPaymentSaving(true);
    try {
      await phase2Api.payments.payInvoice(selected._invoiceId, {
        direction: "in",
        amount,
        payment_mode: paymentForm.payment_mode,
        paid_on: paymentForm.paid_on,
        reference_no: paymentForm.reference_no,
        notes: paymentForm.notes,
      });
      toast.success("Payment recorded");
      setPaymentOpen(false);
      await loadInvoices();
      await viewInvoice(selected);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to record payment");
    } finally {
      setPaymentSaving(false);
    }
  };

  // Fetch the saved invoice and download its PDF straight away (no intermediate popup —
  // every field is editable in the Edit dialog and stored on the invoice).
  const downloadInvoice = async (inv: Invoice) => {
    const numId = inv._invoiceId;
    if (!numId) { toast.error("Invoice ID missing"); return; }
    try {
      setDownloadBusy(true);
      const full = await apiFetch<{ success: boolean; data: ApiInvoiceRow }>(`/admin/invoices/${numId}`);
      const draft = invoiceToTemplateDraft(rowToInvoice(full.data));
      await downloadInvoiceTemplatePdf(draft);
      toast.success(`Downloaded ${draft.invoiceNumber}.pdf`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Download failed");
    } finally {
      setDownloadBusy(false);
    }
  };

  // Clicking an invoice row renders its PDF and shows an inline preview. Current
  // invoices are re-fetched for full line items; past invoices carry their items.
  const openPdfPreview = async (inv: Invoice) => {
    setPdfPreviewInvoice(inv);
    setPdfPreviewBusy(true);
    setPdfPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    try {
      let draft: InvoiceTemplateDraft;
      if (view === "past") {
        draft = invoiceToTemplateDraft(inv);
      } else {
        const numId = inv._invoiceId;
        if (!numId) { toast.error("Invoice ID missing"); setPdfPreviewInvoice(null); return; }
        const full = await apiFetch<{ success: boolean; data: ApiInvoiceRow }>(`/admin/invoices/${numId}`);
        draft = invoiceToTemplateDraft(rowToInvoice(full.data));
      }
      setPdfPreviewUrl(await invoiceTemplatePdfObjectUrl(draft));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to build PDF preview");
      setPdfPreviewInvoice(null);
    } finally {
      setPdfPreviewBusy(false);
    }
  };

  const closePdfPreview = () => {
    setPdfPreviewUrl((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });
    setPdfPreviewInvoice(null);
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Invoice Management</h1>
          <p className="text-muted-foreground">Auto-generated invoices with GST calculation</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu
            title="Invoices"
            columns={INVOICE_EXPORT_COLUMNS}
            rows={filtered}
            dateField="invoiceDate"
            filename="invoices"
          />
          <Button onClick={() => navigate('/invoices/new')} className="gap-2">
            <Plus className="h-4 w-4" /> New Invoice
          </Button>
        </div>
      </div>


      <Dialog open={open} onOpenChange={setOpen}>
        <DialogScrollContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>Invoice {selected?.id}</DialogTitle>
            <DialogDescription>Invoice details and GST breakdown.</DialogDescription>
          </DialogHeader>
          {selected && (
            <div className="space-y-3 py-2 text-sm">
              <div className="grid grid-cols-2 gap-3">
                <div><span className="text-muted-foreground">Order:</span><p className="font-medium text-card-foreground">{selected.orderId}</p></div>
                <div><span className="text-muted-foreground">Date:</span><p className="font-medium text-card-foreground">{selected.date}</p></div>
                <div><span className="text-muted-foreground">Customer:</span><p className="font-medium text-card-foreground">{selected.customer}</p></div>
                <div><span className="text-muted-foreground">GSTIN:</span><p className="font-medium text-card-foreground font-mono text-xs">{selected.gst}</p></div>
                <div><span className="text-muted-foreground">Order Status:</span><p className="font-medium text-card-foreground">{selected.orderStatus}</p></div>
                <div><span className="text-muted-foreground">Payment Status:</span><p className="font-medium text-card-foreground">{selected.paymentStatus}</p></div>
                <div><span className="text-muted-foreground">Payment Method:</span><p className="font-medium text-card-foreground">{selected.paymentMethod}</p></div>
                {selected.trackingNumber && (
                  <div><span className="text-muted-foreground">Tracking Number:</span><p className="font-medium text-card-foreground font-mono text-xs">{selected.trackingNumber}</p></div>
                )}
              </div>

              <div className="rounded-lg border bg-muted/30 p-3 flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs uppercase text-muted-foreground font-semibold">Balance Due</p>
                  <p className="text-xl font-bold text-card-foreground">{inr(selected.balanceDueValue)}</p>
                  <p className="text-xs text-muted-foreground">Paid {inr(selected.amountPaidValue)} of {selected.total}</p>
                </div>
                <Button size="sm" onClick={openRecordPayment} disabled={selected.balanceDueValue <= 0}>
                  <CreditCard className="h-4 w-4" /> Record Payment
                </Button>
              </div>

              <div className="border-t pt-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Payment Receipts</h4>
                <ScrollableX className="border rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Receipt</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Date</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Mode</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Reference</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {invoicePayments.length === 0 && (
                        <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No payments recorded yet.</td></tr>
                      )}
                      {invoicePayments.map((p) => (
                        <tr key={p.payment_id} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium text-card-foreground">{p.payment_number || p.payment_id}</td>
                          <td className="px-3 py-2 text-muted-foreground">{p.paid_on || p.payment_date || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{p.payment_mode || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{p.reference_no || p.reference_number || "—"}</td>
                          <td className="px-3 py-2 text-right font-medium text-card-foreground">{inr(p.amount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollableX>
              </div>

              <div className="border-t pt-3">
                <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Line Items</h4>
                <ScrollableX className="border rounded-lg">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-muted/50 border-b">
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Product</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Size</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">HSN</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Qty</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">Unit Price</th>
                        <th className="text-left px-3 py-2 text-xs font-semibold text-muted-foreground">GST</th>
                        <th className="text-right px-3 py-2 text-xs font-semibold text-muted-foreground">Line Total</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selected.items.map((item, i) => (
                        <tr key={i} className="border-b last:border-0">
                          <td className="px-3 py-2 font-medium text-card-foreground">{item.product}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.size}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.hsn || "—"}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.qty}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.unitPrice}</td>
                          <td className="px-3 py-2 text-muted-foreground">{item.gstRate}%</td>
                          <td className="px-3 py-2 text-right font-medium text-card-foreground">{item.lineTotal}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ScrollableX>
              </div>

              <div className="border-t pt-3 space-y-2">
                <div className="flex justify-between"><span className="text-muted-foreground">Subtotal</span><span className="font-medium text-card-foreground">{selected.subtotal}</span></div>
                {selected.igstAmountValue > 0 ? (
                  <div className="flex justify-between"><span className="text-muted-foreground">IGST</span><span className="font-medium text-card-foreground">{inr(selected.igstAmountValue)}</span></div>
                ) : selected.cgstAmountValue > 0 || selected.sgstAmountValue > 0 ? (
                  <>
                    <div className="flex justify-between"><span className="text-muted-foreground">CGST</span><span className="font-medium text-card-foreground">{inr(selected.cgstAmountValue)}</span></div>
                    <div className="flex justify-between"><span className="text-muted-foreground">SGST</span><span className="font-medium text-card-foreground">{inr(selected.sgstAmountValue)}</span></div>
                  </>
                ) : (
                  <div className="flex justify-between"><span className="text-muted-foreground">GST</span><span className="font-medium text-card-foreground">{selected.gstAmount}</span></div>
                )}
                <div className="flex justify-between"><span className="text-muted-foreground">Delivery Fee</span><span className="font-medium text-card-foreground">{selected.deliveryFee}</span></div>
                <div className="flex justify-between border-t pt-2"><span className="font-semibold text-card-foreground">Total</span><span className="font-bold text-primary text-lg">{selected.total}</span></div>
              </div>
              <div className="flex justify-between items-center pt-2">
                <span className={`text-xs px-3 py-1 rounded-full font-medium ${paymentStatusColors[selected.paymentStatus] ?? "bg-muted text-muted-foreground"}`}>
                  {selected.paymentStatus}
                </span>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEwayOpen(true)} className="gap-1.5">
                    <Truck className="h-3.5 w-3.5" /> E-Way Bill
                  </Button>
                  <Button size="sm" onClick={() => downloadInvoice(selected)} disabled={downloadBusy} className="gap-1.5">
                    {downloadBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />} Download PDF
                  </Button>
                </div>
              </div>
            </div>
          )}
          <DialogFooter><DialogClose asChild><Button variant="outline">Close</Button></DialogClose></DialogFooter>
        </DialogScrollContent>
      </Dialog>

      <Dialog open={paymentOpen} onOpenChange={setPaymentOpen}>
        <DialogScrollContent onInteractOutside={(e) => e.preventDefault()} className="max-w-md">
          <DialogHeader>
            <DialogTitle>Record Payment</DialogTitle>
            <DialogDescription>Post a receipt against invoice {selected?.id}.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Amount</Label>
              <Input className="mt-1" type="number" value={paymentForm.amount} onChange={e => setPaymentForm(f => ({ ...f, amount: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Paid on</Label>
              <Input className="mt-1" type="date" value={paymentForm.paid_on} onChange={e => setPaymentForm(f => ({ ...f, paid_on: e.target.value }))} />
            </div>
            <div>
              <Label className="text-xs">Mode</Label>
              <Select value={paymentForm.payment_mode} onValueChange={v => setPaymentForm(f => ({ ...f, payment_mode: v }))}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{["Cash", "Bank Transfer", "UPI", "Cheque", "Card"].map(m => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs">Reference</Label>
              <Input className="mt-1" value={paymentForm.reference_no} onChange={e => setPaymentForm(f => ({ ...f, reference_no: e.target.value }))} placeholder="UTR / cheque no" />
            </div>
          </div>
          <div>
            <Label className="text-xs">Notes</Label>
            <Textarea className="mt-1" value={paymentForm.notes} onChange={e => setPaymentForm(f => ({ ...f, notes: e.target.value }))} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPaymentOpen(false)} disabled={paymentSaving}>Cancel</Button>
            <Button onClick={recordPayment} disabled={paymentSaving}>
              {paymentSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />} Save Payment
            </Button>
          </DialogFooter>
        </DialogScrollContent>
      </Dialog>


      {/* Total sales summary — current, past, and combined (like the Expenses page) */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard
          title="Current Sales"
          value={inr(currentTotal)}
          subtitle={`${currentCounted.length} invoice(s)${invoices.length - currentCounted.length > 0 ? ` · ${invoices.length - currentCounted.length} cancelled` : ""}`}
          icon={IndianRupee}
        />
        <StatCard
          title="Past Sales"
          value={inr(pastTotal)}
          subtitle={`${historicalCount} invoice(s)`}
          icon={FileText}
        />
        <StatCard
          title="Total Sales"
          value={inr(currentTotal + pastTotal)}
          subtitle="current + past"
          icon={IndianRupee}
        />
      </div>

      <div className="bg-card rounded-xl border shadow-sm">
        <div className="p-4 border-b flex flex-wrap items-center gap-3">
          {/* Current vs Past (imported) invoices toggle */}
          <div className="inline-flex rounded-lg border bg-muted/40 p-0.5">
            <button
              type="button"
              onClick={() => setView("current")}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                view === "current" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Current
            </button>
            <button
              type="button"
              onClick={() => setView("past")}
              className={cn(
                "px-3 py-1.5 text-sm font-medium rounded-md transition-colors",
                view === "past" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Past invoices
            </button>
          </div>
          <div className="relative w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder={view === "past" ? "Search past invoices..." : "Search invoices..."}
              className="pl-10"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
          </div>
          {view === "past" && (
            <p className="text-xs text-muted-foreground">
              Historical invoices imported via Data Upload (read-only).
            </p>
          )}
          <Button
            variant="outline"
            size="sm"
            className="gap-2 ml-auto"
            onClick={exportXlsx}
            disabled={xlsxBusy}
            title={`Download all ${view === "past" ? "past" : "current"} invoices as XLSX`}
          >
            {xlsxBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
            Export XLSX
          </Button>
        </div>
        <ScrollableX>
          <table className="w-full">
            <thead>
              <tr className="border-b bg-muted/50">
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">
                  <button type="button" onClick={() => toggleSort("id")} className="inline-flex items-center gap-1 uppercase hover:text-foreground">Invoice {sortIcon("id")}</button>
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">
                  <button type="button" onClick={() => toggleSort("date")} className="inline-flex items-center gap-1 uppercase hover:text-foreground">Date {sortIcon("date")}</button>
                </th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Order</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Customer</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Items</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Total</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Payment</th>
                <th className="text-left px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Status</th>
                <th className="text-right px-6 py-3 text-xs font-semibold text-muted-foreground uppercase">Actions</th>
              </tr>
            </thead>
            <tbody>
              {paged.rows.map((inv) => (
                <tr
                  key={inv.id}
                  onClick={() => openPdfPreview(inv)}
                  className="border-b last:border-0 hover:bg-muted/30 transition-colors cursor-pointer"
                  title="Click to preview the invoice PDF"
                >
                  <td className="px-6 py-4 text-sm font-medium text-primary">{inv.id}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground whitespace-nowrap">{inv.invoiceDate || inv.date || "—"}</td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{inv.orderId}</td>
                  <td className="px-6 py-4">
                    <p className="text-sm font-medium text-card-foreground">{inv.customer}</p>
                    <p className="text-xs text-muted-foreground font-mono">{inv.gst}</p>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{inv.items.length} item(s)</td>
                  <td className="px-6 py-4 text-sm font-semibold text-card-foreground">{inv.total}</td>
                  <td className="px-6 py-4 text-sm">
                    <div className="space-y-1">
                      <span className={`text-xs px-2 py-1 rounded-full font-medium ${paymentStatusColors[inv.paymentStatus] ?? "bg-muted text-muted-foreground"}`}>
                        {inv.paymentStatus}
                      </span>
                      <p className="text-xs text-muted-foreground">Due {inr(inv.balanceDueValue)}</p>
                    </div>
                  </td>
                  <td className="px-6 py-4">
                    <span className={`text-xs px-3 py-1 rounded-full font-medium ${orderStatusColors[displayStatus(inv)] ?? "bg-muted text-muted-foreground"}`}>
                      {displayStatus(inv)}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-right flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                    {view === "past" ? (
                      <button onClick={() => downloadHistorical(inv)} disabled={downloadBusy} className="p-1.5 hover:bg-muted rounded-lg disabled:opacity-50" title="Download PDF"><Download className="h-4 w-4 text-muted-foreground" /></button>
                    ) : (
                      <>
                        <button onClick={() => viewInvoice(inv)} className="p-1.5 hover:bg-muted rounded-lg" title="View"><Eye className="h-4 w-4 text-muted-foreground" /></button>
                        <button onClick={() => navigate(`/invoices/${inv._invoiceId}/edit`)} className="p-1.5 hover:bg-muted rounded-lg" title="Edit"><Pencil className="h-4 w-4 text-muted-foreground" /></button>
                        <button onClick={() => downloadInvoice(inv)} disabled={downloadBusy} className="p-1.5 hover:bg-muted rounded-lg disabled:opacity-50" title="Download PDF"><Download className="h-4 w-4 text-muted-foreground" /></button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
              {filtered.length === 0 && (
                <tr><td colSpan={9} className="px-6 py-8 text-center text-muted-foreground">{view === "past" ? "No past invoices found" : "No invoices found"}</td></tr>
              )}
            </tbody>
          </table>
        </ScrollableX>

        {/* Pagination — current view only; past view uses server-side "Load more" */}
        {view !== "past" && filtered.length > 0 && (
          <Pagination {...paged} onPage={paged.setPage} noun="invoices" />
        )}

        {/* Load more — past view only, while more rows exist in the DB than are loaded */}
        {view === "past" && historical.length < historicalCount && (
          <div className="flex items-center justify-center gap-3 p-4 border-t">
            <span className="text-sm text-muted-foreground">
              Showing {historical.length} of {historicalCount}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => loadHistorical(historicalPage + 1)}
              disabled={historicalLoadingMore}
            >
              {historicalLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : "Load more"}
            </Button>
          </div>
        )}
      </div>

      {/* ── E-Way Bill ──────────────────────────────────────────────────────── */}
      <EwayBillDialog
        open={ewayOpen}
        onOpenChange={setEwayOpen}
        invoiceId={selected?._invoiceId ?? null}
        inv={selected ? toEwayData(selected) : null}
      />

      {/* ── Invoice PDF preview (click a row) ───────────────────────────────── */}
      <Dialog open={!!pdfPreviewInvoice} onOpenChange={(o) => { if (!o) closePdfPreview(); }}>
        <DialogContent className="max-w-4xl h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="px-6 py-4 border-b">
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" /> Invoice Preview — {pdfPreviewInvoice?.id}
            </DialogTitle>
            <DialogDescription>Preview of how this invoice PDF looks.</DialogDescription>
          </DialogHeader>
          <div className="flex-1 min-h-0 bg-muted/30">
            {pdfPreviewBusy || !pdfPreviewUrl ? (
              <div className="flex h-full items-center justify-center text-muted-foreground">
                <Loader2 className="h-6 w-6 animate-spin mr-2" /> Rendering preview…
              </div>
            ) : (
              <iframe src={pdfPreviewUrl} title="Invoice PDF preview" className="w-full h-full border-0" />
            )}
          </div>
          <DialogFooter className="px-6 py-3 border-t">
            <Button variant="outline" onClick={closePdfPreview}>Close</Button>
            <Button
              disabled={downloadBusy || !pdfPreviewInvoice}
              onClick={() => {
                if (!pdfPreviewInvoice) return;
                if (view === "past") downloadHistorical(pdfPreviewInvoice);
                else downloadInvoice(pdfPreviewInvoice);
              }}
            >
              {downloadBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Download PDF
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
