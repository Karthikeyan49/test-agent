import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ChevronLeft, ChevronRight, Pin, PinOff, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { routeIcon, routeTitle } from "@/lib/navigation";
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
  clearOthers,
  closeTab as closeTabIn,
  neighbourOf,
  openTab,
  readStoredTabs,
  setPinned,
  shouldShowTabs,
  TABS_STORAGE_KEY,
  type WorkspaceTab,
} from "@/lib/workspaceTabs";

export function WorkspaceTabs() {
  const location = useLocation();
  const navigate = useNavigate();
  const [tabs, setTabs] = useState<WorkspaceTab[]>(() =>
    readStoredTabs(typeof window === "undefined" ? null : sessionStorage.getItem(TABS_STORAGE_KEY)),
  );
  const activeRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [overflowing, setOverflowing] = useState(false);

  const path = location.pathname;

  useEffect(() => {
    setTabs((prev) => openTab(prev, { url: path, title: routeTitle(path) }));
  }, [path]);

  useEffect(() => {
    try {
      sessionStorage.setItem(TABS_STORAGE_KEY, JSON.stringify(tabs));
    } catch {
      // A full or disabled sessionStorage must not break navigation.
    }
  }, [tabs]);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [path, tabs.length]);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const check = () => setOverflowing(el.scrollWidth > el.clientWidth + 2);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [tabs.length]);

  const jump = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    const kids = Array.from(el.children) as HTMLElement[];
    const step = kids.slice(0, 10).reduce((sum, k) => sum + k.offsetWidth, 0) || el.clientWidth;
    el.scrollBy({ left: direction * step, behavior: "smooth" });
  };

  const close = (url: string) => {
    const goTo = url === path ? neighbourOf(tabs, url) : null;
    setTabs((prev) => closeTabIn(prev, url));
    if (url === path) navigate(goTo ?? "/");
  };

  const togglePin = (tab: WorkspaceTab) =>
    setTabs((prev) => setPinned(prev, tab.url, !tab.pinned, path));

  if (!shouldShowTabs(tabs)) return null;

  return (
    <div className="flex h-11 items-stretch border-t border-border bg-muted/40">
      {overflowing && (
        <button
          type="button"
          onClick={() => jump(-1)}
          aria-label="Scroll tabs left"
          title="Earlier tabs"
          className="flex shrink-0 items-center border-r border-border/70 px-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
      )}

      <div ref={scrollerRef} className="flex flex-1 items-stretch overflow-x-auto eco-tabstrip pl-2 md:pl-4">
        {tabs.map((tab, i) => {
          const active = tab.url === path;
          const prevActive = i > 0 && tabs[i - 1].url === path;
          const Icon = routeIcon(tab.url);
          return (
            <ContextMenu key={tab.url}>
            <ContextMenuTrigger asChild>
            <div
              ref={active ? activeRef : undefined}
              className={cn(
                "group relative flex shrink-0 items-center text-xs transition-colors",
                active
                  ? "bg-card text-foreground font-semibold"
                  : "text-muted-foreground hover:bg-card/60 hover:text-foreground",
              )}
            >
              {i > 0 && !active && !prevActive && (
                <span aria-hidden className="absolute left-0 top-1/2 h-4 w-px -translate-y-1/2 bg-border" />
              )}
              {active && (
                <span aria-hidden className="absolute inset-x-0 bottom-0 h-0.5 bg-primary" />
              )}
              <button
                type="button"
                data-navigates=""
                onClick={() => navigate(tab.url)}
                className="flex items-center gap-1.5 py-2.5 pl-3 pr-1.5"
                title={tab.pinned ? `${tab.title} (pinned)` : `${tab.title}\nRight-click to pin`}
              >
                <Icon className={cn("h-3.5 w-3.5 shrink-0", active && "text-primary")} />
                <span className="block max-w-[10rem] truncate">{tab.title}</span>
                {tab.pinned && <Pin className="h-3 w-3 shrink-0 rotate-45 text-primary" aria-label="Pinned" />}
              </button>
              {!tab.pinned && (
                <button
                  type="button"
                  onClick={() => close(tab.url)}
                  aria-label={`Close ${tab.title}`}
                  title={`Close ${tab.title}`}
                  className={cn(
                    "mr-2 rounded p-0.5 transition-colors hover:bg-destructive/10 hover:text-destructive",
                    active ? "opacity-70" : "opacity-0 group-hover:opacity-70",
                  )}
                >
                  <X className="h-3 w-3" />
                </button>
              )}
              {tab.pinned && <span className="mr-2" />}
            </div>
            </ContextMenuTrigger>
            <ContextMenuContent className="w-56">
              <ContextMenuItem onSelect={() => togglePin(tab)} className="gap-2">
                {tab.pinned
                  ? <><PinOff className="h-4 w-4" /> Unpin this tab</>
                  : <><Pin className="h-4 w-4" /> Pin this tab</>}
              </ContextMenuItem>
              <ContextMenuSeparator />
              <ContextMenuItem onSelect={() => close(tab.url)} className="gap-2">
                <X className="h-4 w-4" /> Close
              </ContextMenuItem>
              <ContextMenuItem
                onSelect={() => {
                  setTabs((prev) => clearOthers(prev, tab.url));
                  if (tab.url !== path) navigate(tab.url);
                }}
                className="gap-2"
              >
                <X className="h-4 w-4" /> Close others
              </ContextMenuItem>
            </ContextMenuContent>
            </ContextMenu>
          );
        })}
      </div>

      {overflowing && (
        <button
          type="button"
          onClick={() => jump(1)}
          aria-label="Scroll tabs right"
          title="Later tabs"
          className="flex shrink-0 items-center border-l border-border/70 px-1.5 text-muted-foreground transition-colors hover:bg-card hover:text-foreground"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      )}

      <div className="flex shrink-0 items-center border-l border-border/70 pl-2 pr-2 md:pr-4">
        <button
          type="button"
          onClick={() => setTabs((prev) => clearOthers(prev, path))}
          title="Close every tab except the page you are on and anything pinned"
          className="rounded-md px-2 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
        >
          Clear all
        </button>
      </div>
    </div>
  );
}
