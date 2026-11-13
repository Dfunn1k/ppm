import "./styles.css";
import "./lib/install";   // escucha desde el arranque si el navegador permite instalar PPM

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";

import { App } from "./App";
import { ViewTransitions } from "./lib/transitions";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <ViewTransitions />
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
