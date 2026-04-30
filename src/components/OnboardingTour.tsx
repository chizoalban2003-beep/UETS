import { useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { X, ArrowRight } from "lucide-react";

const KEY = "driftworks_tour_v1";

const STEPS = [
  {
    title: "Welcome to Driftworks",
    body: "You start with §10,000 of paper capital, auto-subscribed to the top 5 live markets. Real data, fake money.",
    cta: "Show me markets",
    to: "/markets",
  },
  {
    title: "Meet your trading bot",
    body: "Suggest, Approve, or Auto. Mean-reversion or momentum. It only trades the markets you whitelist.",
    cta: "Configure bot",
    to: "/bot",
  },
  {
    title: "The Caretaker is your co-pilot",
    body: "Plans, places trades (with your OK), spins up new markets, and writes reports. Use the floating button anywhere.",
    cta: "Open Caretaker",
    to: "/caretaker",
  },
  {
    title: "Want real capital?",
    body: "Pass the literacy quiz and a bot-graded simulation to qualify for real-capital staking when it ships.",
    cta: "Start assessment",
    to: "/assessment",
  },
];

export default function OnboardingTour() {
  const { user, loading } = useAuth();
  const [step, setStep] = useState(0);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();

  useEffect(() => {
    if (loading || !user) return;
    if (typeof window === "undefined") return;
    if (!localStorage.getItem(KEY)) setOpen(true);
  }, [user, loading]);

  if (!open) return null;
  const s = STEPS[step];

  const dismiss = () => {
    localStorage.setItem(KEY, "1");
    setOpen(false);
  };

  return (
    <div className="fixed bottom-24 right-6 z-50 w-[340px] animate-in slide-in-from-bottom-4">
      <Card className="p-5 bg-card/95 backdrop-blur border-primary/30 shadow-glow">
        <div className="flex justify-between items-start mb-2">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
            Tour · {step + 1}/{STEPS.length}
          </div>
          <button onClick={dismiss} className="text-muted-foreground hover:text-foreground">
            <X className="w-4 h-4" />
          </button>
        </div>
        <h3 className="font-semibold text-base mb-1.5">{s.title}</h3>
        <p className="text-sm text-muted-foreground mb-4">{s.body}</p>
        <div className="flex justify-between items-center gap-2">
          <Button variant="ghost" size="sm" onClick={dismiss}>
            Skip
          </Button>
          <Button
            size="sm"
            onClick={() => {
              nav(s.to);
              if (step + 1 >= STEPS.length) dismiss();
              else setStep(step + 1);
            }}
          >
            {s.cta}
            <ArrowRight className="w-3.5 h-3.5 ml-1" />
          </Button>
        </div>
      </Card>
    </div>
  );
}
