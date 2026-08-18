import {
  LayoutDashboard,
  Store,
  Users,
  UserPlus,
  ShoppingCart,
  FileText,
  UserCheck,
  MessageSquare,
  HelpCircle,
  Calculator,
  Wallet,
  LineChart,
  Receipt,
  FileBarChart2,
  Contact2,
  ClipboardCheck,
  BadgeIndianRupee,
  ListTodo,
  CalendarClock,
  BookOpen,
  GitBranch,
  Sparkles,
  FileStack,
  DatabaseZap,
  ShieldCheck,
  Home,
  Settings,
  Headset,
  Boxes,
  Package,
  Wrench,
  Factory,
  PackageSearch,
  Layers,
  ArrowLeftRight,
  Scale,
  Smartphone,
  ShoppingBag,
  ClipboardList,
  Building2,
  Handshake,
  FileSignature,
  Truck,
} from "lucide-react";

/** `group` places an item under a named sub-module within its parent module. */
export type MenuItem = { title: string; url: string; icon: typeof LayoutDashboard; group?: string };
/** `group` clusters sub-modules under a parent module in the module picker. */
export type MenuSection = { label: string; items: MenuItem[]; group?: string };

// Ordered to follow how the plant actually runs — the value chain:
// Overview → Purchase (procure raw materials) → Inventory (store → produce →
// finished stock) → Sales (sell) → Finance (account) → HR → Productivity →
// Reports → Mobile App (engagement channel) → Intelligence → Admin.
export const sections: MenuSection[] = [
  {
    label: "Overview",
    items: [{ title: "Dashboard", url: "/", icon: LayoutDashboard }],
  },
  {
    // Procure-to-pay: line up vendors, raise POs, receive & bill, record spend.
    label: "Purchase",
    items: [
      { title: "Vendors", url: "/purchase/vendors", icon: Building2 },
      { title: "Purchase Orders", url: "/purchase/orders", icon: ClipboardList },
      { title: "Purchase Items", url: "/purchase/items", icon: Package },
      { title: "Expenses", url: "/expenses", icon: Wallet },
    ],
  },
  {
    // Make: item master → raw stock in → production → finished stock → ledger.
    label: "Inventory",
    items: [
      { title: "Overview", url: "/inventory", icon: Boxes },
      { title: "Spares & Assets", url: "/inventory/items", icon: Wrench },
      { title: "Raw Materials", url: "/inventory/raw-materials", icon: PackageSearch },
      { title: "Daily Production", url: "/inventory/production", icon: Factory },
      { title: "Finished Stock", url: "/inventory/stock", icon: Layers },
      { title: "Stock Movements", url: "/inventory/movements", icon: ArrowLeftRight },
    ],
  },
  {
    // Order-to-cash: catalog & customer master → quote → order → dispatch → bill.
    label: "Sales",
    items: [
      { title: "Products", url: "/products", icon: Store },
      { title: "Customers", url: "/customers", icon: Users },
      { title: "Quotations", url: "/sales/quotations", icon: FileSignature },
      { title: "Sales Orders", url: "/sales/sales-orders", icon: ShoppingCart },
      { title: "Delivery Challans", url: "/sales/delivery-challans", icon: Truck },
      { title: "Invoices", url: "/invoices", icon: FileText },
    ],
  },
  {
    label: "Finance",
    items: [
      { title: "Sales Billing", url: "/sales-billing", icon: FileStack },
      { title: "GST Compliance", url: "/gst-compliance", icon: ShieldCheck },
      { title: "Financial Statements", url: "/financial-statements", icon: Scale },
      { title: "Profit & Loss", url: "/finance", icon: LineChart },
      { title: "Finance Planning", url: "/finance-planning", icon: FileBarChart2 },
    ],
  },
  {
    label: "Human Resources",
    items: [
      { title: "Employees", url: "/employees", icon: Contact2 },
      { title: "Attendance", url: "/attendance", icon: ClipboardCheck },
      { title: "Payroll", url: "/payroll", icon: BadgeIndianRupee },
      { title: "Advance Register", url: "/advance-register", icon: Wallet },
      { title: "HR Compliance", url: "/hr-compliance", icon: ShieldCheck },
    ],
  },
  {
    label: "Productivity",
    items: [
      { title: "Tasks", url: "/tasks", icon: ListTodo },
      { title: "Meetings", url: "/meetings", icon: CalendarClock },
      { title: "Workflows", url: "/workflows", icon: GitBranch },
      { title: "SOPs", url: "/sops", icon: BookOpen },
    ],
  },
  {
    label: "Reports",
    items: [
      { title: "All Reports", url: "/reports", icon: FileBarChart2 },
      { title: "Customer Report", url: "/customer-report", icon: Contact2 },
      { title: "Monthly Report", url: "/monthly-report", icon: CalendarClock },
      { title: "Customer Ledger", url: "/customer-ledger", icon: BookOpen },
    ],
  },
  {
    // Parent module: the mobile-app–driven areas, split into two sub-modules.
    label: "Mobile App",
    items: [
      { title: "Pending Approvals", url: "/pending-approvals", icon: UserPlus,  group: "Operations" },
      { title: "Dealer Network",    url: "/dealers",           icon: UserCheck, group: "Operations" },
      { title: "Queries",           url: "/queries",           icon: MessageSquare, group: "Customer Engagement" },
      { title: "Quote Requests",    url: "/quote-requests",    icon: Calculator,    group: "Customer Engagement" },
      { title: "FAQ Management",    url: "/faq",               icon: HelpCircle,    group: "Customer Engagement" },
    ],
  },
  {
    label: "Intelligence",
    items: [
      { title: "AI Insights", url: "/insights", icon: Sparkles },
    ],
  },
  {
    label: "Admin",
    items: [
      { title: "Data Interop", url: "/data-interop", icon: DatabaseZap },
    ],
  },
];

/** The icon that represents a whole module (section) in the switcher and modules dialog. */
export const sectionIcons: Record<string, MenuItem["icon"]> = {
  Overview:              LayoutDashboard,
  "Mobile App":          Smartphone,
  Operations:            ShoppingBag,
  Inventory:             Boxes,
  Purchase:              ShoppingBag,
  Sales:                 Handshake,
  Finance:               BadgeIndianRupee,
  "Human Resources":     Contact2,
  Productivity:          ListTodo,
  "Customer Engagement": MessageSquare,
  Reports:               FileBarChart2,
  Intelligence:          Sparkles,
  Admin:                 DatabaseZap,
};

/** Icon for a section label; falls back to the section's first item icon, then Store. */
export function sectionIcon(label: string): MenuItem["icon"] {
  if (sectionIcons[label]) return sectionIcons[label];
  const section = sections.find((s) => s.label === label);
  return section?.items[0]?.icon ?? Store;
}

export function findSectionByPath(pathname: string): MenuSection | null {
  for (const section of sections) {
    for (const item of section.items) {
      if (item.url === pathname) {
        return section;
      }
    }
  }
  return null;
}

export function getDefaultSection(): MenuSection {
  return sections[1]; // Purchase — first operational module after Overview
}

export const ACTIVE_MODULE_STORAGE_KEY = "eco_active_module_section";

export function resolveStoredSection(stored: string): MenuSection | undefined {
  return sections.find((s) => s.label === stored);
}

/** Titles for routes not in the sidebar (detail pages, utility pages). */
const EXTRA_ROUTE_TITLES: Record<string, string> = {
  "/":         "Dashboard",
  "/settings": "Settings",
  "/contact":  "Contact & Support",
};

const EXTRA_ROUTE_ICONS: Record<string, MenuItem["icon"]> = {
  "/":         Home,
  "/settings": Settings,
  "/contact":  Headset,
};

/** Turn a URL slug into a readable title as a last resort. */
function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * The icon a route shows in the workspace tab strip.
 * Sidebar entries are authoritative; falls back to EXTRA_ROUTE_ICONS, then FileText.
 */
export function routeIcon(pathname: string): MenuItem["icon"] {
  const path = pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  for (const section of sections) {
    for (const item of section.items) {
      if (item.url === path) return item.icon;
    }
  }
  return EXTRA_ROUTE_ICONS[path] ?? FileText;
}

/**
 * The label a route shows in the workspace tab strip.
 * Sidebar entries are authoritative; falls back to EXTRA_ROUTE_TITLES, then slug.
 */
export function routeTitle(pathname: string): string {
  const path = pathname !== "/" && pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  for (const section of sections) {
    for (const item of section.items) {
      if (item.url === path) return item.title;
    }
  }
  if (EXTRA_ROUTE_TITLES[path]) return EXTRA_ROUTE_TITLES[path];
  const last = path.split("/").filter(Boolean).pop();
  return last ? titleCaseSlug(last) : "Dashboard";
}
