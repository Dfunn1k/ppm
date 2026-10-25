/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// La web y la API parecen «la misma casa»: el navegador llama a /api/… y Vite lo reenvía
// a la API sin el prefijo. Así la cookie de sesión funciona sola, sin CORS.
const apiTarget = process.env.API_TARGET ?? "http://localhost:8000";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  server: {
    port: 5173,
    allowedHosts: ["web"], // el nombre del servicio en Docker Compose, para las pruebas de Playwright
    // En Docker sobre WSL los cambios a veces no avisan: WATCH_POLLING=true los revisa cada tanto
    watch: process.env.WATCH_POLLING === "true" ? { usePolling: true, interval: 300 } : undefined,
    proxy: {
      "/api": {
        target: apiTarget,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
