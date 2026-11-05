// Un gasto sin saber en qué fue: «Lo clasifico después» lo deja en Por clasificar (y avisa en
// Pendientes) y «Ajuste» es la categoría para lo que nunca se sabrá.
import { expect, type Page, test } from "@playwright/test";

/** Perú, Efectivo S/ 500 y BCP S/ 1,000. Devuelve el id del BCP. */
async function readyUser(page: Page) {
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
  const banks = (await (await page.request.get("/api/catalog")).json()).banks as { id: number; name: string }[];
  const r = await page.request.post("/api/accounts/bank", {
    data: { name: "BCP", currency: "PEN", bank_id: banks.find((b) => b.name === "BCP")!.id, opening: { amount: "1000" } },
  });
  return (await r.json()).account.id as number;
}

test("lo clasifico después: baja la cuenta, no es gasto y queda por clasificar", async ({ page }) => {
  const bcp = await readyUser(page);
  await page.goto(`/registrar?cuenta=${bcp}`);
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("48.90");
  await page.getByRole("button", { name: /En qué/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: /Lo clasifico después/ }).click();
  await expect(page.getByRole("button", { name: /En qué/ })).toContainText("Lo clasifico después");
  await expect(page.getByText("no cuenta como gasto del mes hasta que elijas la categoría")).toBeVisible();
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(page).toHaveURL("/movimientos");
  await expect(page.getByText("Salió − S/ 0.00")).toBeVisible();

  await page.goto("/inicio");
  await page.getByRole("region", { name: "Pendientes" }).getByRole("link", { name: /1 movimiento por clasificar/ }).click();
  await expect(page).toHaveURL("/por-clasificar");
  await expect(page.getByRole("link", { name: /Por clasificar/ }).first()).toBeVisible();
});

test("ajuste es un gasto de la categoría Otras", async ({ page }) => {
  await readyUser(page);
  await page.goto("/registrar");
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("3.50");
  await page.getByRole("button", { name: /En qué/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "Ajuste" }).click();
  await expect(page.getByText("Es gasto desde ya y no vuelve a preguntar")).toBeVisible();
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(page.getByText("Salió − S/ 3.50")).toBeVisible();
});
