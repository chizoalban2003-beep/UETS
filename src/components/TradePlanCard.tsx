import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Wallet,
  Activity,
  TrendingUp,
  Shield,
  Target,
  Sparkles,
  Loader2,
  CheckCircle2,
} from "lucide-react";
import { useState } from "react";

export type TradePlanStep = {
  tool: string;
  description: string;
  args?: Record<string, unknown>;
};

export type TradePlan = {
  title: string;
  objective?: string;
  steps: TradePlanStep[];
  risk_notes?: string;
  expected_outcome?: string;
};

interface TradePlanCardProps {
  plan: TradePlan;
  objective?: string;
  onSave: (mode: "suggest" | "autopilot") => Promise<void>;
}

const TOOL_ICONS: Record<string, React.FC<{ className?: string }>> = {
  get_portfolio: Wallet,
  run_backtest: Activity,
  place_trade: TrendingUp,
  suggest_hedges: Shield,
  set_goal: Target,
};

function StepIcon({ tool }: { tool: string }) {
  const Icon = TOOL_ICONS[tool] || Sparkles;
  return <Icon className="w-4 h-4 text-accent shrink-0 mt-0.5" />;
}

export default function TradePlanCard({ plan, objective, onSave }: TradePlanCardProps) {
  const [saving, setSaving] = useState<"suggest" | "autopilot" | null>(null);

  const handleSave = async (mode: "suggest" | "autopilot") => {
    setSaving(mode);
    try {
      await onSave(mode);
    } finally {
      setSaving(null);
    }
  };

  return (
    <Card className="p-4 border-accent/40 bg-accent/5 space-y-3">
      <div className="flex items-start gap-2">
        <Sparkles className="w-4 h-4 text-accent mt-1 shrink-0" />
        <div>
          <p className="font-semibold text-sm">{plan.title}</p>
          {(objective || plan.objective) && (
            <p className="text-xs text-muted-foreground mt-0.5">{objective || plan.objective}</p>
          )}
        </div>
      </div>

      <ol className="space-y-2">
        {plan.steps.map((step, i) => (
          <li key={i} className="flex items-start gap-2 text-sm">
            <Badge variant="outline" className="text-[10px] h-5 w-5 flex items-center justify-center shrink-0 p-0">
              {i + 1}
            </Badge>
            <StepIcon tool={step.tool} />
            <span className="text-muted-foreground">{step.description}</span>
          </li>
        ))}
      </ol>

      {plan.risk_notes && (
        <div className="rounded-md bg-destructive/10 border border-destructive/20 px-3 py-2 text-xs text-destructive">
          <strong>Risk:</strong> {plan.risk_notes}
        </div>
      )}

      {plan.expected_outcome && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <CheckCircle2 className="w-3.5 h-3.5 text-bull shrink-0" />
          <span><strong>Expected:</strong> {plan.expected_outcome}</span>
        </div>
      )}

      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          onClick={() => handleSave("suggest")}
          disabled={saving !== null}
          className="flex-1"
        >
          {saving === "suggest" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Target className="w-3.5 h-3.5 mr-1.5" />}
          Save plan
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => handleSave("autopilot")}
          disabled={saving !== null}
          className="flex-1"
        >
          {saving === "autopilot" ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <TrendingUp className="w-3.5 h-3.5 mr-1.5" />}
          Run in autopilot
        </Button>
      </div>
    </Card>
  );
}
