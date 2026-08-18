import { useEffect, useState } from "react";
import { Sparkles, TrendingUp, AlertTriangle, Lightbulb, Activity, Loader2, RefreshCw, PlayCircle, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogScrollContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { useRegisterChatContext } from "@/contexts/ChatContext";
import { apiFetch } from "@/lib/api/client";

type Tab = "sales" | "expenses" | "employees" | "production";

interface InsightItem { 
  title: string; 
  detail: string;
  mitigation?: {
    steps: string[];
    expected_outcome: string;
    timeline: string;
    cost_effort?: string;
    severity?: string;
    impact_if_ignored?: string;
  };
  improvement?: {
    suggestions: string[];
    performance_impact: {
      if_we_do: string;
      then_improves: string;
      by_percentage: string;
    };
    timeline: string;
    before_after: {
      before: string;
      after: string;
    };
  };
  metric?: {
    current_value: string;
    target_value: string;
    trend: string;
    how_to_improve: string[];
    projected_impact: {
      if_we_do: string;
      metric_becomes: string;
      additional_benefits: string;
    };
    projected_timeline: string;
  };
}

interface InsightsResult {
  recommendations: InsightItem[];
  improvements: InsightItem[];
  criticalIssues: InsightItem[];
  performanceMetrics: InsightItem[];
  generatedAt: string;
}

const TABS: { key: Tab; label: string; description: string }[] = [
  { key: "sales", label: "Sales", description: "Revenue trends, top SKUs, churn risk" },
  { key: "expenses", label: "Expenses", description: "Spend leaks, vendor concentration, anomalies" },
  { key: "employees", label: "Employees", description: "Attendance, productivity, payroll efficiency" },
  { key: "production", label: "Production", description: "Throughput, downtime, raw-material yield" },
];

const STORAGE_KEY = "eco_insights_cache_v1";

export default function Insights() {
  const [tab, setTab] = useState<Tab>("sales");
  const [busy, setBusy] = useState<Tab | "all" | null>(null);
  const [results, setResults] = useState<Partial<Record<Tab, InsightsResult>>>(() => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}"); } catch { return {}; }
  });
  const [selectedInsight, setSelectedInsight] = useState<InsightItem | null>(null);

  const register = useRegisterChatContext();
  useEffect(() => register({
    page: "AI Insights",
    summary: `Tab: ${tab}`,
    data: results[tab],
  }), [register, tab, results]);

  const persist = (next: Partial<Record<Tab, InsightsResult>>) => {
    setResults(next);
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(next)); } catch { /* ignore quota */ }
  };

  const generate = async (which: Tab | "all") => {
    setBusy(which);
    try {
      const targets: Tab[] = which === "all" ? TABS.map((t) => t.key) : [which];
      const next = { ...results };
      
      for (const t of targets) {
        const data = await apiFetch<{ data: InsightsResult }>('/admin/insights/generate', {
          method: 'POST',
          body: JSON.stringify({ category: t })
        });
        next[t] = data.data;
      }
      
      persist(next);
      toast.success(which === "all" ? "All insights generated!" : `${which} insights generated!`);
    } catch (e) {
      const error = e as Error;
      toast.error(error?.message ?? "Could not generate insights");
    } finally {
      setBusy(null);
    }
  };

  const result = results[tab];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-foreground flex items-center gap-2">
            <Sparkles className="h-6 w-6 text-primary" /> AI Insights
          </h1>
          <p className="text-muted-foreground">
            Cross-module recommendations, risks and metrics — powered by Lovable AI.
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => generate("all")} disabled={!!busy}>
            {busy === "all" ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
            Generate All
          </Button>
        </div>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="grid grid-cols-2 md:grid-cols-4 w-full">
          {TABS.map((t) => (
            <TabsTrigger key={t.key} value={t.key}>{t.label}</TabsTrigger>
          ))}
        </TabsList>

        {TABS.map((t) => (
          <TabsContent key={t.key} value={t.key} className="space-y-4 mt-6">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <div>
                <h2 className="text-lg font-semibold text-foreground">{t.label}</h2>
                <p className="text-sm text-muted-foreground">{t.description}</p>
              </div>
              <Button onClick={() => generate(t.key)} disabled={!!busy}>
                {busy === t.key ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                {results[t.key] ? "Regenerate" : "Generate Insights"}
              </Button>
            </div>

            {!result && t.key === tab && (
              <div className="rounded-xl border border-dashed bg-card p-10 text-center text-muted-foreground">
                Click <strong>Generate Insights</strong> to analyse your {t.label.toLowerCase()} data.
              </div>
            )}

            {result && t.key === tab && (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <InsightSection
                  title="Recommendations"
                  icon={<Lightbulb className="h-4 w-4" />}
                  tone="recommendation"
                  items={result.recommendations}
                  onItemClick={setSelectedInsight}
                />
                <InsightSection
                  title="Areas of Improvement"
                  icon={<TrendingUp className="h-4 w-4" />}
                  tone="improvement"
                  items={result.improvements}
                  onItemClick={setSelectedInsight}
                />
                <InsightSection
                  title="Critical Issues"
                  icon={<AlertTriangle className="h-4 w-4" />}
                  tone="critical"
                  items={result.criticalIssues}
                  onItemClick={setSelectedInsight}
                />
                <InsightSection
                  title="Performance Metrics"
                  icon={<Activity className="h-4 w-4" />}
                  tone="metric"
                  items={result.performanceMetrics}
                  onItemClick={setSelectedInsight}
                />
              </div>
            )}

            {result && t.key === tab && (
              <p className="text-xs text-muted-foreground italic">{result.generatedAt}</p>
            )}
          </TabsContent>
        ))}
      </Tabs>

      {/* Details Dialog */}
      <Dialog open={!!selectedInsight} onOpenChange={() => setSelectedInsight(null)}>
        <DialogScrollContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>{selectedInsight?.title}</DialogTitle>
            <DialogDescription>{selectedInsight?.detail}</DialogDescription>
          </DialogHeader>
          
          {selectedInsight?.mitigation && (
            <div className="space-y-4 mt-4">
              <div>
                <h4 className="font-semibold text-sm mb-2">Mitigation Steps:</h4>
                <ol className="list-decimal list-inside space-y-1 text-sm">
                  {selectedInsight.mitigation.steps.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold">Expected Outcome:</span>
                  <p className="text-muted-foreground">{selectedInsight.mitigation.expected_outcome}</p>
                </div>
                <div>
                  <span className="font-semibold">Timeline:</span>
                  <p className="text-muted-foreground">{selectedInsight.mitigation.timeline}</p>
                </div>
                {selectedInsight.mitigation.cost_effort && (
                  <div>
                    <span className="font-semibold">Cost/Effort:</span>
                    <p className="text-muted-foreground">{selectedInsight.mitigation.cost_effort}</p>
                  </div>
                )}
                {selectedInsight.mitigation.severity && (
                  <div>
                    <span className="font-semibold">Severity:</span>
                    <p className="text-destructive font-medium">{selectedInsight.mitigation.severity}</p>
                  </div>
                )}
              </div>
              
              {selectedInsight.mitigation.impact_if_ignored && (
                <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3">
                  <span className="font-semibold text-sm text-destructive">Impact if Ignored:</span>
                  <p className="text-sm text-muted-foreground mt-1">{selectedInsight.mitigation.impact_if_ignored}</p>
                </div>
              )}
            </div>
          )}

          {selectedInsight?.improvement && (
            <div className="space-y-4 mt-4">
              <div>
                <h4 className="font-semibold text-sm mb-2">Suggestions:</h4>
                <ul className="list-disc list-inside space-y-1 text-sm">
                  {selectedInsight.improvement.suggestions.map((suggestion, i) => (
                    <li key={i}>{suggestion}</li>
                  ))}
                </ul>
              </div>
              
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-lg p-3">
                <h4 className="font-semibold text-sm mb-2">Performance Impact:</h4>
                <p className="text-sm"><strong>If we do:</strong> {selectedInsight.improvement.performance_impact.if_we_do}</p>
                <p className="text-sm"><strong>Then improves:</strong> {selectedInsight.improvement.performance_impact.then_improves}</p>
                <p className="text-sm"><strong>By:</strong> {selectedInsight.improvement.performance_impact.by_percentage}</p>
              </div>
              
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold">Before:</span>
                  <p className="text-muted-foreground">{selectedInsight.improvement.before_after.before}</p>
                </div>
                <div>
                  <span className="font-semibold">After:</span>
                  <p className="text-muted-foreground">{selectedInsight.improvement.before_after.after}</p>
                </div>
              </div>
              
              <div>
                <span className="font-semibold text-sm">Timeline:</span>
                <p className="text-sm text-muted-foreground">{selectedInsight.improvement.timeline}</p>
              </div>
            </div>
          )}

          {selectedInsight?.metric && (
            <div className="space-y-4 mt-4">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <span className="font-semibold">Current Value:</span>
                  <p className="text-muted-foreground">{selectedInsight.metric.current_value}</p>
                </div>
                <div>
                  <span className="font-semibold">Target Value:</span>
                  <p className="text-muted-foreground">{selectedInsight.metric.target_value}</p>
                </div>
                <div>
                  <span className="font-semibold">Trend:</span>
                  <p className="text-muted-foreground capitalize">{selectedInsight.metric.trend}</p>
                </div>
                <div>
                  <span className="font-semibold">Timeline:</span>
                  <p className="text-muted-foreground">{selectedInsight.metric.projected_timeline}</p>
                </div>
              </div>
              
              <div>
                <h4 className="font-semibold text-sm mb-2">How to Improve:</h4>
                <ol className="list-decimal list-inside space-y-1 text-sm">
                  {selectedInsight.metric.how_to_improve.map((step, i) => (
                    <li key={i}>{step}</li>
                  ))}
                </ol>
              </div>
              
              <div className="bg-blue-500/10 border border-blue-500/20 rounded-lg p-3">
                <h4 className="font-semibold text-sm mb-2">Projected Impact:</h4>
                <p className="text-sm"><strong>If we do:</strong> {selectedInsight.metric.projected_impact.if_we_do}</p>
                <p className="text-sm"><strong>Metric becomes:</strong> {selectedInsight.metric.projected_impact.metric_becomes}</p>
                <p className="text-sm"><strong>Additional benefits:</strong> {selectedInsight.metric.projected_impact.additional_benefits}</p>
              </div>
            </div>
          )}
        </DialogScrollContent>
      </Dialog>
    </div>
  );
}

function InsightSection({
  title, icon, tone, items, onItemClick,
}: {
  title: string;
  icon: React.ReactNode;
  tone: "recommendation" | "improvement" | "critical" | "metric";
  items: InsightItem[];
  onItemClick: (item: InsightItem) => void;
}) {
  const toneClasses: Record<typeof tone, string> = {
    recommendation: "border-l-primary bg-primary/5",
    improvement: "border-l-amber-500 bg-amber-500/5",
    critical: "border-l-destructive bg-destructive/5",
    metric: "border-l-blue-500 bg-blue-500/5",
  } as const;
  const badgeClasses: Record<typeof tone, string> = {
    recommendation: "bg-primary/15 text-primary",
    improvement: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
    critical: "bg-destructive/15 text-destructive",
    metric: "bg-blue-500/15 text-blue-700 dark:text-blue-300",
  } as const;

  return (
    <div className={`rounded-xl border border-l-4 ${toneClasses[tone]} p-5 space-y-3`}>
      <div className="flex items-center gap-2 font-semibold text-foreground">
        <span className={`p-1.5 rounded-md ${badgeClasses[tone]}`}>{icon}</span>
        {title}
        <span className="text-xs text-muted-foreground font-normal">({items.length})</span>
      </div>
      <ul className="space-y-2.5">
        {items.length === 0 && <li className="text-sm text-muted-foreground italic">Nothing to flag.</li>}
        {items.map((it, i) => (
          <li key={i} className="text-sm">
            <p className="font-medium text-foreground">{it.title}</p>
            <p className="text-muted-foreground">{it.detail}</p>
            {(it.mitigation || it.improvement || it.metric) && (
              <button
                onClick={() => onItemClick(it)}
                className="text-xs text-primary hover:underline flex items-center gap-1 mt-1"
              >
                Click to show {it.mitigation ? 'mitigation steps' : it.improvement ? 'improvement details' : 'metric details'}
                <ChevronRight className="h-3 w-3" />
              </button>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}