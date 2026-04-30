import { useState } from "react";
import { GraduationCap, ChevronDown } from "lucide-react";
import { Card } from "@/components/ui/card";
import ReactMarkdown from "react-markdown";
import { cn } from "@/lib/utils";

export default function LessonCard({ concept, body }: { concept: string; body: string }) {
  const [open, setOpen] = useState(false);
  return (
    <Card className="p-3 border-accent/40 bg-accent/5">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 w-full text-left"
      >
        <GraduationCap className="w-4 h-4 text-accent shrink-0" />
        <span className="text-xs font-medium flex-1">Lesson · {concept}</span>
        <ChevronDown className={cn("w-3.5 h-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="mt-2 prose prose-sm prose-invert max-w-none [&>*]:my-1 text-xs">
          <ReactMarkdown>{body}</ReactMarkdown>
        </div>
      )}
    </Card>
  );
}
