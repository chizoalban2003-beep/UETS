import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, Circle, Lock, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type Question = {
  q: string;
  options: string[];
  answer: number;
  explain: string;
};

// Questions are loaded from DB; this is a fallback in case DB is unavailable
const QUIZ_FALLBACK: Question[] = [
  {
    q: "What does a Distortion contract pay out at resolution?",
    options: [
      "A fixed §1 if the value is above the trend",
      "An amount proportional to how far the final value is OUTSIDE the band",
      "Always zero unless the band is breached by exactly 5%",
      "The same as a Snap-back contract",
    ],
    answer: 1,
    explain: "Distortion is scalar: 0 inside the band, scaling toward 1 as the breach grows.",
  },
  {
    q: "What does Snap-back YES pay if the final value stays inside the band?",
    options: ["0", "0.5", "1", "Same as Distortion YES"],
    answer: 2,
    explain: "Snap-back is binary: YES = stayed inside (1), NO = breached (0).",
  },
  {
    q: "Pricing on each contract uses…",
    options: [
      "An order book matched by the platform",
      "A constant-product (x·y=k) automated market maker",
      "A Black-Scholes options model",
      "A fixed price set by the creator",
    ],
    answer: 1,
    explain: "Each contract is a CPMM with reserves of YES and NO shares.",
  },
  {
    q: "What is the trading fee per trade?",
    options: ["0%", "0.1%", "1% (100 bps)", "5%"],
    answer: 2,
    explain: "fee_bps defaults to 100 = 1%, taken on the gross numeraire amount.",
  },
  {
    q: "When the bot is in 'Suggest' mode, it…",
    options: [
      "Auto-executes trades up to the daily loss cap",
      "Posts ideas you must approve before any trade is placed",
      "Only watches; never proposes anything",
      "Liquidates your portfolio every night",
    ],
    answer: 1,
    explain: "Suggest = ideas only. Approve = one-click confirm. Auto = autopilot within risk caps.",
  },
  {
    q: "Holding long Snap-back on two highly correlated markets is…",
    options: [
      "A natural hedge — risks cancel out",
      "Effectively a doubled bet on the same outcome",
      "Required by the platform",
      "Lower risk than a single Snap-back",
    ],
    answer: 1,
    explain: "Correlated bets compound — they don't hedge. Hedge with offsetting sides or uncorrelated markets.",
  },
  {
    q: "If the AMM reserves are reserve_yes=600 and reserve_no=400, the implied probability of YES is closest to…",
    options: ["60%", "50%", "40%", "Cannot be computed"],
    answer: 2,
    explain: "Price_YES ≈ reserve_NO / (reserve_YES + reserve_NO) = 400/1000 = 40%.",
  },
  {
    q: "Driftworks paper capital is…",
    options: [
      "Convertible 1:1 to USD on withdrawal",
      "A virtual balance for risk-free testing — real-capital staking requires passing the assessment",
      "Capped at §100",
      "Backed by a custodian",
    ],
    answer: 1,
    explain: "Paper-only today. Real capital unlocks after passing both assessment stages.",
  },
  {
    q: "The Caretaker bot, when asked to place a trade in 'assist' mode, will…",
    options: [
      "Place the trade silently",
      "Refuse — you must do it manually",
      "Stage the trade as a pending approval card you click to confirm",
      "Email your broker",
    ],
    answer: 2,
    explain: "Assist = pending-approval cards. Autopilot = direct execution under risk caps.",
  },
  {
    q: "Max daily loss on the bot is enforced…",
    options: [
      "Client-side only, easy to bypass",
      "Server-side per user, blocking new bot trades once breached",
      "Once a year",
      "Only for the Auto mode",
    ],
    answer: 1,
    explain: "Risk caps are enforced server-side in the bot run / trade RPC.",
  },
];

const QUIZ_PASS = 8;
const SIM_PASS = 75;

export default function Assessment() {
  const { user } = useAuth();
  const [quiz, setQuiz] = useState<Question[]>(QUIZ_FALLBACK);
  const [eligibility, setEligibility] = useState<any>(null);
  const [attempts, setAttempts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [stage, setStage] = useState<"overview" | "quiz" | "sim">("overview");

  // quiz state
  const [answers, setAnswers] = useState<number[]>([]);
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // sim state
  const [simRun, setSimRun] = useState(false);
  const [simResult, setSimResult] = useState<any>(null);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: el }, { data: at }, { data: qs }] = await Promise.all([
      supabase.from("user_capital_eligibility").select("*").eq("user_id", user.id).maybeSingle(),
      supabase.from("assessment_attempts").select("*").eq("user_id", user.id).order("created_at", { ascending: false }),
      supabase.from("assessment_questions").select("*").eq("stage", "quiz").eq("active", true).order("position"),
    ]);
    setEligibility(el);
    setAttempts(at || []);
    if (qs && qs.length > 0) {
      setQuiz(
        (qs as any[]).map((q) => ({
          q: q.question,
          options: Array.isArray(q.options) ? q.options : JSON.parse(q.options),
          answer: q.answer_index,
          explain: q.explanation,
        }))
      );
    }
    setLoading(false);
  };

  useEffect(() => {
    document.title = "Assessment · Driftworks";
  }, []);

  useEffect(() => { load(); }, [user]);

  const quizPassed = !!eligibility?.quiz_passed_at;
  const simPassed = !!eligibility?.sim_passed_at;
  const isEligible = !!eligibility?.eligible;

  const submitQuiz = async () => {
    if (answers.length !== quiz.length || answers.some((a) => a === undefined)) {
      toast.error("Answer every question first");
      return;
    }
    setSubmitting(true);
    const score = answers.reduce((acc, a, i) => acc + (a === quiz[i].answer ? 1 : 0), 0);
    const passed = score >= QUIZ_PASS;
    try {
      const { error } = await supabase.functions.invoke("assessment-grade-quiz", {
        body: { score, total: quiz.length, passed, answers },
      });
      if (error) throw error;
      setSubmitted(true);
      toast.success(passed ? `Passed: ${score}/${quiz.length}` : `Score ${score}/${quiz.length} — need ${QUIZ_PASS} to pass`);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Could not save attempt");
    } finally {
      setSubmitting(false);
    }
  };

  const runSim = async () => {
    setSimRun(true);
    setSimResult(null);
    try {
      const { data, error } = await supabase.functions.invoke("assessment-sim", { body: {} });
      if (error) throw error;
      setSimResult(data);
      await load();
    } catch (e: any) {
      toast.error(e?.message || "Simulation failed");
    } finally {
      setSimRun(false);
    }
  };

  if (loading) {
    return <div className="container py-12 text-center text-sm text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin inline" /></div>;
  }

  return (
    <div className="container py-8 max-w-4xl">
      <div className="flex items-center gap-3 mb-1">
        <ShieldCheck className="w-7 h-7 text-primary" />
        <h1 className="text-3xl font-semibold tracking-tight">Real-capital readiness</h1>
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Two stages. Pass both to qualify for real-capital staking when it ships.
      </p>

      <div className="grid md:grid-cols-2 gap-4 mb-8">
        <StageCard
          n={1}
          title="Literacy quiz"
          subtitle={`Score ≥ ${QUIZ_PASS}/${quiz.length} on platform mechanics`}
          done={quizPassed}
          locked={false}
          onStart={() => setStage("quiz")}
        />
        <StageCard
          n={2}
          title="Bot-graded simulation"
          subtitle={`Score ≥ ${SIM_PASS}/100 on a scripted scenario`}
          done={simPassed}
          locked={!quizPassed}
          onStart={() => setStage("sim")}
        />
      </div>

      {isEligible && (
        <Card className="p-5 mb-6 bg-bull/10 border-bull/40">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="w-6 h-6 text-bull" />
            <div>
              <div className="font-semibold">You're eligible for real-capital staking</div>
              <div className="text-xs text-muted-foreground">Real-money rails ship next. You're already on the qualified list.</div>
            </div>
          </div>
        </Card>
      )}

      {stage === "quiz" && (
        <Card className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold">Stage 1 · Literacy quiz</h2>
            <Button variant="ghost" size="sm" onClick={() => { setStage("overview"); setSubmitted(false); }}>Back</Button>
          </div>
          <div className="space-y-5">
            {quiz.map((q, i) => (
              <div key={i} className="border-b border-border/60 pb-4 last:border-0">
                <div className="font-medium text-sm mb-2">{i + 1}. {q.q}</div>
                <div className="space-y-1.5">
                  {q.options.map((opt, j) => {
                    const chosen = answers[i] === j;
                    const isCorrect = submitted && j === q.answer;
                    const isWrong = submitted && chosen && j !== q.answer;
                    return (
                      <label
                        key={j}
                        className={`flex items-start gap-2 p-2 rounded-md cursor-pointer text-sm border ${
                          isCorrect ? "border-bull/60 bg-bull/10"
                          : isWrong ? "border-bear/60 bg-bear/10"
                          : chosen ? "border-primary/60 bg-primary/5"
                          : "border-transparent hover:bg-secondary/40"
                        }`}
                      >
                        <input
                          type="radio"
                          name={`q${i}`}
                          checked={chosen}
                          disabled={submitted}
                          onChange={() => {
                            const next = [...answers];
                            next[i] = j;
                            setAnswers(next);
                          }}
                          className="mt-1"
                        />
                        <span>{opt}</span>
                      </label>
                    );
                  })}
                </div>
                {submitted && <div className="text-xs text-muted-foreground mt-2 italic">{q.explain}</div>}
              </div>
            ))}
          </div>
          {!submitted ? (
            <Button onClick={submitQuiz} disabled={submitting} className="mt-6 w-full">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : "Submit answers"}
            </Button>
          ) : (
            <Button onClick={() => { setStage("overview"); setSubmitted(false); setAnswers([]); }} className="mt-6 w-full" variant="outline">
              Back to overview
            </Button>
          )}
        </Card>
      )}

      {stage === "sim" && (
        <Card className="p-6">
          <div className="flex justify-between items-center mb-4">
            <h2 className="font-semibold">Stage 2 · Bot-graded simulation</h2>
            <Button variant="ghost" size="sm" onClick={() => setStage("overview")}>Back</Button>
          </div>
          {!quizPassed ? (
            <div className="text-center py-12 text-sm text-muted-foreground">
              <Lock className="w-6 h-6 mx-auto mb-2" /> Pass the literacy quiz first.
            </div>
          ) : (
            <>
              <p className="text-sm text-muted-foreground mb-4">
                The Caretaker spins up a scripted 3-market scenario with §5,000 sim balance. It scores
                your decisions against an optimal-policy reference. Pass: {SIM_PASS}/100.
              </p>
              {!simResult && (
                <Button onClick={runSim} disabled={simRun} className="w-full">
                  {simRun ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Running scenario…</> : "Run simulation"}
                </Button>
              )}
              {simResult && (
                <div className="space-y-4">
                  <div className="flex items-baseline gap-3">
                    <div className="text-5xl font-mono-num text-primary">{Math.round(simResult.score || 0)}</div>
                    <div className="text-sm text-muted-foreground">/ 100</div>
                    <Badge variant={simResult.passed ? "default" : "secondary"}>{simResult.passed ? "Passed" : "Try again"}</Badge>
                  </div>
                  <Card className="p-4 bg-secondary/30">
                    <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Caretaker feedback</div>
                    <div className="text-sm whitespace-pre-wrap">{simResult.feedback}</div>
                  </Card>
                  <Button onClick={() => { setSimResult(null); }} variant="outline" className="w-full">Run again</Button>
                </div>
              )}
            </>
          )}
        </Card>
      )}

      {stage === "overview" && attempts.length > 0 && (
        <Card>
          <div className="p-4 border-b border-border/60 font-medium text-sm">Attempt history</div>
          <div className="divide-y divide-border/60">
            {attempts.slice(0, 10).map((a) => (
              <div key={a.id} className="p-3 flex justify-between items-center text-sm">
                <div>
                  <span className="capitalize font-medium">{a.stage}</span>
                  <span className="text-muted-foreground"> · {new Date(a.created_at).toLocaleString()}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono-num">{Number(a.score).toFixed(0)}</span>
                  <Badge variant={a.passed ? "default" : "secondary"}>{a.passed ? "pass" : "fail"}</Badge>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function StageCard({ n, title, subtitle, done, locked, onStart }: { n: number; title: string; subtitle: string; done: boolean; locked: boolean; onStart: () => void }) {
  return (
    <Card className={`p-5 ${done ? "border-bull/40 bg-bull/5" : locked ? "opacity-60" : ""}`}>
      <div className="flex items-start gap-3">
        {done ? <CheckCircle2 className="w-6 h-6 text-bull shrink-0" /> : locked ? <Lock className="w-6 h-6 text-muted-foreground shrink-0" /> : <Circle className="w-6 h-6 text-muted-foreground shrink-0" />}
        <div className="flex-1">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Stage {n}</div>
          <div className="font-semibold">{title}</div>
          <div className="text-xs text-muted-foreground mt-0.5">{subtitle}</div>
        </div>
      </div>
      <Button
        size="sm"
        variant={done ? "outline" : "default"}
        onClick={onStart}
        disabled={locked}
        className="w-full mt-4"
      >
        {done ? "Review" : locked ? "Locked" : "Start"}
      </Button>
    </Card>
  );
}
