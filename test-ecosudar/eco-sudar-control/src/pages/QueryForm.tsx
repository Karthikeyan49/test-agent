import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { MessageSquare, Loader2, User, Mail, Calendar } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import { queriesApi, type Query, type QueryStatus } from "@/lib/api/queries";

const statusColors: Record<string, string> = {
  "New":         "bg-blue-500/15 text-blue-700 border-blue-500/30",
  "In Progress": "bg-amber-500/15 text-amber-700 border-amber-500/30",
  "Resolved":    "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
};

function Field({
  label,
  children,
}: {
  label: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="grid grid-cols-[9rem_1fr] items-start gap-3">
      <Label className="pt-2 text-sm text-muted-foreground">{label}</Label>
      <div>{children}</div>
    </div>
  );
}

export default function QueryForm() {
  const navigate = useNavigate();
  const location = useLocation();
  const { id } = useParams();

  // Query data passed via navigation state from the list page
  const query = location.state?.query as Query | undefined;

  const [adminReply, setAdminReply] = useState(query?.adminReply ?? "");
  const [status, setStatus] = useState<QueryStatus>(
    query?.status === "New" ? "In Progress" : (query?.status ?? "In Progress")
  );
  const [saving, setSaving] = useState(false);

  const initialReply = query?.adminReply ?? "";
  const initialStatus: QueryStatus =
    query?.status === "New" ? "In Progress" : (query?.status ?? "In Progress");

  const dirty = useMemo(
    () => adminReply !== initialReply || status !== initialStatus,
    [adminReply, status, initialReply, initialStatus]
  );
  useUnsavedChanges(dirty && !saving, "query-form");

  // If navigated directly without state, show fallback
  if (!query) {
    return (
      <FormPage
        title="Customer Query"
        onBack={() => navigate("/queries")}
        backLabel="Queries"
      >
        <div className="flex flex-col items-center gap-4 py-12 text-muted-foreground">
          <p className="text-sm">Query data not available.</p>
          <Button variant="outline" onClick={() => navigate("/queries")}>
            Back to Queries
          </Button>
        </div>
      </FormPage>
    );
  }

  const submit = async () => {
    setSaving(true);
    try {
      await queriesApi.reply(query._queryId, adminReply, status);
      toast.success(`Query ${query.id} updated`);
      navigate("/queries");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update query");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title={`Query ${query.id}`}
      description="View customer query and send a reply."
      icon={<MessageSquare className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/queries")}
      backLabel="Queries"
      footer={
        <>
          <Button variant="outline" onClick={() => navigate("/queries")} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1" />
                Saving…
              </>
            ) : (
              "Save & Update"
            )}
          </Button>
        </>
      }
    >
      <div className="max-w-2xl space-y-6">
        {/* Customer info card */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold text-foreground">Customer</h3>
            <Badge variant="outline" className={statusColors[query.status]}>
              {query.status}
            </Badge>
          </div>
          <div className="space-y-2 text-sm">
            <div className="flex items-center gap-2">
              <User className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="font-medium text-card-foreground">{query.name}</span>
            </div>
            <div className="flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">{query.email}</span>
            </div>
            <div className="flex items-center gap-2">
              <Calendar className="h-4 w-4 text-muted-foreground shrink-0" />
              <span className="text-muted-foreground">{query.date}</span>
            </div>
          </div>
        </div>

        {/* Original message */}
        <div>
          <Label className="text-sm font-semibold text-foreground">Customer Message</Label>
          <div className="mt-2 rounded-lg border bg-muted/20 p-3 text-sm text-card-foreground">
            {query.message}
          </div>
        </div>

        {/* Admin reply */}
        <Field label="Admin Reply">
          <Textarea
            value={adminReply}
            onChange={(e) => setAdminReply(e.target.value)}
            placeholder="Type your reply to the customer..."
            rows={4}
          />
        </Field>

        {/* Status update */}
        <Field label="Update Status">
          <Select value={status} onValueChange={(v) => setStatus(v as QueryStatus)}>
            <SelectTrigger className="max-w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="New">New</SelectItem>
              <SelectItem value="In Progress">In Progress</SelectItem>
              <SelectItem value="Resolved">Resolved</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>
    </FormPage>
  );
}
