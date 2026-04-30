import { Badge } from "@/components/ui/badge";
import { Radio } from "lucide-react";

export default function DataSourceBadge({ size = "sm" }: { size?: "sm" | "xs" }) {
  return (
    <Badge variant="outline" className={`gap-1 border-bull/40 text-bull bg-bull/5 ${size === "xs" ? "text-[10px] py-0 px-1.5" : ""}`}>
      <Radio className="w-3 h-3" />
      Live
    </Badge>
  );
}
