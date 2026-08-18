/**
 * Central API client.
 *   BASE_URL  — sourced from VITE_API_BASE_URL in .env (e.g. https://api.ecosudar.com/api)
 *   MOCK_MODE — set to false when backend is deployed & .env points to real API
 * Auth token (set by Login) is read from localStorage and attached as Bearer.
 */
export const MOCK_MODE = import.meta.env.VITE_USE_MOCK_API === "true";
export const BASE_URL = import.meta.env.VITE_API_BASE_URL;

if (!BASE_URL && !MOCK_MODE) {
  console.warn("WARNING: VITE_API_BASE_URL is missing in the .env file!");
}

export function getAuthToken(): string | null {
  try {
    const raw = localStorage.getItem("eco_admin_auth");
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data.token ?? null;
  } catch {
    return null;
  }
}

/**
 * Lightweight GET response cache (stale-while-navigating).
 * Why: most pages fetch on mount via apiFetch; without this, navigating away and
 * back re-hits the (slow, shared-hosting) API every time. This caches GET responses
 * briefly and dedupes in-flight requests, so revisiting a page is instant.
 * Correctness: any non-GET request (create/update/delete) clears the whole cache,
 * so a write is always followed by fresh reads. Auth changes clear it too.
 */
const GET_TTL_MS = 60_000;
type CacheEntry = { ts: number; promise: Promise<unknown> };
const getCache = new Map<string, CacheEntry>();

/** Manually clear the GET cache (e.g. on login or a hard refresh action). */
export function clearApiCache(): void {
  getCache.clear();
}

if (typeof window !== "undefined") {
  // Never serve one user's cached data to another / after session end.
  window.addEventListener("eco:auth-expired", clearApiCache);
}

/** Extra apiFetch options beyond the standard fetch RequestInit. */
type ApiInit = RequestInit & { skipCache?: boolean };

export async function apiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  const method = (init.method ?? "GET").toUpperCase();
  const cacheable = method === "GET" && init.skipCache !== true && !MOCK_MODE;

  if (cacheable) {
    const hit = getCache.get(path);
    if (hit && Date.now() - hit.ts < GET_TTL_MS) {
      return hit.promise as Promise<T>;
    }
  }

  const run = async (): Promise<T> => {
    const token = getAuthToken();
    const isFormData = typeof FormData !== "undefined" && init.body instanceof FormData;
    const headers: Record<string, string> = {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      "X-Client-Type": "web",
      ...(init.headers as Record<string, string> | undefined),
    };
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });
    if (!res.ok) {
      if (res.status === 401 && typeof window !== "undefined") {
        window.dispatchEvent(new Event("eco:auth-expired"));
      }

      const text = await res.text().catch(() => res.statusText);
      // Try to parse JSON error response
      try {
        const errorJson = JSON.parse(text);
        // If it's our standard error format, extract just the message
        if (errorJson.message) {
          throw new Error(errorJson.message);
        }
        // If parsing succeeded but no message field, throw the full response
        throw new Error(`API ${res.status}: ${text}`);
      } catch (parseError) {
        // If it's already an Error we threw, re-throw it
        if (parseError instanceof Error && !parseError.message.startsWith('API')) {
          throw parseError;
        }
        // If JSON parsing failed, use the original text
        throw new Error(`API ${res.status}: ${text}`);
      }
    }

    const json = await res.json();
    // Auto-unwrap standard { success, data } envelope returned by PHP backend
    return json as T;
  };

  if (cacheable) {
    const promise = run();
    getCache.set(path, { ts: Date.now(), promise });
    // Don't cache failures — drop the entry so the next call retries.
    promise.catch(() => {
      const cur = getCache.get(path);
      if (cur && cur.promise === promise) getCache.delete(path);
    });
    return promise;
  }

  const result = await run();
  // A successful write makes cached reads stale → clear so next reads are fresh.
  if (method !== "GET") clearApiCache();
  return result;
}

/** Simulate network latency for mock data */
export const mockDelay = (ms = 300) => new Promise((r) => setTimeout(r, ms));
