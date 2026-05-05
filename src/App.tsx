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
import MarketNew from "./pages/MarketNew";
import MarketsMine from "./pages/MarketsMine";
import MarketDetail from "./pages/MarketDetail";
import Portfolio from "./pages/Portfolio";
import BotPage from "./pages/Bot";
import Caretaker from "./pages/Caretaker";
import Reports from "./pages/Reports";
import Goals from "./pages/Goals";
import Backtest from "./pages/Backtest";
import Assessment from "./pages/Assessment";
import Billing from "./pages/Billing";
import Credits from "./pages/Credits";
import Marketplace from "./pages/Marketplace";
import NotFound from "./pages/NotFound.tsx";
import Leaderboard from "./pages/Leaderboard";
import Admin from "./pages/Admin";
import CreatorProfile from "./pages/CreatorProfile";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
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
              <Route path="*" element={<NotFound />} />
            </Route>
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
