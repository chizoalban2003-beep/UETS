import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import ReactMarkdown from "react-markdown";
import { format } from "date-fns";
import { FileText, Download, Loader2 } from "lucide-react";
import { toast } from "sonner";

export default function Reports() {
  const { user } = useAuth();
  const [reports, setReports] = useState<any[]>([]);
  const [selected, setSelected] = useState<any>(null);
  const [generating, setGenerating] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data } = await supabase.from("reports").select("*").eq("user_id", user.id).order("created_at", { ascending: false });
    setReports(data || []);
    if (!selected && data?.[0]) setSelected(data[0]);
  };
  useEffect(() => { load(); }, [user]);

  const generate = async () => {
    setGenerating(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      const r = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-report`, {
        method: "POST",
        headers: { "Content-Type": "application/json", apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY, Authorization: `Bearer ${session?.access_token}` },
        body: JSON.stringify({ user_id: user!.id, kind: "on_demand", days: 7 }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "Failed");
      toast.success("Report ready");
      await load();
    } catch (e: any) { toast.error(e?.message || "Failed"); }
    setGenerating(false);
  };

  const download = (r: any) => {
    const blob = new Blob([r.content_md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `${r.title}.md`; a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="container py-8 max-w-6xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Reports</h1>
          <p className="text-xs text-muted-foreground">Daily, weekly, monthly performance — generated automatically.</p>
        </div>
        <Button onClick={generate} disabled={generating}>
          {generating ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : <FileText className="w-4 h-4 mr-1" />}
          Generate now
        </Button>
      </div>

      <div className="grid lg:grid-cols-[280px_1fr] gap-4">
        <Card className="p-2 max-h-[70vh] overflow-y-auto">
          {reports.length === 0 && <div className="p-4 text-xs text-muted-foreground">No reports yet.</div>}
          {reports.map((r) => (
            <button key={r.id} onClick={() => setSelected(r)}
              className={`w-full text-left p-3 rounded-md text-sm transition-colors ${selected?.id === r.id ? "bg-secondary" : "hover:bg-secondary/50"}`}>
              <div className="flex items-center justify-between">
                <Badge variant="outline" className="text-[10px]">{r.kind}</Badge>
                <span className="text-[10px] text-muted-foreground">{format(new Date(r.created_at), "MMM d")}</span>
              </div>
              <div className="font-medium text-xs mt-1 truncate">{r.title}</div>
            </button>
          ))}
        </Card>
        <Card className="p-6 min-h-[60vh]">
          {selected ? (
            <>
              <div className="flex items-center justify-between mb-4">
                <h2 className="text-lg font-medium">{selected.title}</h2>
                <Button size="sm" variant="outline" onClick={() => download(selected)}><Download className="w-4 h-4 mr-1" />.md</Button>
              </div>
              <div className="prose prose-sm prose-invert max-w-none">
                <ReactMarkdown>{selected.content_md}</ReactMarkdown>
              </div>
            </>
          ) : <div className="text-sm text-muted-foreground">Select a report or generate one.</div>}
        </Card>
      </div>
    </div>
  );
}
