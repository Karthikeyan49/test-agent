import { apiFetch } from "./client";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  sources?: { id: number; title: string }[];
  created_at?: string;
}

export interface ChatResponse {
  session_id: string;
  reply: string;
}

export const chatApi = {
  async send(message: string, sessionId?: string): Promise<ChatResponse> {
    const res = await apiFetch<{ data: ChatResponse }>("/chat", {
      method: "POST",
      body: JSON.stringify({ message, session_id: sessionId ?? "" }),
    });
    return res.data;
  },

  async history(sessionId: string): Promise<ChatMessage[]> {
    const res = await apiFetch<{ data: ChatMessage[] }>(
      `/chat/history?session_id=${encodeURIComponent(sessionId)}`
    );
    return res.data ?? [];
  },
};
