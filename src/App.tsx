import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { GlobalInviteListener } from "@/online/GlobalInviteListener";
import { DiagnosticsPanel } from "@/components/DiagnosticsPanel";

import Index from "./pages/Index";
import Ajustes from "./pages/Ajustes";
import Partida from "./pages/Partida";
import OnlineLobby from "./pages/OnlineLobby";
import OnlineNou from "./pages/OnlineNou";
import OnlineUnir from "./pages/OnlineUnir";
import OnlineSala from "./pages/OnlineSala";
import OnlinePartida from "./pages/OnlinePartida";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 5_000 } },
});

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <ErrorBoundary>
          <GlobalInviteListener />
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/ajustes" element={<Ajustes />} />
            <Route path="/partida" element={<Partida />} />
            <Route path="/online/lobby" element={<OnlineLobby />} />
            <Route path="/online/nou" element={<OnlineNou />} />
            <Route path="/online/unir" element={<OnlineUnir />} />
            <Route path="/online/sala/:codi" element={<OnlineSala />} />
            <Route path="/online/partida/:codi" element={<OnlinePartida />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <DiagnosticsPanel />
        </ErrorBoundary>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
