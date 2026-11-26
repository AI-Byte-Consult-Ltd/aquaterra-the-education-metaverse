import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { LanguageProvider } from "@/i18n/LanguageContext";
import { AccountProvider } from "@/game/account/AccountContext";
import RequireAccount from "@/game/account/RequireAccount";
import { EconomyProvider } from "@/game/economy/EconomyContext";
import Index from "./pages/Index";
import City from "./pages/City";
import LandMap from "./pages/LandMap";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import Admin from "./pages/Admin";
import Wallet from "./pages/Wallet";
import StateHome from "./pages/state/StateHome";
import ChamberPage from "./pages/state/ChamberPage";
import ProposalPage from "./pages/state/ProposalPage";
import ProposePage from "./pages/state/ProposePage";
import { DistrictsPage, JournalPage, LawsPage } from "./pages/state/RecordsPages";
import ArcadeHome from "./pages/arcade/ArcadeHome";
import PlayPage from "./pages/arcade/PlayPage";
import SetupPage from "./pages/arcade/SetupPage";
import { CharterPage } from "./pages/state/CharterPage";
import Roads from "./pages/Roads";
import Heritage from "./pages/Heritage";
import Rainbowland from "./pages/Rainbowland";
import Quests from "./pages/Quests";
import Rich from "./pages/Rich";
import Bank from "./pages/Bank";
import Terms from "./pages/Terms";
import NotFound from "./pages/NotFound";

/** Old /city links (plot and address search params) open the world. */
const CityRedirect = () => {
  const { search } = useLocation();
  return <Navigate to={`/world${search}`} replace />;
};

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <LanguageProvider>
      <AccountProvider>
      <EconomyProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/world" element={<RequireAccount><City /></RequireAccount>} />
            <Route path="/profile" element={<RequireAccount><Profile /></RequireAccount>} />
            <Route path="/wallet" element={<RequireAccount><Wallet /></RequireAccount>} />
            <Route path="/council" element={<Navigate to="/state/council" replace />} />
            <Route path="/state" element={<StateHome />} />
            <Route path="/state/new" element={<RequireAccount><ProposePage /></RequireAccount>} />
            <Route path="/state/laws" element={<LawsPage />} />
            <Route path="/state/charter" element={<CharterPage />} />
            <Route path="/bank" element={<Bank />} />
            <Route path="/roads" element={<Roads />} />
            <Route path="/heritage" element={<RequireAccount><Heritage /></RequireAccount>} />
            <Route path="/rainbowland" element={<Rainbowland />} />
            <Route path="/quests" element={<Quests />} />
            <Route path="/rich" element={<Rich />} />
            <Route path="/state/journal" element={<JournalPage />} />
            <Route path="/state/districts" element={<DistrictsPage />} />
            <Route path="/state/p/:id" element={<ProposalPage />} />
            <Route path="/state/:chamber" element={<ChamberPage />} />
            <Route path="/arcade" element={<ArcadeHome />} />
            <Route path="/arcade/play/:plotId" element={<RequireAccount><PlayPage /></RequireAccount>} />
            <Route path="/arcade/setup/:plotId" element={<RequireAccount><SetupPage /></RequireAccount>} />
            <Route path="/admin" element={<RequireAccount><Admin /></RequireAccount>} />
            <Route path="/city" element={<CityRedirect />} />
            <Route path="/map" element={<LandMap />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
      </EconomyProvider>
      </AccountProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
