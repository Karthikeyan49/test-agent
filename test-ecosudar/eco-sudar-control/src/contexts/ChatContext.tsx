import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from "react";

/**
 * Per-page contextual data for the floating chatbot. Pages call
 * `useRegisterChatContext({ page, summary, data })` to share what they're
 * currently showing so the chatbot can answer questions grounded in it.
 *
 * Keep `data` small — this is sent to the AI on every request once the
 * Lovable Cloud / chat-assistant edge function is wired up.
 */
export interface ChatPageContext {
  page: string;
  summary?: string;
  data?: unknown;
}

interface ChatContextShape {
  current: ChatPageContext | null;
  set: (ctx: ChatPageContext | null) => void;
}

const ChatCtx = createContext<ChatContextShape | null>(null);

export function ChatContextProvider({ children }: { children: ReactNode }) {
  const [current, setCurrent] = useState<ChatPageContext | null>(null);
  const value = useMemo<ChatContextShape>(
    () => ({ current, set: setCurrent }),
    [current],
  );
  return <ChatCtx.Provider value={value}>{children}</ChatCtx.Provider>;
}

export function useChatContext() {
  const ctx = useContext(ChatCtx);
  if (!ctx) throw new Error("useChatContext must be used inside <ChatContextProvider>");
  return ctx;
}

/** Pages call this in an effect to register their context (auto-clears on unmount). */
export function useRegisterChatContext() {
  const { set } = useChatContext();
  const ref = useRef(set);
  ref.current = set;
  return useCallback((ctx: ChatPageContext) => {
    ref.current(ctx);
    return () => ref.current(null);
  }, []);
}
