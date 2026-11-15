// X5 · Monedas y formato: agregar una moneda del catálogo, quitarla, ver que la que tiene cuentas no se
// quita y cambiar el formato de números.
import { expect, test } from "@playwright/test";

test("agregar y quitar una moneda, y cambiar el formato", async ({ page }) => {
  await page.goto("/crear-cuenta");
  await page.getByLabel("¿Cómo te llamamos?").fill("Ana");
  await page.getByLabel("Correo").fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@prueba.ppm`);
  await page.getByLabel("Contraseña", { exact: true }).fill("pan-para-mayo-2026");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("heading", { name: "¿Usas otras monedas?" })).toBeVisible();   // el paso 2 ya se dibujó
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Guardar y empezar" }).click();
  await expect(page).toHaveURL("/inicio");

  await page.goto("/mas");
  await expect(page.getByText("Muy pronto")).toHaveCount(0);
  await page.getByRole("link", { name: /Monedas y formato/ }).click();
  await expect(page).toHaveURL("/mas/monedas");
  const principal = page.getByRole("region", { name: "Moneda principal" });
  await expect(principal).toContainText("Sol");
  await expect(principal.getByRole("button")).toHaveCount(0);   // la principal no se quita

  await page.getByRole("button", { name: "Agregar moneda" }).click();
  const hoja = page.getByRole("dialog", { name: "Agregar moneda" });
  await hoja.getByLabel("Buscar moneda").fill("chileno");
  await hoja.getByRole("button", { name: /CLP\s*Peso chileno/ }).click();
  await expect(hoja).toHaveCount(0);
  const otras = page.getByRole("region", { name: "Otras monedas" });
  await expect(otras).toContainText("Peso chileno");
  await expect(otras).toContainText("Sin cuentas todavía");

  // Una cuenta en pesos chilenos: ya no se puede quitar, y se escribe sin decimales
  const r = await page.request.post("/api/accounts/cash", { data: { name: "Pesos", currency: "CLP", opening: { amount: "15000", rate: "0.0036" } } });
  expect(r.status()).toBe(201);
  await page.reload();
  await expect(otras).toContainText("En uso: Pesos");
  await expect(otras.getByRole("button", { name: "Quitar Peso chileno" })).toHaveCount(0);
  await page.goto("/cuentas");
  await expect(page.getByRole("link", { name: /Pesos/ })).toContainText("CLP 15,000");

  await page.goto("/mas/monedas");
  await page.getByRole("button", { name: "Agregar moneda" }).click();
  await page.getByRole("dialog", { name: "Agregar moneda" }).getByLabel("Buscar moneda").fill("EUR");
  await page.getByRole("dialog", { name: "Agregar moneda" }).getByRole("button", { name: /EUR\s*Euro/ }).click();
  await otras.getByRole("button", { name: "Quitar Euro" }).click();
  await expect(otras).not.toContainText("Euro");

  // El formato: España escribe 1.284,90
  await page.getByRole("radio", { name: /España/ }).click();
  await expect(page.getByRole("radio", { name: /España/ })).toHaveAttribute("aria-checked", "true");
  await page.goto("/cuentas");
  await expect(page.getByRole("link", { name: /Pesos/ })).toContainText("CLP 15.000");
});
