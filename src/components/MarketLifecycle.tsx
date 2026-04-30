import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

const STEPS = [
  { key: "draft", label: "Draft" },
  { key: "open", label: "Live" },
  { key: "pending_resolution", label: "Awaiting value" },
  { key: "disputable", label: "Dispute window" },
  { key: "resolved", label: "Resolved" },
];

const ORDER: Record<string, number> = {
  draft: 0,
  pending_review: 0,
  open: 1,
  pending_resolution: 2,
  disputable: 3,
  resolved: 4,
  cancelled: -1,
};

export default function MarketLifecycle({ status }: { status: string }) {
  const current = ORDER[status] ?? 0;
  if (status === "cancelled") {
    return (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <span className="w-2 h-2 rounded-full bg-bear" /> Cancelled
      </div>
    );
  }
  return (
    <div className="flex items-center gap-2 text-xs">
      {STEPS.map((s, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={s.key} className="flex items-center gap-2">
            <div
              className={cn(
                "w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-medium border",
                done && "bg-primary border-primary text-primary-foreground",
                active && "border-primary text-primary",
                !done && !active && "border-border text-muted-foreground",
              )}
            >
              {done ? <Check className="w-3 h-3" /> : i + 1}
            </div>
            <span className={cn(active ? "text-foreground" : "text-muted-foreground")}>{s.label}</span>
            {i < STEPS.length - 1 && <span className="w-4 h-px bg-border" />}
          </div>
        );
      })}
    </div>
  );
}
