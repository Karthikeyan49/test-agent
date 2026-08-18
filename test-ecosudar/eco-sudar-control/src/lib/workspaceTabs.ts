export interface WorkspaceTab {
  url: string;
  title: string;
  pinned?: boolean;
  visitedAt?: number;
}

export const MAX_TABS = 4;
export const TABS_STORAGE_KEY = "eco_workspace_tabs";

function pinnedFirst(tabs: WorkspaceTab[]): WorkspaceTab[] {
  return [...tabs.filter((t) => t.pinned), ...tabs.filter((t) => !t.pinned)];
}

function evict(tabs: WorkspaceTab[], keepUrl?: string): WorkspaceTab[] {
  let next = tabs;
  for (;;) {
    const loose = next.filter((t) => !t.pinned);
    if (loose.length <= MAX_TABS) return next;
    const droppable = loose.filter((t) => t.url !== keepUrl);
    if (droppable.length === 0) return next;
    const oldest = droppable.reduce((a, b) => ((a.visitedAt ?? 0) <= (b.visitedAt ?? 0) ? a : b));
    next = next.filter((t) => t.url !== oldest.url);
  }
}

export function openTab(tabs: WorkspaceTab[], tab: WorkspaceTab, now: number = Date.now()): WorkspaceTab[] {
  const known = tabs.some((t) => t.url === tab.url);
  const next = known
    ? tabs.map((t) => (t.url === tab.url ? { ...t, title: tab.title, visitedAt: now } : t))
    : [...tabs, { ...tab, visitedAt: now }];
  return evict(next, tab.url);
}

export function closeTab(tabs: WorkspaceTab[], url: string): WorkspaceTab[] {
  return tabs.filter((t) => t.url !== url);
}

export function shouldShowTabs(tabs: WorkspaceTab[]): boolean {
  return tabs.length > 1 || tabs.some((t) => t.pinned);
}

export function setPinned(
  tabs: WorkspaceTab[],
  url: string,
  pinned: boolean,
  keepUrl?: string,
): WorkspaceTab[] {
  const marked = tabs.map((t) => (t.url === url ? { ...t, pinned } : t));
  return evict(pinnedFirst(marked), keepUrl);
}

export function clearOthers(tabs: WorkspaceTab[], keepUrl: string): WorkspaceTab[] {
  return tabs.filter((t) => t.url === keepUrl || t.pinned);
}

export function neighbourOf(tabs: WorkspaceTab[], url: string): string | null {
  const i = tabs.findIndex((t) => t.url === url);
  if (i === -1) return null;
  const right = tabs[i + 1];
  if (right) return right.url;
  const left = tabs[i - 1];
  return left ? left.url : null;
}

export function readStoredTabs(raw: string | null): WorkspaceTab[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const tabs = parsed
      .filter(
        (t): t is WorkspaceTab =>
          !!t &&
          typeof (t as WorkspaceTab).url === "string" &&
          typeof (t as WorkspaceTab).title === "string",
      )
      .map((t) => ({
        url: t.url,
        title: t.title,
        pinned: t.pinned === true,
        visitedAt: typeof t.visitedAt === "number" ? t.visitedAt : 0,
      }));
    return evict(pinnedFirst(tabs));
  } catch {
    return [];
  }
}
