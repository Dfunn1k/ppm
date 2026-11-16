// Exportar mis datos: desde Mi cuenta (y desde Eliminar), con o sin adjuntos; se descarga un ZIP.
import { readFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

const PASSWORD = "pan-para-mayo-2026";

async function newUser(page: Page) {
  await page.goto("/crear-cuenta");
  await page.getByLabel("¿Cómo te llamamos?").fill("Dany");
  await page.getByLabel("Correo").fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@prueba.ppm`);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("heading", { name: "¿Usas otras monedas?" })).toBeVisible();   // el paso 2 ya se dibujó
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Lo que hay hoy en Efectivo").fill("500");
  await page.getByRole("button", { name: "Guardar y empezar" }).click();
  await expect(page).toHaveURL("/inicio");
}

test("exportar los datos desde Mi cuenta, con y sin adjuntos", async ({ page }) => {
  await newUser(page);
  await page.goto("/mas/cuenta");
  await page.getByRole("link", { name: /Exportar mis datos/ }).click();
  await expect(page).toHaveURL("/mas/cuenta/exportar");
  await expect(page.getByRole("heading", { name: "Exportar tus datos" })).toBeVisible();
  const inside = page.getByRole("list", { name: "Qué trae el ZIP" });
  await expect(inside).toContainText("datos.json");
  await expect(inside).toContainText("csv/");
  await expect(page.getByRole("definition").first()).toHaveText("1");          // la cuenta Efectivo

  const switchFiles = page.getByRole("switch", { name: /Incluir adjuntos/ });
  await expect(switchFiles).toBeChecked();
  await switchFiles.click();
  await expect(inside).toContainText("No va: solo sus nombres en datos.json");

  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: /Descargar ZIP/ }).click();
  const file = await download;
  expect(file.suggestedFilename()).toMatch(/^ppm-\d{4}-\d{2}-\d{2}\.zip$/);
  expect(readFileSync(await file.path()).subarray(0, 2).toString()).toBe("PK");   // un ZIP de verdad
  await expect(page.getByRole("status")).toContainText("Listo.");
  await expect(page.getByRole("status")).toContainText(file.suggestedFilename());

  // Desde Eliminar, antes de firmar
  await page.goto("/mas/cuenta/eliminar");
  await page.getByRole("link", { name: /¿Te llevas tus datos\?/ }).click();
  await expect(page).toHaveURL("/mas/cuenta/exportar");
});
