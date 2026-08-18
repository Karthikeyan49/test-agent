import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";

/** Sentinel value for the "all / no filter" option (Radix Select forbids ""). */
export const ALL = "__all__";

/** The standard filter strip: a card row that lays out search + field filters. */
export function FilterBar({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-card rounded-xl border p-4 shadow-sm flex flex-wrap items-center gap-3">
      {children}
    </div>
  );
}

/** Standard search box for the filter strip. */
export function FilterSearch({
  value, onChange, placeholder = "Search…", className = "w-full sm:w-72",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  className?: string;
}) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
      <Input className="pl-9" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

/**
 * A single field-wise filter dropdown (e.g. City, Status, Vendor). Value ALL
 * means "no filter". Pair with `matchesFilter` in the page's useMemo.
 */
export function FilterSelect({
  label, value, onChange, options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-auto min-w-[8.5rem] gap-1.5">
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{label}: All</SelectItem>
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/** True if a row's field value passes a filter set to ALL or a specific value. */
export function matchesFilter(filterValue: string, rowValue: unknown): boolean {
  return filterValue === ALL || String(rowValue ?? "") === filterValue;
}

/** Distinct, sorted option list for a field, ready for <FilterSelect options>. */
export function distinctOptions<T>(rows: T[], pick: (r: T) => unknown): { value: string; label: string }[] {
  const set = new Set<string>();
  rows.forEach((r) => {
    const v = pick(r);
    if (v !== null && v !== undefined && String(v).trim() !== "") set.add(String(v));
  });
  return Array.from(set).sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
}
