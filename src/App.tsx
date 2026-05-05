import { lazy, Suspense } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";
import Layout from "@/components/Layout";
import RequireAuth from "@/components/RequireAuth";
import Landing from "./pages/Landing";
import Auth from "./pages/Auth";
import Markets from "./pages/Markets";
import MarketDetail from "./pages/MarketDetail";
import Marketplace from "./pages/Marketplace";
import Leaderboard from "./pages/Leaderboard";
import CreatorProfile from "./pages/CreatorProfile";
import NotFound from "./pages/NotFound.tsx";

// Heavy pages — lazy loaded to keep initial bundle small
const MarketNew = lazy(() => import("./pages/MarketNew"));
const MarketsMine = lazy(() => import("./pages/MarketsMine"));
const Portfolio = lazy(() => import("./pages/Portfolio"));
const BotPage = lazy(() => import("./pages/Bot"));
const Caretaker = lazy(() => import("./pages/Caretaker"));
const Reports = lazy(() => import("./pages/Reports"));
const Goals = lazy(() => import("./pages/Goals"));
const Backtest = lazy(() => import("./pages/Backtest"));
const Assessment = lazy(() => import("./pages/Assessment"));
const Billing = lazy(() => import("./pages/Billing"));
const Credits = lazy(() => import("./pages/Credits"));
const Admin = lazy(() => import("./pages/Admin"));
const Settings = lazy(() => import("./pages/Settings"));

const Spinner = () => (
  <div className="flex items-center justify-center min-h-screen">
    <div className="animate-spin w-6 h-6 border-2 border-primary border-t-transparent rounded-full" />
  </div>
);

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Suspense fallback={<Spinner />}>
            <Routes>
              <Route element={<Layout />}>
                <Route path="/" element={<Landing />} />
                <Route path="/auth" element={<Auth />} />
                <Route path="/markets" element={<Markets />} />
                <Route path="/marketplace" element={<Marketplace />} />
                <Route path="/markets/new" element={<RequireAuth><MarketNew /></RequireAuth>} />
                <Route path="/markets/mine" element={<RequireAuth><MarketsMine /></RequireAuth>} />
                <Route path="/markets/:id" element={<MarketDetail />} />
                <Route path="/portfolio" element={<RequireAuth><Portfolio /></RequireAuth>} />
                <Route path="/bot" element={<RequireAuth><BotPage /></RequireAuth>} />
                <Route path="/caretaker" element={<RequireAuth><Caretaker /></RequireAuth>} />
                <Route path="/reports" element={<RequireAuth><Reports /></RequireAuth>} />
                <Route path="/goals" element={<RequireAuth><Goals /></RequireAuth>} />
                <Route path="/backtest" element={<RequireAuth><Backtest /></RequireAuth>} />
                <Route path="/assessment" element={<RequireAuth><Assessment /></RequireAuth>} />
                <Route path="/billing" element={<RequireAuth><Billing /></RequireAuth>} />
                <Route path="/credits" element={<RequireAuth><Credits /></RequireAuth>} />
                <Route path="/leaderboard" element={<Leaderboard />} />
                <Route path="/admin" element={<RequireAuth><Admin /></RequireAuth>} />
                <Route path="/creators/:creatorId" element={<CreatorProfile />} />
                <Route path="/settings" element={<RequireAuth><Settings /></RequireAuth>} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
