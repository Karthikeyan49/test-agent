import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Camera, Download, FileText, Loader2, Pencil, Plus, QrCode, Search, Trash2, Upload, Users, X } from "lucide-react";
import { HrImportWizard } from "@/components/HrImportWizard";
import jsPDF from "jspdf";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogScrollContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { StatCard } from "@/components/StatCard";
import { QrImage } from "@/components/QrImage";
import { toast } from "sonner";
import QRCode from "qrcode";
import idFrontSrc from "@/assets/id-front.png";
import idBackSrc from "@/assets/id-back.png";
import { getAuthToken, BASE_URL } from "@/lib/api/client";
import {
  employeesApi,
  DEPARTMENTS,
  EMPLOYMENT_TYPES,
  type Department,
  type Employee,
  type EmployeePayload,
  type EmploymentType,
  type QualificationRow,
} from "@/lib/api/hr";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { TableSkeleton } from "@/components/TableSkeleton";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { ExportMenu, type ExportColumnDef } from "@/components/ExportMenu";

const EMPLOYEE_EXPORT_COLUMNS: ExportColumnDef<Employee>[] = [
  { header: "ID",          key: "id" },
  { header: "Name",        key: "name" },
  { header: "Department",  key: "department" },
  { header: "Designation", key: "designation" },
  { header: "Phone",       key: "phone" },
  { header: "Email",       key: "email" },
  { header: "Base Salary", key: "baseSalary" },
  { header: "Joined",      key: "joinedAt" },
  { header: "Status",      key: "active",    group: "detail", defaultChecked: false },
  { header: "Aadhaar",     key: "aadhaarNumber", group: "detail", defaultChecked: false },
];

const inr = (n: number) => `₹${n.toLocaleString("en-IN")}`;

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const emptyQualification = (): QualificationRow => ({
  qualification: "",
  institution: "",
  year: "",
  grade: "",
});

const emptyForm = (): EmployeePayload => ({
  customId: "",
  name: "",
  email: "",
  phone: "",
  alternatePhone: "",
  department: "",
  designation: "",
  employmentType: "permanent",
  baseSalary: 0,
  joinedAt: "",
  communicationAddress: "",
  permanentAddress: "",
  sameAsCommunicationAddress: false,
  aadhaarNumber: "",
  dob: "",
  bloodGroup: "",
  experience: "",
  relativesWorking: false,
  relativesDetails: "",
  qualifications: [emptyQualification()],
  bankAccountHolder: "",
  bankName: "",
  bankAccountNumber: "",
  bankIfsc: "",
  bankBranch: "",
  pfEnabled: true,
  pfPercent: 12,
  bonusPercent: 0,
  attendanceBonusAmount: 750,
  esiEnabled: false,
  esiEmployeePercent: 0.75,
  siteAllowance: 0,
  da: 0,
  foodAllowance: 0,
  travelAllowance: 0,
  insurancePdfPath: null,
  insurancePdfName: null,
  insuranceFile: null,
  photoPath: null,
  photoFile: null,
  deletePhoto: false,
  uniformIssued: false,
  uniformIssuedAt: "",
  uniformValidUntil: "",
  shoesIssued: false,
  shoesIssuedAt: "",
  shoesValidUntil: "",
  active: true,
});

const cleanQualifications = (rows: QualificationRow[] = []) =>
  rows
    .map((row) => ({
      qualification: row.qualification.trim(),
      institution: row.institution.trim(),
      year: row.year.trim(),
      grade: row.grade.trim(),
    }))
    .filter((row) => Object.values(row).some(Boolean));

const oneYearFrom = (date?: string) => {
  if (!date) return "";
  const d = new Date(`${date}T00:00:00`);
  d.setFullYear(d.getFullYear() + 1);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

const employmentLabel = (value?: string) =>
  EMPLOYMENT_TYPES.find((item) => item.value === value)?.label ?? "Permanent";

const errorMessage = (error: unknown) => error instanceof Error ? error.message : "Something went wrong";
const employeeIdInput = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);

export default function Employees() {
  const navigate = useNavigate();
  const [items, setItems] = useState<Employee[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [deptFilter, setDeptFilter] = useState<string>("all");

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Employee | null>(null);
  const [form, setForm] = useState<EmployeePayload>(emptyForm());
  const [photoTs, setPhotoTs] = useState(() => Date.now());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDownloading, setBulkDownloading] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Employee | null>(null);
  const [qrFor, setQrFor] = useState<Employee | null>(null);
  const [importOpen, setImportOpen] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const employees = await employeesApi.list();
      setItems(employees);
    }
    catch (error) { toast.error(errorMessage(error)); }
    finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const filtered = useMemo(() => items.filter((e) => {
    if (deptFilter !== "all" && e.department !== deptFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      const haystack = [
        e.name,
        e.id,
        e.designation,
        e.email,
        e.phone,
        e.alternatePhone,
        e.aadhaarNumber,
        e.employmentType,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!haystack.includes(q)) return false;
    }
    return true;
  }), [items, deptFilter, search]);

  const paged = usePagedRows(filtered);

  const stats = useMemo(() => {
    const active = items.filter((e) => e.active).length;
    const payroll = items.reduce((s, e) => s + (e.active ? e.baseSalary : 0), 0);
    return { total: items.length, active, payroll, depts: new Set(items.map((e) => e.department).filter(Boolean)).size };
  }, [items]);

  const setField = <K extends keyof EmployeePayload>(key: K, value: EmployeePayload[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  const setCommunicationAddress = (value: string) => {
    setForm((prev) => ({
      ...prev,
      communicationAddress: value,
      permanentAddress: prev.sameAsCommunicationAddress ? value : prev.permanentAddress,
    }));
  };

  const setSameAddress = (checked: boolean) => {
    setForm((prev) => ({
      ...prev,
      sameAsCommunicationAddress: checked,
      permanentAddress: checked ? prev.communicationAddress : prev.permanentAddress,
    }));
  };

  const updateQualification = (index: number, key: keyof QualificationRow, value: string) => {
    setForm((prev) => {
      const rows = [...(prev.qualifications ?? [])];
      rows[index] = { ...(rows[index] ?? emptyQualification()), [key]: value };
      return { ...prev, qualifications: rows };
    });
  };

  const addQualification = () => {
    setForm((prev) => ({ ...prev, qualifications: [...(prev.qualifications ?? []), emptyQualification()] }));
  };

  const removeQualification = (index: number) => {
    setForm((prev) => {
      const rows = (prev.qualifications ?? []).filter((_, i) => i !== index);
      return { ...prev, qualifications: rows.length ? rows : [emptyQualification()] };
    });
  };

  const openCreate = () => { setEditing(null); setForm(emptyForm()); setDialogOpen(true); };
  const openEdit = (e: Employee) => {
    setEditing(e);
    const { id, qrToken, ...rest } = e;
    setForm({
      ...emptyForm(),
      ...rest,
      customId: id,
      insuranceFile: null,
      photoFile: null,
      deletePhoto: false,
      qualifications: e.qualifications?.length ? e.qualifications : [emptyQualification()],
    });
    setDialogOpen(true);
  };

  const onPhotoFile = (file?: File) => {
    if (!file) {
      setForm((prev) => ({ ...prev, photoFile: null }));
      return;
    }
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];
    if (!allowedTypes.includes(file.type)) {
      toast.error("Photo must be JPG, PNG or WebP");
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      toast.error("Photo must be 3 MB or less");
      return;
    }
    setForm((prev) => ({ ...prev, photoFile: file, deletePhoto: false }));
  };

  // Build photo URL — includes a timestamp so the browser never serves a stale cached image
  const photoUrl = (employeeId: string, bust?: string | number) => {
    const token = getAuthToken();
    const params = new URLSearchParams();
    if (token) params.set("token", token);
    if (bust)  params.set("t", String(bust));
    const qs = params.toString();
    return `${BASE_URL}/admin/employees/${employeeId}/photo${qs ? `?${qs}` : ''}`;
  };

  // Preview URL for the selected photo (either new file or existing server path)
  const photoPreview = form.photoFile
    ? URL.createObjectURL(form.photoFile)
    : form.photoPath && editing?.id
    ? photoUrl(editing.id, photoTs)
    : null;

  const onInsuranceFile = (file?: File) => {
    if (!file) {
      setForm((prev) => ({ ...prev, insuranceFile: null }));
      return;
    }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Insurance document must be a PDF");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Insurance PDF must be 5 MB or less");
      return;
    }
    setForm((prev) => ({ ...prev, insuranceFile: file, insurancePdfName: file.name }));
  };

  const onSubmit = async () => {
    // Only Name and Phone are required — all other fields are optional
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    if (!form.phone.trim()) { toast.error("Mobile number is required"); return; }
    const customId = employeeIdInput(form.customId ?? "");
    if (editing && !customId) { toast.error("Employee ID is required"); return; }

    const payload: EmployeePayload = {
      ...form,
      customId,
      permanentAddress: form.sameAsCommunicationAddress ? form.communicationAddress : form.permanentAddress,
      qualifications: cleanQualifications(form.qualifications ?? []),
      uniformValidUntil: form.uniformIssued ? oneYearFrom(form.uniformIssuedAt) : "",
      shoesValidUntil: form.shoesIssued ? oneYearFrom(form.shoesIssuedAt) : "",
    };

    try {
      if (editing) await employeesApi.update(editing.id, payload);
      else await employeesApi.create(payload);
      toast.success(editing ? "Employee updated" : "Employee added");
      setPhotoTs(Date.now());
      setDialogOpen(false); load();
    } catch (error) { toast.error(errorMessage(error)); }
  };

  const onDelete = async () => {
    if (!confirmDelete) return;
    try {
      await employeesApi.remove(confirmDelete.id);
      toast.success("Employee deactivated"); setConfirmDelete(null); load();
    } catch (error) { toast.error(errorMessage(error)); }
  };

  // ─── Helper: load a same-origin / data-URL image ────────────────────────────
  const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => reject(new Error(`Image load failed: ${src.slice(0, 80)}`));
      img.src = src;
    });

  // ─── Helper: load a cross-origin image via fetch → blob → objectURL ────────
  // This is needed for employee photos hosted on the API server.
  // Using fetch+blob avoids CORS canvas-tainting issues.
  const loadImageViaFetch = async (url: string): Promise<HTMLImageElement> => {
    const token = getAuthToken();
    const headers: Record<string, string> = {};
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const resp = await fetch(url, { headers });
    if (!resp.ok) throw new Error(`Photo fetch failed (${resp.status}): ${url}`);
    const blob = await resp.blob();
    const blobUrl = URL.createObjectURL(blob);
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error(`Decode failed: ${url}`)); };
      img.src = blobUrl;
    });
  };

  // ─── Draw circle-cropped photo onto canvas ───────────────────────────────────
  const drawCirclePhoto = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement,
    cx: number, cy: number, r: number,
    borderColor = "#c92020", borderWidth = 8
  ) => {
    ctx.save();
    // Red border ring
    ctx.beginPath();
    ctx.arc(cx, cy, r + borderWidth, 0, Math.PI * 2);
    ctx.fillStyle = borderColor;
    ctx.fill();
    // Clip and draw photo inside circle
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.clip();
    const side = Math.min(img.naturalWidth, img.naturalHeight);
    const sx = (img.naturalWidth  - side) / 2;
    const sy = (img.naturalHeight - side) / 2;
    ctx.drawImage(img, sx, sy, side, side, cx - r, cy - r, r * 2, r * 2);
    ctx.restore();
  };

  // ─── Generate FRONT side canvas ────────────────────────────────────────────
  const buildFrontCanvas = async (e: Employee): Promise<HTMLCanvasElement> => {
    const W = 590, H = 1004;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const fc = canvas.getContext("2d")!;

    // 1. Draw the CLEAN template (all sample data pre-removed by PIL script)
    const tpl = await loadImage(idFrontSrc);
    fc.drawImage(tpl, 0, 0, W, H);

    // 2. ── Draw the employee photo ────────────────────────────────────────────
    // Pixel-perfect positions measured from original 1.png (590×1004):
    //   Circle center = (307, 402), outer_r = 145, inner_r = 138, border ~7px
    const PHOTO_CX = 307, PHOTO_CY = 402, PHOTO_R = 138;
    if (e.photoPath) {
      try {
        // Use fetch-based loader to handle cross-origin photos safely
        const pUrl = photoUrl(e.id, photoTs);
        const photoImg = await loadImageViaFetch(pUrl);
        drawCirclePhoto(fc, photoImg, PHOTO_CX, PHOTO_CY, PHOTO_R, "#c92020", 7);
      } catch (err) {
        console.warn("Photo load failed:", err);
        // Grey placeholder with initial
        fc.beginPath(); fc.arc(PHOTO_CX, PHOTO_CY, PHOTO_R + 7, 0, Math.PI * 2); fc.fillStyle = "#c92020"; fc.fill();
        fc.beginPath(); fc.arc(PHOTO_CX, PHOTO_CY, PHOTO_R, 0, Math.PI * 2); fc.fillStyle = "#d1d5db"; fc.fill();
        fc.fillStyle = "#6b7280";
        fc.font = `bold ${PHOTO_R}px system-ui, sans-serif`;
        fc.textAlign = "center"; fc.textBaseline = "middle";
        fc.fillText(e.name.charAt(0).toUpperCase(), PHOTO_CX, PHOTO_CY);
      }
    } else {
      // No photo uploaded — draw placeholder with initial letter
      fc.beginPath(); fc.arc(PHOTO_CX, PHOTO_CY, PHOTO_R + 7, 0, Math.PI * 2); fc.fillStyle = "#c92020"; fc.fill();
      fc.beginPath(); fc.arc(PHOTO_CX, PHOTO_CY, PHOTO_R, 0, Math.PI * 2); fc.fillStyle = "#e5e7eb"; fc.fill();
      fc.fillStyle = "#6b7280";
      fc.font = `bold ${PHOTO_R}px system-ui, sans-serif`;
      fc.textAlign = "center"; fc.textBaseline = "middle";
      fc.fillText(e.name.charAt(0).toUpperCase(), PHOTO_CX, PHOTO_CY);
    }

    // 3. ── Draw employee text ─────────────────────────────────────────────────
    // Positions measured from original template pixel analysis:
    //   Name block:  y=600..627, centered, ~34px font
    //   Desig block: y=669..691, centered, ~24px font
    //   ID block:    y=751..768, x starts 87, ~22px font
    //   Phone block: y=804..821, x starts 87, ~22px font

    // Name (bold, centered) — baseline at y=627 (bottom of 28px block starting at 600)
    fc.textAlign = "center"; fc.textBaseline = "alphabetic";
    fc.fillStyle = "#111111"; fc.font = "bold 34px 'Arial Black', 'Arial', sans-serif";
    fc.fillText(e.name.toUpperCase(), W / 2, 627);

    // Designation (bold, centered) — baseline at y=691
    fc.fillStyle = "#333333"; fc.font = "bold 28px 'Arial', sans-serif";
    fc.fillText((e.designation || "Employee").toUpperCase(), W / 2, 691);

    // ID Number (left-aligned with label) — baseline at y=768
    fc.textAlign = "left"; fc.fillStyle = "#333333"; fc.font = "bold 26px 'Arial', sans-serif";
    fc.fillText("ID Number", 87, 768);
    fc.fillText(":", 225, 768);
    fc.font = "26px 'Arial', sans-serif";
    fc.fillText(e.id, 250, 768);

    // Phone (left-aligned with label) — baseline at y=821
    fc.font = "bold 26px 'Arial', sans-serif";
    fc.fillText("Phone", 87, 821);
    fc.fillText(":", 225, 821);
    fc.font = "26px 'Arial', sans-serif";
    const phone = e.phone.replace(/^\+91\s?/, "");
    fc.fillText(`+91 ${phone}`, 250, 821);

    return canvas;
  };


  // ─── Generate BACK side canvas ─────────────────────────────────────────────
  const buildBackCanvas = async (e: Employee): Promise<HTMLCanvasElement> => {
    const W = 590, H = 1004;
    const canvas = document.createElement("canvas");
    canvas.width = W; canvas.height = H;
    const bc = canvas.getContext("2d")!;

    // 1. Draw the back template (has company contact info at bottom — keep it)
    const tpl = await loadImage(idBackSrc);
    bc.drawImage(tpl, 0, 0, W, H);

    // 2. QR code in the center white area
    const QR_SIZE = 280, QR_X = (W - QR_SIZE) / 2, QR_Y = 220;
    const qrDataUrl = await QRCode.toDataURL(e.qrToken, {
      width: QR_SIZE * 2, margin: 1, errorCorrectionLevel: "M",
      color: { dark: "#111111", light: "#ffffff" },
    });
    const qrImg = await loadImage(qrDataUrl);

    // White bg behind QR for clean look
    bc.fillStyle = "#ffffff";
    bc.fillRect(QR_X - 12, QR_Y - 12, QR_SIZE + 24, QR_SIZE + 24);
    bc.drawImage(qrImg, QR_X, QR_Y, QR_SIZE, QR_SIZE);

    // Employee name + ID below QR
    bc.textAlign = "center"; bc.textBaseline = "alphabetic";
    bc.fillStyle = "#111111"; bc.font = "bold 22px 'Arial', sans-serif";
    bc.fillText(e.name.toUpperCase(), W / 2, QR_Y + QR_SIZE + 38);
    bc.fillStyle = "#333333"; bc.font = "18px 'Arial', sans-serif";
    bc.fillText(`${e.id}  •  ${e.designation || "Employee"}`, W / 2, QR_Y + QR_SIZE + 64);
    bc.fillStyle = "#666666"; bc.font = "13px 'Courier New', monospace";
    bc.fillText(e.qrToken, W / 2, QR_Y + QR_SIZE + 88);

    return canvas;
  };

  // ─── Download helpers ──────────────────────────────────────────────────────
  const triggerDownload = (canvas: HTMLCanvasElement, filename: string) => {
    const a = document.createElement("a");
    a.href = canvas.toDataURL("image/png");
    a.download = filename;
    a.click();
  };

  const downloadFront = async (e: Employee) => {
    try {
      const canvas = await buildFrontCanvas(e);
      triggerDownload(canvas, `${e.id}-${e.name.replace(/\s+/g, "_")}-Front.png`);
      toast.success("Front ID card downloaded");
    } catch (err) {
      console.error("Front card failed:", err);
      toast.error("Could not generate front ID card");
    }
  };

  const downloadBack = async (e: Employee) => {
    try {
      const canvas = await buildBackCanvas(e);
      triggerDownload(canvas, `${e.id}-${e.name.replace(/\s+/g, "_")}-Back.png`);
      toast.success("Back ID card downloaded");
    } catch (err) {
      console.error("Back card failed:", err);
      toast.error("Could not generate back ID card");
    }
  };

  const downloadBoth = async (e: Employee) => {
    try {
      const front = await buildFrontCanvas(e);
      triggerDownload(front, `${e.id}-${e.name.replace(/\s+/g, "_")}-Front.png`);
      await new Promise((r) => setTimeout(r, 400));
      const back = await buildBackCanvas(e);
      triggerDownload(back, `${e.id}-${e.name.replace(/\s+/g, "_")}-Back.png`);
      toast.success("ID card downloaded (Front + Back)");
    } catch (err) {
      console.error("ID card failed:", err);
      toast.error("Could not generate ID card");
    }
  };

  // ─── Bulk PDF: 3 IDs per page, A4 landscape ──────────────────────────────
  const downloadBulkPdf = async (side: "front" | "back") => {
    const employees = selectedIds.size > 0
      ? filtered.filter((e) => selectedIds.has(e.id))
      : filtered;
    if (employees.length === 0) { toast.error("No employees to download"); return; }

    setBulkDownloading(true);
    const toastId = toast.loading(`Generating ${side} IDs PDF for ${employees.length} employee${employees.length > 1 ? "s" : ""}…`);

    try {
      // A4 landscape: 297 × 210 mm — 3 IDs per page, reduced & centred
      const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
      const PAGE_W = 297, PAGE_H = 210;

      const CARD_W  = 72;                         // reduced width (was ~92 mm)
      const CARD_H  = CARD_W * (1004 / 590);      // ~122.5 mm (aspect-locked)
      const COLS    = 3;
      const GAP_X   = 8;                          // gap between cards
      const TOTAL_W = COLS * CARD_W + (COLS - 1) * GAP_X;
      const START_X = (PAGE_W - TOTAL_W) / 2;     // centre horizontally
      const START_Y = (PAGE_H - CARD_H) / 2;      // centre vertically

      // Border style
      const BORDER_R = 141 / 255, BORDER_G = 0, BORDER_B = 0; // #8D0000 (deep red)
      const BORDER_T = 0.6;        // line thickness mm
      const RADIUS   = 2;          // corner radius mm

      const buildCanvas = side === "front" ? buildFrontCanvas : buildBackCanvas;

      for (let i = 0; i < employees.length; i++) {
        const col = i % 3;
        if (i > 0 && col === 0) doc.addPage();

        const cardX = START_X + col * (CARD_W + GAP_X);
        const cardY = START_Y;

        // Draw card image
        const canvas  = await buildCanvas(employees[i]);
        const imgData = canvas.toDataURL("image/jpeg", 0.92);
        doc.addImage(imgData, "JPEG", cardX, cardY, CARD_W, CARD_H);

        // Draw border on top of image edges
        doc.setDrawColor(BORDER_R * 255, BORDER_G, BORDER_B * 255);
        doc.setLineWidth(BORDER_T);
        doc.roundedRect(cardX, cardY, CARD_W, CARD_H, RADIUS, RADIUS);
      }

      doc.save(`Employee-${side}-IDs-${new Date().toISOString().slice(0, 10)}.pdf`);
      toast.success(`PDF downloaded — ${employees.length} ${side} ID${employees.length > 1 ? "s" : ""}`, { id: toastId });
    } catch (err) {
      console.error("Bulk PDF failed:", err);
      toast.error("PDF generation failed", { id: toastId });
    } finally {
      setBulkDownloading(false);
    }
  };

  const allFilteredSelected = filtered.length > 0 && filtered.every((e) => selectedIds.has(e.id));
  const toggleSelectAll = () => {
    if (allFilteredSelected) {
      setSelectedIds((prev) => { const next = new Set(prev); filtered.forEach((e) => next.delete(e.id)); return next; });
    } else {
      setSelectedIds((prev) => { const next = new Set(prev); filtered.forEach((e) => next.add(e.id)); return next; });
    }
  };
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => { const next = new Set(prev); next.has(id) ? next.delete(id) : next.add(id); return next; });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Employees</h1>
          <p className="text-muted-foreground">Manage staff and generate QR codes for attendance.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setImportOpen(true)}>
            <Upload className="h-4 w-4" /> Import
          </Button>
          <ExportMenu title="Employees" columns={EMPLOYEE_EXPORT_COLUMNS} rows={filtered} filename="employees" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" disabled={bulkDownloading}>
                {bulkDownloading
                  ? <Loader2 className="h-4 w-4 animate-spin" />
                  : <Download className="h-4 w-4" />}
                Download IDs
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => downloadBulkPdf("front")}>
                <Download className="h-4 w-4 mr-2" />
                Front IDs PDF
                <span className="ml-auto text-xs text-muted-foreground pl-4">
                  {selectedIds.size > 0 ? `${selectedIds.size} selected` : `all ${filtered.length}`}
                </span>
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => downloadBulkPdf("back")}>
                <Download className="h-4 w-4 mr-2" />
                Back IDs PDF
                <span className="ml-auto text-xs text-muted-foreground pl-4">
                  {selectedIds.size > 0 ? `${selectedIds.size} selected` : `all ${filtered.length}`}
                </span>
              </DropdownMenuItem>
              {selectedIds.size > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => setSelectedIds(new Set())} className="text-muted-foreground">
                    Clear selection
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
          <Button onClick={() => navigate("/employees/new")}><Plus className="h-4 w-4" />Add Employee</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard title="Total Staff" value={String(stats.total)} subtitle={`${stats.active} active`} icon={Users} />
        <StatCard title="Departments" value={String(stats.depts)} subtitle="active" icon={QrCode} />
        <StatCard title="Monthly Payroll" value={inr(stats.payroll)} subtitle="gross base" icon={Download} />
        <StatCard title="Avg. Salary" value={stats.active ? inr(Math.round(stats.payroll / stats.active)) : "₹0"} subtitle="per active" icon={Pencil} subtitleColor="muted" />
      </div>

      <div className="bg-card rounded-xl border p-4 shadow-sm flex flex-wrap gap-3 items-center">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="Search name, ID, mobile, Aadhaar or role..." value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={deptFilter} onValueChange={setDeptFilter}>
          <SelectTrigger className="w-44"><SelectValue placeholder="Department" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All departments</SelectItem>
            {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {/* Bulk action toolbar — shown when employees are selected */}
      {selectedIds.size > 0 && (
        <div className="bg-primary/5 border border-primary/20 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-foreground">
            {selectedIds.size} employee{selectedIds.size > 1 ? "s" : ""} selected
          </span>
          <div className="flex gap-2 ml-auto flex-wrap">
            <Button
              size="sm"
              variant="outline"
              disabled={bulkDownloading}
              onClick={() => downloadBulkPdf("front")}
              className="gap-1.5"
            >
              {bulkDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download Front IDs (PDF)
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={bulkDownloading}
              onClick={() => downloadBulkPdf("back")}
              className="gap-1.5"
            >
              {bulkDownloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              Download Back IDs (PDF)
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setSelectedIds(new Set())}
              className="text-muted-foreground"
            >
              <X className="h-3.5 w-3.5 mr-1" />Clear
            </Button>
          </div>
        </div>
      )}

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="px-4 py-3 w-10">
                  <Checkbox
                    checked={allFilteredSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all"
                  />
                </th>
                <th className="text-left px-4 py-3 font-medium">ID</th>
                <th className="text-left px-4 py-3 font-medium">Name</th>
                <th className="text-left px-4 py-3 font-medium">Department</th>
                <th className="text-left px-4 py-3 font-medium">Role</th>
                <th className="text-left px-4 py-3 font-medium">Designation</th>
                <th className="text-left px-4 py-3 font-medium">Contact</th>
                <th className="text-right px-4 py-3 font-medium">Salary</th>
                <th className="text-left px-4 py-3 font-medium">Status</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={10} />}
              {!loading && filtered.length === 0 && <tr><td colSpan={10} className="text-center py-10 text-muted-foreground">No employees.</td></tr>}
              {!loading && paged.rows.map((e) => (
                <tr key={e.id} className={`border-t hover:bg-muted/30 ${selectedIds.has(e.id) ? "bg-primary/5" : ""}`}>
                  <td className="px-4 py-3">
                    <Checkbox
                      checked={selectedIds.has(e.id)}
                      onCheckedChange={() => toggleSelect(e.id)}
                      aria-label={`Select ${e.name}`}
                    />
                  </td>
                  <td className="px-4 py-3 font-medium text-card-foreground">{e.id}</td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      {e.photoPath ? (
                        <img
                          src={photoUrl(e.id, photoTs)}
                          alt={e.name}
                          className="h-8 w-8 rounded-full object-cover border shrink-0"
                        />
                      ) : (
                        <div className="h-8 w-8 rounded-full bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                          {e.name.charAt(0).toUpperCase()}
                        </div>
                      )}
                      <div>
                        <div className="font-medium">{e.name}</div>
                        {e.insurancePdfName && <div className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground"><FileText className="h-3 w-3" />Insurance PDF</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3"><span className="text-xs px-2 py-1 rounded-full bg-secondary text-secondary-foreground">{e.department || "Not set"}</span></td>
                  <td className="px-4 py-3 text-muted-foreground">{employmentLabel(e.employmentType)}</td>
                  <td className="px-4 py-3 text-muted-foreground">{e.designation || "Not set"}</td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">{e.email || "No email"}<br/>{e.phone}</td>
                  <td className="px-4 py-3 text-right font-semibold">{inr(e.baseSalary)}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs px-2 py-1 rounded-full ${e.active ? "bg-primary/10 text-primary" : "bg-destructive/10 text-destructive"}`}>
                      {e.active ? "Active" : "Inactive"}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="inline-flex gap-1 items-center">
                      <Button size="icon" variant="ghost" title="View QR" onClick={() => setQrFor(e)}><QrCode className="h-4 w-4" /></Button>
                      <Button size="sm" variant="outline" className="h-8 px-2 text-xs" title="Download Front ID" onClick={() => downloadFront(e)}>
                        <Download className="h-3 w-3 mr-1" />Front
                      </Button>
                      <Button size="sm" variant="outline" className="h-8 px-2 text-xs" title="Download Back ID" onClick={() => downloadBack(e)}>
                        <Download className="h-3 w-3 mr-1" />Back
                      </Button>
                      <Button size="icon" variant="ghost" onClick={() => navigate(`/employees/${e.id}/edit`)}><Pencil className="h-4 w-4" /></Button>
                      <Button size="icon" variant="ghost" onClick={() => setConfirmDelete(e)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
      </div>
      {!loading && filtered.length > 0 && (
        <Pagination {...paged} onPage={paged.setPage} noun="employees" />
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogScrollContent onInteractOutside={(e) => e.preventDefault()} className=" max-w-5xl">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Employee" : "Add Employee"}</DialogTitle>
            <DialogDescription>
              {editing
                ? `Editing ${editing.id}`
                : "Only Name and Mobile Number are required. All other fields are optional."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6">
            <section className="space-y-3">
              <h3 className="text-sm font-semibold text-foreground">Basic Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                {/* Photo upload — spans full row on mobile, 1 col on desktop */}
                <div className="md:col-span-4 flex items-center gap-4">
                  {/* Avatar preview */}
                  <div className="relative shrink-0">
                    {photoPreview ? (
                      <img
                        src={photoPreview}
                        alt="Employee photo"
                        className="h-20 w-20 rounded-full object-cover border-2 border-border"
                      />
                    ) : (
                      <div className="h-20 w-20 rounded-full bg-muted flex items-center justify-center border-2 border-dashed border-border">
                        <Camera className="h-8 w-8 text-muted-foreground" />
                      </div>
                    )}
                    {photoPreview && (
                      <button
                        type="button"
                        onClick={() => setForm((prev) => ({ ...prev, photoFile: null, photoPath: null, deletePhoto: true }))}
                        className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    <Label>Employee Photo</Label>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Button type="button" variant="outline" size="sm" asChild>
                        <span><Upload className="h-4 w-4" />{photoPreview ? "Change Photo" : "Upload Photo"}</span>
                      </Button>
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="hidden"
                        onChange={(e) => onPhotoFile(e.target.files?.[0])}
                      />
                    </label>
                    <p className="text-xs text-muted-foreground">JPG, PNG or WebP · max 3 MB</p>
                  </div>
                </div>
                <div className="md:col-span-2">
                  <Label>Employee ID {!editing && <span className="text-xs font-normal text-muted-foreground">(optional)</span>}</Label>
                  <Input
                    value={form.customId ?? ""}
                    maxLength={12}
                    onChange={(e) => setField("customId", employeeIdInput(e.target.value))}
                    placeholder="e.g. EMP-010"
                  />
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {editing ? "Update the employee ID used across HR records." : "Leave empty to auto-generate (EMP-001, EMP-002...)."}
                  </p>
                </div>
                <div className="md:col-span-2">
                  <Label>Full Name <span className="text-destructive">*</span></Label>
                  <Input value={form.name} onChange={(e) => setField("name", e.target.value)} />
                </div>
                <div>
                  <Label>Email <span className="text-xs font-normal text-muted-foreground">(optional)</span></Label>
                  <Input type="email" value={form.email} onChange={(e) => setField("email", e.target.value)} />
                </div>
                <div>
                  <Label>Mobile Number <span className="text-destructive">*</span></Label>
                  <Input value={form.phone} onChange={(e) => setField("phone", e.target.value)} />
                </div>
                <div><Label>Alternate Number</Label><Input value={form.alternatePhone ?? ""} onChange={(e) => setField("alternatePhone", e.target.value)} /></div>
                <div><Label>Aadhaar Number</Label><Input value={form.aadhaarNumber ?? ""} onChange={(e) => setField("aadhaarNumber", e.target.value)} /></div>
                <div><Label>Date of Birth</Label><Input type="date" value={form.dob ?? ""} onChange={(e) => setField("dob", e.target.value)} /></div>
                <div>
                  <Label>Blood Group</Label>
                  <Select value={form.bloodGroup || "none"} onValueChange={(v) => setField("bloodGroup", v === "none" ? "" : v)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not set</SelectItem>
                      {BLOOD_GROUPS.map((group) => <SelectItem key={group} value={group}>{group}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold text-foreground">Employment</h3>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
                <div>
                  <Label>Department</Label>
                  <Select value={form.department || "none"} onValueChange={(v) => setField("department", v === "none" ? "" : v as Department)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">Not set</SelectItem>
                      {DEPARTMENTS.map((d) => <SelectItem key={d} value={d}>{d}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div><Label>Designation</Label><Input value={form.designation} onChange={(e) => setField("designation", e.target.value)} /></div>
                <div>
                  <Label>Role Type</Label>
                  <Select value={form.employmentType ?? "permanent"} onValueChange={(v) => setField("employmentType", v as EmploymentType)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>{EMPLOYMENT_TYPES.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div><Label>Joined</Label><Input type="date" value={form.joinedAt} onChange={(e) => setField("joinedAt", e.target.value)} /></div>
                <div><Label>Experience</Label><Input value={form.experience ?? ""} onChange={(e) => setField("experience", e.target.value)} placeholder="2 years" /></div>
                <div><Label>Base Salary (₹/mo)</Label><Input type="number" min="0" value={form.baseSalary || ""} onChange={(e) => setField("baseSalary", Number(e.target.value.replace(/^0+(?=\d)/, "")))} /></div>
                <div className="flex items-center gap-2 pt-7">
                  <Checkbox id="active" checked={form.active} onCheckedChange={(checked) => setField("active", checked === true)} />
                  <Label htmlFor="active" className="cursor-pointer">Active employee</Label>
                </div>
              </div>
            </section>

            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold text-foreground">Address</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div><Label>Communication Address</Label><Textarea value={form.communicationAddress ?? ""} onChange={(e) => setCommunicationAddress(e.target.value)} /></div>
                <div><Label>Permanent Address</Label><Textarea value={form.permanentAddress ?? ""} disabled={form.sameAsCommunicationAddress} onChange={(e) => setField("permanentAddress", e.target.value)} /></div>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox id="same-address" checked={form.sameAsCommunicationAddress} onCheckedChange={(checked) => setSameAddress(checked === true)} />
                <Label htmlFor="same-address" className="cursor-pointer">Permanent address same as communication address</Label>
              </div>
            </section>

            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold text-foreground">Bank Details</h3>
              <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
                <div><Label>Account Holder</Label><Input value={form.bankAccountHolder ?? ""} onChange={(e) => setField("bankAccountHolder", e.target.value)} /></div>
                <div><Label>Bank Name</Label><Input value={form.bankName ?? ""} onChange={(e) => setField("bankName", e.target.value)} /></div>
                <div><Label>Account Number</Label><Input value={form.bankAccountNumber ?? ""} onChange={(e) => setField("bankAccountNumber", e.target.value)} /></div>
                <div><Label>IFSC</Label><Input value={form.bankIfsc ?? ""} onChange={(e) => setField("bankIfsc", e.target.value.toUpperCase())} /></div>
                <div><Label>Branch</Label><Input value={form.bankBranch ?? ""} onChange={(e) => setField("bankBranch", e.target.value)} /></div>
              </div>
            </section>

            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold text-foreground">Payroll Options</h3>
              <div className="grid grid-cols-1 md:grid-cols-8 gap-3">
                <div className="flex items-center gap-2 pt-7">
                  <Checkbox id="pf-enabled" checked={form.pfEnabled} onCheckedChange={(checked) => setField("pfEnabled", checked === true)} />
                  <Label htmlFor="pf-enabled" className="cursor-pointer">PF Opt-in</Label>
                </div>
                <div><Label>PF %</Label><Input type="number" min="0" step="0.01" disabled={!form.pfEnabled} value={form.pfPercent ?? 12} onChange={(e) => setField("pfPercent", Number(e.target.value))} /></div>
                <div className="flex items-center gap-2 pt-7">
                  <Checkbox id="esi-enabled" checked={form.esiEnabled} onCheckedChange={(checked) => setField("esiEnabled", checked === true)} />
                  <Label htmlFor="esi-enabled" className="cursor-pointer">ESI Opt-in</Label>
                </div>
                <div><Label>ESI Employee %</Label><Input type="number" min="0" step="0.01" disabled={!form.esiEnabled} value={form.esiEmployeePercent ?? 0.75} onChange={(e) => setField("esiEmployeePercent", Number(e.target.value))} /></div>
                <div>
                  <Label>Attendance Bonus Amount</Label>
                  <Input
                    type="text"
                    inputMode="decimal"
                    value={form.attendanceBonusAmount === undefined ? "750" : String(form.attendanceBonusAmount)}
                    onChange={(e) => {
                      const cleaned = e.target.value
                        .replace(/[^\d.]/g, "")
                        .replace(/^0+(?=\d)/, "");
                      setField("attendanceBonusAmount", cleaned === "" ? 0 : Number(cleaned));
                    }}
                  />
                </div>
                <div><Label>Site Allowance</Label><Input type="number" min="0" value={form.siteAllowance ?? 0} onChange={(e) => setField("siteAllowance", Number(e.target.value))} /></div>
                <div><Label>DA</Label><Input type="number" min="0" value={form.da ?? 0} onChange={(e) => setField("da", Number(e.target.value))} /></div>
                <div><Label>Food Allowance</Label><Input type="number" min="0" value={form.foodAllowance ?? 0} onChange={(e) => setField("foodAllowance", Number(e.target.value))} /></div>
                <div><Label>Travel Allowance</Label><Input type="number" min="0" value={form.travelAllowance ?? 0} onChange={(e) => setField("travelAllowance", Number(e.target.value))} /></div>
              </div>
            </section>

            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold text-foreground">Relatives & Qualifications</h3>
              <div className="space-y-3">
                <div className="flex items-center gap-2">
                  <Checkbox id="relatives-working" checked={form.relativesWorking} onCheckedChange={(checked) => setField("relativesWorking", checked === true)} />
                  <Label htmlFor="relatives-working" className="cursor-pointer">Relatives working with EcoSudar</Label>
                </div>
                {form.relativesWorking && <Textarea value={form.relativesDetails ?? ""} onChange={(e) => setField("relativesDetails", e.target.value)} placeholder="Name, relation, department..." />}
              </div>

              <div className="space-y-2">
                {(form.qualifications ?? [emptyQualification()]).map((row, index) => (
                  <div key={index} className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_120px_40px] gap-2 items-end">
                    <div><Label>Qualification</Label><Input value={row.qualification} onChange={(e) => updateQualification(index, "qualification", e.target.value)} /></div>
                    <div><Label>Institution</Label><Input value={row.institution} onChange={(e) => updateQualification(index, "institution", e.target.value)} /></div>
                    <div><Label>Year</Label><Input value={row.year} onChange={(e) => updateQualification(index, "year", e.target.value)} /></div>
                    <div><Label>Grade</Label><Input value={row.grade} onChange={(e) => updateQualification(index, "grade", e.target.value)} /></div>
                    <Button type="button" size="icon" variant="ghost" onClick={() => removeQualification(index)}><X className="h-4 w-4" /></Button>
                  </div>
                ))}
                <Button type="button" size="sm" variant="outline" onClick={addQualification}><Plus className="h-4 w-4" />Add Qualification</Button>
              </div>
            </section>

            <section className="space-y-3 border-t pt-4">
              <h3 className="text-sm font-semibold text-foreground">Documents & Assets</h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div>
                  <Label>Insurance PDF</Label>
                  <Input type="file" accept="application/pdf,.pdf" onChange={(e) => onInsuranceFile(e.target.files?.[0])} />
                  {form.insurancePdfName && <p className="mt-1 text-xs text-muted-foreground">{form.insurancePdfName}</p>}
                </div>
                <div className="flex items-center gap-2 pt-7">
                  <Checkbox id="uniform-issued" checked={form.uniformIssued} onCheckedChange={(checked) => setField("uniformIssued", checked === true)} />
                  <Label htmlFor="uniform-issued" className="cursor-pointer">Uniform issued</Label>
                </div>
                <div><Label>Uniform Issue Date</Label><Input type="date" disabled={!form.uniformIssued} value={form.uniformIssuedAt ?? ""} onChange={(e) => setField("uniformIssuedAt", e.target.value)} /></div>
                <div className="text-xs text-muted-foreground md:col-start-3">Valid until: {form.uniformIssued ? oneYearFrom(form.uniformIssuedAt) || "Not set" : "Not issued"}</div>
                <div className="flex items-center gap-2 pt-7">
                  <Checkbox id="shoes-issued" checked={form.shoesIssued} onCheckedChange={(checked) => setField("shoesIssued", checked === true)} />
                  <Label htmlFor="shoes-issued" className="cursor-pointer">Shoes issued</Label>
                </div>
                <div><Label>Shoes Issue Date</Label><Input type="date" disabled={!form.shoesIssued} value={form.shoesIssuedAt ?? ""} onChange={(e) => setField("shoesIssuedAt", e.target.value)} /></div>
                <div className="text-xs text-muted-foreground pt-8">Valid until: {form.shoesIssued ? oneYearFrom(form.shoesIssuedAt) || "Not set" : "Not issued"}</div>
              </div>
            </section>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
            <Button onClick={onSubmit}>{editing ? "Save changes" : "Add employee"}</Button>
          </DialogFooter>
        </DialogScrollContent>
      </Dialog>

      <Dialog open={!!qrFor} onOpenChange={(o) => !o && setQrFor(null)}>
        <DialogScrollContent className="max-w-md">
          {qrFor && (
            <>
              <DialogHeader>
                <DialogTitle>{qrFor.name}</DialogTitle>
                <DialogDescription>{qrFor.id} - {qrFor.designation || "Employee"}</DialogDescription>
              </DialogHeader>
              <div className="flex flex-col items-center gap-3 py-4">
                <div className="bg-white p-4 rounded-lg border inline-block">
                  <QrImage value={qrFor.qrToken} size={200} />
                </div>
                <code className="text-xs bg-muted px-2 py-1 rounded">{qrFor.qrToken}</code>
                <p className="text-xs text-muted-foreground text-center">Print and give to the employee. They scan it at the QR kiosk for check-in/out.</p>
              </div>
              <DialogFooter className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Button variant="outline" onClick={() => setQrFor(null)}>Close</Button>
                <Button variant="outline" onClick={() => downloadFront(qrFor)} className="gap-1"><Download className="h-4 w-4" /> Front</Button>
                <Button variant="outline" onClick={() => downloadBack(qrFor)} className="gap-1"><Download className="h-4 w-4" /> Back</Button>
                <Button onClick={() => downloadBoth(qrFor)} className="gap-1"><Download className="h-4 w-4" /> Both</Button>
              </DialogFooter>
            </>
          )}
        </DialogScrollContent>
      </Dialog>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate employee?</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmDelete && <>This marks <strong>{confirmDelete.name}</strong> ({confirmDelete.id}) as inactive and preserves their attendance and payroll history.</>}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={onDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <HrImportWizard kind="employees" open={importOpen} onClose={() => setImportOpen(false)} onDone={load} />
    </div>
  );
}
