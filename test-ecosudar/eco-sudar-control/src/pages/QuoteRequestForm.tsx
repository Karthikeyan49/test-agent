import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Calculator, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { FormPage } from "@/components/FormPage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { useUnsavedChanges } from "@/components/UnsavedChangesGuard";
import { quoteRequestsApi, type QuoteRequest, type QuoteStatus } from "@/lib/api/quoteRequests";

const statusColors: Record<string, string> = {
  "New":       "bg-blue-500/15 text-blue-700 border-blue-500/30",
  "Contacted": "bg-amber-500/15 text-amber-700 border-amber-500/30",
  "Quoted":    "bg-indigo-500/15 text-indigo-700 border-indigo-500/30",
  "Closed":    "bg-emerald-500/15 text-emerald-700 border-emerald-500/30",
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

export default function QuoteRequestForm() {
  const navigate = useNavigate();
  const location = useLocation();

  // Quote data passed via navigation state from the list page
  const quote = location.state?.quote as QuoteRequest | undefined;

  const [quotedPrice, setQuotedPrice] = useState(quote?.quotedPrice ?? "");
  const [adminNotes, setAdminNotes] = useState(quote?.adminNotes ?? "");
  const [status, setStatus] = useState<QuoteStatus>(quote?.status ?? "New");
  const [saving, setSaving] = useState(false);

  const initialPrice = quote?.quotedPrice ?? "";
  const initialNotes = quote?.adminNotes ?? "";
  const initialStatus = quote?.status ?? "New";

  const dirty = useMemo(
    () =>
      quotedPrice !== initialPrice ||
      adminNotes !== initialNotes ||
      status !== initialStatus,
    [quotedPrice, adminNotes, status, initialPrice, initialNotes, initialStatus]
  );
  useUnsavedChanges(dirty && !saving, "quote-request-form");

  // If navigated directly without state, show fallback
  if (!quote) {
    return (
      <FormPage
        title="Quote Request"
        onBack={() => navigate("/quote-requests")}
        backLabel="Quote Requests"
      >
        <div className="flex flex-col items-center gap-4 py-12 text-muted-foreground">
          <p className="text-sm">Quote data not available.</p>
          <Button variant="outline" onClick={() => navigate("/quote-requests")}>
            Back to Quote Requests
          </Button>
        </div>
      </FormPage>
    );
  }

  const submit = async () => {
    setSaving(true);
    try {
      const result = await quoteRequestsApi.update(quote._quoteId, {
        status,
        adminNotes,
        quotedPrice,
      });
      if (status === "Quoted" && quotedPrice) {
        toast.success(
          result.email_sent
            ? `Quote emailed to ${quote.email}`
            : "Quote saved — email delivery failed"
        );
      } else {
        toast.success(`Quote ${quote.id} updated`);
      }
      navigate("/quote-requests");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update quote");
    } finally {
      setSaving(false);
    }
  };

  return (
    <FormPage
      title={quote.id}
      description="Quote request from the Savings Calculator in the mobile app."
      icon={<Calculator className="h-6 w-6 text-primary" />}
      onBack={() => navigate("/quote-requests")}
      backLabel="Quote Requests"
      footer={
        <>
          <Button
            variant="outline"
            onClick={() => navigate("/quote-requests")}
            disabled={saving}
          >
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
        {/* Customer info */}
        <div className="rounded-lg border bg-muted/30 p-4 space-y-2 text-sm">
          <div className="flex items-center justify-between mb-1">
            <h3 className="text-sm font-semibold text-foreground">Customer</h3>
            <Badge variant="outline" className={statusColors[quote.status]}>
              {quote.status}
            </Badge>
          </div>
          {[
            ["Customer", quote.customerName],
            ["Phone",    quote.phone],
            ["Email",    quote.email],
            ["Date",     quote.date],
          ].map(([lbl, val]) => (
            <div key={lbl} className="flex justify-between">
              <span className="text-muted-foreground">{lbl}</span>
              <span className="text-card-foreground font-medium">{val}</span>
            </div>
          ))}
        </div>

        {/* Savings breakdown */}
        <div className="rounded-lg border p-4 space-y-2 text-sm">
          <h3 className="text-sm font-semibold text-foreground mb-2">
            Savings Calculator Results
          </h3>
          {[
            ["Product",           quote.product],
            ["Quantity / Month",  quote.quantityPerMonth],
            ["Current Fuel",      quote.currentFuel],
            [`${quote.currentFuel} Cost`, quote.currentCost],
            ["With Biomass Pellets", quote.biomassCost],
            ["Monthly Savings",  quote.monthlySavings],
            ["Annual Savings",   quote.annualSavings],
          ].map(([lbl, val]) => (
            <div key={lbl} className="flex justify-between">
              <span className="text-muted-foreground">{lbl}</span>
              <span className="text-card-foreground">{val || "—"}</span>
            </div>
          ))}
        </div>

        {/* Admin actions */}
        <Field label="Quoted Price">
          <Input
            value={quotedPrice}
            onChange={(e) => setQuotedPrice(e.target.value)}
            placeholder="e.g. ₹13.50/kg"
          />
        </Field>

        <Field label="Admin Notes">
          <Textarea
            value={adminNotes}
            onChange={(e) => setAdminNotes(e.target.value)}
            placeholder="Add notes about this quote..."
            rows={3}
          />
        </Field>

        <Field label="Update Status">
          <Select value={status} onValueChange={(v) => setStatus(v as QuoteStatus)}>
            <SelectTrigger className="max-w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="New">New</SelectItem>
              <SelectItem value="Contacted">Contacted</SelectItem>
              <SelectItem value="Quoted">Quoted</SelectItem>
              <SelectItem value="Closed">Closed</SelectItem>
            </SelectContent>
          </Select>
          {status === "Quoted" && quotedPrice && (
            <p className="mt-1.5 text-xs text-muted-foreground">
              Saving with "Quoted" status will email the price to the customer.
            </p>
          )}
        </Field>
      </div>
    </FormPage>
  );
}
