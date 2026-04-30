import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Sparkles, Send, CheckCircle2, XCircle, Loader2 } from "lucide-react";

type Msg = { id: string; role: string; content: string | null; tool_calls?: any; result?: any; pending_approval?: boolean; approved?: boolean | null; tool_call_id?: string | null };
type Pending = { id: string; name: string; args: any };

export default function Caretaker() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("caretaker_messages")
      .select("*").eq("user_id", user.id).order("created_at", { ascending: true }).limit(60);
    setMessages((data as any) || []);
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);
  };

  useEffect(() => { load(); }, [user]);

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
    else toast.success(approved ? "Action executed" : "Rejected");
    setPending((prev) => prev.filter((x) => x.id !== p.id));
    await load();
  };

  return (
    <div className="container py-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-lg bg-gradient-primary shadow-glow flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-primary-foreground" />
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Caretaker</h1>
          <p className="text-xs text-muted-foreground">Your AI co-pilot. Plans, suggests, trades on your approval.</p>
        </div>
      </div>

      <Card className="p-0 flex flex-col h-[70vh]">
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
          {messages.length === 0 && (
            <div className="text-sm text-muted-foreground text-center py-12">
              Say hi — try "What's my portfolio looking like?" or "Suggest a trade on the most active market."
            </div>
          )}
          {messages.filter((m) => m.role !== "tool" && (m.content || m.tool_calls)).map((m) => (
            <div key={m.id} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm ${
                m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary"
              }`}>
                {m.content && <div className="prose prose-sm prose-invert max-w-none">
                  <ReactMarkdown>{m.content}</ReactMarkdown>
                </div>}
                {m.tool_calls && Array.isArray(m.tool_calls) && (
                  <div className="mt-2 space-y-1">
                    {m.tool_calls.map((tc: any) => (
                      <Badge key={tc.id} variant="outline" className="text-[10px]">
                        called {tc.function?.name}
                      </Badge>
                    ))}
                  </div>
                )}
              </div>
            </div>
          ))}
          {pending.map((p) => (
            <Card key={p.id} className="p-4 border-accent/40 bg-accent/5">
              <div className="flex items-center gap-2 mb-2">
                <Sparkles className="w-4 h-4 text-accent" />
                <span className="font-medium text-sm">Action requested: {p.name}</span>
              </div>
              <pre className="text-xs bg-background/50 rounded p-2 overflow-auto mb-3">{JSON.stringify(p.args, null, 2)}</pre>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => respond(p, true)}>
                  <CheckCircle2 className="w-4 h-4 mr-1" /> Approve
                </Button>
                <Button size="sm" variant="outline" onClick={() => respond(p, false)}>
                  <XCircle className="w-4 h-4 mr-1" /> Reject
                </Button>
              </div>
            </Card>
          ))}
          {busy && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> thinking…</div>}
        </div>
        <div className="border-t border-border p-3 flex gap-2">
          <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything…"
            onKeyDown={(e) => e.key === "Enter" && !busy && send()} disabled={busy} />
          <Button onClick={send} disabled={busy || !input.trim()}><Send className="w-4 h-4" /></Button>
        </div>
      </Card>
    </div>
  );
}
