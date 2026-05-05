import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import ReactMarkdown from "react-markdown";
import { toast } from "sonner";
import { Sparkles, Send, CheckCircle2, XCircle, Loader2, RefreshCw, ClipboardList, PlayCircle, Clock } from "lucide-react";
import { streamCaretaker } from "@/lib/caretakerStream";
import CaretakerModeSlider, { type CaretakerMode } from "@/components/CaretakerModeSlider";
import EventBriefingCard, { type CaretakerEvent } from "@/components/EventBriefingCard";
import CaretakerPersonality from "@/components/CaretakerPersonality";
import TradePlanCard, { type TradePlan } from "@/components/TradePlanCard";

type Msg = { id: string; role: string; content: string | null; tool_calls?: any; result?: any; pending_approval?: boolean; approved?: boolean | null; tool_call_id?: string | null; streaming?: boolean };
type Pending = { id: string; name: string; args: any; guardrail_warning?: string };
type ToolStatus = { id: string; name: string; status: "running" | "done" };
type AgentPlan = { id: string; title: string; objective?: string; status: string; mode: string; current_step: number; created_at: string };

export default function Caretaker() {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [toolStatuses, setToolStatuses] = useState<ToolStatus[]>([]);
  const [inlinePlans, setInlinePlans] = useState<Record<string, TradePlan>>({});
  const [agentPlans, setAgentPlans] = useState<AgentPlan[]>([]);
  const [plansLoading, setPlansLoading] = useState(false);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<CaretakerMode>("suggest");
  const [skill, setSkill] = useState<"beginner" | "intermediate" | "advanced">("beginner");
  const [events, setEvents] = useState<CaretakerEvent[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const scrollDown = () =>
    setTimeout(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }), 50);

  const loadProfile = async () => {
    if (!user) return;
    const { data } = await supabase.from("profiles").select("skill_level,caretaker_mode").eq("id", user.id).maybeSingle();
    if (data) {
      setMode(((data as any).caretaker_mode || "suggest") as CaretakerMode);
      setSkill(((data as any).skill_level || "beginner") as any);
    }
  };

  const load = async () => {
    if (!user) return;
    const [{ data: msgs }, { data: evts }] = await Promise.all([
      supabase.from("caretaker_messages").select("*").eq("user_id", user.id).order("created_at", { ascending: true }).limit(60),
      supabase.from("caretaker_events").select("*").eq("user_id", user.id).order("created_at", { ascending: false }).limit(30),
    ]);
    // Extract inline trade plans from create_trade_plan tool results
    const plans: Record<string, TradePlan> = {};
    for (const m of (msgs as any[]) || []) {
      if (m.role === "tool" && m.result?.ok && m.result?.plan) {
        plans[m.tool_call_id || m.id] = m.result.plan as TradePlan;
      }
    }
    setInlinePlans(plans);
    setMessages((msgs as any) || []);
    setEvents((evts as any) || []);
    scrollDown();
  };

  const loadAgentPlans = async () => {
    if (!user) return;
    setPlansLoading(true);
    const { data } = await supabase
      .from("agent_plans")
      .select("id,title,objective,status,mode,current_step,created_at")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(50);
    setAgentPlans((data as AgentPlan[]) || []);
    setPlansLoading(false);
  };

  useEffect(() => { loadProfile(); load(); }, [user]);
  useEffect(() => {
    document.title = "Caretaker · Driftworks";
  }, []);
  useEffect(() => () => abortRef.current?.abort(), []);

  // Realtime: new briefings
  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`caretaker-events-${user.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "caretaker_events", filter: `user_id=eq.${user.id}` }, (payload) => {
        setEvents((prev) => [payload.new as any, ...prev].slice(0, 30));
      })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [user]);

  const generateBriefings = async () => {
    setRefreshing(true);
    const { data, error } = await supabase.functions.invoke("caretaker-events", { body: {} });
    setRefreshing(false);
    if (error) { toast.error(error.message); return; }
    const n = (data as any)?.written ?? 0;
    toast.success(n ? `${n} new briefing${n > 1 ? "s" : ""}` : "No new briefings — all caught up.");
    load();
  };

  const updateMode = async (m: CaretakerMode) => {
    if (!user) return;
    setMode(m);
    await supabase.from("profiles").update({ caretaker_mode: m }).eq("id", user.id);
    toast.success(`Caretaker → ${m}`);
  };

  const updateSkill = async (s: typeof skill) => {
    if (!user) return;
    setSkill(s);
    await supabase.from("profiles").update({ skill_level: s }).eq("id", user.id);
  };

  const send = async () => {
    if (!input.trim() || !user) return;
    const text = input.trim();
    setInput("");
    setBusy(true);
    setToolStatuses([]);

    const userMsgId = `local-u-${Date.now()}`;
    const asstMsgId = `local-a-${Date.now()}`;
    setMessages((prev) => [
      ...prev,
      { id: userMsgId, role: "user", content: text },
      { id: asstMsgId, role: "assistant", content: "", streaming: true },
    ]);
    scrollDown();

    const ac = new AbortController();
    abortRef.current = ac;

    await streamCaretaker({
      message: text,
      signal: ac.signal,
      onEvent: (e) => {
        if (e.type === "text") {
          setMessages((prev) => prev.map((m) => (m.id === asstMsgId ? { ...m, content: (m.content || "") + e.delta } : m)));
          scrollDown();
        } else if (e.type === "tool_call") {
          setToolStatuses((prev) => {
            const ex = prev.find((t) => t.id === e.id);
            if (ex) return prev.map((t) => (t.id === e.id ? { ...t, status: e.status } : t));
            return [...prev, { id: e.id, name: e.name, status: e.status }];
          });
        } else if (e.type === "pending") {
          setPending(e.items);
        } else if (e.type === "error") {
          toast.error(e.error);
        } else if (e.type === "done") {
          setBusy(false);
          load();
        }
      },
    });
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

  const savePlanFromChat = async (plan: TradePlan, mode: "suggest" | "autopilot") => {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/caretaker-execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({
        tool_name: "save_agent_plan",
        args: { ...plan, mode },
        approved: true,
      }),
    });
    const j = await r.json();
    if (!r.ok) { toast.error(j.error || "Failed to save plan"); return; }
    toast.success("Plan saved! View it in Agent Plans.");
    await loadAgentPlans();
  };

  const runPlan = async (planId: string) => {
    const { data: { session } } = await supabase.auth.getSession();
    const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/caretaker-execute`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${session?.access_token}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify({ tool_name: "run_agent_plan", args: { plan_id: planId }, approved: true }),
    });
    const j = await r.json();
    if (!r.ok) toast.error(j.error || "Failed to run plan");
    else { toast.success("Plan started!"); await loadAgentPlans(); }
  };

  return (
    <div className="container py-8 max-w-4xl">
      <div className="flex items-start gap-3 mb-6 flex-wrap">
        <div className="w-10 h-10 rounded-lg bg-gradient-primary shadow-glow flex items-center justify-center">
          <Sparkles className="w-5 h-5 text-primary-foreground" />
        </div>
        <div className="flex-1 min-w-[180px]">
          <h1 className="text-2xl font-semibold tracking-tight">Caretaker</h1>
          <p className="text-xs text-muted-foreground">Tutor, co-pilot, autopilot. Adapts to your skill level. Narrates pre / during / post every event.</p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Skill</span>
            {(["beginner", "intermediate", "advanced"] as const).map((s) => (
              <Button key={s} size="sm" variant={skill === s ? "default" : "outline"} className="h-7 text-xs capitalize" onClick={() => updateSkill(s)}>
                {s}
              </Button>
            ))}
          </div>
          <CaretakerModeSlider value={mode} onChange={updateMode} />
        </div>
      </div>

      <Tabs defaultValue="chat" onValueChange={(v) => { if (v === "plans") loadAgentPlans(); }}>
        <TabsList>
          <TabsTrigger value="chat">Chat</TabsTrigger>
          <TabsTrigger value="journal">
            Journal
            {events.some((e) => !e.read_at) && <Badge variant="default" className="ml-2 h-5 px-1.5">{events.filter((e) => !e.read_at).length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="plans">
            Agent Plans
            {agentPlans.some((p) => p.status === "running") && <Badge variant="default" className="ml-2 h-5 px-1.5">{agentPlans.filter((p) => p.status === "running").length}</Badge>}
          </TabsTrigger>
          <TabsTrigger value="personality">Personality</TabsTrigger>
        </TabsList>

        <TabsContent value="chat" className="mt-4">
          <Card className="p-0 flex flex-col h-[65vh]">
            <div ref={scrollRef} className="flex-1 overflow-y-auto p-5 space-y-4">
              {messages.length === 0 && (
                <div className="text-sm text-muted-foreground text-center py-12">
                  Say hi — try "What's my portfolio looking like?", "Teach me about distortion", or "Suggest a trade on the most active market."
                </div>
              )}
              {messages.filter((m) => m.role !== "tool" && (m.content || m.tool_calls)).map((m) => (
                <div key={m.id} className={`flex flex-col ${m.role === "user" ? "items-end" : "items-start"}`}>
                  <div className={`max-w-[85%] rounded-lg px-4 py-2.5 text-sm ${m.role === "user" ? "bg-primary text-primary-foreground" : "bg-secondary"}`}>
                    {m.content && (
                      <div className="prose prose-sm prose-invert max-w-none">
                        <ReactMarkdown>{m.content}</ReactMarkdown>
                      </div>
                    )}
                    {m.tool_calls && Array.isArray(m.tool_calls) && (
                      <div className="mt-2 space-y-1">
                        {m.tool_calls.map((tc: any) => (
                          <Badge key={tc.id} variant="outline" className="text-[10px]">called {tc.function?.name}</Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  {/* Inline TradePlanCard for create_trade_plan tool results */}
                  {m.tool_calls && Array.isArray(m.tool_calls) && m.tool_calls.some((tc: any) => tc.function?.name === "create_trade_plan") &&
                    m.tool_calls.map((tc: any) => {
                      if (tc.function?.name !== "create_trade_plan") return null;
                      const inlinePlan = inlinePlans[tc.id];
                      if (!inlinePlan) return null;
                      return (
                        <div key={tc.id} className="max-w-[85%] mt-2">
                          <TradePlanCard
                            plan={inlinePlan}
                            onSave={(mode) => savePlanFromChat(inlinePlan, mode)}
                          />
                        </div>
                      );
                    })
                  }
                </div>
              ))}
              {pending.map((p) => (
                <Card key={p.id} className="p-4 border-accent/40 bg-accent/5">
                  <div className="flex items-center gap-2 mb-2">
                    <Sparkles className="w-4 h-4 text-accent" />
                    <span className="font-medium text-sm">Action requested: {p.name}</span>
                    {p.guardrail_warning && <Badge variant="destructive" className="text-[10px]">guardrail: {p.guardrail_warning}</Badge>}
                  </div>
                  <pre className="text-xs bg-background/50 rounded p-2 overflow-auto mb-3">{JSON.stringify(p.args, null, 2)}</pre>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={() => respond(p, true)}><CheckCircle2 className="w-4 h-4 mr-1" /> Approve</Button>
                    <Button size="sm" variant="outline" onClick={() => respond(p, false)}><XCircle className="w-4 h-4 mr-1" /> Reject</Button>
                  </div>
                </Card>
              ))}
              {toolStatuses.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {toolStatuses.map((t) => (
                    <Badge key={t.id} variant="outline" className="text-[10px] gap-1">
                      {t.status === "running" ? <Loader2 className="w-2.5 h-2.5 animate-spin" /> : <CheckCircle2 className="w-2.5 h-2.5 text-bull" />}
                      {t.name}
                    </Badge>
                  ))}
                </div>
              )}
              {busy && <div className="text-xs text-muted-foreground flex items-center gap-2"><Loader2 className="w-3 h-3 animate-spin" /> thinking…</div>}
            </div>
            <div className="border-t border-border p-3 flex gap-2">
              <Input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Ask anything…" onKeyDown={(e) => e.key === "Enter" && !busy && send()} disabled={busy} />
              <Button onClick={send} disabled={busy || !input.trim()}><Send className="w-4 h-4" /></Button>
            </div>
          </Card>
        </TabsContent>

        <TabsContent value="journal" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Pre-event briefings, live updates, post-event recaps, and actions taken on your behalf.</p>
            <Button size="sm" variant="outline" onClick={generateBriefings} disabled={refreshing}>
              {refreshing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
              Refresh
            </Button>
          </div>
          {events.length === 0 ? (
            <Card className="p-10 text-center bg-gradient-surface">
              <Sparkles className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No briefings yet. Click <strong>Refresh</strong> to generate the first batch.</p>
            </Card>
          ) : (
            events.map((e) => <EventBriefingCard key={e.id} event={e} />)
          )}
        </TabsContent>

        <TabsContent value="plans" className="mt-4 space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm text-muted-foreground">Saved agent plans. Ask the Caretaker to create a plan, then save it here.</p>
            <Button size="sm" variant="outline" onClick={loadAgentPlans} disabled={plansLoading}>
              {plansLoading ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5 mr-1" />}
              Refresh
            </Button>
          </div>
          {agentPlans.length === 0 ? (
            <Card className="p-10 text-center bg-gradient-surface">
              <ClipboardList className="w-8 h-8 mx-auto mb-3 text-muted-foreground" />
              <p className="text-sm text-muted-foreground">No saved plans yet. Ask the Caretaker: <em>"Create a plan to grow my portfolio 20% this month."</em></p>
            </Card>
          ) : (
            agentPlans.map((plan) => (
              <Card key={plan.id} className="p-4 space-y-2">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-medium text-sm">{plan.title}</p>
                    {plan.objective && <p className="text-xs text-muted-foreground mt-0.5">{plan.objective}</p>}
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Badge variant={plan.status === "running" ? "default" : plan.status === "completed" ? "outline" : "secondary"} className="text-[10px]">
                      {plan.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">
                      {plan.mode}
                    </Badge>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  {new Date(plan.created_at).toLocaleDateString()}
                  {plan.status !== "running" && plan.status !== "completed" && (
                    <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => runPlan(plan.id)}>
                      <PlayCircle className="w-3.5 h-3.5 mr-1" /> Run
                    </Button>
                  )}
                </div>
              </Card>
            ))
          )}
        </TabsContent>

        <TabsContent value="personality" className="mt-4">
          <CaretakerPersonality />
        </TabsContent>
      </Tabs>
    </div>
  );
}
