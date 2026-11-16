// Repartir en el tiempo: un seguro pagado por adelantado cuenta como gasto mes a mes; cancelar lo que
// falta con lo que te devolvieron, y deshacerlo.
import { expect, type Page, test } from "@playwright/test";

async function newUser(page: Page) {
  await page.goto("/crear-cuenta");
  await page.getByLabel("¿Cómo te llamamos?").fill("Ana");
  await page.getByLabel("Correo").fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@prueba.ppm`);
  await page.getByLabel("Contraseña", { exact: true }).fill("pan-para-mayo-2026");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("heading", { name: "¿Usas otras monedas?" })).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Lo que hay hoy en Efectivo").fill("2000");
  await page.getByRole("button", { name: "Guardar y empezar" }).click();
  await expect(page).toHaveURL("/inicio");
}

test("un seguro repartido en 12 meses: la parte del mes, cancelar lo que falta y deshacer", async ({ page }) => {
  await newUser(page);
  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("1200");
  await page.getByRole("button", { name: /En qué/ }).first().click();
  await page.getByRole("dialog").getByLabel("Buscar categoría").fill("Seguro vehicular");
  await page.getByRole("dialog").getByRole("radio", { name: "Seguro vehicular" }).click();
  await page.getByLabel("Nota").fill("SOAT");

  await page.getByRole("switch", { name: /Repartir en el tiempo/ }).click();
  const reparto = page.getByRole("region", { name: "Así se reparte" });
  await expect(reparto).toContainText("partes");                        // por días: un año desde hoy
  await page.getByRole("radio", { name: "Por meses" }).click();
  await expect(reparto).toContainText("12 partes iguales");
  await expect(reparto).toContainText("S/ 100.00");
  await expect(reparto).toContainText("… y 9 más");
  await page.getByRole("button", { name: "Registrar gasto" }).click();

  // En el mes: la parte de hoy es el gasto; el pago, de Efectivo a «Pagos por adelantado»
  await expect(page).toHaveURL("/movimientos");
  await page.getByRole("link", { name: /SOAT · parte 1\/12/ }).click();
  await expect(page.getByText("Parte 1 de 12 de «SOAT»")).toBeVisible();
  await expect(page.getByRole("button", { name: /Editar|Borrar/ })).toHaveCount(0);
  await page.getByRole("link", { name: /Parte 1 de 12/ }).click();

  await expect(page.getByText("Gasto repartido")).toBeVisible();
  await expect(page.getByText("Por meses: 12 partes de S/ 100.00")).toBeVisible();
  const partes = page.getByRole("region", { name: "Partes" });
  await expect(partes).toContainText("12 partes · 1 contó");
  await expect(partes).toContainText("Faltan S/ 1,100.00");

  await page.getByRole("button", { name: "Cancelar lo que falta" }).click();
  const hoja = page.getByRole("dialog");
  await hoja.getByLabel("¿Cuánto te devolvieron?").fill("600");
  await expect(hoja.getByRole("region", { name: "Qué pasa al cancelar" })).toContainText("S/ 500.00 que no te devolvieron cuentan como gasto");
  await hoja.getByRole("button", { name: "Cancelar las 11 partes" }).click();
  await expect(partes).toContainText("11 canceladas");
  await expect(partes).toContainText("Te devolvieron S/ 600.00 a Efectivo y S/ 500.00 contaron como gasto");

  await partes.getByRole("button", { name: "Deshacer" }).click();
  await expect(partes).toContainText("Faltan S/ 1,100.00");
  await expect(page.getByRole("button", { name: "Cancelar lo que falta" })).toBeVisible();
});

test("cancelar con lo devuelto en dólares: el tipo de cambio y la diferencia del cambio", async ({ page }) => {
  await newUser(page);
  const banks = (await (await page.request.get("/api/catalog")).json()).banks as { id: number; name: string }[];
  const usd = (await (await page.request.post("/api/accounts/bank", {
    data: { name: "BBVA dólares", currency: "USD", bank_id: banks.find((b) => b.name === "BBVA")!.id, opening: { amount: "500", rate: "3.70" } },
  })).json()).account.id as number;
  const cats: Record<string, number> = {};
  for (const g of (await (await page.request.get("/api/categories?kind=expense")).json()).groups) for (const k of g.children) cats[k.name] = k.id;
  const d = await (await page.request.post("/api/moves", { data: {
    kind: "expense", account_id: usd, amount: "300", rate: "3.70", ref: "Seguro de viaje",
    splits: [{ category_id: cats["Seguro vehicular"], amount: "300" }], deferral: { method: "months", months: 12 } } })).json();
  await page.goto(`/movimientos/${d.summary.id}`);

  await page.getByRole("button", { name: "Cancelar lo que falta" }).click();
  const hoja = page.getByRole("dialog");
  await hoja.getByRole("button", { name: /^Entra a/ }).click();
  await page.getByRole("radio", { name: /^BBVA dólares/ }).click();
  await hoja.getByLabel("¿Cuánto te devolvieron?").fill("275");
  await hoja.getByLabel("Tipo de cambio").fill("3.80");
  await expect(hoja.getByText("S/ 1,045.00", { exact: true })).toBeVisible();
  await expect(hoja.getByRole("region", { name: "Qué pasa al cancelar" })).toContainText("US$ 275.00 (S/ 1,045.00) entran a BBVA dólares");
  await hoja.getByRole("button", { name: "Cancelar las 11 partes" }).click();
  // US$ 275 valían S/ 1,017.50 al tipo de entonces: S/ 27.50 de ganancia
  await expect(page.getByRole("region", { name: "Partes" })).toContainText("Te devolvieron US$ 275.00 (S/ 1,045.00) a BBVA dólares. El cambio te dejó S/ 27.50 de ganancia.");
});
