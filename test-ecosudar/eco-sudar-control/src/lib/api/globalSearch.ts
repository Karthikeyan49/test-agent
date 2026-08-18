import { apiFetch } from "./client";

export interface SearchHit {
  id: number;
  title: string;
  subtitle: string;
  meta: string;
  url: string;
}

export interface SearchGroup {
  label: string;
  type: string;
  items: SearchHit[];
}

export const MIN_QUERY = 2;

export async function globalSearch(q: string, signal?: AbortSignal): Promise<SearchGroup[]> {
  const res = await apiFetch<{ data: { groups: SearchGroup[] } }>(
    `/admin/search?q=${encodeURIComponent(q)}`,
    { signal } as RequestInit,
  );
  return res.data?.groups ?? [];
}
