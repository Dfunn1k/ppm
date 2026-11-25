import { defineConfig } from "@playwright/test";

// Capturas de toda la matriz y auditoría con axe (docs/frontend/PROGRESO.md). No son pruebas:
// no fallan por lo que encuentran, lo anotan en capturas-salida/. Corren en el contenedor «e2e»:
//   docker compose run --rm e2e corepack pnpm capturas
export default defineConfig({
  testDir: "./capturas",
  fullyParallel: true,
  workers: Number(process.env.PPM_WORKERS ?? 4),
  reporter: "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://web:5173",
    locale: "es-PE",
    timezoneId: "America/Lima",
    actionTimeout: 5000,       // una acción que no encuentra su elemento no cuelga la corrida
    navigationTimeout: 30_000,
  },
  projects: [
    { name: "preparar", testMatch: /preparar\.setup\.ts/ },
    { name: "capturas", testMatch: /(capturas|axe)\.spec\.ts/, dependencies: ["preparar"] },
  ],
});
