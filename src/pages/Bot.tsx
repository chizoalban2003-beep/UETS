import { Card } from "@/components/ui/card";
import { Bot } from "lucide-react";

export default function BotPage() {
  return (
    <div className="container py-10 max-w-3xl">
      <h1 className="text-3xl font-semibold tracking-tight mb-2">Trading bot</h1>
      <p className="text-sm text-muted-foreground mb-8">Suggest, approve, or full-auto. Coming online next.</p>

      <Card className="p-10 text-center bg-gradient-surface">
        <div className="w-12 h-12 rounded-lg bg-primary/10 text-primary flex items-center justify-center mx-auto mb-4">
          <Bot className="w-6 h-6" />
        </div>
        <h2 className="font-medium mb-2">Bot module unlocking soon</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Mean-reversion, momentum, or your own custom strategy described in plain English.
          Every trade comes with rationale, confidence, and full audit trail.
        </p>
      </Card>
    </div>
  );
}
