import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Sparkles, Loader2 } from "lucide-react";

type Voice = "calm" | "coach" | "quant" | "concise";

const VOICE_PREVIEW: Record<Voice, string> = {
  calm: "“Two minutes to resolution. Position holds at +3.2%. No action needed.”",
  coach: "“Nice — you sized that one well. What signal told you to enter when you did?”",
  quant: "“BTC dist=+1.84σ · band=5% · YES @ 0.62 · edge=11bps · skip.”",
  concise: "“Distortion stretching wide. Hedge with SNAPBACK NO at 0.41. Done.”",
};

const LANGS: { code: string; label: string }[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Español" },
  { code: "fr", label: "Français" },
  { code: "de", label: "Deutsch" },
  { code: "pt", label: "Português" },
];

export default function CaretakerPersonality() {
  const { user } = useAuth();
  const [name, setName] = useState("Caretaker");
  const [voice, setVoice] = useState<Voice>("calm");
  const [lang, setLang] = useState("en");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase
      .from("profiles")
      .select("caretaker_name,caretaker_voice,caretaker_language")
      .eq("id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (data) {
          setName((data as any).caretaker_name || "Caretaker");
          setVoice(((data as any).caretaker_voice || "calm") as Voice);
          setLang((data as any).caretaker_language || "en");
        }
        setLoading(false);
      });
  }, [user]);

  const save = async () => {
    if (!user) return;
    setSaving(true);
    const { error } = await supabase
      .from("profiles")
      .update({
        caretaker_name: name.trim() || "Caretaker",
        caretaker_voice: voice,
        caretaker_language: lang,
      })
      .eq("id", user.id);
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(`Saved — say hi to ${name.trim() || "Caretaker"}`);
  };

  if (loading) return null;

  return (
    <Card className="p-6 space-y-5 border-primary/20">
      <div className="flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-primary" />
        <h3 className="font-medium">Personality</h3>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div>
          <Label className="mb-1 block">Name</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Caretaker" maxLength={32} />
          <p className="text-xs text-muted-foreground mt-1">What you call your AI co-pilot.</p>
        </div>
        <div>
          <Label className="mb-1 block">Language</Label>
          <Select value={lang} onValueChange={setLang}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {LANGS.map((l) => <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>)}
            </SelectContent>
          </Select>
          <p className="text-xs text-muted-foreground mt-1">Replies always come back in this language.</p>
        </div>
      </div>

      <div>
        <Label className="mb-2 block">Voice</Label>
        <div className="grid sm:grid-cols-2 gap-2">
          {(Object.keys(VOICE_PREVIEW) as Voice[]).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVoice(v)}
              className={`text-left p-3 rounded-md border transition-colors ${
                voice === v
                  ? "border-primary bg-primary/10"
                  : "border-border hover:border-primary/40 hover:bg-secondary/40"
              }`}
            >
              <div className="text-xs font-semibold uppercase tracking-wider mb-1 capitalize">{v}</div>
              <div className="text-xs text-muted-foreground italic">{VOICE_PREVIEW[v]}</div>
            </button>
          ))}
        </div>
      </div>

      <Button onClick={save} disabled={saving} className="w-full sm:w-auto">
        {saving ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Saving</> : "Save personality"}
      </Button>
    </Card>
  );
}
