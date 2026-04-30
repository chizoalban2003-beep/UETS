import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import ReactMarkdown from "react-markdown";
import { CalendarClock, Activity, Trophy, Sparkles, Zap, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";

export type CaretakerEvent = {
  id: string;
  user_id: string;
  market_id: string | null;
  kind: "pre_event" | "during_event" | "post_event" | "action_taken" | "lesson";
  title: string;
  body_md: string;
  metrics: any;
  read_at: string | null;
  created_at: string;
};

const KIND_META: Record<CaretakerEvent["kind"], { Icon: any; label: string; tone: string }> = {
  pre_event: { Icon: CalendarClock, label: "Pre-event", tone: "text-primary border-primary/30" },
  during_event: { Icon: Activity, label: "Live update", tone: "text-accent border-accent/30" },
  post_event: { Icon: Trophy, label: "Recap", tone: "text-bull border-bull/30" },
  action_taken: { Icon: Zap, label: "Action taken", tone: "text-foreground border-border" },
  lesson: { Icon: Sparkles, label: "Lesson", tone: "text-muted-foreground border-border" },
};

export default function EventBriefingCard({
  event,
  marketName,
  compact = false,
}: {
  event: CaretakerEvent;
  marketName?: string;
  compact?: boolean;
}) {
  const meta = KIND_META[event.kind];
  const Icon = meta.Icon;
  const unread = !event.read_at;

  const markRead = async () => {
    if (event.read_at) return;
    await supabase.from("caretaker_events").update({ read_at: new Date().toISOString() }).eq("id", event.id);
  };

  return (
    <Card
      className={`p-4 ${unread ? "border-primary/40 bg-gradient-surface" : ""}`}
      onMouseEnter={markRead}
    >
      <div className="flex items-start gap-3">
        <div className="w-8 h-8 rounded-md bg-secondary/60 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-foreground/80" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <Badge variant="outline" className={meta.tone}>{meta.label}</Badge>
            {unread && <Badge variant="default" className="text-[10px] h-4 px-1">new</Badge>}
            <span className="text-xs text-muted-foreground">{new Date(event.created_at).toLocaleString()}</span>
          </div>
          <h3 className="font-medium text-sm mb-2">{event.title}</h3>
          <div className={`prose prose-sm prose-invert max-w-none [&>*]:my-1 ${compact ? "text-xs" : ""}`}>
            <ReactMarkdown>{event.body_md}</ReactMarkdown>
          </div>
          {event.market_id && (
            <div className="mt-3">
              <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
                <Link to={`/markets/${event.market_id}`}>
                  Open {marketName || "market"} <ExternalLink className="w-3 h-3 ml-1" />
                </Link>
              </Button>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}
