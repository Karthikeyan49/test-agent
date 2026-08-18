/**
 * FAQ API
 * GET    /admin/faqs
 * POST   /admin/faqs
 * PUT    /admin/faqs/reorder
 * PUT    /admin/faqs/{id}
 * DELETE /admin/faqs/{id}
 */
import { apiFetch } from "./client";

export interface FAQ {
  id: number;
  question: string;
  answer: string;
  active: boolean;
  sortOrder: number;
}

interface ApiFaqRow {
  faq_id: number;
  question: string;
  answer: string;
  active: boolean;
  sort_order: number;
  created_at: string;
}

interface Envelope<T> { success: boolean; data: T }

function rowToFaq(row: ApiFaqRow): FAQ {
  return {
    id:        row.faq_id,
    question:  row.question,
    answer:    row.answer,
    active:    Boolean(row.active),
    sortOrder: row.sort_order,
  };
}

export const faqApi = {
  async list(): Promise<FAQ[]> {
    const res = await apiFetch<Envelope<ApiFaqRow[]>>("/admin/faqs");
    return (res.data ?? []).map(rowToFaq);
  },

  async create(data: { question: string; answer: string }): Promise<FAQ> {
    const res = await apiFetch<Envelope<ApiFaqRow>>("/admin/faqs", {
      method: "POST",
      body: JSON.stringify(data),
    });
    return rowToFaq(res.data);
  },

  async update(id: number, patch: Partial<{ question: string; answer: string; active: boolean; sort_order: number }>): Promise<void> {
    await apiFetch<Envelope<unknown>>(`/admin/faqs/${id}`, {
      method: "PUT",
      body: JSON.stringify(patch),
    });
  },

  async reorder(ids: number[]): Promise<void> {
    await apiFetch<Envelope<unknown>>("/admin/faqs/reorder", {
      method: "PUT",
      body: JSON.stringify({ ids }),
    });
  },

  async remove(id: number): Promise<void> {
    await apiFetch<void>(`/admin/faqs/${id}`, { method: "DELETE" });
  },
};
