import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import { Waves, LayoutGrid, Plus, Wallet, Bot, LogOut, LogIn, Sparkles, FileText, Target, ShieldCheck, Briefcase, CreditCard, Settings } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { useEffect, useState } from "react";
import CaretakerDock from "@/components/CaretakerDock";
import DemoBadge from "@/components/DemoBadge";
import OnboardingTour from "@/components/OnboardingTour";
import NotificationsBell from "@/components/NotificationsBell";
import ThemeToggle from "@/components/ThemeToggle";
import { BRAND } from "@/lib/brand";

export default function Layout() {
  const { user, loading } = useAuth();
  const nav = useNavigate();
  const [balance, setBalance] = useState<number | null>(null);

  useEffect(() => {
    if (!user) {
      setBalance(null);
      return;
    }
    let mounted = true;
    const load = async () => {
      const { data } = await supabase.from("wallets").select("balance").eq("user_id", user.id).maybeSingle();
      if (mounted) setBalance(data?.balance ? Number(data.balance) : 0);
    };
    load();
    const ch = supabase
      .channel("wallet")
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `user_id=eq.${user.id}` }, load)
      .subscribe();
    return () => {
      mounted = false;
      supabase.removeChannel(ch);
    };
  }, [user]);

  const linkCls = ({ isActive }: { isActive: boolean }) =>
    `flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
      isActive ? "bg-secondary text-foreground" : "text-muted-foreground hover:text-foreground hover:bg-secondary/50"
    }`;

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-border/60 bg-card/30 backdrop-blur-md sticky top-0 z-40">
        <div className="container flex items-center justify-between h-14 gap-4">
          <Link to="/" className="flex items-center gap-2 font-semibold">
            <span className="w-7 h-7 rounded-md bg-gradient-primary shadow-glow flex items-center justify-center">
              <Waves className="w-4 h-4 text-primary-foreground" />
            </span>
            <span className="tracking-tight">Drift<span className="text-primary">works</span></span>
          </Link>

          <nav className="hidden md:flex items-center gap-1">
            <NavLink to="/markets" className={linkCls}><LayoutGrid className="w-4 h-4" />Markets</NavLink>
            <NavLink to="/marketplace" className={linkCls}><LayoutGrid className="w-4 h-4" />Top</NavLink>
            <NavLink to="/markets/new" className={linkCls}><Plus className="w-4 h-4" />Create</NavLink>
            {user && <NavLink to="/markets/mine" className={linkCls}><Briefcase className="w-4 h-4" />My markets</NavLink>}
            <NavLink to="/portfolio" className={linkCls}><Wallet className="w-4 h-4" />Portfolio</NavLink>
            <NavLink to="/bot" className={linkCls}><Bot className="w-4 h-4" />Bot</NavLink>
            <NavLink to="/caretaker" className={linkCls}><Sparkles className="w-4 h-4" />Caretaker</NavLink>
            <NavLink to="/goals" className={linkCls}><Target className="w-4 h-4" />Goals</NavLink>
            <NavLink to="/reports" className={linkCls}><FileText className="w-4 h-4" />Reports</NavLink>
            <NavLink to="/assessment" className={linkCls}><ShieldCheck className="w-4 h-4" />Assessment</NavLink>
            <NavLink to="/leaderboard" className={linkCls}>Leaderboard</NavLink>
            {user && <NavLink to="/billing" className={linkCls}><CreditCard className="w-4 h-4" />Billing</NavLink>}
            {user && <NavLink to="/settings" className={linkCls}><Settings className="w-4 h-4" />Settings</NavLink>}
          </nav>

          <div className="flex items-center gap-3">
            <DemoBadge />
            <ThemeToggle />
            {user && <NotificationsBell />}
            {user && balance !== null && (
              <div className="hidden sm:flex flex-col items-end leading-tight">
                <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Balance</span>
                <span className="font-mono-num text-sm text-primary">${balance.toFixed(2)}</span>
              </div>
            )}
            {loading ? null : user ? (
              <Button variant="ghost" size="sm" onClick={async () => { await supabase.auth.signOut(); nav("/"); }}>
                <LogOut className="w-4 h-4" />
              </Button>
            ) : (
              <Button size="sm" onClick={() => nav("/auth")}><LogIn className="w-4 h-4 mr-1" />Sign in</Button>
            )}
          </div>
        </div>
      </header>

      <main className="flex-1">
        <Outlet />
      </main>

      <footer className="border-t border-border/60 py-6 text-center text-xs text-muted-foreground">
        {BRAND.name} · Paper-trading sandbox tracking real-world data · Real capital after assessment
      </footer>

      <CaretakerDock />
      <OnboardingTour />
    </div>
  );
}
