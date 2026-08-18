import { useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircle, Send, Sparkles, X, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useChatContext } from "@/contexts/ChatContext";
import { chatApi } from "@/lib/api/chat";
import { getCompanyProfile } from "@/lib/companyProfile";

interface Msg { role: "user" | "assistant"; content: string; }

const SESSION_KEY = "eco_chat_session";

function MarkdownMessage({ content }: { content: string }) {
  const lines = content.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  const inlineFormat = (text: string): React.ReactNode => {
    const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
    return parts.map((p, j) => {
      if (p.startsWith("**") && p.endsWith("**")) return <strong key={j}>{p.slice(2, -2)}</strong>;
      if (p.startsWith("*")  && p.endsWith("*"))  return <em key={j}>{p.slice(1, -1)}</em>;
      if (p.startsWith("`")  && p.endsWith("`"))
        return <code key={j} className="bg-muted-foreground/20 rounded px-1 text-xs font-mono">{p.slice(1, -1)}</code>;
      return p;
    });
  };

  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().startsWith("|")) {
      const tableLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("|")) { tableLines.push(lines[i]); i++; }
      const rows = tableLines
        .filter((l) => !/^\s*\|[\s\-|:]+\|\s*$/.test(l))
        .map((l) => l.split("|").filter((_, idx, arr) => idx > 0 && idx < arr.length - 1).map((c) => c.trim()));
      if (rows.length > 0)
        elements.push(<div key={i} className="overflow-x-auto my-1"><table className="text-xs w-full border-collapse"><thead><tr>{rows[0].map((c, j) => <th key={j} className="border border-muted-foreground/30 px-2 py-1 text-left font-semibold bg-muted/50">{inlineFormat(c)}</th>)}</tr></thead><tbody>{rows.slice(1).map((row, ri) => <tr key={ri}>{row.map((c, j) => <td key={j} className="border border-muted-foreground/30 px-2 py-1">{inlineFormat(c)}</td>)}</tr>)}</tbody></table></div>);
      continue;
    }
    if (line.startsWith("### ")) { elements.push(<p key={i} className="font-semibold text-sm mt-2">{inlineFormat(line.slice(4))}</p>); i++; continue; }
    if (line.startsWith("## "))  { elements.push(<p key={i} className="font-bold text-sm mt-2">{inlineFormat(line.slice(3))}</p>); i++; continue; }
    if (line.startsWith("# "))   { elements.push(<p key={i} className="font-bold text-sm mt-2">{inlineFormat(line.slice(2))}</p>); i++; continue; }
    if (/^[-•*] /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-•*] /.test(lines[i])) { items.push(lines[i].slice(2)); i++; }
      elements.push(<ul key={i} className="list-disc list-inside space-y-0.5 my-1">{items.map((it, j) => <li key={j} className="text-sm">{inlineFormat(it)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\. /.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\. /.test(lines[i])) { items.push(lines[i].replace(/^\d+\. /, "")); i++; }
      elements.push(<ol key={i} className="list-decimal list-inside space-y-0.5 my-1">{items.map((it, j) => <li key={j} className="text-sm">{inlineFormat(it)}</li>)}</ol>);
      continue;
    }
    if (/^---+$/.test(line.trim())) { elements.push(<hr key={i} className="border-muted-foreground/20 my-2" />); i++; continue; }
    if (line.trim() === "")         { elements.push(<div key={i} className="h-1" />); i++; continue; }
    elements.push(<p key={i} className="text-sm">{inlineFormat(line)}</p>);
    i++;
  }
  return <div className="space-y-0.5">{elements}</div>;
}

const GREETING: Msg = {
  role: "assistant",
  content: "Hi! I'm your ERP Assistant.\n\nI can help you with:\n• How to use any feature in this system\n• Finding records, reports, summaries\n• Step-by-step guidance on any workflow",
};
const GUIDE_GREETING: Msg = { role: "assistant", content: "**Guide mode** — Ask me how to use any feature.\n\nExamples:\n• How to add a customer\n• How to record a payment\n• How to generate a quotation" };
const DATA_GREETING:  Msg = { role: "assistant", content: "**Data mode** — Ask me about your live ERP data.\n\nExamples:\n• Show today's pending orders\n• How many invoices are overdue\n• What's the total revenue this month" };

export function ChatWidget() {
  const [open,      setOpen]      = useState(false);
  const [input,     setInput]     = useState("");
  const [busy,      setBusy]      = useState(false);
  const [mode,      setMode]      = useState<"guide" | "data">("guide");
  const [messages,  setMessages]  = useState<Msg[]>([GREETING]);
  const [sessionId, setSessionId] = useState<string>(
    () => localStorage.getItem(SESSION_KEY) ?? "",
  );
  const { current } = useChatContext();
  const scrollRef   = useRef<HTMLDivElement>(null);

  const switchMode = (newMode: "guide" | "data") => {
    setMode(newMode);
    setMessages([newMode === "guide" ? GUIDE_GREETING : DATA_GREETING]);
  };

  useEffect(() => {
    if (!open || messages.length > 1) return;
    const sid = localStorage.getItem(SESSION_KEY);
    if (!sid) return;
    chatApi.history(sid).then((history) => {
      if (history.length > 0) setMessages([GREETING, ...history]);
    }).catch(() => {});
  }, [open]); // eslint-disable-line

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, open]);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    const text = input.trim();
    if (!text || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: text }]);
    setBusy(true);
    try {
      const messageToSend = mode === "guide" ? `[GUIDE] ${text}` : text;
      const res = await chatApi.send(messageToSend, sessionId || undefined);
      if (res.session_id && res.session_id !== sessionId) {
        setSessionId(res.session_id);
        localStorage.setItem(SESSION_KEY, res.session_id);
      }
      setMessages((m) => [...m, { role: "assistant", content: res.reply }]);
    } catch {
      setMessages((m) => [...m, { role: "assistant", content: "Sorry, I couldn't reach the server. Please try again." }]);
    } finally {
      setBusy(false);
    }
  };

  const companyName = getCompanyProfile().name;

  return (
    <>
      {/* Launcher — fixed bottom-right */}
      <button
        aria-label={open ? "Close assistant" : "Open assistant"}
        onClick={() => setOpen((o) => !o)}
        style={{ position: "fixed", bottom: "1rem", right: "1rem", zIndex: 9999 }}
        className="h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg hover:shadow-xl hover:scale-105 transition-all flex items-center justify-center"
      >
        <MessageCircle className="h-6 w-6 pointer-events-none" />
      </button>

      {/* Panel — opens upward from the button */}
      {open && (
        <div
          className="bg-card border rounded-2xl shadow-2xl flex flex-col overflow-hidden"
          style={{
            position:  "fixed",
            bottom:    "5rem",
            right:     "1rem",
            width:     "min(400px, calc(100vw - 2rem))",
            height:    "min(600px, calc(100vh - 6rem))",
            maxHeight: "80vh",
            zIndex:    9998,
          }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 py-3 border-b bg-primary text-primary-foreground select-none shrink-0">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5" />
              <div>
                <p className="font-semibold text-sm leading-tight">Ask {companyName}</p>
                <p className="text-[11px] text-primary-foreground/80 leading-tight">
                  {current?.page ? `Context: ${current.page}` : mode === "guide" ? "How-To Guide" : "Live Data Assistant"}
                </p>
              </div>
            </div>
            <Button size="icon" variant="ghost" className="h-8 w-8 text-primary-foreground hover:bg-white/10" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          {/* Mode toggle */}
          <div className="flex border-b shrink-0">
            <button type="button" onClick={() => switchMode("guide")}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${mode === "guide" ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>
              How-To Guide
            </button>
            <button type="button" onClick={() => switchMode("data")}
              className={`flex-1 py-2 text-xs font-medium transition-colors ${mode === "data" ? "bg-primary/10 text-primary border-b-2 border-primary" : "text-muted-foreground hover:text-foreground"}`}>
              Live Data
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
            {messages.map((m, idx) => (
              <div key={idx} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[85%] rounded-2xl px-3 py-2 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground rounded-br-sm whitespace-pre-wrap" : "bg-muted text-foreground rounded-bl-sm"}`}>
                  {m.role === "user" ? m.content : <MarkdownMessage content={m.content} />}
                </div>
              </div>
            ))}
            {busy && (
              <div className="flex justify-start">
                <div className="bg-muted rounded-2xl rounded-bl-sm px-3 py-2 text-sm text-muted-foreground flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" /> Thinking…
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <form onSubmit={send} className="border-t p-3 flex gap-2 shrink-0">
            <Input value={input} onChange={(e) => setInput(e.target.value)}
              placeholder={mode === "guide" ? "Ask how to do anything…" : "Ask about your data…"}
              disabled={busy} />
            <Button type="submit" size="icon" disabled={busy || !input.trim()}>
              <Send className="h-4 w-4" />
            </Button>
          </form>
        </div>
      )}
    </>
  );
}
