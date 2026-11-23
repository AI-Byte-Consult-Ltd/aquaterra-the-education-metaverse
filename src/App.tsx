import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { LanguageProvider } from "@/i18n/LanguageContext";
import { AccountProvider } from "@/game/account/AccountContext";
import RequireAccount from "@/game/account/RequireAccount";
import Index from "./pages/Index";
import City from "./pages/City";
import LandMap from "./pages/LandMap";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
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
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/world" element={<RequireAccount><City /></RequireAccount>} />
            <Route path="/profile" element={<RequireAccount><Profile /></RequireAccount>} />
            <Route path="/city" element={<CityRedirect />} />
            <Route path="/map" element={<LandMap />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
      </AccountProvider>
    </LanguageProvider>
  </QueryClientProvider>
);

export default App;
