import { defineConfig, devices } from "@playwright/test";

// Recorridos de punta a punta contra la API de verdad. Corren en el contenedor «e2e» de
// Docker Compose:  docker compose run --rm e2e
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: process.env.BASE_URL ?? "http://web:5173",
    locale: "es-PE",
    timezoneId: "America/Lima",
    trace: "retain-on-failure",
  },
  projects: [{ name: "celular", use: { ...devices["Pixel 7"] } }],
});
