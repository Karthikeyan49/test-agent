/**
 * HR API – employees, attendance, payroll.
 * MOCK_MODE=true  → in-memory mock data
 * MOCK_MODE=false → real backend at /admin/employees|attendance|payroll
 */
import { MOCK_MODE, apiFetch, mockDelay } from "./client";

export type Department = "Production" | "Quality" | "Sales" | "Admin" | "Dispatch" | "Maintenance";
export type EmploymentType = "permanent" | "contract" | "job_work";

export interface QualificationRow {
  qualification: string;
  institution: string;
  year: string;
  grade: string;
}

export interface Employee {
  id: string;            // EMP-001
  employee_id?: number;  // numeric primary key, used by inventory issue endpoints
  name: string;
  email: string;
  phone: string;
  alternatePhone?: string;
  department: Department | "";
  designation: string;
  employmentType?: EmploymentType;
  baseSalary: number;    // monthly gross
  joinedAt: string;
  communicationAddress?: string;
  permanentAddress?: string;
  sameAsCommunicationAddress?: boolean;
  aadhaarNumber?: string;
  dob?: string;
  bloodGroup?: string;
  experience?: string;
  relativesWorking?: boolean;
  relativesDetails?: string;
  qualifications?: QualificationRow[];
  bankAccountHolder?: string;
  bankName?: string;
  bankAccountNumber?: string;
  bankIfsc?: string;
  bankBranch?: string;
  pfEnabled?: boolean;
  pfPercent?: number;
  bonusPercent?: number;
  attendanceBonusAmount?: number;
  defaultShiftId?: string;
  esiEnabled?: boolean;
  esiEmployeePercent?: number;
  siteAllowance?: number;
  da?: number;
  foodAllowance?: number;
  travelAllowance?: number;
  insurancePdfPath?: string | null;
  insurancePdfName?: string | null;
  insuranceFile?: File | null;
  uniformIssued?: boolean;
  uniformIssuedAt?: string;
  uniformValidUntil?: string;
  shoesIssued?: boolean;
  shoesIssuedAt?: string;
  shoesValidUntil?: string;
  photoPath?: string | null;   // relative URL: uploads/employee-photos/...
  photoFile?: File | null;     // transient — used for upload only
  qrToken: string;       // unique token embedded in QR
  active: boolean;
}

export type EmployeePayload = Omit<Employee, "id" | "qrToken"> & {
  customId?: string;    // optional user-specified employee ID (e.g. EMP-010)
  deletePhoto?: boolean; // true when user explicitly removed the photo
};

export interface AttendanceEntry {
  id: string;
  employeeId: string;
  date: string;          // YYYY-MM-DD
  shiftId?: string | null;
  shiftName?: string | null;
  shiftStartTime?: string | null;
  shiftEndTime?: string | null;
  checkIn?: string;      // ISO
  checkOut?: string;     // ISO
  hoursWorked?: number;
  scheduledHours?: number | null;
  lateMinutes?: number;
  overtimeHours?: number;
  status: "Present" | "Half-day" | "Absent" | "Leave";
}

export interface AttendanceShift {
  id: string;
  name: string;
  startTime: string;
  endTime: string;
  workingHours: number;
  graceMinutes: number;
  isDefault: boolean;
  active: boolean;
}

// Shape returned by GET /admin/attendance/analytics (AttendanceAnalytics model).
// snake_case to mirror the PHP response exactly.
export interface AttendanceAnalyticsBucket {
  date?: string;
  department?: string;
  employee_key?: string;
  name?: string;
  designation?: string;
  scheduled_days: number;
  present_days: number;
  half_days: number;
  absent_days: number;
  leave_days: number;
  late_days: number;
  total_hours: number;
  overtime_hours: number;
  effective_present_days: number;
  attendance_pct: number;
  late_rate_pct: number;
  absenteeism_pct: number;
}

export interface AttendanceAnalytics {
  from: string;
  to: string;
  department: string | null;
  employee_key: string | null;
  summary: AttendanceAnalyticsBucket;
  daily_trend: AttendanceAnalyticsBucket[];
  departments: AttendanceAnalyticsBucket[];
  employees: AttendanceAnalyticsBucket[];
}

export interface AttendanceScanResponse {
  employee: Employee;
  entry: AttendanceEntry;
  action: "checked-in" | "checked-out";
}

export interface Payslip {
  employeeId: string;
  employeeName: string;
  designation: string;
  doj?: string;
  month: string;         // YYYY-MM
  workingDays: number;
  presentDays: number;
  leaves: number;
  leaveCredit?: number;
  earnedLeaveCredit?: number;
  leaveAvailedThisMonth?: number;
  leaveSalary: number;
  travelAllow: number;
  salaryAdvancePaid: number;
  deductedAdvance: number;
  baseSalary: number;
  siteAllowance?: number;
  da?: number;
  foodAllowance?: number;
  grossSalary?: number;
  salaryPerDay: number;
  earnedSalary: number;
  attendBonus: number;
  overtimeRate: number;
  overtimeHours: number;
  overtimeSalary: number;
  totalSalary: number;
  hra: number;
  allowances: number;
  pf: number;
  professionalTax: number;
  deductions: number;
  netPay: number;
}

export interface EmployeeAdvance {
  id: number;
  employeeId: string;
  employeeName: string;
  designation?: string;
  advanceDate: string;
  payrollMonth: string;
  amount: number;
  notes?: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export type EmployeeAdvancePayload = {
  employeeId: string;
  advanceDate: string;
  payrollMonth: string;
  amount: number;
  notes?: string;
};

const DEPARTMENTS: Department[] = ["Production", "Quality", "Sales", "Admin", "Dispatch", "Maintenance"];
export const EMPLOYMENT_TYPES: { value: EmploymentType; label: string }[] = [
  { value: "permanent", label: "Permanent" },
  { value: "contract", label: "Contract" },
  { value: "job_work", label: "Job Work" },
];

let MOCK_EMPLOYEES: Employee[] = [
  { id: "EMP-001", name: "Arun Prakash", email: "arun@ecosudar.in", phone: "+91 98400 11122", department: "Production", designation: "Shift Supervisor", baseSalary: 32000, joinedAt: "2023-04-12", qrToken: "ESD-AP-001-7Q9X", active: true },
  { id: "EMP-002", name: "Divya Ramesh", email: "divya@ecosudar.in", phone: "+91 98400 22334", department: "Quality", designation: "QC Engineer", baseSalary: 38000, joinedAt: "2022-11-05", qrToken: "ESD-DR-002-K2M4", active: true },
  { id: "EMP-003", name: "Karthik S", email: "karthik@ecosudar.in", phone: "+91 99520 11445", department: "Dispatch", designation: "Logistics Lead", baseSalary: 28000, joinedAt: "2024-01-18", qrToken: "ESD-KS-003-B8N1", active: true },
  { id: "EMP-004", name: "Meena Lakshmi", email: "meena@ecosudar.in", phone: "+91 90030 55778", department: "Sales", designation: "Field Sales", baseSalary: 26000, joinedAt: "2023-09-22", qrToken: "ESD-ML-004-Z3P7", active: true },
  { id: "EMP-005", name: "Suresh Kumar", email: "suresh@ecosudar.in", phone: "+91 90420 88991", department: "Maintenance", designation: "Mechanical Tech", baseSalary: 30000, joinedAt: "2022-06-30", qrToken: "ESD-SK-005-V6T2", active: true },
];

let MOCK_SHIFTS: AttendanceShift[] = [
  {
    id: "1",
    name: "General Shift",
    startTime: "09:00",
    endTime: "17:00",
    workingHours: 8,
    graceMinutes: 0,
    isDefault: true,
    active: true,
  },
];

const defaultShift = () => MOCK_SHIFTS.find((s) => s.active && s.isDefault) ?? MOCK_SHIFTS.find((s) => s.active) ?? MOCK_SHIFTS[0];

const hoursBetweenTimes = (start: string, end: string) => {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  let minutes = (eh * 60 + em) - (sh * 60 + sm);
  if (minutes <= 0) minutes += 24 * 60;
  return Math.round((minutes / 60) * 100) / 100;
};

function mockAttendanceMetrics(data: {
  date: string;
  checkIn?: string;
  checkOut?: string;
  status: AttendanceEntry["status"];
  shift: AttendanceShift;
  manualOverride?: boolean;
}) {
  const scheduledHours = data.shift.workingHours || hoursBetweenTimes(data.shift.startTime, data.shift.endTime) || 8;
  if (data.status === "Absent" || data.status === "Leave") {
    return {
      status: data.status,
      hoursWorked: 0,
      scheduledHours,
      lateMinutes: 0,
      overtimeHours: 0,
    };
  }

  const shiftStart = new Date(`${data.date}T${data.shift.startTime}:00`).getTime();
  const checkInTs = data.checkIn ? new Date(data.checkIn).getTime() : 0;
  const lateMinutes = checkInTs > 0
    ? Math.max(0, Math.floor((checkInTs - (shiftStart + data.shift.graceMinutes * 60000)) / 60000))
    : 0;

  let hoursWorked: number | undefined;
  const overtimeHours = 0;
  if (data.checkIn && data.checkOut) {
    let outTs = new Date(data.checkOut).getTime();
    if (outTs <= checkInTs) outTs += 86400000;
    const payableStart = Math.max(checkInTs, shiftStart);
    hoursWorked = Math.round(Math.max(0, (outTs - payableStart) / 3600000) * 100) / 100;
  }

  let status = data.status;
  if (!data.manualOverride) {
    const halfDayFloor = Math.min(5, Math.max(4, scheduledHours / 2));
    status = lateMinutes > 0 || (hoursWorked !== undefined && hoursWorked < halfDayFloor)
      ? "Half-day"
      : "Present";
  }

  return { status, hoursWorked, scheduledHours, lateMinutes, overtimeHours };
}

// Build mock attendance for last 30 days
function buildMockAttendance(): AttendanceEntry[] {
  const entries: AttendanceEntry[] = [];
  const today = new Date();
  for (let d = 29; d >= 0; d--) {
    const day = new Date(today.getTime() - d * 86400000);
    const dateStr = day.toISOString().slice(0, 10);
    const isSunday = day.getDay() === 0;
    MOCK_EMPLOYEES.forEach((emp) => {
      if (isSunday) return;
      const rand = Math.random();
      let status: AttendanceEntry["status"] = "Present";
      let hours: number | undefined = 8 + Math.random() * 1.2;
      if (rand < 0.05) { status = "Absent"; hours = undefined; }
      else if (rand < 0.12) { status = "Half-day"; hours = 4 + Math.random(); }
      else if (rand < 0.16) { status = "Leave"; hours = undefined; }
      const inT = new Date(day); inT.setHours(9, Math.floor(Math.random() * 25));
      const outT = hours ? new Date(inT.getTime() + hours * 3600000) : undefined;
      const shift = defaultShift();
      const metrics = mockAttendanceMetrics({
        date: dateStr,
        checkIn: status === "Absent" || status === "Leave" ? undefined : inT.toISOString(),
        checkOut: outT?.toISOString(),
        status,
        shift,
        manualOverride: true,
      });
      entries.push({
        id: `ATT-${emp.id}-${dateStr}`,
        employeeId: emp.id,
        date: dateStr,
        shiftId: shift.id,
        shiftName: shift.name,
        shiftStartTime: shift.startTime,
        shiftEndTime: shift.endTime,
        checkIn: status === "Absent" || status === "Leave" ? undefined : inT.toISOString(),
        checkOut: outT?.toISOString(),
        hoursWorked: metrics.hoursWorked,
        scheduledHours: metrics.scheduledHours,
        lateMinutes: metrics.lateMinutes,
        overtimeHours: metrics.overtimeHours,
        status: metrics.status,
      });
    });
  }
  return entries;
}

let MOCK_ATTENDANCE: AttendanceEntry[] = buildMockAttendance();
let MOCK_ADVANCES: EmployeeAdvance[] = [];

const todayStr = () => new Date().toISOString().slice(0, 10);
const normalizeEmployeeId = (value?: string) => (value ?? "").trim().toUpperCase();
const nextEmpId = () => {
  let num = MOCK_EMPLOYEES.length + 1;
  let id = `EMP-${String(num).padStart(3, "0")}`;
  while (MOCK_EMPLOYEES.some((emp) => emp.id === id)) {
    num += 1;
    id = `EMP-${String(num).padStart(3, "0")}`;
  }
  return id;
};
const genToken = (name: string) => {
  const initials = name.split(" ").map((p) => p[0]).join("").toUpperCase().slice(0, 2);
  const rand = Math.random().toString(36).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4);
  return `ESD-${initials}-${String(MOCK_EMPLOYEES.length + 1).padStart(3, "0")}-${rand}`;
};

function employeeFormData(data: Partial<EmployeePayload>): FormData {
  const form = new FormData();
  Object.entries(data).forEach(([key, value]) => {
    if (key === "insurancePdfPath" || key === "insurancePdfName") return;
    if (key === "photoPath") return; // never send back the path — only send the file
    if (key === "deletePhoto") {
      if (value === true) form.append("deletePhoto", "1");
      return;
    }
    if (value === undefined || value === null) return;
    if (key === "insuranceFile") {
      if (typeof File !== "undefined" && value instanceof File) {
        form.append("insurancePdf", value);
      }
      return;
    }
    if (key === "photoFile") {
      if (typeof File !== "undefined" && value instanceof File) {
        form.append("employeePhoto", value);
      }
      return;
    }
    if (key === "qualifications") {
      form.append(key, JSON.stringify(value));
      return;
    }
    if (typeof value === "boolean") {
      form.append(key, value ? "1" : "0");
      return;
    }
    form.append(key, String(value));
  });
  return form;
}

export const employeesApi = {
  async list(): Promise<Employee[]> {
    if (MOCK_MODE) { await mockDelay(); return [...MOCK_EMPLOYEES]; }
    return (await apiFetch<{data: Employee[]}>("/admin/employees")).data;
  },
  async create(data: EmployeePayload): Promise<Employee> {
    if (MOCK_MODE) {
      await mockDelay();
      const customId = normalizeEmployeeId(data.customId);
      const employeeId = customId || nextEmpId();
      if (MOCK_EMPLOYEES.some((emp) => emp.id === employeeId)) {
        throw new Error(`Employee ID '${employeeId}' already exists`);
      }
      const { customId: _customId, ...employeeData } = data;
      const e: Employee = {
        ...employeeData,
        id: employeeId,
        qrToken: genToken(data.name),
        insurancePdfName: data.insuranceFile?.name ?? data.insurancePdfName ?? null,
        insurancePdfPath: data.insuranceFile ? "mock-upload.pdf" : data.insurancePdfPath ?? null,
      };
      MOCK_EMPLOYEES.push(e); return e;
    }
    return (await apiFetch<{data: Employee}>("/admin/employees", {
      method: "POST",
      body: employeeFormData(data),
    })).data;
  },
  async update(id: string, patch: Partial<EmployeePayload>): Promise<Employee> {
    if (MOCK_MODE) {
      await mockDelay();
      const customId = normalizeEmployeeId(patch.customId);
      const nextId = customId || id;
      if (nextId !== id && MOCK_EMPLOYEES.some((emp) => emp.id === nextId)) {
        throw new Error(`Employee ID '${nextId}' already exists`);
      }
      const { customId: _customId, ...employeePatch } = patch;
      if (nextId !== id) {
        MOCK_ATTENDANCE = MOCK_ATTENDANCE.map((entry) => (
          entry.employeeId === id ? { ...entry, employeeId: nextId } : entry
        ));
      }
      MOCK_EMPLOYEES = MOCK_EMPLOYEES.map((e) => (e.id === id ? {
        ...e,
        ...employeePatch,
        id: nextId,
        insurancePdfName: patch.insuranceFile?.name ?? patch.insurancePdfName ?? e.insurancePdfName,
        insurancePdfPath: patch.insuranceFile ? "mock-upload.pdf" : patch.insurancePdfPath ?? e.insurancePdfPath,
      } : e));
      return MOCK_EMPLOYEES.find((e) => e.id === nextId)!;
    }
    return (await apiFetch<{data: Employee}>(`/admin/employees/${id}`, {
      method: "POST",
      body: employeeFormData(patch),
    })).data;
  },
  async remove(id: string): Promise<void> {
    if (MOCK_MODE) { await mockDelay(); MOCK_EMPLOYEES = MOCK_EMPLOYEES.filter((e) => e.id !== id); return; }
    await apiFetch<void>(`/admin/employees/${id}`, { method: "DELETE" });
  },
};

export const attendanceApi = {
  shifts: {
    async list(): Promise<AttendanceShift[]> {
      if (MOCK_MODE) { await mockDelay(); return [...MOCK_SHIFTS]; }
      return (await apiFetch<{data: AttendanceShift[]}>("/admin/attendance/shifts")).data;
    },
    async create(data: Omit<AttendanceShift, "id">): Promise<AttendanceShift> {
      if (MOCK_MODE) {
        await mockDelay();
        if (data.isDefault) MOCK_SHIFTS = MOCK_SHIFTS.map((s) => ({ ...s, isDefault: false }));
        const shift: AttendanceShift = { ...data, id: String(Date.now()) };
        MOCK_SHIFTS.push(shift);
        return shift;
      }
      return (await apiFetch<{data: AttendanceShift}>("/admin/attendance/shifts", {
        method: "POST",
        body: JSON.stringify(data),
      })).data;
    },
    async update(id: string, data: Partial<Omit<AttendanceShift, "id">>): Promise<AttendanceShift> {
      if (MOCK_MODE) {
        await mockDelay();
        if (data.isDefault) MOCK_SHIFTS = MOCK_SHIFTS.map((s) => ({ ...s, isDefault: false }));
        MOCK_SHIFTS = MOCK_SHIFTS.map((s) => (s.id === id ? { ...s, ...data } : s));
        return MOCK_SHIFTS.find((s) => s.id === id)!;
      }
      return (await apiFetch<{data: AttendanceShift}>(`/admin/attendance/shifts/${id}`, {
        method: "PUT",
        body: JSON.stringify(data),
      })).data;
    },
  },

  async list(params?: { from?: string; to?: string; employeeId?: string }): Promise<AttendanceEntry[]> {
    if (MOCK_MODE) {
      await mockDelay();
      return MOCK_ATTENDANCE.filter((a) => {
        if (params?.employeeId && a.employeeId !== params.employeeId) return false;
        if (params?.from && a.date < params.from) return false;
        if (params?.to && a.date > params.to) return false;
        return true;
      }).sort((a, b) => b.date.localeCompare(a.date));
    }
    const clean = Object.fromEntries(
      Object.entries(params ?? {}).filter(([, v]) => v !== undefined)
    ) as Record<string, string>;
    const qs = new URLSearchParams(clean).toString();
    return (await apiFetch<{data: AttendanceEntry[]}>(`/admin/attendance?${qs}`)).data;
  },

  // Attendance analytics for a date range. Backed by the existing
  // GET /admin/attendance/analytics endpoint (AttendanceAnalytics model),
  // which already returns daily_trend, departments and employees — no new
  // backend endpoints needed. Fields are snake_case from PHP.
  async analytics(params: { from: string; to: string }): Promise<AttendanceAnalytics> {
    const qs = new URLSearchParams({ from: params.from, to: params.to }).toString();
    return (await apiFetch<{ data: AttendanceAnalytics }>(`/admin/attendance/analytics?${qs}`)).data;
  },

  async manual(data: {
    entryId?: string;
    employeeId: string;
    date: string;
    shiftId?: string;
    checkIn: string;
    checkOut: string;
    status: AttendanceEntry["status"];
    note?: string;
  }): Promise<AttendanceEntry> {
    if (MOCK_MODE) {
      await mockDelay();
      const shift = MOCK_SHIFTS.find((s) => s.id === data.shiftId) ?? defaultShift();
      const checkInIso  = data.checkIn  ? `${data.date}T${data.checkIn}:00`  : undefined;
      const checkOutIso = data.checkOut ? `${data.date}T${data.checkOut}:00` : undefined;
      const metrics = mockAttendanceMetrics({
        date: data.date,
        checkIn: checkInIso,
        checkOut: checkOutIso,
        status: data.status,
        shift,
        manualOverride: true,
      });
      const entry: AttendanceEntry = {
        id: data.entryId || `${Date.now()}`,
        employeeId: data.employeeId,
        date: data.date,
        shiftId: shift.id,
        shiftName: shift.name,
        shiftStartTime: shift.startTime,
        shiftEndTime: shift.endTime,
        checkIn: checkInIso,
        checkOut: checkOutIso,
        hoursWorked: metrics.hoursWorked,
        scheduledHours: metrics.scheduledHours,
        lateMinutes: metrics.lateMinutes,
        overtimeHours: metrics.overtimeHours,
        status: metrics.status,
      };
      const idx = MOCK_ATTENDANCE.findIndex((a) => a.id === entry.id);
      if (idx >= 0) MOCK_ATTENDANCE[idx] = entry;
      else MOCK_ATTENDANCE.unshift(entry);
      return entry;
    }
    return (await apiFetch<{data: AttendanceEntry}>("/admin/attendance/manual", {
      method: "POST",
      body: JSON.stringify(data),
    })).data;
  },

  async delete(id: string): Promise<void> {
    if (MOCK_MODE) {
      await mockDelay();
      MOCK_ATTENDANCE = MOCK_ATTENDANCE.filter((a) => a.id !== id);
      return;
    }
    await apiFetch<void>(`/admin/attendance/${id}`, { method: "DELETE" });
  },

  /** Resolve a scanned QR token into an employee, then mark in/out */
  async scan(token: string): Promise<AttendanceScanResponse> {
    if (MOCK_MODE) {
      await mockDelay(150);
      const emp = MOCK_EMPLOYEES.find((e) => e.qrToken === token.trim());
      if (!emp) throw new Error("Invalid QR token");
      if (!emp.active) throw new Error("Employee is inactive");
      const date = todayStr();
      const shift = defaultShift();
      let entry = MOCK_ATTENDANCE.find((a) => a.employeeId === emp.id && a.date === date && a.checkIn && !a.checkOut);
      const now = new Date().toISOString();
      let action: "checked-in" | "checked-out";
      if (!entry) {
        const metrics = mockAttendanceMetrics({ date, checkIn: now, status: "Present", shift });
        entry = {
          id: `${Date.now()}`,
          employeeId: emp.id,
          date,
          shiftId: shift.id,
          shiftName: shift.name,
          shiftStartTime: shift.startTime,
          shiftEndTime: shift.endTime,
          checkIn: now,
          status: metrics.status,
          scheduledHours: metrics.scheduledHours,
          lateMinutes: metrics.lateMinutes,
          overtimeHours: metrics.overtimeHours,
        };
        MOCK_ATTENDANCE.unshift(entry);
        action = "checked-in";
      } else if (!entry.checkOut) {
        entry.checkOut = now;
        const rowShift = MOCK_SHIFTS.find((s) => s.id === entry.shiftId) ?? shift;
        const metrics = mockAttendanceMetrics({ date, checkIn: entry.checkIn, checkOut: now, status: "Present", shift: rowShift });
        entry.hoursWorked = metrics.hoursWorked;
        entry.scheduledHours = metrics.scheduledHours;
        entry.lateMinutes = metrics.lateMinutes;
        entry.overtimeHours = metrics.overtimeHours;
        entry.status = metrics.status;
        action = "checked-out";
      } else {
        throw new Error("Already checked out for today");
      }
      return { employee: emp, entry, action };
    }
    return (await apiFetch<{data: AttendanceScanResponse}>("/admin/attendance/scan", { method: "POST", body: JSON.stringify({ token }) })).data;
  },

  async checkIn(employeeId: string): Promise<AttendanceScanResponse> {
    if (MOCK_MODE) {
      await mockDelay(150);
      const emp = MOCK_EMPLOYEES.find((e) => e.id === employeeId);
      if (!emp) throw new Error("Employee not found");
      if (!emp.active) throw new Error("Employee is inactive");
      const date = todayStr();
      const existing = MOCK_ATTENDANCE.find((a) => a.employeeId === emp.id && a.date === date && a.checkIn && !a.checkOut);
      if (existing) throw new Error("Already checked in for today");

      const shift = defaultShift();
      const now = new Date().toISOString();
      const metrics = mockAttendanceMetrics({ date, checkIn: now, status: "Present", shift });
      const entry: AttendanceEntry = {
        id: `${Date.now()}`,
        employeeId: emp.id,
        date,
        shiftId: shift.id,
        shiftName: shift.name,
        shiftStartTime: shift.startTime,
        shiftEndTime: shift.endTime,
        checkIn: now,
        status: metrics.status,
        scheduledHours: metrics.scheduledHours,
        lateMinutes: metrics.lateMinutes,
        overtimeHours: metrics.overtimeHours,
      };
      MOCK_ATTENDANCE.unshift(entry);
      return { employee: emp, entry, action: "checked-in" };
    }
    return (await apiFetch<{data: AttendanceScanResponse}>("/admin/attendance/check-in", {
      method: "POST",
      body: JSON.stringify({ employeeId }),
    })).data;
  },

  async checkOut(employeeId: string): Promise<AttendanceScanResponse> {
    if (MOCK_MODE) {
      await mockDelay(150);
      const emp = MOCK_EMPLOYEES.find((e) => e.id === employeeId);
      if (!emp) throw new Error("Employee not found");
      if (!emp.active) throw new Error("Employee is inactive");
      const date = todayStr();
      const entry = MOCK_ATTENDANCE.find((a) => a.employeeId === emp.id && a.date === date && a.checkIn && !a.checkOut);
      if (!entry) throw new Error("No active check-in found for today");

      const now = new Date().toISOString();
      const shift = MOCK_SHIFTS.find((s) => s.id === entry.shiftId) ?? defaultShift();
      const metrics = mockAttendanceMetrics({ date, checkIn: entry.checkIn, checkOut: now, status: "Present", shift });
      entry.checkOut = now;
      entry.hoursWorked = metrics.hoursWorked;
      entry.scheduledHours = metrics.scheduledHours;
      entry.lateMinutes = metrics.lateMinutes;
      entry.overtimeHours = metrics.overtimeHours;
      entry.status = metrics.status;
      return { employee: emp, entry, action: "checked-out" };
    }
    return (await apiFetch<{data: AttendanceScanResponse}>("/admin/attendance/check-out", {
      method: "POST",
      body: JSON.stringify({ employeeId }),
    })).data;
  },
};

/** Working days in given YYYY-MM (excludes Sundays) */
export function workingDaysInMonth(month: string): number {
  const [y, m] = month.split("-").map(Number);
  const lastDay = new Date(y, m, 0).getDate();
  let count = 0;
  for (let d = 1; d <= lastDay; d++) {
    if (new Date(y, m - 1, d).getDay() !== 0) count++;
  }
  return count;
}

export interface PayrollFlag {
  employee_key: string;
  employee_name: string | null;
  severity: "high" | "medium" | "low";
  issue: string;
  detail: string;
}
export interface PayrollAiCheck {
  month: string;
  checked: number;
  overall: string;
  flags: PayrollFlag[];
  flagged: number;
  high: number;
  generated_at: string;
}

export const payrollApi = {
  async get(month: string): Promise<Payslip[]> {
    if (MOCK_MODE) { await mockDelay(); return []; }
    return (await apiFetch<{data: Payslip[]}>(`/admin/payroll?month=${month}`)).data ?? [];
  },
  async aiCheck(month: string): Promise<PayrollAiCheck> {
    return (await apiFetch<{ data: PayrollAiCheck }>("/admin/payroll/ai-check", {
      method: "POST", body: JSON.stringify({ month }),
    })).data;
  },
  async run(
    month: string,
    workingDaysOverride?: number,
    overtimeHoursByEmployee: Record<string, number> = {},
    leaveCreditsByEmployee: Record<string, number> = {}
  ): Promise<Payslip[]> {
    if (MOCK_MODE) {
      await mockDelay();
      const workingDays = workingDaysOverride ?? Math.max(1, workingDaysInMonth(month));
      const monthEntries = MOCK_ATTENDANCE.filter((a) => a.date.startsWith(month));
      const advanceTotals = MOCK_ADVANCES
        .filter((advance) => advance.payrollMonth === month)
        .reduce<Record<string, number>>((totals, advance) => {
          totals[advance.employeeId] = (totals[advance.employeeId] ?? 0) + advance.amount;
          return totals;
        }, {});

      return MOCK_EMPLOYEES.map((emp) => {
        const empEntries = monthEntries.filter((a) => a.employeeId === emp.id);

        const dailyFractions: Record<string, number> = {};
        const dailyLeave: Record<string, boolean> = {};
        for (const e of empEntries) {
          if (e.status === "Present") dailyFractions[e.date] = (dailyFractions[e.date] ?? 0) + 1;
          if (e.status === "Half-day") dailyFractions[e.date] = (dailyFractions[e.date] ?? 0) + 0.5;
          if (e.status === "Leave") dailyLeave[e.date] = true;
        }

        let daysWorked = 0;
        let leaves = 0;
        for (const fraction of Object.values(dailyFractions)) {
          daysWorked += Math.min(1, fraction);
        }
        for (const date of Object.keys(dailyLeave)) {
          const workedFraction = dailyFractions[date] ?? 0;
          leaves += Math.max(0, 1 - workedFraction);
        }
        for (const e of empEntries) {
          if (e.status === "Absent") leaves += 1;
          if (e.status === "Half-day" && !dailyLeave[e.date]) leaves += 0.5;
        }
        daysWorked = Math.round(daysWorked * 10) / 10;
        leaves = Math.round(leaves * 10) / 10;

        // Salary sheet components
        const base          = emp.baseSalary;
        const siteAllowance = Math.max(0, Number(emp.siteAllowance ?? 0));
        const da            = Math.max(0, Number(emp.da ?? 0));
        const foodAllowance = Math.max(0, Number(emp.foodAllowance ?? 0));
        const travelAllow   = Math.max(0, Number(emp.travelAllowance ?? 0));
        const grossSalary   = Math.round((base + siteAllowance + da + foodAllowance + travelAllow) * 100) / 100;
        const salaryPerDay  = workingDays > 0 ? Math.round((grossSalary / workingDays) * 100) / 100 : 0;
        const overtimeRate  = workingDays > 0 ? Math.round((((base + da) / workingDays / 8) * 1.5) * 100) / 100 : 0;

        const overtimeHrs = Math.round(Math.max(0, Number(overtimeHoursByEmployee[emp.id] ?? 0)) * 100) / 100;

        const earnedLeaveCredit = Math.floor(daysWorked / 20);
        const hasProvidedLeaveCredit = Object.prototype.hasOwnProperty.call(leaveCreditsByEmployee, emp.id);
        const requestedLeaveCredits = Number(leaveCreditsByEmployee[emp.id]);
        const availableBeforeLeave = Math.round(Math.max(
          0,
          (Number.isFinite(requestedLeaveCredits) ? requestedLeaveCredits : 0) + (hasProvidedLeaveCredit ? 0 : earnedLeaveCredit)
        ) * 10) / 10;
        const leaveAvailed    = Math.round(Math.min(
          leaves,
          availableBeforeLeave
        ) * 10) / 10;
        const availableLeaveCredit = Math.round(Math.max(0, availableBeforeLeave - leaveAvailed) * 10) / 10;
        const unpaidLeave     = Math.round(Math.max(0, leaves - leaveAvailed) * 10) / 10;
        const payableDays     = Math.round((daysWorked + leaveAvailed) * 10) / 10;

        const earnedSalary    = Math.round(salaryPerDay * payableDays * 100) / 100;
        const overtimeSalary  = Math.round(overtimeRate * overtimeHrs * 100) / 100;
        const attendanceBonusAmount = Math.max(0, Number(emp.attendanceBonusAmount ?? 750));
        const attendBonus     = daysWorked >= workingDays ? attendanceBonusAmount : 0;
        const leaveSalary     = Math.round(salaryPerDay * unpaidLeave * 100) / 100;
        const salaryAdvancePaid = Math.round(Math.max(0, Number(advanceTotals[emp.id] ?? 0)) * 100) / 100;
        const deductedAdvance = salaryAdvancePaid;
        const hra          = 0;
        const allowances   = 0;
        const totalSalary  = Math.round((earnedSalary + attendBonus + overtimeSalary) * 100) / 100;

        // Deductions
        const pfPercent       = emp.pfEnabled === false ? 0 : Math.max(0, Number(emp.pfPercent ?? 12));
        const pf              = Math.round(earnedSalary * (pfPercent / 100) * 100) / 100;
        const professionalTax = 0;
        const deductions      = Math.round((pf + deductedAdvance) * 100) / 100;
        const netPay          = Math.max(0, Math.round((totalSalary - deductions) * 100) / 100);

        return {
          employeeId: emp.id, employeeName: emp.name, designation: emp.designation, month,
          doj: emp.joinedAt || "",
          workingDays, presentDays: daysWorked, leaves,
          leaveCredit: availableLeaveCredit,
          earnedLeaveCredit,
          baseSalary: base,
          siteAllowance,
          da,
          foodAllowance,
          grossSalary,
          salaryPerDay,
          overtimeRate,
          overtimeHours: overtimeHrs,
          overtimeHrs,
          earnedSalary,
          overtimeSalary,
          attendBonus,
          leaveAvailedThisMonth: leaveAvailed,
          leaveSalary,
          travelAllow,
          totalSalary,
          salaryAdvancePaid,
          deductedAdvance,
          hra, allowances,
          pf, professionalTax, deductions, netPay,
        };
      });
    }
    const body: Record<string, unknown> = { month };
    if (workingDaysOverride !== undefined) body.workingDays = workingDaysOverride;
    body.overtimeHours = overtimeHoursByEmployee;
    body.leaveCredits = leaveCreditsByEmployee;
    return (await apiFetch<{data: Payslip[]}>("/admin/payroll/run", { method: "POST", body: JSON.stringify(body) })).data;
  },
};

export const employeeAdvancesApi = {
  async list(params?: { month?: string; employeeId?: string }): Promise<EmployeeAdvance[]> {
    if (MOCK_MODE) {
      await mockDelay();
      return MOCK_ADVANCES
        .filter((advance) => !params?.month || advance.payrollMonth === params.month)
        .filter((advance) => !params?.employeeId || advance.employeeId === params.employeeId)
        .sort((a, b) => b.advanceDate.localeCompare(a.advanceDate) || b.id - a.id);
    }
    const clean = Object.fromEntries(
      Object.entries(params ?? {}).filter(([, value]) => value !== undefined && value !== "")
    ) as Record<string, string>;
    const qs = new URLSearchParams(clean).toString();
    return (await apiFetch<{data: EmployeeAdvance[]}>(`/admin/employee-advances${qs ? `?${qs}` : ""}`)).data ?? [];
  },

  async create(payload: EmployeeAdvancePayload): Promise<EmployeeAdvance> {
    if (MOCK_MODE) {
      await mockDelay();
      const employee = MOCK_EMPLOYEES.find((emp) => emp.id === payload.employeeId);
      if (!employee) throw new Error("Employee not found");
      const advance: EmployeeAdvance = {
        id: Date.now(),
        employeeId: employee.id,
        employeeName: employee.name,
        designation: employee.designation,
        advanceDate: payload.advanceDate,
        payrollMonth: payload.payrollMonth,
        amount: Math.max(0, Number(payload.amount)),
        notes: payload.notes ?? "",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      MOCK_ADVANCES.unshift(advance);
      return advance;
    }
    return (await apiFetch<{data: EmployeeAdvance}>("/admin/employee-advances", {
      method: "POST",
      body: JSON.stringify(payload),
    })).data;
  },

  async update(id: number, payload: EmployeeAdvancePayload): Promise<EmployeeAdvance> {
    if (MOCK_MODE) {
      await mockDelay();
      const employee = MOCK_EMPLOYEES.find((emp) => emp.id === payload.employeeId);
      if (!employee) throw new Error("Employee not found");
      MOCK_ADVANCES = MOCK_ADVANCES.map((advance) => advance.id === id ? {
        ...advance,
        employeeId: employee.id,
        employeeName: employee.name,
        designation: employee.designation,
        advanceDate: payload.advanceDate,
        payrollMonth: payload.payrollMonth,
        amount: Math.max(0, Number(payload.amount)),
        notes: payload.notes ?? "",
        updatedAt: new Date().toISOString(),
      } : advance);
      return MOCK_ADVANCES.find((advance) => advance.id === id)!;
    }
    return (await apiFetch<{data: EmployeeAdvance}>(`/admin/employee-advances/${id}`, {
      method: "PUT",
      body: JSON.stringify(payload),
    })).data;
  },

  async remove(id: number): Promise<void> {
    if (MOCK_MODE) {
      await mockDelay();
      MOCK_ADVANCES = MOCK_ADVANCES.filter((advance) => advance.id !== id);
      return;
    }
    await apiFetch<void>(`/admin/employee-advances/${id}`, { method: "DELETE" });
  },
};

export { DEPARTMENTS };
