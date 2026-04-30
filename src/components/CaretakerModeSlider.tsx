import { GraduationCap, Lightbulb, UserCheck, Bot as BotIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type CaretakerMode = "teach" | "suggest" | "copilot" | "autopilot";

const MODES: { key: CaretakerMode; label: string; sub: string; Icon: typeof BotIcon }[] = [
  { key: "teach", label: "Teach", sub: "Explain only, never trade", Icon: GraduationCap },
  { key: "suggest", label: "Suggest", sub: "Propose, you approve", Icon: Lightbulb },
  { key: "copilot", label: "Co-pilot", sub: "Auto inside guardrails", Icon: UserCheck },
  { key: "autopilot", label: "Autopilot", sub: "Full auto", Icon: BotIcon },
];

export default function CaretakerModeSlider({
  value,
  onChange,
  size = "md",
}: {
  value: CaretakerMode;
  onChange: (m: CaretakerMode) => void;
  size?: "sm" | "md";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-stretch rounded-lg border border-border bg-card/50 p-1 gap-1",
        size === "sm" && "p-0.5 gap-0.5",
      )}
      role="radiogroup"
      aria-label="Caretaker mode"
    >
      {MODES.map(({ key, label, sub, Icon }) => {
        const active = value === key;
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(key)}
            title={sub}
            className={cn(
              "flex flex-col items-center gap-0.5 rounded-md transition-colors text-center",
              size === "md" ? "px-3 py-2 min-w-[88px]" : "px-2 py-1 min-w-[64px]",
              active
                ? "bg-gradient-primary text-primary-foreground shadow-glow"
                : "text-muted-foreground hover:text-foreground hover:bg-secondary/60",
            )}
          >
            <Icon className={size === "md" ? "w-4 h-4" : "w-3.5 h-3.5"} />
            <span className={cn("font-medium", size === "md" ? "text-xs" : "text-[10px]")}>{label}</span>
          </button>
        );
      })}
    </div>
  );
}
