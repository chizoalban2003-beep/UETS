import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { Sparkles } from "lucide-react";
import { Link } from "react-router-dom";

export default function DemoBadge() {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Link
          to="/assessment"
          className="hidden sm:inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-primary/40 bg-primary/10 text-[11px] font-medium tracking-wide text-primary hover:bg-primary/20 transition-colors"
        >
          <Sparkles className="w-3 h-3" />
          DEMO · Paper Capital
        </Link>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-xs">
        Real-world market data, paper money. Real-capital staking unlocks after passing the assessment.
      </TooltipContent>
    </Tooltip>
  );
}
