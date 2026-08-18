import { useSyncExternalStore } from "react";

/**
 * How many rows a list shows at once.
 *
 * One setting for the whole app, not one per page: picking 50 on Invoices and
 * finding Customers still on 25 is the kind of inconsistency you have to keep
 * re-noticing. Changing it anywhere changes it everywhere, immediately —
 * every mounted list reads the same store rather than its own copy.
 *
 * Remembered in localStorage, so it survives a reload. A bad or missing value
 * falls back to the default rather than throwing, because a corrupt preference
 * must never be able to stop a page rendering.
 */
export const PAGE_SIZES = [25, 50, 75, 100] as const;
export type PageSize = (typeof PAGE_SIZES)[number];

export const DEFAULT_PAGE_SIZE: PageSize = 25;
const STORAGE_KEY = "eco_rows_per_page";

function readStored(): PageSize {
  if (typeof window === "undefined") return DEFAULT_PAGE_SIZE;
  try {
    const n = Number(window.localStorage.getItem(STORAGE_KEY));
    return (PAGE_SIZES as readonly number[]).includes(n) ? (n as PageSize) : DEFAULT_PAGE_SIZE;
  } catch {
    return DEFAULT_PAGE_SIZE;
  }
}

let current: PageSize = readStored();
const listeners = new Set<() => void>();

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

const getSnapshot = (): PageSize => current;
const getServerSnapshot = (): PageSize => DEFAULT_PAGE_SIZE;

export function setPageSize(size: PageSize): void {
  if (size === current) return;
  current = size;
  try {
    window.localStorage.setItem(STORAGE_KEY, String(size));
  } catch {
    // The setting still applies for this session; it just will not persist.
  }
  listeners.forEach((fn) => fn());
}

/** The current rows-per-page, re-rendering every list when it changes. */
export function usePageSize(): PageSize {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
}

/**
 * Which slice of `rows` belongs on `page`, and how many pages there are.
 *
 * `page` is clamped rather than trusted. Filtering a list down while sitting on
 * page 6 would otherwise show an empty table with no indication why — the rows
 * exist, you are just past the end of them.
 */
export function pageSlice<T>(rows: T[], page: number, size: number) {
  const total = rows.length;
  const totalPages = Math.max(1, Math.ceil(total / size));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * size;
  const end = Math.min(start + size, total);
  return {
    rows: rows.slice(start, end),
    page: safePage,
    totalPages,
    total,
    /** 1-based, inclusive, for "Showing 26–50 of 214". Zero when empty. */
    from: total === 0 ? 0 : start + 1,
    to: end,
  };
}

/**
 * The page numbers to render, with gaps collapsed.
 *
 * 214 rows at 25 a page is nine buttons, which fits. Two thousand rows is
 * eighty, which does not — so the middle collapses to an ellipsis and the
 * first, last and neighbours of the current page stay reachable.
 */
export function pageNumbers(page: number, totalPages: number): (number | "gap")[] {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, i) => i + 1);

  const out: (number | "gap")[] = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(totalPages - 1, page + 1);
  if (from > 2) out.push("gap");
  for (let i = from; i <= to; i++) out.push(i);
  if (to < totalPages - 1) out.push("gap");
  out.push(totalPages);
  return out;
}
