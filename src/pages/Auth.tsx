import { useEffect, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { lovable } from "@/integrations/lovable/index";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Activity } from "lucide-react";
import { BRAND } from "@/lib/brand";

export default function Auth() {
  const { user } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) nav(loc.state?.from || "/markets", { replace: true });
  }, [user, nav, loc]);

  const signIn = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
  };

  const signUp = async () => {
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: { emailRedirectTo: window.location.origin + "/markets" },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Account created — you have $10,000 paper capital");
  };

  const google = async () => {
    const r = await lovable.auth.signInWithOAuth("google", { redirect_uri: window.location.origin + "/markets" });
    if (r.error) toast.error("Google sign-in failed");
  };

  return (
    <div className="container max-w-md py-12">
      <div className="text-center mb-8">
        <div className="inline-flex items-center gap-2 mb-4">
          <span className="w-10 h-10 rounded-lg bg-gradient-primary shadow-glow flex items-center justify-center">
            <Activity className="w-5 h-5 text-primary-foreground" />
          </span>
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">Welcome to {BRAND.name}</h1>
        <p className="text-sm text-muted-foreground mt-1">{BRAND.tagline}</p>
      </div>

      <Card className="p-6">
        <Tabs defaultValue="signin">
          <TabsList className="grid grid-cols-2 mb-6">
            <TabsTrigger value="signin">Sign in</TabsTrigger>
            <TabsTrigger value="signup">Create account</TabsTrigger>
          </TabsList>

          <TabsContent value="signin" className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            <Button className="w-full" onClick={signIn} disabled={busy}>Sign in</Button>
          </TabsContent>

          <TabsContent value="signup" className="space-y-4">
            <div className="space-y-2">
              <Label>Email</Label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Password</Label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
            </div>
            <Button className="w-full" onClick={signUp} disabled={busy}>Create account & get $10,000</Button>
          </TabsContent>
        </Tabs>

        <div className="relative my-6">
          <div className="absolute inset-0 flex items-center"><div className="w-full border-t border-border" /></div>
          <div className="relative flex justify-center text-xs"><span className="px-2 bg-card text-muted-foreground">or</span></div>
        </div>

        <Button variant="outline" className="w-full" onClick={google}>Continue with Google</Button>
      </Card>
    </div>
  );
}
