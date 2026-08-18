import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { FileText, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Req } from "@/components/Req";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import {
  sopsApi,
  SOP_DEPARTMENTS,
  SOP_ROLES,
  type SopDepartment,
  type SopAccessRole,
  type SopOwner,
} from "@/lib/api/sops";

const formatBytes = (b?: number | null) => {
  const n = Number(b || 0);
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1_048_576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1_048_576).toFixed(2)} MB`;
};

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

const empty = () => ({
  code: "",
  title: "",
  department: "Production" as SopDepartment,
  description: "",
  ownerId: "",
  accessRole: "Department Only" as SopAccessRole,
  tags: "",
});
type Form = ReturnType<typeof empty>;

export default function SopForm() {
  const navigate = useNavigate();
  const { id } = useParams();
  const editing = !!id;

  const [form, setForm] = useState<Form>(empty());
  const [initial, setInitial] = useState(JSON.stringify(empty()));
  const [document, setDocument] = useState<File | null>(null);
  const [owners, setOwners] = useState<SopOwner[]>([]);
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(editing);

  const set = <K extends keyof Form>(k: K, v: Form[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  const dirty = useMemo(() => JSON.stringify(form) !== initial, [form, initial]);
  useUnsavedChanges(dirty && !saving, "sop-form");

  useEffect(() => {
    sopsApi
      .owners()
      .then(setOwners)
      .catch(() => toast.error("Failed to load owners"));

    if (!editing) return;
    setLoading(true);
    sopsApi
      .getById(id)
      .then((sop) => {
        const next: Form = {
          code: sop.code ?? "",
          title: sop.title ?? "",
          department: (sop.department ?? "Production") as SopDepartment,
          description: sop.description ?? "",
          ownerId: sop.ownerId ?? sop.owner_id?.toString() ?? "",
          accessRole: ((sop.accessRole ?? sop.access_role) ??
            "Department Only") as SopAccessRole,
          tags: (sop.tags ?? []).join(", "),
        };
        setForm(next);
        setInitial(JSON.stringify(next));
      })
      .catch((e) => toast.error(e instanceof Error ? e.message : "Failed to load SOP"))
      .finally(() => setLoading(false));
  }, [id, editing]);

  const submit = async () => {
    if (!form.code.trim()) { toast.error("Code is required"); return; }
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    if (!editing && !document) { toast.error("SOP document is required"); return; }

    setSaving(true);
    try {
      const tagList = form.tags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);

      if (editing) {
        await sopsApi.update(id!, {
          code: form.code.trim().toUpperCase(),
          title: form.title.trim(),
          department: form.department,
          description: form.description.trim(),
          owner_id: form.ownerId ? Number(form.ownerId) : undefined,
          access_role: form.accessRole,
          tags: tagList,
        });
        toast.success("SOP updated");
      } else {
        await sopsApi.create({
          code: form.code.trim().toUpperCase(),
          title: form.title.trim(),
          department: form.department,
          description: form.description.trim(),
          ownerId: form.ownerId || undefined,
          accessRole: form.accessRole,
          tags: tagList,
          document: document ?? undefined,
        });
        toast.success("SOP created");
      }
      setInitial(JSON.stringify(form));
      navigate("/sops");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Save failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title={editing ? "Edit SOP" : "New SOP"}
      description="Standard operating procedure with version control and role-based access."
      icon={<FileText className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/sops")}
      backLabel="SOPs"
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/sops")} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving || loading}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                Saving…
              </>
            ) : editing ? (
              "Save SOP"
            ) : (
              "Create SOP"
            )}
          </Button>
        </>
      }
    >
      {loading ? (
        <div className="max-w-2xl space-y-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="h-9 bg-muted rounded animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="max-w-2xl space-y-4">
          <Field label="Code" req>
            <Input
              value={form.code}
              onChange={(e) => set("code", e.target.value.toUpperCase())}
              placeholder="PROD-001"
            />
          </Field>

          <Field label="Department" req>
            <Select
              value={form.department}
              onValueChange={(v) => set("department", v as SopDepartment)}
            >
              <SelectTrigger className="max-w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOP_DEPARTMENTS.map((d) => (
                  <SelectItem key={d} value={d}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Title" req>
            <Input
              value={form.title}
              onChange={(e) => set("title", e.target.value)}
            />
          </Field>

          <Field label="Description">
            <Textarea
              value={form.description}
              onChange={(e) => set("description", e.target.value)}
              rows={3}
            />
          </Field>

          <Field label="Owner">
            <Select
              value={form.ownerId || "current-admin"}
              onValueChange={(v) =>
                set("ownerId", v === "current-admin" ? "" : v)
              }
            >
              <SelectTrigger className="max-w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="current-admin">Current admin</SelectItem>
                {owners.map((o) => (
                  <SelectItem key={o.id} value={o.id}>
                    {o.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Access Role">
            <Select
              value={form.accessRole}
              onValueChange={(v) => set("accessRole", v as SopAccessRole)}
            >
              <SelectTrigger className="max-w-[260px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {SOP_ROLES.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>

          <Field label="Tags">
            <Input
              value={form.tags}
              onChange={(e) => set("tags", e.target.value)}
              placeholder="production, safety (comma-separated)"
            />
          </Field>

          {!editing && (
            <Field label="Document" req>
              <div>
                <Input
                  type="file"
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.txt"
                  onChange={(e) => setDocument(e.target.files?.[0] ?? null)}
                />
                {document && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {document.name} · {formatBytes(document.size)}
                  </p>
                )}
              </div>
            </Field>
          )}
        </div>
      )}
    </FormPage>
  );
}
