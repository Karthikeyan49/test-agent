import { useEffect, useMemo, useRef, useState } from "react";
import { sections, sectionIcons, ACTIVE_MODULE_STORAGE_KEY } from "@/lib/navigation";
import type { MenuItem, MenuSection } from "@/lib/navigation";
import { useNavigate } from "react-router-dom";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  Search,
  ChevronRight,
  Cpu,
  Smartphone,
} from "lucide-react";

interface ModulesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const moduleDescriptions: Record<string, string> = {
  "/":                   "Today's actions, revenue overview, operations health, AI recommendations",
  "/products":           "Products catalog — manage SKUs, pricing, stock and categories",
  "/orders":             "Sales orders — create, track and fulfil customer orders",
  "/pending-approvals":  "Review and approve dealer registrations and pending actions",
  "/customers":          "Customer CRM — contacts, history, credit limits and ledgers",
  "/dealers":            "Dealer network — authorised dealers, territories and performance",
  "/inventory":              "Plant overview — raw materials, production output and finished stock",
  "/inventory/production":   "Daily production runs — output, batches and raw-material consumption",
  "/inventory/raw-materials":"Biomass feedstock stock, reorder levels and movements",
  "/inventory/stock":        "Finished-goods stock by category with reorder alerts",
  "/inventory/movements":    "Auditable ledger of every stock change in the plant",
  "/purchase/orders":        "Raise and track purchase orders to vendors",
  "/purchase/vendors":       "Supplier master — contacts, GSTIN and payment terms",
  "/sales/quotations":       "Customer quotations — send, then convert to a sales order",
  "/sales/sales-orders":     "Confirmed sales orders — dispatch challans and raise invoices",
  "/sales/delivery-challans":"Delivery challans — finished stock dispatched against an order",
  "/invoices":           "Tax invoices — generate, send and track payment status",
  "/sales-billing":      "Sales billing summary, receipts and billing reports",
  "/expenses":           "Record and categorise business expenses",
  "/finance":            "Profit & Loss — revenue vs. cost by period and product",
  "/financial-statements": "Cash flow and receivables/payables ageing from recorded transactions",
  "/finance-planning":   "Budget vs actuals, forecasting and financial planning",
  "/gst-compliance":     "Monthly GSTR summary, output vs input tax, and return filing status",
  "/gst-invoicing":      "GST-compliant invoice generation and filing data",
  "/reports":            "Consolidated business reports and exports",
  "/customer-report":    "Customer-wise revenue, order history and outstanding summary",
  "/monthly-report":     "Month-over-month performance summary",
  "/customer-ledger":    "Customer ledger — debit/credit and balance statements",
  "/employees":          "Employee master — roles, departments and assignments",
  "/attendance":         "Daily attendance tracking and monthly summaries",
  "/hr-compliance":      "PF, ESI and statutory HR compliance records",
  "/payroll":            "Monthly salary processing and payslip generation",
  "/advance-register":   "Employee salary advances and recovery tracking",
  "/tasks":              "Task management — assign, track and close action items",
  "/meetings":           "Schedule and log meetings with agendas and outcomes",
  "/workflows":          "Automated workflow rules and approval chains",
  "/sops":               "Standard Operating Procedures by department",
  "/queries":            "Customer query inbox — respond and resolve",
  "/quote-requests":     "Website quote requests — review and convert to orders",
  "/faq":                "FAQ management for the customer-facing portal",
  "/insights":           "AI-generated insights, trends and anomaly detection",
  "/data-interop":       "Import/export, integrations and data pipelines",
  "/settings":           "System configuration, users and access control",
};

type SearchResult =
  | { kind: "module"; section: MenuSection }
  | { kind: "item"; item: MenuItem; parent: MenuSection };

export function ModulesDialog({ open, onOpenChange }: ModulesDialogProps) {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [activeLabel, setActiveLabel] = useState<string | null>(null);
  const rowRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const displaySections = sections.filter((s) => s.label !== "Overview");

  useEffect(() => {
    if (open) {
      setQuery("");
      setActiveLabel(displaySections[0]?.label ?? null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleItemClick = (url: string, sectionLabel: string) => {
    localStorage.setItem(ACTIVE_MODULE_STORAGE_KEY, sectionLabel);
    navigate(url);
    onOpenChange(false);
  };

  const activeSection =
    displaySections.find((s) => s.label === activeLabel) ?? displaySections[0];

  const onRowKeyDown = (e: React.KeyboardEvent, idx: number, section: MenuSection) => {
    let next = -1;
    if (e.key === "ArrowDown") next = Math.min(idx + 1, displaySections.length - 1);
    else if (e.key === "ArrowUp") next = Math.max(idx - 1, 0);
    else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      if (section.items[0]) handleItemClick(section.items[0].url, section.label);
      return;
    }
    if (next >= 0) {
      e.preventDefault();
      rowRefs.current[next]?.focus();
      setActiveLabel(displaySections[next].label);
    }
  };

  const results = useMemo<SearchResult[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const out: SearchResult[] = [];
    for (const section of displaySections) {
      if (section.label.toLowerCase().includes(q)) out.push({ kind: "module", section });
    }
    for (const section of displaySections) {
      for (const item of section.items) {
        if (item.title.toLowerCase().includes(q)) out.push({ kind: "item", item, parent: section });
      }
    }
    return out;
  }, [query, displaySections]);

  const searching = query.trim().length > 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl h-[85vh] flex flex-col overflow-hidden">
        <DialogHeader>
          <DialogTitle>Select a module</DialogTitle>
          <DialogDescription>Choose an area to load in the sidebar</DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search modules and areas…"
            className="pl-9"
            autoFocus
          />
        </div>

        {searching ? (
          <div className="flex-1 min-h-0 overflow-y-auto py-2 space-y-0.5 eco-float-scroll">
            {results.map((r) => {
              const isModule = r.kind === "module";
              const section = isModule ? r.section : r.parent;
              const Icon = isModule
                ? (sectionIcons[section.label] ?? section.items[0]?.icon ?? Cpu)
                : r.item.icon;
              const label = isModule ? section.label : r.item.title;
              const url   = isModule ? section.items[0]?.url : r.item.url;
              return (
                <button
                  key={`${r.kind}-${label}-${url}`}
                  onClick={() => url && handleItemClick(url, section.label)}
                  title={!isModule ? (moduleDescriptions[r.item.url] ?? r.item.title) : undefined}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg hover:bg-muted/30 transition-colors text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                    <Icon className="h-4 w-4 text-primary" />
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className={`block text-sm truncate ${isModule ? "font-semibold text-primary" : "text-card-foreground"}`}>
                      {label}
                    </span>
                    <span className="block text-xs text-muted-foreground">
                      {isModule
                        ? (moduleDescriptions[section.items[0]?.url ?? ""] ?? `${section.items.length} areas`)
                        : `in ${section.label}`}
                    </span>
                  </span>
                </button>
              );
            })}
            {results.length === 0 && (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">
                No matches for &ldquo;{query.trim()}&rdquo;
              </p>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-[minmax(180px,1fr)_1.6fr] gap-4 py-4 overflow-hidden">
            <div className="space-y-1 overflow-y-auto min-h-0 pr-1 eco-float-scroll">
              {displaySections.map((section, idx) => {
                const Icon  = sectionIcons[section.label] ?? section.items[0]?.icon ?? Cpu;
                const count = section.items.length;
                const isActive = activeSection?.label === section.label;
                const prevGroup = idx > 0 ? displaySections[idx - 1].group : undefined;
                const showGroupHeader = section.group && section.group !== prevGroup;
                return (
                  <div key={section.label} className="contents">
                  {showGroupHeader && (
                    <div className="flex items-center gap-1.5 px-2 pt-2 pb-0.5">
                      <Smartphone className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{section.group}</span>
                    </div>
                  )}
                  <button
                    ref={(el) => { rowRefs.current[idx] = el; }}
                    onMouseEnter={() => setActiveLabel(section.label)}
                    onFocus={() => setActiveLabel(section.label)}
                    onClick={() => {
                      const hasHover = window.matchMedia("(hover: hover)").matches;
                      if (hasHover || isActive) {
                        if (section.items[0]) handleItemClick(section.items[0].url, section.label);
                      } else {
                        setActiveLabel(section.label);
                      }
                    }}
                    onKeyDown={(e) => onRowKeyDown(e, idx, section)}
                    aria-current={isActive ? "true" : undefined}
                    className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 border-[0.5px] ${section.group ? "ml-3 w-[calc(100%-0.75rem)]" : ""} ${
                      isActive
                        ? "bg-primary/10 border-primary/30"
                        : "border-transparent hover:bg-muted/40"
                    }`}
                  >
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10">
                      <Icon className="h-5 w-5 text-primary" />
                    </span>
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium text-card-foreground truncate">{section.label}</span>
                      <span className="block text-xs text-muted-foreground">{count} {count === 1 ? "area" : "areas"}</span>
                    </span>
                    <ChevronRight className={`h-4 w-4 shrink-0 transition-colors ${isActive ? "text-primary" : "text-muted-foreground/40"}`} />
                  </button>
                  </div>
                );
              })}
            </div>

            <div className="rounded-xl border border-border bg-muted/20 p-3 overflow-y-auto min-h-0 eco-float-scroll">
              {activeSection && (
                <>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground px-1 pb-2">
                    {activeSection.label}
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1">
                    {activeSection.items.map((item, idx) => {
                      const ItemIcon = item.icon;
                      const desc = moduleDescriptions[item.url];
                      const prevGroup = idx > 0 ? activeSection.items[idx - 1].group : undefined;
                      const showSub = item.group && item.group !== prevGroup;
                      return (
                        <div key={item.url} className="contents">
                        {showSub && (
                          <p className="col-span-full text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/80 px-1 pt-2 pb-0.5">
                            {item.group}
                          </p>
                        )}
                        <button
                          onClick={() => handleItemClick(item.url, activeSection.label)}
                          title={desc ?? item.title}
                          className="flex items-start gap-2.5 px-3 py-2.5 rounded-lg text-left bg-card hover:bg-muted/40 hover:text-primary transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                        >
                          <ItemIcon className="h-4 w-4 shrink-0 text-primary mt-0.5" />
                          <span className="flex-1 min-w-0">
                            <span className="block text-sm font-medium text-card-foreground truncate">{item.title}</span>
                            {desc && <span className="block text-xs text-muted-foreground leading-snug mt-0.5 line-clamp-2">{desc}</span>}
                          </span>
                        </button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
