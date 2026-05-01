import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Bell, CheckCheck } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { formatDistanceToNow } from "date-fns";

type Event = {
  id: string;
  title: string;
  body_md: string;
  kind: string;
  market_id: string | null;
  read_at: string | null;
  created_at: string;
};

export default function NotificationsBell() {
  const { user } = useAuth();
  const [events, setEvents] = useState<Event[]>([]);
  const [open, setOpen] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase
      .from("caretaker_events")
      .select("*")
      .eq("user_id", user.id)
      .order("created_at", { ascending: false })
      .limit(20);
    setEvents((data as Event[]) || []);
  };

  useEffect(() => {
    if (!user) return;
    load();
    const ch = supabase
      .channel("ct-events")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "caretaker_events", filter: `user_id=eq.${user.id}` },
        load,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user]);

  if (!user) return null;
  const unread = events.filter((e) => !e.read_at).length;

  const markAllRead = async () => {
    const ids = events.filter((e) => !e.read_at).map((e) => e.id);
    if (!ids.length) return;
    await supabase.from("caretaker_events").update({ read_at: new Date().toISOString() }).in("id", ids);
    load();
  };

  const markRead = async (id: string) => {
    await supabase.from("caretaker_events").update({ read_at: new Date().toISOString() }).eq("id", id);
    load();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="relative">
          <Bell className="w-4 h-4" />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 min-w-4 h-4 px-1 rounded-full bg-primary text-[10px] font-mono text-primary-foreground flex items-center justify-center">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0">
        <div className="flex items-center justify-between p-3 border-b border-border/60">
          <div className="text-sm font-medium">Caretaker briefings</div>
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={markAllRead} className="text-xs h-7">
              <CheckCheck className="w-3 h-3 mr-1" />
              Mark all read
            </Button>
          )}
        </div>
        <ScrollArea className="h-[420px]">
          {events.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No briefings yet. The Caretaker will write here as your markets evolve.
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {events.map((e) => (
                <Link
                  key={e.id}
                  to={e.market_id ? `/markets/${e.market_id}` : "/caretaker"}
                  onClick={() => {
                    if (!e.read_at) markRead(e.id);
                    setOpen(false);
                  }}
                  className={`block p-3 hover:bg-secondary/50 transition-colors ${!e.read_at ? "bg-primary/5" : ""}`}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <div className="text-sm font-medium leading-snug">{e.title}</div>
                    {!e.read_at && <span className="w-2 h-2 rounded-full bg-primary mt-1.5 shrink-0" />}
                  </div>
                  <div className="text-xs text-muted-foreground line-clamp-2 whitespace-pre-line">
                    {e.body_md.replace(/[#*`_]/g, "").slice(0, 160)}
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-1.5">
                    {formatDistanceToNow(new Date(e.created_at), { addSuffix: true })}
                  </div>
                </Link>
              ))}
            </div>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
