import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface SortableHeaderProps<T extends string> {
  label: string;
  sortKey: T;
  currentKey: T | null;
  dir: "asc" | "desc";
  onSort: (key: T) => void;
  className?: string;
  align?: "left" | "right" | "center";
}

export function SortableHeader<T extends string>({
  label,
  sortKey,
  currentKey,
  dir,
  onSort,
  className,
  align = "left",
}: SortableHeaderProps<T>) {
  const active = currentKey === sortKey;

  return (
    <th
      className={cn(
        "py-3 px-4 text-xs font-medium uppercase tracking-wider text-muted-foreground cursor-pointer select-none hover:text-foreground transition-colors whitespace-nowrap",
        align === "right"  && "text-right",
        align === "center" && "text-center",
        className,
      )}
      onClick={() => onSort(sortKey)}
    >
      <span className="inline-flex items-center gap-1">
        {label}
        {active
          ? dir === "asc"
            ? <ArrowUp   className="h-3.5 w-3.5 text-primary" />
            : <ArrowDown className="h-3.5 w-3.5 text-primary" />
          : <ArrowUpDown className="h-3.5 w-3.5 opacity-30" />}
      </span>
    </th>
  );
}
