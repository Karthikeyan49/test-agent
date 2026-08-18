import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { Camera, Plus, Upload, Users, X } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  employeesApi,
  DEPARTMENTS,
  EMPLOYMENT_TYPES,
  type Department,
  type EmployeePayload,
  type EmploymentType,
  type QualificationRow,
} from "@/lib/api/hr";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import { getAuthToken, BASE_URL } from "@/lib/api/client";

const BLOOD_GROUPS = ["A+", "A-", "B+", "B-", "AB+", "AB-", "O+", "O-"];

const emptyQualification = (): QualificationRow => ({
  qualification: "", institution: "", year: "", grade: "",
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
    .map((r) => ({
      qualification: r.qualification.trim(),
      institution: r.institution.trim(),
      year: r.year.trim(),
      grade: r.grade.trim(),
    }))
    .filter((r) => Object.values(r).some(Boolean));

const oneYearFrom = (date?: string) => {
  if (!date) return "";
  const d = new Date(`${date}T00:00:00`);
  d.setFullYear(d.getFullYear() + 1);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
};

const employeeIdInput = (value: string) =>
  value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 12);

const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong");

function Field({
  label,
  children,
  req,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
  req?: boolean;
}) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-sm text-muted-foreground">
        {label} {req && <Req />}
      </Label>
      <div>{children}</div>
    </div>
  );
}

export default function EmployeeForm() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const editing = !!id;

  const [form, setForm] = useState<EmployeePayload>(emptyForm());
  const [initial, setInitial] = useState(JSON.stringify(emptyForm()));
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);
  const [photoTs] = useState(() => Date.now());

  const set = <K extends keyof EmployeePayload>(key: K, value: EmployeePayload[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const setCommunicationAddress = (value: string) =>
    setForm((prev) => ({
      ...prev,
      communicationAddress: value,
      permanentAddress: prev.sameAsCommunicationAddress ? value : prev.permanentAddress,
    }));

  const setSameAddress = (checked: boolean) =>
    setForm((prev) => ({
      ...prev,
      sameAsCommunicationAddress: checked,
      permanentAddress: checked ? prev.communicationAddress : prev.permanentAddress,
    }));

  const updateQualification = (index: number, key: keyof QualificationRow, value: string) =>
    setForm((prev) => {
      const rows = [...(prev.qualifications ?? [])];
      rows[index] = { ...(rows[index] ?? emptyQualification()), [key]: value };
      return { ...prev, qualifications: rows };
    });

  const addQualification = () =>
    setForm((prev) => ({
      ...prev,
      qualifications: [...(prev.qualifications ?? []), emptyQualification()],
    }));

  const removeQualification = (index: number) =>
    setForm((prev) => {
      const rows = (prev.qualifications ?? []).filter((_, i) => i !== index);
      return { ...prev, qualifications: rows.length ? rows : [emptyQualification()] };
    });

  useEffect(() => {
    if (!editing || !id) return;
    setLoading(true);
    employeesApi
      .list()
      .then((employees) => {
        const emp = employees.find((e) => e.id === id);
        if (!emp) {
          toast.error("Employee not found");
          navigate("/employees");
          return;
        }
        const { id: empId, qrToken: _qr, ...rest } = emp;
        const next: EmployeePayload = {
          ...emptyForm(),
          ...rest,
          customId: empId,
          insuranceFile: null,
          photoFile: null,
          deletePhoto: false,
          qualifications: emp.qualifications?.length
            ? emp.qualifications
            : [emptyQualification()],
        };
        setForm(next);
        setInitial(JSON.stringify(next));
      })
      .catch((e) => toast.error(errMsg(e)))
      .finally(() => setLoading(false));
  }, [id, editing, navigate]);

  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial]);
  useUnsavedChanges(dirty && !saving, "employee-form");

  const photoUrl = (empId: string) => {
    const token = getAuthToken();
    const params = new URLSearchParams();
    if (token) params.set("token", token);
    params.set("t", String(photoTs));
    return `${BASE_URL}/admin/employees/${empId}/photo?${params.toString()}`;
  };

  const photoPreview = form.photoFile
    ? URL.createObjectURL(form.photoFile)
    : form.photoPath && id
    ? photoUrl(id)
    : null;

  const onPhotoFile = (file?: File) => {
    if (!file) { set("photoFile", null); return; }
    if (!["image/jpeg", "image/png", "image/webp"].includes(file.type)) {
      toast.error("Photo must be JPG, PNG or WebP");
      return;
    }
    if (file.size > 3 * 1024 * 1024) { toast.error("Photo must be 3 MB or less"); return; }
    setForm((prev) => ({ ...prev, photoFile: file, deletePhoto: false }));
  };

  const onInsuranceFile = (file?: File) => {
    if (!file) { set("insuranceFile", null); return; }
    if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) {
      toast.error("Insurance document must be a PDF");
      return;
    }
    if (file.size > 5 * 1024 * 1024) { toast.error("Insurance PDF must be 5 MB or less"); return; }
    setForm((prev) => ({ ...prev, insuranceFile: file, insurancePdfName: file.name }));
  };

  const submit = async () => {
    if (!form.name.trim()) { toast.error("Name is required"); return; }
    if (!form.phone.trim()) { toast.error("Mobile number is required"); return; }
    const customId = employeeIdInput(form.customId ?? "");
    if (editing && !customId) { toast.error("Employee ID is required"); return; }

    setSaving(true);
    try {
      const payload: EmployeePayload = {
        ...form,
        customId,
        permanentAddress: form.sameAsCommunicationAddress
          ? form.communicationAddress
          : form.permanentAddress,
        qualifications: cleanQualifications(form.qualifications ?? []),
        uniformValidUntil: form.uniformIssued ? oneYearFrom(form.uniformIssuedAt) : "",
        shoesValidUntil: form.shoesIssued ? oneYearFrom(form.shoesIssuedAt) : "",
      };
      if (editing) {
        await employeesApi.update(id!, payload);
        toast.success("Employee updated");
      } else {
        await employeesApi.create(payload);
        toast.success("Employee added");
      }
      setInitial(JSON.stringify(form));
      navigate("/employees");
    } catch (e) {
      toast.error(errMsg(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title={editing ? "Edit Employee" : "New Employee"}
      description="Only Name and Mobile Number are required. All other fields are optional."
      icon={<Users className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/employees")}
      backLabel="Employees"
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/employees")} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || loading}>
            {saving ? "Saving…" : editing ? "Save Employee" : "Add Employee"}
          </Button>
        </>
      }
    >
      {loading ? (
        <p className="text-sm text-muted-foreground">Loading employee…</p>
      ) : (
        <Tabs defaultValue="personal" className="w-full">
          <TabsList>
            <TabsTrigger value="personal">Personal</TabsTrigger>
            <TabsTrigger value="employment">Employment</TabsTrigger>
            <TabsTrigger value="payroll">Payroll</TabsTrigger>
            <TabsTrigger value="bank">Bank Details</TabsTrigger>
            <TabsTrigger value="documents">Documents</TabsTrigger>
          </TabsList>

          {/* ── Personal ─────────────────────────────────────────── */}
          <TabsContent value="personal" className="pt-4">
            <div className="max-w-3xl space-y-3">
              <Field label="Photo">
                <div className="flex items-center gap-4">
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
                        onClick={() =>
                          setForm((prev) => ({
                            ...prev,
                            photoFile: null,
                            photoPath: null,
                            deletePhoto: true,
                          }))
                        }
                        className="absolute -top-1 -right-1 h-5 w-5 rounded-full bg-destructive text-white flex items-center justify-center"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div className="space-y-1">
                    <label className="flex items-center gap-2 cursor-pointer">
                      <Button type="button" variant="outline" size="sm" asChild>
                        <span>
                          <Upload className="h-4 w-4 mr-1" />
                          {photoPreview ? "Change Photo" : "Upload Photo"}
                        </span>
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
              </Field>

              <Field label="Employee ID">
                <div>
                  <Input
                    value={form.customId ?? ""}
                    maxLength={12}
                    onChange={(e) => set("customId", employeeIdInput(e.target.value))}
                    placeholder="e.g. EMP-010"
                  />
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {editing
                      ? "Update the employee ID used across HR records."
                      : "Leave empty to auto-generate (EMP-001, EMP-002...)."}
                  </p>
                </div>
              </Field>

              <Field label="Full Name" req>
                <Input value={form.name} onChange={(e) => set("name", e.target.value)} />
              </Field>
              <Field label="Email">
                <Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} />
              </Field>
              <Field label="Mobile" req>
                <Input value={form.phone} onChange={(e) => set("phone", e.target.value)} />
              </Field>
              <Field label="Alternate Phone">
                <Input
                  value={form.alternatePhone ?? ""}
                  onChange={(e) => set("alternatePhone", e.target.value)}
                />
              </Field>
              <Field label="Aadhaar Number">
                <Input
                  value={form.aadhaarNumber ?? ""}
                  onChange={(e) => set("aadhaarNumber", e.target.value)}
                />
              </Field>
              <Field label="Date of Birth">
                <Input
                  type="date"
                  value={form.dob ?? ""}
                  onChange={(e) => set("dob", e.target.value)}
                  className="max-w-[200px]"
                />
              </Field>
              <Field label="Blood Group">
                <Select
                  value={form.bloodGroup || "none"}
                  onValueChange={(v) => set("bloodGroup", v === "none" ? "" : v)}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {BLOOD_GROUPS.map((g) => (
                      <SelectItem key={g} value={g}>
                        {g}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Communication Address">
                <Textarea
                  rows={2}
                  value={form.communicationAddress ?? ""}
                  onChange={(e) => setCommunicationAddress(e.target.value)}
                />
              </Field>
              <Field label="Permanent Address">
                <div>
                  <Textarea
                    rows={2}
                    value={form.permanentAddress ?? ""}
                    disabled={form.sameAsCommunicationAddress}
                    onChange={(e) => set("permanentAddress", e.target.value)}
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <Checkbox
                      id="same-address"
                      checked={form.sameAsCommunicationAddress}
                      onCheckedChange={(checked) => setSameAddress(checked === true)}
                    />
                    <Label htmlFor="same-address" className="cursor-pointer text-sm font-normal">
                      Same as communication address
                    </Label>
                  </div>
                </div>
              </Field>
            </div>
          </TabsContent>

          {/* ── Employment ───────────────────────────────────────── */}
          <TabsContent value="employment" className="pt-4">
            <div className="max-w-3xl space-y-3">
              <Field label="Department">
                <Select
                  value={form.department || "none"}
                  onValueChange={(v) =>
                    set("department", v === "none" ? "" : (v as Department))
                  }
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Not set</SelectItem>
                    {DEPARTMENTS.map((d) => (
                      <SelectItem key={d} value={d}>
                        {d}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Designation">
                <Input
                  value={form.designation}
                  onChange={(e) => set("designation", e.target.value)}
                />
              </Field>
              <Field label="Role Type">
                <Select
                  value={form.employmentType ?? "permanent"}
                  onValueChange={(v) => set("employmentType", v as EmploymentType)}
                >
                  <SelectTrigger className="w-48">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {EMPLOYMENT_TYPES.map((item) => (
                      <SelectItem key={item.value} value={item.value}>
                        {item.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Joined Date">
                <Input
                  type="date"
                  value={form.joinedAt}
                  onChange={(e) => set("joinedAt", e.target.value)}
                  className="max-w-[200px]"
                />
              </Field>
              <Field label="Experience">
                <Input
                  value={form.experience ?? ""}
                  onChange={(e) => set("experience", e.target.value)}
                  placeholder="2 years"
                  className="max-w-[220px]"
                />
              </Field>
              <Field label="Base Salary (₹/mo)">
                <Input
                  type="number"
                  min="0"
                  value={form.baseSalary || ""}
                  onChange={(e) =>
                    set("baseSalary", Number(e.target.value.replace(/^0+(?=\d)/, "")))
                  }
                  className="max-w-[220px]"
                />
              </Field>
              <Field label="Status">
                <div className="flex items-center gap-2 pt-1">
                  <Checkbox
                    id="active"
                    checked={form.active}
                    onCheckedChange={(checked) => set("active", checked === true)}
                  />
                  <Label htmlFor="active" className="cursor-pointer font-normal">
                    Active employee
                  </Label>
                </div>
              </Field>
            </div>
          </TabsContent>

          {/* ── Payroll ──────────────────────────────────────────── */}
          <TabsContent value="payroll" className="pt-4">
            <div className="max-w-3xl space-y-3">
              <Field label="PF">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="pf-enabled"
                    checked={form.pfEnabled}
                    onCheckedChange={(checked) => set("pfEnabled", checked === true)}
                  />
                  <Label htmlFor="pf-enabled" className="cursor-pointer font-normal">
                    Opt-in
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!form.pfEnabled}
                    value={form.pfPercent ?? 12}
                    onChange={(e) => set("pfPercent", Number(e.target.value))}
                    className="max-w-[100px]"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </Field>
              <Field label="ESI">
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="esi-enabled"
                    checked={form.esiEnabled}
                    onCheckedChange={(checked) => set("esiEnabled", checked === true)}
                  />
                  <Label htmlFor="esi-enabled" className="cursor-pointer font-normal">
                    Opt-in
                  </Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    disabled={!form.esiEnabled}
                    value={form.esiEmployeePercent ?? 0.75}
                    onChange={(e) => set("esiEmployeePercent", Number(e.target.value))}
                    className="max-w-[100px]"
                  />
                  <span className="text-sm text-muted-foreground">%</span>
                </div>
              </Field>
              <Field label="Attendance Bonus">
                <Input
                  type="text"
                  inputMode="decimal"
                  value={
                    form.attendanceBonusAmount === undefined
                      ? "750"
                      : String(form.attendanceBonusAmount)
                  }
                  onChange={(e) => {
                    const cleaned = e.target.value
                      .replace(/[^\d.]/g, "")
                      .replace(/^0+(?=\d)/, "");
                    set("attendanceBonusAmount", cleaned === "" ? 0 : Number(cleaned));
                  }}
                  className="max-w-[180px]"
                />
              </Field>
              <Field label="Site Allowance">
                <Input
                  type="number"
                  min="0"
                  value={form.siteAllowance ?? 0}
                  onChange={(e) => set("siteAllowance", Number(e.target.value))}
                  className="max-w-[180px]"
                />
              </Field>
              <Field label="DA">
                <Input
                  type="number"
                  min="0"
                  value={form.da ?? 0}
                  onChange={(e) => set("da", Number(e.target.value))}
                  className="max-w-[180px]"
                />
              </Field>
              <Field label="Food Allowance">
                <Input
                  type="number"
                  min="0"
                  value={form.foodAllowance ?? 0}
                  onChange={(e) => set("foodAllowance", Number(e.target.value))}
                  className="max-w-[180px]"
                />
              </Field>
              <Field label="Travel Allowance">
                <Input
                  type="number"
                  min="0"
                  value={form.travelAllowance ?? 0}
                  onChange={(e) => set("travelAllowance", Number(e.target.value))}
                  className="max-w-[180px]"
                />
              </Field>
            </div>
          </TabsContent>

          {/* ── Bank Details ─────────────────────────────────────── */}
          <TabsContent value="bank" className="pt-4">
            <div className="max-w-2xl space-y-3">
              <Field label="Account Holder">
                <Input
                  value={form.bankAccountHolder ?? ""}
                  onChange={(e) => set("bankAccountHolder", e.target.value)}
                />
              </Field>
              <Field label="Bank Name">
                <Input
                  value={form.bankName ?? ""}
                  onChange={(e) => set("bankName", e.target.value)}
                />
              </Field>
              <Field label="Account Number">
                <Input
                  value={form.bankAccountNumber ?? ""}
                  onChange={(e) => set("bankAccountNumber", e.target.value)}
                />
              </Field>
              <Field label="IFSC">
                <Input
                  value={form.bankIfsc ?? ""}
                  onChange={(e) => set("bankIfsc", e.target.value.toUpperCase())}
                  className="max-w-[220px]"
                />
              </Field>
              <Field label="Branch">
                <Input
                  value={form.bankBranch ?? ""}
                  onChange={(e) => set("bankBranch", e.target.value)}
                />
              </Field>
            </div>
          </TabsContent>

          {/* ── Documents ────────────────────────────────────────── */}
          <TabsContent value="documents" className="pt-4">
            <div className="max-w-3xl space-y-6">
              <section className="space-y-3">
                <h3 className="text-sm font-semibold text-foreground">Insurance</h3>
                <Field label="Insurance PDF">
                  <div>
                    <Input
                      type="file"
                      accept="application/pdf,.pdf"
                      onChange={(e) => onInsuranceFile(e.target.files?.[0])}
                    />
                    {form.insurancePdfName && (
                      <p className="mt-1 text-xs text-muted-foreground">
                        {form.insurancePdfName}
                      </p>
                    )}
                  </div>
                </Field>
              </section>

              <section className="space-y-3 border-t pt-4">
                <h3 className="text-sm font-semibold text-foreground">Qualifications</h3>
                <div className="space-y-2">
                  {(form.qualifications ?? [emptyQualification()]).map((row, index) => (
                    <div
                      key={index}
                      className="grid grid-cols-1 md:grid-cols-[1fr_1fr_120px_120px_40px] gap-2 items-end"
                    >
                      <div>
                        <Label className="text-xs text-muted-foreground">Qualification</Label>
                        <Input
                          value={row.qualification}
                          onChange={(e) =>
                            updateQualification(index, "qualification", e.target.value)
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Institution</Label>
                        <Input
                          value={row.institution}
                          onChange={(e) =>
                            updateQualification(index, "institution", e.target.value)
                          }
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Year</Label>
                        <Input
                          value={row.year}
                          onChange={(e) => updateQualification(index, "year", e.target.value)}
                        />
                      </div>
                      <div>
                        <Label className="text-xs text-muted-foreground">Grade</Label>
                        <Input
                          value={row.grade}
                          onChange={(e) => updateQualification(index, "grade", e.target.value)}
                        />
                      </div>
                      <Button
                        type="button"
                        size="icon"
                        variant="ghost"
                        onClick={() => removeQualification(index)}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={addQualification}
                    className="gap-1"
                  >
                    <Plus className="h-4 w-4" />
                    Add Qualification
                  </Button>
                </div>
              </section>

              <section className="space-y-3 border-t pt-4">
                <h3 className="text-sm font-semibold text-foreground">Relatives</h3>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="relatives-working"
                      checked={form.relativesWorking}
                      onCheckedChange={(checked) => set("relativesWorking", checked === true)}
                    />
                    <Label htmlFor="relatives-working" className="cursor-pointer font-normal">
                      Relatives working with EcoSudar
                    </Label>
                  </div>
                  {form.relativesWorking && (
                    <Textarea
                      rows={3}
                      value={form.relativesDetails ?? ""}
                      onChange={(e) => set("relativesDetails", e.target.value)}
                      placeholder="Name, relation, department..."
                    />
                  )}
                </div>
              </section>

              <section className="space-y-3 border-t pt-4">
                <h3 className="text-sm font-semibold text-foreground">Uniform &amp; Shoes</h3>
                <Field label="Uniform">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="uniform-issued"
                        checked={form.uniformIssued}
                        onCheckedChange={(checked) => set("uniformIssued", checked === true)}
                      />
                      <Label htmlFor="uniform-issued" className="cursor-pointer font-normal">
                        Issued
                      </Label>
                    </div>
                    {form.uniformIssued && (
                      <div className="space-y-1">
                        <Input
                          type="date"
                          value={form.uniformIssuedAt ?? ""}
                          onChange={(e) => set("uniformIssuedAt", e.target.value)}
                          className="max-w-[200px]"
                        />
                        <p className="text-xs text-muted-foreground">
                          Valid until: {oneYearFrom(form.uniformIssuedAt) || "Not set"}
                        </p>
                      </div>
                    )}
                  </div>
                </Field>
                <Field label="Shoes">
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="shoes-issued"
                        checked={form.shoesIssued}
                        onCheckedChange={(checked) => set("shoesIssued", checked === true)}
                      />
                      <Label htmlFor="shoes-issued" className="cursor-pointer font-normal">
                        Issued
                      </Label>
                    </div>
                    {form.shoesIssued && (
                      <div className="space-y-1">
                        <Input
                          type="date"
                          value={form.shoesIssuedAt ?? ""}
                          onChange={(e) => set("shoesIssuedAt", e.target.value)}
                          className="max-w-[200px]"
                        />
                        <p className="text-xs text-muted-foreground">
                          Valid until: {oneYearFrom(form.shoesIssuedAt) || "Not set"}
                        </p>
                      </div>
                    )}
                  </div>
                </Field>
              </section>
            </div>
          </TabsContent>
        </Tabs>
      )}
    </FormPage>
  );
}
