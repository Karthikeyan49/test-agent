/* eslint-disable @typescript-eslint/no-explicit-any */
import { BASE_URL, apiFetch, getAuthToken } from "./client";

export type ApiRow = Record<string, any>;

type Envelope<T> = { success: boolean; data: T; pagination?: ApiRow };
type Paginated<T> = { success: boolean; data: T[]; pagination?: ApiRow };

function qs(params: ApiRow = {}) {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  });
  const text = search.toString();
  return text ? `?${text}` : "";
}

function rows<T = ApiRow>(res: Paginated<T> | Envelope<{ rows?: T[] }> | Envelope<T[]>): T[] {
  const data = (res as any).data;
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  return [];
}

function data<T = ApiRow>(res: Envelope<T>): T {
  return res.data;
}

async function post<T = ApiRow>(path: string, body: ApiRow = {}) {
  return data(await apiFetch<Envelope<T>>(path, { method: "POST", body: JSON.stringify(body) }));
}

async function put<T = ApiRow>(path: string, body: ApiRow = {}) {
  return data(await apiFetch<Envelope<T>>(path, { method: "PUT", body: JSON.stringify(body) }));
}

async function del(path: string) {
  await apiFetch(path, { method: "DELETE" });
}

async function upload<T = ApiRow>(path: string, form: FormData) {
  return data(await apiFetch<Envelope<T>>(path, { method: "POST", body: form }));
}

/**
 * Fetch an auth-gated attachment (e.g. a meeting photo) and return a blob object
 * URL usable as an <img src>. Attachment bytes are served only via the
 * /admin/attachments/{id}/download endpoint behind Bearer auth — a plain <img>
 * tag can't send the token, so we fetch with auth and wrap the blob.
 * Caller is responsible for URL.revokeObjectURL() when done.
 */
export async function attachmentObjectUrl(path: string): Promise<string> {
  return URL.createObjectURL(await attachmentBlob(path));
}

/**
 * Like attachmentObjectUrl but returns the raw Blob. `overrideType` forces the
 * blob's MIME type — needed for <video>, because the download endpoint may serve
 * the file as application/octet-stream, and a blob URL with that type won't play.
 */
export async function attachmentBlob(path: string, overrideType?: string): Promise<Blob> {
  const token = getAuthToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "X-Client-Type": "web",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Failed to load attachment (${res.status})`);
  }
  const blob = await res.blob();
  if (overrideType && blob.type !== overrideType) {
    return blob.slice(0, blob.size, overrideType);
  }
  return blob;
}

export async function downloadPath(path: string, filename?: string) {
  const token = getAuthToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    headers: {
      "X-Client-Type": "web",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(text || `Download failed (${res.status})`);
  }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename || "download";
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export const phase2Api = {
  vendors: {
    list: (params?: ApiRow) => apiFetch<Paginated<ApiRow>>(`/admin/vendors${qs({ limit: 100, ...params })}`).then(rows),
    get: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/vendors/${id}`).then(data),
    create: (payload: ApiRow) => post("/admin/vendors", payload),
    update: (id: number, payload: ApiRow) => put(`/admin/vendors/${id}`, payload),
    remove: (id: number) => del(`/admin/vendors/${id}`),
    performance: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/vendors/${id}/performance`).then(data),
  },

  purchaseItems: {
    list: (params?: ApiRow) => apiFetch<Paginated<ApiRow>>(`/admin/purchase-items${qs({ limit: 100, ...params })}`).then(rows),
    get: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/purchase-items/${id}`).then(data),
    orders: (id: number) => apiFetch<Envelope<ApiRow[]>>(`/admin/purchase-items/${id}/orders`).then(data),
    create: (payload: ApiRow) => post("/admin/purchase-items", payload),
    update: (id: number, payload: ApiRow) => put(`/admin/purchase-items/${id}`, payload),
    remove: (id: number) => del(`/admin/purchase-items/${id}`),
  },

  purchaseRequests: {
    list: (params?: ApiRow) => apiFetch<Paginated<ApiRow>>(`/admin/purchase-requests${qs({ limit: 100, ...params })}`).then(rows),
    get: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/purchase-requests/${id}`).then(data),
    create: (payload: ApiRow) => post("/admin/purchase-requests", payload),
    update: (id: number, payload: ApiRow) => put(`/admin/purchase-requests/${id}`, payload),
    submit: (id: number) => post(`/admin/purchase-requests/${id}/submit`),
    approve: (id: number) => post(`/admin/purchase-requests/${id}/approve`),
    reject: (id: number, reason: string) => post(`/admin/purchase-requests/${id}/reject`, { reason }),
    remove: (id: number) => del(`/admin/purchase-requests/${id}`),
  },

  purchaseOrders: {
    list: (params?: ApiRow) => apiFetch<Paginated<ApiRow>>(`/admin/purchase-orders${qs({ limit: 100, ...params })}`).then(rows),
    get: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/purchase-orders/${id}`).then(data),
    create: (payload: ApiRow) => post("/admin/purchase-orders", payload),
    update: (id: number, payload: ApiRow) => put(`/admin/purchase-orders/${id}`, payload),
    issue: (id: number) => post(`/admin/purchase-orders/${id}/issue`),
    cancel: (id: number) => post(`/admin/purchase-orders/${id}/cancel`),
    shortClose: (id: number) => post(`/admin/purchase-orders/${id}/short-close`),
    bill: (id: number, payment_mode = "Bank Transfer") => post(`/admin/purchase-orders/${id}/bill`, { payment_mode }),
    receive: (id: number, payload: ApiRow) => post(`/admin/purchase-orders/${id}/receipts`, payload),
    receiveWithPhoto: (id: number, payload: ApiRow, file?: File) => {
      const form = new FormData();
      Object.entries(payload).forEach(([key, value]) => {
        form.append(key, key === "items" ? JSON.stringify(value ?? []) : value == null ? "" : String(value));
      });
      if (file) form.append("delivery_photo", file);
      return upload(`/admin/purchase-orders/${id}/receipts`, form);
    },
    payments: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/purchase-orders/${id}/payments`).then(data),
    pay: (id: number, payload: ApiRow) => post(`/admin/purchase-orders/${id}/payments`, payload),
    revert: (id: number) => post(`/admin/purchase-orders/${id}/revert`),
    voidReceipt: (grnId: number, reason: string) => post(`/admin/goods-receipts/${grnId}/void`, { reason }),
    pdf: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/purchase-orders/${id}/pdf`).then(data),
  },

  payments: {
    list: (params?: ApiRow) => apiFetch<Paginated<ApiRow>>(`/admin/payments${qs({ limit: 100, ...params })}`).then(rows),
    create: (payload: ApiRow) => post("/admin/payments", payload),
    invoicePayments: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/invoices/${id}/payments`).then(data),
    payInvoice: (id: number, payload: ApiRow) => post(`/admin/invoices/${id}/payments`, payload),
    receipt: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/payments/${id}/receipt`).then(data),
    void: (id: number, reason: string) => post(`/admin/payments/${id}/void`, { reason }),
    ageing: (asOf?: string) => apiFetch<Envelope<ApiRow>>(`/admin/receivables/ageing${qs({ as_of: asOf })}`).then(data),
  },

  salesDocuments: {
    list: (params?: ApiRow) => apiFetch<Paginated<ApiRow>>(`/admin/sales-documents${qs({ limit: 100, ...params })}`).then(rows),
    get: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/sales-documents/${id}`).then(data),
    create: (payload: ApiRow) => post("/admin/sales-documents", payload),
    update: (id: number, payload: ApiRow) => put(`/admin/sales-documents/${id}`, payload),
    transition: (id: number, action: "send" | "accept" | "reject" | "cancel" | "convert") => post(`/admin/sales-documents/${id}/${action}`),
    /** Convert a document; `target` disambiguates (quotation→sales_order|proforma, sales_order→delivery_challan|invoice). */
    convert: (id: number, target?: "sales_order" | "proforma" | "delivery_challan" | "invoice") =>
      post(`/admin/sales-documents/${id}/convert`, target ? { target } : {}),
    document: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/sales-documents/${id}/document`).then(data),
  },

  testCertificates: {
    list: (params?: ApiRow) => apiFetch<Paginated<ApiRow>>(`/admin/test-certificates${qs({ limit: 100, ...params })}`).then(rows),
    get: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/test-certificates/${id}`).then(data),
    create: (payload: ApiRow) => post("/admin/test-certificates", payload),
    update: (id: number, payload: ApiRow) => put(`/admin/test-certificates/${id}`, payload),
    issue: (id: number) => post(`/admin/test-certificates/${id}/issue`),
    void: (id: number) => post(`/admin/test-certificates/${id}/void`),
    uploadDocument: (id: number, file: File) => {
      const form = new FormData();
      form.append("document", file);
      return upload(`/admin/test-certificates/${id}/document`, form);
    },
    download: (id: number) => downloadPath(`/admin/test-certificates/${id}/download`, `test-certificate-${id}`),
  },

  gstCompliance: {
    list: () => apiFetch<Envelope<ApiRow[]>>("/admin/gst-compliance").then(data),
    show: (period: string) => apiFetch<Envelope<ApiRow>>(`/admin/gst-compliance/${period}`).then(data),
    calculate: (period?: string) => apiFetch<Envelope<ApiRow>>(`/admin/gst-compliance/calculate${qs({ period })}`).then(data),
    save: (period: string, payload: ApiRow = {}) => post(`/admin/gst-compliance/${period}/save`, payload),
    review: (period: string) => post(`/admin/gst-compliance/${period}/review`),
    file: (period: string) => post(`/admin/gst-compliance/${period}/file`),
    lock: (period: string) => post(`/admin/gst-compliance/${period}/lock`),
    export: (period: string) => downloadPath(`/admin/gst-compliance/${period}/export`, `gst-${period}.csv`),
  },

  dealerNetwork: {
    dealers: (params?: ApiRow) => apiFetch<Paginated<ApiRow>>(`/admin/dealers${qs({ limit: 100, ...params })}`).then(rows),
    dealer: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/dealers/${id}`).then(data),
    priceLists: (params?: ApiRow) => apiFetch<Paginated<ApiRow>>(`/admin/dealer-price-lists${qs({ limit: 100, ...params })}`).then(rows),
    priceList: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/dealer-price-lists/${id}`).then(data),
    createPriceList: (payload: ApiRow) => post("/admin/dealer-price-lists", payload),
    updatePriceList: (id: number, payload: ApiRow) => put(`/admin/dealer-price-lists/${id}`, payload),
    updatePriceItems: (id: number, items: ApiRow[]) => put(`/admin/dealer-price-lists/${id}/items`, { items }),
    dealerCustomers: (params?: ApiRow) => apiFetch<Paginated<ApiRow>>(`/admin/dealer-customers${qs({ limit: 100, ...params })}`).then(rows),
    conflicts: () => apiFetch<Paginated<ApiRow>>("/admin/dealer-customers/conflicts?limit=100").then(rows),
    resolveCustomer: (id: number, payload: ApiRow) => post(`/admin/dealer-customers/${id}/resolve`, payload),
    mergeCustomers: (source_id: number, target_id: number) => post("/admin/customers/merge", { source_id, target_id }),
    analyticsSummary: (params?: ApiRow) => apiFetch<Envelope<ApiRow>>(`/admin/customers/analytics/summary${qs(params)}`).then(data),
    recomputeMetrics: (customer_id?: number) => post("/admin/customer-metrics/recompute", { customer_id }),
    customerAnalytics: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/customers/${id}/analytics`).then(data),
    priceSimulation: (params: ApiRow) => apiFetch<Envelope<ApiRow>>(`/admin/dealer-price-simulation${qs(params)}`).then(data),
  },

  financePlanning: {
    expenseAnalytics: (params?: ApiRow) => apiFetch<Envelope<ApiRow>>(`/admin/expenses/analytics${qs(params)}`).then(data),
    reportsAnalytics: (params?: ApiRow) => apiFetch<Envelope<ApiRow>>(`/admin/reports/analytics${qs(params)}`).then(data),
    overlay: (params?: ApiRow) => apiFetch<Envelope<ApiRow>>(`/admin/finance/overlay${qs(params)}`).then(data),
    budgets: () => apiFetch<Paginated<ApiRow>>("/admin/budgets?limit=100").then(rows),
    budget: (id: number) => apiFetch<Envelope<ApiRow>>(`/admin/budgets/${id}`).then(data),
    budgetVsActual: (id: number, period?: string) => apiFetch<Envelope<ApiRow>>(`/admin/budgets/${id}/vs-actual${qs({ period })}`).then(data),
    createBudget: (payload: ApiRow) => post("/admin/budgets", payload),
    updateBudget: (id: number, payload: ApiRow) => put(`/admin/budgets/${id}`, payload),
    benchmarks: () => apiFetch<Envelope<ApiRow[]>>("/admin/benchmarks").then(data),
    saveBenchmark: (payload: ApiRow) => post("/admin/benchmarks", payload),
    benchmarkStatus: (params?: ApiRow) => apiFetch<Envelope<ApiRow>>(`/admin/benchmarks/status${qs(params)}`).then(data),
  },

  hrCompliance: {
    compliance: (params?: ApiRow) => apiFetch<Envelope<ApiRow>>(`/admin/compliance${qs({ limit: 100, ...params })}`).then(data),
    expiring: (days?: number) => apiFetch<Envelope<ApiRow[]>>(`/admin/compliance/expiring${qs({ days })}`).then(data),
    employeeRecords: (employeeKey: string) => apiFetch<Envelope<ApiRow[]>>(`/admin/employees/${employeeKey}/compliance`).then(data),
    createRecord: (employeeKey: string, payload: ApiRow, file?: File) => {
      const form = new FormData();
      Object.entries(payload).forEach(([key, value]) => form.append(key, value == null ? "" : String(value)));
      if (file) form.append("document", file);
      return upload(`/admin/employees/${employeeKey}/compliance`, form);
    },
    updateRecord: (id: number, payload: ApiRow, file?: File) => {
      const form = new FormData();
      Object.entries(payload).forEach(([key, value]) => form.append(key, value == null ? "" : String(value)));
      if (file) form.append("document", file);
      return apiFetch<Envelope<ApiRow>>(`/admin/compliance/${id}`, { method: "PUT", body: form }).then(data);
    },
    remove: (id: number) => del(`/admin/compliance/${id}`),
    download: (id: number) => downloadPath(`/admin/compliance/${id}/download?download=1`, `compliance-${id}`),
    attendanceAnalytics: (params?: ApiRow) => apiFetch<Envelope<ApiRow>>(`/admin/attendance/analytics${qs(params)}`).then(data),
    attendanceAnomalies: (params?: ApiRow) => apiFetch<Envelope<ApiRow[]>>(`/admin/attendance/anomalies${qs(params)}`).then(data),
    importEmployees: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return upload("/admin/employees/import", form);
    },
    importAttendance: (file: File) => {
      const form = new FormData();
      form.append("file", file);
      return upload("/admin/attendance/import", form);
    },
    meetingMedia: (meetingId: number) => apiFetch<Envelope<ApiRow[]>>(`/admin/meetings/${meetingId}/media`).then(data),
    addMeetingMedia: (meetingId: number, payload: { title?: string; caption?: string; category?: string; external_url?: string; file?: File }) => {
      const form = new FormData();
      if (payload.title) form.append("title", payload.title);
      if (payload.caption) form.append("caption", payload.caption);
      if (payload.category) form.append("category", payload.category);
      if (payload.external_url) form.append("external_url", payload.external_url);
      // Backend's primary handler reads $_FILES['files'] ONLY as an array (files[]).
      // A singular "files" field is parsed by PHP as a string and ignored, so the
      // array syntax "files[]" is required for a single-file upload to be seen.
      if (payload.file) form.append("files[]", payload.file);
      return upload(`/admin/meetings/${meetingId}/media`, form);
    },
    removeMeetingMedia: (meetingId: number, attachmentId: number) => del(`/admin/meetings/${meetingId}/media/${attachmentId}`),
  },

  // Staged HR import wizard: upload → {job_id, mapping} dry-run → {action:'commit'} commit
  hrImport: {
    upload: (kind: "employees" | "attendance", file: File) => {
      const form = new FormData();
      form.append("file", file);
      return upload(`/admin/${kind === "employees" ? "employees" : "attendance"}/import`, form);
    },
    run: (kind: "employees" | "attendance", payload: { job_id: number | string; mapping?: ApiRow; action?: "commit" }) =>
      post(`/admin/${kind === "employees" ? "employees" : "attendance"}/import`, payload),
    errors: (kind: "employees" | "attendance", jobId: number) =>
      downloadPath(`/admin/${kind === "employees" ? "employees" : "attendance"}/import/${jobId}/errors`, `${kind}-import-${jobId}-errors.csv`),
  },

  interop: {
    modules: () => apiFetch<Envelope<ApiRow>>("/admin/import/modules").then(data),
    jobs: (params?: ApiRow) => apiFetch<Paginated<ApiRow>>(`/admin/import-jobs${qs({ limit: 100, ...params })}`).then(rows),
    template: (module: string) => downloadPath(`/admin/import/${module}/template`, `${module}-template.csv`),
    upload: (module: string, file: File) => {
      const form = new FormData();
      form.append("file", file);
      return upload(`/admin/import/${module}/upload`, form);
    },
    aiMap: (module: string, jobId: number) => post(`/admin/import/${module}/${jobId}/ai-map`),
    map: (module: string, jobId: number, mapping: ApiRow) => post(`/admin/import/${module}/${jobId}/map`, { mapping }),
    dryRun: (module: string, jobId: number, mapping?: ApiRow) => post(`/admin/import/${module}/${jobId}/dry-run`, mapping ? { mapping } : {}),
    commit: (module: string, jobId: number) => post(`/admin/import/${module}/${jobId}/commit`),
    job: (jobId: number, withRows = false) => apiFetch<Envelope<ApiRow>>(`/admin/import/${jobId}${qs({ rows: withRows ? 1 : "" })}`).then(data),
    errors: (jobId: number) => downloadPath(`/admin/import/${jobId}/errors`, `import-${jobId}-errors.csv`),
    exportModule: (module: string, params?: ApiRow) => downloadPath(`/admin/export/${module}${qs(params)}`, `${module}-export.csv`),
    exportAll: (params?: ApiRow) => downloadPath(`/admin/export/all${qs(params)}`, "eco-sudar-full-export.zip"),
    backupStatus: () => apiFetch<Envelope<ApiRow>>("/admin/backup/status").then(data),
    runBackup: () => post("/admin/backup/run"),
  },
};
