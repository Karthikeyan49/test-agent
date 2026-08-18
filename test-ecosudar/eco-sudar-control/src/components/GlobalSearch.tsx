import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2, Search } from "lucide-react";
import {
  CommandDialog, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";
import { sections } from "@/lib/navigation";
import { globalSearch, MIN_QUERY, type SearchGroup } from "@/lib/api/globalSearch";
import { useConfirmLeave } from "@/components/UnsavedChangesGuard";

export function GlobalSearch({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [groups, setGroups] = useState<SearchGroup[]>([]);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();
  const confirmLeave = useConfirmLeave();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (q.length < MIN_QUERY) {
      setGroups([]);
      setLoading(false);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    const t = setTimeout(() => {
      globalSearch(q, controller.signal)
        .then(setGroups)
        .catch(() => {})
        .finally(() => setLoading(false));
    }, 220);
    return () => { clearTimeout(t); controller.abort(); };
  }, [query]);

  useEffect(() => {
    if (!open) { setQuery(""); setGroups([]); }
  }, [open]);

  const go = async (url: string) => {
    if (!(await confirmLeave())) return;
    setOpen(false);
    navigate(url);
  };

  const typed = query.trim();
  const tooShort = typed.length > 0 && typed.length < MIN_QUERY;

  return (
    <>
      {compact ? (
        <button
          onClick={() => setOpen(true)}
          title="Search everything (Ctrl+K)"
          aria-label="Search everything"
          className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Search className="h-5 w-5" />
        </button>
      ) : (
        <button
          onClick={() => setOpen(true)}
          title="Search everything (Ctrl+K)"
          aria-label="Search everything"
          className="flex w-full items-center gap-2 rounded-lg border border-input bg-background/70 px-3 py-2 text-sm text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <Search className="h-4 w-4 shrink-0" />
          <span className="flex-1 truncate text-left">Search customers, orders, invoices, stock…</span>
          <kbd className="hidden md:inline shrink-0 rounded border bg-muted px-1.5 py-0.5 text-[10px] font-medium">
            Ctrl K
          </kbd>
        </button>
      )}

      <CommandDialog open={open} onOpenChange={setOpen}>
        <CommandInput
          placeholder="Search customers, orders, invoices, stock, payments…"
          value={query}
          onValueChange={setQuery}
        />
        <CommandList>
          {loading && (
            <div className="flex items-center gap-2 px-4 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          )}

          {!loading && (
            <CommandEmpty>
              {tooShort ? `Type at least ${MIN_QUERY} characters.` : "Nothing matches that."}
            </CommandEmpty>
          )}

          {groups.map((group) => (
            <CommandGroup key={group.type} heading={group.label}>
              {group.items.map((hit) => (
                <CommandItem
                  key={`${group.type}-${hit.id}`}
                  value={`${hit.title} ${hit.subtitle} ${typed}`}
                  onSelect={() => go(hit.url)}
                  className="gap-3"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-foreground">{hit.title}</p>
                    {hit.subtitle && (
                      <p className="truncate text-xs text-muted-foreground">{hit.subtitle}</p>
                    )}
                  </div>
                  {hit.meta && (
                    <span className="shrink-0 text-xs text-muted-foreground eco-nums">{hit.meta}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}

          {sections.map((section) => (
            <CommandGroup key={section.label} heading={`Go to · ${section.label}`}>
              {section.items.map((item) => {
                const Icon = item.icon;
                return (
                  <CommandItem
                    key={item.url}
                    value={`${section.label} ${item.title}`}
                    onSelect={() => go(item.url)}
                  >
                    <Icon className="mr-2 h-4 w-4 shrink-0" />
                    <span>{item.title}</span>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          ))}
        </CommandList>
      </CommandDialog>
    </>
  );
}
