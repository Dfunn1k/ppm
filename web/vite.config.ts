/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

import { defineConfig, type Plugin } from "vite";

import { iconFontUrl } from "./src/lib/iconFontUrl";

// La web y la API parecen «la misma casa»: el navegador llama a /api/… y Vite lo reenvía
// a la API sin el prefijo. Así la cookie de sesión funciona sola, sin CORS.
const apiTarget = process.env.API_TARGET ?? "http://localhost:8000";

// La fuente de íconos a la medida: solo los que usa la interfaz (src/data/ui-icons.json)
function iconFont(): Plugin {
  const icons = JSON.parse(readFileSync(new URL("./src/data/ui-icons.json", import.meta.url), "utf8")) as string[];
  return { name: "ppm-icon-font", transformIndexHtml: (html) => html.replace("%PPM_ICON_FONT%", iconFontUrl(icons)) };
}

// La versión de PPM (una sola para todo, decisión «Versiones de PPM»): la de package.json, al pie de Más
const version = (JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")) as { version: string }).version;

export default defineConfig({
  plugins: [react(), tailwindcss(), iconFont()],
  define: { __PPM_VERSION__: JSON.stringify(version) },
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
