import { useEffect, useState, ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, AlertTriangle, ShieldCheck } from "lucide-react";
import { toast } from "sonner";

type KycStatus = "verified" | "pending" | "failed" | null;

export default function KycGate({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [status, setStatus] = useState<KycStatus>(null);
  const [loading, setLoading] = useState(true);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!user) return;

    // Initial fetch
    supabase
      .from("kyc_verifications")
      .select("status")
      .eq("user_id", user.id)
      .maybeSingle()
      .then(({ data }) => {
        setStatus((data?.status as KycStatus) ?? null);
        setLoading(false);
      });

    // Realtime subscription so UI updates live when webhook fires
    const channel = supabase
      .channel(`kyc:${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "kyc_verifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
          const row = payload.new as any;
          if (row?.status) setStatus(row.status as KycStatus);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  const startVerification = async () => {
    setStarting(true);
    const { data, error } = await supabase.functions.invoke("kyc-start", {
      body: { return_url: window.location.href },
    });
    setStarting(false);
    if (error || data?.error) {
      toast.error(data?.error || error?.message || "Failed to start verification");
      return;
    }
    if (data?.url) window.open(data.url, "_blank");
  };

  if (loading) return null;

  if (status === "verified") return <>{children}</>;

  if (status === "pending") {
    return (
      <Card className="max-w-md mx-auto mt-8">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
          <Clock className="w-10 h-10 text-muted-foreground animate-pulse" />
          <div>
            <p className="font-medium text-base">Verification under review</p>
            <p className="text-sm text-muted-foreground mt-1">Usually 2 minutes. This page will update automatically.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (status === "failed") {
    return (
      <Card className="max-w-md mx-auto mt-8 border-destructive/50">
        <CardContent className="pt-8 pb-8 flex flex-col items-center gap-4 text-center">
          <AlertTriangle className="w-10 h-10 text-destructive" />
          <div>
            <p className="font-medium text-base">Verification failed</p>
            <p className="text-sm text-muted-foreground mt-1">
              Contact{" "}
              <a href="mailto:support@driftworks.app" className="underline">
                support@driftworks.app
              </a>
            </p>
          </div>
        </CardContent>
      </Card>
    );
  }

  // null — not started
  return (
    <Card className="max-w-md mx-auto mt-8">
      <CardHeader className="items-center text-center">
        <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mb-2">
          <ShieldCheck className="w-6 h-6 text-primary" />
        </div>
        <CardTitle>Verify your identity</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col items-center gap-4 text-center pb-8">
        <p className="text-sm text-muted-foreground">
          Required before trading with real credits. Takes ~2 minutes via Stripe Identity.
        </p>
        <Button onClick={startVerification} disabled={starting}>
          {starting ? "Starting…" : "Start verification"}
        </Button>
      </CardContent>
    </Card>
  );
}
