import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Target, Plus, Loader2, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { formatNum } from "@/lib/trend";

type GoalStatus = "active" | "achieved" | "failed" | "cancelled";
type Goal = {
  id: string;
  user_id: string;
  title: string;
  target_return_pct: number | null;
  max_loss: number | null;
  deadline: string | null;
  notes: string | null;
  status: GoalStatus;
  created_at: string;
};

const STATUS_VARIANT: Record<GoalStatus, "default" | "secondary" | "outline" | "destructive"> = {
  active: "default",
  achieved: "outline",
  failed: "destructive",
  cancelled: "secondary",
};

export default function Goals() {
  const { user } = useAuth();
  const [goals, setGoals] = useState<Goal[]>([]);
  const [loading, setLoading] = useState(true);
  const [startBalance, setStartBalance] = useState(10000);
  const [currentValue, setCurrentValue] = useState(0);
  const [openNew, setOpenNew] = useState(false);

  // form
  const [title, setTitle] = useState("");
  const [target, setTarget] = useState<string>("");
  const [maxLoss, setMaxLoss] = useState<string>("");
  const [deadlineDays, setDeadlineDays] = useState<string>("30");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    if (!user) return;
    setLoading(true);
    const [{ data: g }, { data: w }] = await Promise.all([
      supabase
        .from("user_goals")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false }),
      supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle(),
    ]);
    setGoals((g as Goal[]) || []);
    setCurrentValue(Number((w as any)?.balance || 0));
    setLoading(false);
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const addGoal = async () => {
    if (!user || !title.trim()) return;
    setSaving(true);
    const deadline = deadlineDays
      ? new Date(Date.now() + Number(deadlineDays) * 86400000).toISOString()
      : null;
    const { error } = await supabase.from("user_goals").insert({
      user_id: user.id,
      title: title.trim(),
      target_return_pct: target ? Number(target) : null,
      max_loss: maxLoss ? Number(maxLoss) : null,
      deadline,
      notes: notes.trim() || null,
    });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Goal created");
    setTitle("");
    setTarget("");
    setMaxLoss("");
    setDeadlineDays("30");
    setNotes("");
    setOpenNew(false);
    load();
  };

  const updateStatus = async (id: string, status: GoalStatus) => {
    const { error } = await supabase.from("user_goals").update({ status }).eq("id", id);
    if (error) toast.error(error.message);
    else load();
  };

  const remove = async (id: string) => {
    const { error } = await supabase.from("user_goals").delete().eq("id", id);
    if (error) toast.error(error.message);
    else load();
  };

  const computeProgress = (g: Goal) => {
    if (!g.target_return_pct) return null;
    const targetValue = startBalance * (1 + g.target_return_pct / 100);
    const gained = currentValue - startBalance;
    const need = targetValue - startBalance;
    if (need <= 0) return 100;
    return Math.max(0, Math.min(100, (gained / need) * 100));
  };

  const daysLeft = (g: Goal) => {
    if (!g.deadline) return null;
    const d = Math.ceil((new Date(g.deadline).getTime() - Date.now()) / 86400000);
    return d;
  };

  return (
    <div className="container py-10 max-w-4xl">
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gradient-primary shadow-glow flex items-center justify-center">
            <Target className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Goals</h1>
            <p className="text-xs text-muted-foreground">
              Set targets — the Caretaker tracks them and adjusts strategy.
            </p>
          </div>
        </div>
        <Dialog open={openNew} onOpenChange={setOpenNew}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-1" /> New goal
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>New trading goal</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label className="text-xs">Title</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="e.g. Grow account 10% this month"
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Target return %</Label>
                  <Input
                    type="number"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder="10"
                  />
                </div>
                <div>
                  <Label className="text-xs">Max loss ($)</Label>
                  <Input
                    type="number"
                    value={maxLoss}
                    onChange={(e) => setMaxLoss(e.target.value)}
                    placeholder="500"
                  />
                </div>
              </div>
              <div>
                <Label className="text-xs">Deadline (days from now)</Label>
                <Input
                  type="number"
                  value={deadlineDays}
                  onChange={(e) => setDeadlineDays(e.target.value)}
                />
              </div>
              <div>
                <Label className="text-xs">Notes</Label>
                <Textarea
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  rows={3}
                  placeholder="Strategy notes, constraints, context…"
                />
              </div>
            </div>
            <DialogFooter>
              <Button onClick={addGoal} disabled={saving || !title.trim()}>
                {saving && <Loader2 className="w-4 h-4 mr-1 animate-spin" />}
                Create goal
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      <Card className="p-4 mb-6 grid grid-cols-3 gap-4">
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Starting</div>
          <div className="font-mono text-lg">${formatNum(startBalance)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Current</div>
          <div className="font-mono text-lg">${formatNum(currentValue)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">P&amp;L</div>
          <div
            className={`font-mono text-lg ${
              currentValue >= startBalance ? "text-bull" : "text-bear"
            }`}
          >
            {currentValue >= startBalance ? "+" : ""}
            {formatNum(currentValue - startBalance)}
          </div>
        </div>
      </Card>

      {loading ? (
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      ) : goals.length === 0 ? (
        <Card className="p-12 text-center bg-gradient-surface">
          <Target className="w-10 h-10 mx-auto mb-3 text-muted-foreground" />
          <p className="text-sm text-muted-foreground mb-4">
            No goals yet. Set one to give the Caretaker direction.
          </p>
          <Button onClick={() => setOpenNew(true)}>
            <Plus className="w-4 h-4 mr-1" /> Create your first goal
          </Button>
        </Card>
      ) : (
        <div className="space-y-3">
          {goals.map((g) => {
            const progress = computeProgress(g);
            const days = daysLeft(g);
            return (
              <Card key={g.id} className="p-5">
                <div className="flex items-start justify-between gap-3 mb-3 flex-wrap">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <h3 className="font-medium">{g.title}</h3>
                      <Badge variant={STATUS_VARIANT[g.status]} className="capitalize text-[10px]">
                        {g.status}
                      </Badge>
                    </div>
                    <div className="flex gap-4 text-xs text-muted-foreground font-mono flex-wrap">
                      {g.target_return_pct != null && <span>target +{g.target_return_pct}%</span>}
                      {g.max_loss != null && <span>max loss ${formatNum(g.max_loss)}</span>}
                      {days != null && (
                        <span className={days < 0 ? "text-bear" : ""}>
                          {days < 0 ? `${-days}d overdue` : `${days}d left`}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 items-center">
                    <Select
                      value={g.status}
                      onValueChange={(v) => updateStatus(g.id, v as GoalStatus)}
                    >
                      <SelectTrigger className="h-8 w-32 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="active">Active</SelectItem>
                        <SelectItem value="achieved">Achieved</SelectItem>
                        <SelectItem value="failed">Failed</SelectItem>
                        <SelectItem value="cancelled">Cancelled</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => remove(g.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
                {progress != null && (
                  <div className="space-y-1">
                    <Progress value={progress} className="h-2" />
                    <div className="text-[10px] text-muted-foreground">
                      {progress.toFixed(0)}% to target
                    </div>
                  </div>
                )}
                {g.notes && (
                  <p className="text-xs text-muted-foreground mt-3 whitespace-pre-wrap">{g.notes}</p>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
