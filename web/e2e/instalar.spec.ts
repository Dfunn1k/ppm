// Instalar PPM desde Más: la hoja explica cómo instalarla. En las pruebas el navegador no ofrece su
// instalador (http sin HTTPS), así que se muestran los pasos a mano.
import { expect, test } from "@playwright/test";

test("instalar PPM desde Más", async ({ page }) => {
  await page.goto("/crear-cuenta");
  await page.getByLabel("¿Cómo te llamamos?").fill("Ana");
  await page.getByLabel("Correo").fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@prueba.ppm`);
  await page.getByLabel("Contraseña", { exact: true }).fill("pan-para-mayo-2026");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Lo que hay hoy en Efectivo").fill("500");
  await page.getByRole("button", { name: "Guardar y empezar" }).click();
  await expect(page).toHaveURL("/inicio");

  await page.goto("/mas");
  await page.getByRole("button", { name: /Instalar PPM/ }).click();
  const hoja = page.getByRole("dialog", { name: "Instalar PPM" });
  await expect(hoja).toContainText("Se abre como una app");
  await expect(hoja).toContainText("Abre el menú del navegador");
  await page.screenshot({ path: "test-results/instalar.png" });
  await hoja.getByRole("button", { name: "Entendido" }).click();
  await expect(hoja).toHaveCount(0);
});
