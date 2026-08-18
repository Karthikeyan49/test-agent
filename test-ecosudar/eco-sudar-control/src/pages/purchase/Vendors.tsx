import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Plus, Trash2, Building2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollableX } from "@/components/ui/scrollable-x";
import { toast } from "sonner";
import { phase2Api, type ApiRow } from "@/lib/api/phase2";
import { ExportMenu } from "@/components/ExportMenu";
import { type ExportColumnDef } from "@/components/ExportDialog";
import { FilterBar, FilterSearch, FilterSelect, matchesFilter, distinctOptions, ALL } from "@/components/Filters";
import { Pagination, usePagedRows } from "@/components/Pagination";
import { TableSkeleton } from "@/components/TableSkeleton";
import { ConfirmDeleteDialog } from "@/components/ConfirmDeleteDialog";

const err = (e: unknown, f: string) => (e instanceof Error ? e.message : f);

/** Export columns — table fields plus "Additional Fields" (group:"detail", off by default). */
const EXPORT_COLUMNS: ExportColumnDef<ApiRow>[] = [
  { header: "Code", key: "vendor_code" },
  { header: "Name", key: "name" },
  { header: "GSTIN", key: "gstin" },
  { header: "Contact", key: "contact_name" },
  { header: "Phone", key: "phone" },
  { header: "City", key: "city" },
  { header: "State", key: "state" },
  { header: "Payment Terms", key: "payment_terms" },
  { header: "Email", key: "email", group: "detail", defaultChecked: false },
  { header: "Mobile", key: "mobile", group: "detail", defaultChecked: false },
  { header: "PAN", key: "pan", group: "detail", defaultChecked: false },
  { header: "Address", key: "address", group: "detail", defaultChecked: false },
  { header: "Pincode", key: "pincode", group: "detail", defaultChecked: false },
  { header: "Bank A/C", key: "bank_account_number", group: "detail", defaultChecked: false },
  { header: "IFSC", key: "bank_ifsc", group: "detail", defaultChecked: false },
  { header: "Notes", key: "notes", group: "detail", defaultChecked: false },
  { header: "Status", key: (v) => (Number(v.is_active ?? 1) ? "Active" : "Inactive"), group: "detail", defaultChecked: false },
];

const STATUS_OPTIONS = [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }];

export default function Vendors() {
  const navigate = useNavigate();
  const [items, setItems] = useState<ApiRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [city, setCity] = useState(ALL);
  const [state, setState] = useState(ALL);
  const [status, setStatus] = useState(ALL);
  const [confirmDel, setConfirmDel] = useState<ApiRow | null>(null);

  const load = () => {
    setLoading(true);
    phase2Api.vendors.list().then(setItems)
      .catch((e) => toast.error(err(e, "Failed to load vendors")))
      .finally(() => setLoading(false));
  };
  useEffect(load, []);

  const cityOptions  = useMemo(() => distinctOptions(items, (v) => v.city), [items]);
  const stateOptions = useMemo(() => distinctOptions(items, (v) => v.state), [items]);

  const filtered = useMemo(() => items.filter((v) => {
    const q = search.toLowerCase();
    const matchesSearch = !q ||
      String(v.name ?? "").toLowerCase().includes(q) ||
      String(v.gstin ?? "").toLowerCase().includes(q) ||
      String(v.contact_name ?? "").toLowerCase().includes(q) ||
      String(v.email ?? "").toLowerCase().includes(q) ||
      String(v.phone ?? "").includes(search);
    const active = v.is_active === undefined ? true : !!Number(v.is_active);
    const matchesStatus = status === ALL || (status === "active" ? active : !active);
    return matchesSearch && matchesFilter(city, v.city) && matchesFilter(state, v.state) && matchesStatus;
  }), [items, search, city, state, status]);

  const paged = usePagedRows(filtered);

  const remove = async () => {
    if (!confirmDel) return;
    try { await phase2Api.vendors.remove(confirmDel.vendor_id); toast.success("Vendor removed"); setConfirmDel(null); load(); }
    catch (e) { toast.error(err(e, "Delete failed")); }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground">Vendors</h1>
          <p className="text-muted-foreground">Suppliers of raw materials and services.</p>
        </div>
        <div className="flex items-center gap-2">
          <ExportMenu title="Vendors" columns={EXPORT_COLUMNS} rows={filtered} dateField="created_at" filename="vendors" />
          <Button onClick={() => navigate("/purchase/vendors/new")}><Plus className="h-4 w-4" /> Add vendor</Button>
        </div>
      </div>

      <FilterBar>
        <FilterSearch value={search} onChange={setSearch} placeholder="Search name, GSTIN, contact…" />
        <FilterSelect label="City" value={city} onChange={setCity} options={cityOptions} />
        <FilterSelect label="State" value={state} onChange={setState} options={stateOptions} />
        <FilterSelect label="Status" value={status} onChange={setStatus} options={STATUS_OPTIONS} />
      </FilterBar>

      <div className="bg-card rounded-xl border shadow-sm overflow-hidden">
        <ScrollableX>
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-muted-foreground">
              <tr>
                <th className="text-left px-4 py-3 font-medium">Vendor</th>
                <th className="text-left px-4 py-3 font-medium">GSTIN</th>
                <th className="text-left px-4 py-3 font-medium">Contact</th>
                <th className="text-left px-4 py-3 font-medium">Location</th>
                <th className="text-left px-4 py-3 font-medium">Terms</th>
                <th className="text-right px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading && <TableSkeleton cols={6} />}
              {!loading && filtered.length === 0 && <tr><td colSpan={6} className="text-center py-10 text-muted-foreground">No vendors yet.</td></tr>}
              {!loading && paged.rows.map((v) => (
                <tr key={v.vendor_id} className="border-t hover:bg-muted/30 cursor-pointer" onClick={() => navigate(`/purchase/vendors/${v.vendor_id}`)}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/10 shrink-0"><Building2 className="h-4 w-4 text-primary" /></span>
                      <div><div className="font-medium text-card-foreground">{v.name}</div><div className="text-xs text-muted-foreground">{v.vendor_code}</div></div>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{v.gstin || "—"}</td>
                  <td className="px-4 py-3">{v.contact_name || "—"}<div className="text-xs text-muted-foreground">{v.phone || v.email || ""}</div></td>
                  <td className="px-4 py-3 text-muted-foreground">{[v.city, v.state].filter(Boolean).join(", ") || "—"}</td>
                  <td className="px-4 py-3 text-muted-foreground">{v.payment_terms || "—"}</td>
                  <td className="px-4 py-3 text-right" onClick={(e) => e.stopPropagation()}>
                    <div className="inline-flex gap-1">
                      <Button size="icon" variant="ghost" title="Remove" onClick={() => setConfirmDel(v)}><Trash2 className="h-4 w-4 text-destructive" /></Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableX>
        <Pagination {...paged} onPage={paged.setPage} noun="vendors" />
      </div>

      <ConfirmDeleteDialog
        open={!!confirmDel}
        onOpenChange={(o) => !o && setConfirmDel(null)}
        onConfirm={remove}
        title="Remove vendor?"
        description={confirmDel ? `"${confirmDel.name}" will be removed.` : undefined}
      />
    </div>
  );
}
