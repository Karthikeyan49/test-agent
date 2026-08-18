import { useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Plus, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface RecordComboboxProps<T> {
  options: T[];
  value: number | string | null | undefined;
  onSelect: (id: number | string) => void;
  getId:       (item: T) => number | string;
  getLabel:    (item: T) => string;
  getSecondary?: (item: T) => string | undefined;
  placeholder?: string;
  disabled?: boolean;
  onAddNew?: () => void;
  addNewLabel?: string;
  className?: string;
}

export function RecordCombobox<T>({
  options,
  value,
  onSelect,
  getId,
  getLabel,
  getSecondary,
  placeholder = "Select…",
  disabled,
  onAddNew,
  addNewLabel = "New record",
  className,
}: RecordComboboxProps<T>) {
  const [open,  setOpen]  = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  // The menu is portaled to <body> so it is never clipped by a scroll container
  // (e.g. a line-items table inside ScrollableX). Position it under the trigger.
  const [rect, setRect] = useState<{ left: number; top: number; width: number } | null>(null);

  const selected = value != null ? options.find((o) => getId(o) === value) : null;

  const filtered = query.trim()
    ? options.filter((o) => {
        const label     = getLabel(o).toLowerCase();
        const secondary = getSecondary?.(o)?.toLowerCase() ?? "";
        const q         = query.toLowerCase();
        return label.includes(q) || secondary.includes(q);
      })
    : options;

  const position = () => {
    const el = triggerRef.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    setRect({ left: r.left, top: r.bottom + 4, width: r.width });
  };

  useLayoutEffect(() => {
    if (!open) return;
    position();
    const handler = () => position();
    window.addEventListener("scroll", handler, true);
    window.addEventListener("resize", handler);
    return () => {
      window.removeEventListener("scroll", handler, true);
      window.removeEventListener("resize", handler);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const handleSelect = (item: T) => {
    onSelect(getId(item));
    setQuery("");
    setOpen(false);
  };

  const handleOpen = () => {
    if (disabled) return;
    position();
    setOpen(true);
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  const handleBlur = () => {
    setTimeout(() => setOpen(false), 150);
  };

  return (
    <div className={cn("relative", className)}>
      <button
        ref={triggerRef}
        type="button"
        onClick={handleOpen}
        disabled={disabled}
        className={cn(
          "flex w-full items-center justify-between rounded-md border border-input bg-muted px-3 py-2 text-sm shadow-sm transition-colors",
          "hover:border-ring focus:outline-none focus:ring-2 focus:ring-ring",
          disabled && "opacity-50 cursor-not-allowed",
          open && "ring-2 ring-ring",
        )}
      >
        <span className={cn("truncate text-left", selected ? "text-foreground" : "text-muted-foreground")}>
          {selected ? getLabel(selected) : placeholder}
        </span>
        <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
      </button>

      {open && rect && createPortal(
        <div
          style={{ position: "fixed", left: rect.left, top: rect.top, width: rect.width, zIndex: 60 }}
          className="rounded-md border bg-popover shadow-md overflow-hidden"
        >
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onBlur={handleBlur}
              placeholder="Search…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>

          <ul className="max-h-60 overflow-y-auto py-1">
            {filtered.length === 0 && (
              <li className="px-3 py-2 text-sm text-muted-foreground">No results found</li>
            )}
            {filtered.map((item) => {
              const id        = getId(item);
              const label     = getLabel(item);
              const secondary = getSecondary?.(item);
              const active    = id === value;
              return (
                <li
                  key={String(id)}
                  onMouseDown={(e) => { e.preventDefault(); handleSelect(item); }}
                  className={cn(
                    "flex flex-col px-3 py-2 cursor-pointer select-none transition-colors",
                    active ? "bg-primary/10 text-primary" : "hover:bg-muted",
                  )}
                >
                  <span className="text-sm font-medium leading-tight">{label}</span>
                  {secondary && (
                    <span className="text-xs text-muted-foreground leading-tight">{secondary}</span>
                  )}
                </li>
              );
            })}
          </ul>

          {onAddNew && (
            <div className="border-t">
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setOpen(false);
                  onAddNew();
                }}
                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-primary hover:bg-primary/5 transition-colors"
              >
                <Plus className="h-3.5 w-3.5" /> {addNewLabel}
              </button>
            </div>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
