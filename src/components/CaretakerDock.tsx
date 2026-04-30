import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { Sparkles, Send, X, Loader2, ExternalLink, CheckCircle2, XCircle } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { streamCaretaker } from "@/lib/caretakerStream";

type Msg = {
  id: string;
  role: string;
  content: string | null;
  tool_calls?: any;
  pending_approval?: boolean;
  created_at: string;
};
type Pending = { id: string; name: string; args: any };

const HIDE_ON = new Set(["/auth", "/caretaker"]);

export default function CaretakerDock() {
  const { user } = useAuth();
  const loc = useLocation();
  const [open, setOpen] = useState(false);
  const [unread, setUnread] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const hidden = !user || HIDE_ON.has(loc.pathname);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("caretaker_messages")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    const arr = ((data as any) || []).reverse();
    setMessages(arr);
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase
      .channel("dock-caretaker")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "caretaker_messages", filter: `user_id=eq.${user.id}` },
        (payload) => {
          const m = payload.new as any;
          setMessages((prev) => [...prev.slice(-19), m]);
          if (!open && m.role === "assistant") setUnread(true);
          setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, open]);

  useEffect(() => {
    if (open) setUnread(false);
  }, [open]);

  const send = async () => {
    if (!input.trim() || !user) return;
    const text = input.trim();
    setInput("");
    setBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/caretaker-chat`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ message: text }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "chat failed");
      setPending(j.pending || []);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Failed");
    }
    setBusy(false);
  };

  const respond = async (p: Pending, approved: boolean) => {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/caretaker-execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ tool_call_id: p.id, tool_name: p.name, args: p.args, approved }),
    });
    const j = await r.json();
    if (!r.ok) toast.error(j.error || "Failed");
    else toast.success(approved ? "Done" : "Rejected");
    setPending((prev) => prev.filter((x) => x.id !== p.id));
    await load();
  };

  if (hidden) return null;

  return (
    <>
      {/* Floating launcher */}
      <button
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "fixed bottom-6 right-6 z-50 w-14 h-14 rounded-full bg-gradient-primary shadow-glow",
          "flex items-center justify-center hover:scale-105 transition-transform",
          open && "rotate-90",
        )}
        aria-label="Open Caretaker"
      >
        {open ? (
          <X className="w-6 h-6 text-primary-foreground" />
        ) : (
          <Sparkles className="w-6 h-6 text-primary-foreground" />
        )}
        {unread && !open && (
          <span className="absolute top-1 right-1 w-3 h-3 rounded-full bg-bull border-2 border-background" />
        )}
      </button>

      {/* Side panel */}
      {open && (
        <div className="fixed bottom-24 right-6 z-50 w-[380px] max-w-[calc(100vw-3rem)] h-[560px] max-h-[calc(100vh-8rem)] flex flex-col rounded-xl border border-border bg-card shadow-2xl animate-in slide-in-from-bottom-4 fade-in">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-primary" />
              <span className="font-medium text-sm">Caretaker</span>
            </div>
            <Link
              to="/caretaker"
              onClick={() => setOpen(false)}
              className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1"
            >
              Open full <ExternalLink className="w-3 h-3" />
            </Link>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto p-3 space-y-3">
            {messages.length === 0 && (
              <div className="text-xs text-muted-foreground text-center py-8 px-4">
                Ask anything — "What's my P&amp;L?", "Suggest a trade", "Set a 10% goal for this month".
              </div>
            )}
            {messages
              .filter((m) => m.role !== "tool" && (m.content || m.tool_calls))
              .map((m) => (
                <div
                  key={m.id}
                  className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[85%] rounded-lg px-3 py-2 text-xs ${
                      m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary"
                    }`}
                  >
                    {m.content && (
                      <div className="prose prose-xs prose-invert max-w-none [&>*]:my-1">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    )}
                    {m.tool_calls && Array.isArray(m.tool_calls) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {m.tool_calls.map((tc: any) => (
                          <Badge key={tc.id} variant="outline" className="text-[9px] px-1 py-0">
                            {tc.function?.name}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            {pending.map((p) => (
              <Card key={p.id} className="p-3 border-accent/40 bg-accent/5">
                <div className="text-xs font-medium mb-1.5">Approve: {p.name}</div>
                <pre className="text-[10px] bg-background/50 rounded p-1.5 overflow-auto mb-2 max-h-24">
                  {JSON.stringify(p.args, null, 2)}
                </pre>
                <div className="flex gap-1.5">
                  <Button size="sm" className="h-7 text-xs" onClick={() => respond(p, true)}>
                    <CheckCircle2 className="w-3 h-3 mr-1" /> Approve
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs"
                    onClick={() => respond(p, false)}
                  >
                    <XCircle className="w-3 h-3 mr-1" /> Reject
                  </Button>
                </div>
              </Card>
            ))}
            {busy && (
              <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> thinking…
              </div>
            )}
          </div>

          <div className="border-t border-border p-2 flex gap-1.5">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask…"
              onKeyDown={(e) => e.key === "Enter" && !busy && send()}
              disabled={busy}
              className="h-8 text-xs"
            />
            <Button size="sm" className="h-8 px-2" onClick={send} disabled={busy || !input.trim()}>
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
