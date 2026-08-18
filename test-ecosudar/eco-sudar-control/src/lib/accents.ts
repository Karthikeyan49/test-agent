export type Accent = "sky" | "violet" | "amber" | "emerald" | "rose" | "teal" | "slate";

export interface AccentClasses {
  tile: string;
  icon: string;
  border: string;
}

export const ACCENTS: Record<Accent, AccentClasses> = {
  sky: {
    tile: "bg-sky-50 dark:bg-sky-500/10",
    icon: "text-sky-600 dark:text-sky-400",
    border: "border-sky-200 dark:border-sky-500/20",
  },
  violet: {
    tile: "bg-violet-50 dark:bg-violet-500/10",
    icon: "text-violet-600 dark:text-violet-400",
    border: "border-violet-200 dark:border-violet-500/20",
  },
  amber: {
    tile: "bg-amber-50 dark:bg-amber-500/10",
    icon: "text-amber-600 dark:text-amber-400",
    border: "border-amber-200 dark:border-amber-500/20",
  },
  emerald: {
    tile: "bg-emerald-50 dark:bg-emerald-500/10",
    icon: "text-emerald-600 dark:text-emerald-400",
    border: "border-emerald-200 dark:border-emerald-500/20",
  },
  rose: {
    tile: "bg-rose-50 dark:bg-rose-500/10",
    icon: "text-rose-600 dark:text-rose-400",
    border: "border-rose-200 dark:border-rose-500/20",
  },
  teal: {
    tile: "bg-teal-50 dark:bg-teal-500/10",
    icon: "text-teal-600 dark:text-teal-400",
    border: "border-teal-200 dark:border-teal-500/20",
  },
  slate: {
    tile: "bg-slate-100 dark:bg-slate-500/10",
    icon: "text-slate-600 dark:text-slate-400",
    border: "border-slate-200 dark:border-slate-500/20",
  },
};

export const SUBJECT: Record<string, Accent> = {
  revenue: "emerald",
  cost: "rose",
  stock: "teal",
  orders: "sky",
  people: "violet",
  pending: "amber",
  derived: "violet",
  neutral: "slate",
};

export const MODULE: Record<string, Accent> = {
  Overview: "sky",
  Operations: "sky",
  Finance: "amber",
  "Human Resources": "violet",
  Productivity: "teal",
  "Customer Engagement": "rose",
  Intelligence: "violet",
  Admin: "slate",
};

export const accentOf = (a: Accent): AccentClasses => ACCENTS[a];
