// Presupuesto por sobres, de punta a punta: empezar (qué es, el mes, los sobres de ahorro), repartir,
// la lista del mes con Por asignar, un sobre con sus movimientos, asignar, cubrir un rojo, de dónde sale
// Por asignar, el interruptor de una cuenta, la tarjeta del Inicio y la entrada en Más.
import { expect, type Page, test } from "@playwright/test";

/** Ana con Efectivo S/ 500 y BCP S/ 1,000. Devuelve el id del BCP y sus categorías de gasto. */
async function readyUser(page: Page) {
  await page.goto("/crear-cuenta");
  await page.getByLabel("¿Cómo te llamamos?").fill("Ana");
  await page.getByLabel("Correo").fill(`e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@prueba.ppm`);
  await page.getByLabel("Contraseña", { exact: true }).fill("pan-para-mayo-2026");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("heading", { name: "¿Usas otras monedas?" })).toBeVisible();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Lo que hay hoy en Efectivo").fill("500");
  await page.getByRole("button", { name: "Guardar y empezar" }).click();
  await expect(page).toHaveURL("/inicio");
  const banks = (await (await page.request.get("/api/catalog")).json()).banks as { id: number; name: string }[];
  const r = await page.request.post("/api/accounts/bank", {
    data: { name: "BCP", currency: "PEN", bank_id: banks.find((b) => b.name === "BCP")!.id, opening: { amount: "1000" } },
  });
  const bcp = (await r.json()).account.id as number;
  const cats: Record<string, number> = {};
  for (const g of (await (await page.request.get("/api/categories?kind=expense")).json()).groups) for (const k of g.children) cats[k.name] = k.id;
  return { bcp, cats };
}

test("empezar, repartir, un sobre, asignar, cubrir un rojo y sacar una cuenta", async ({ page }) => {
  const { bcp, cats } = await readyUser(page);
  const spend = (category: string, amount: string) => page.request.post("/api/moves", {
    data: { kind: "expense", account_id: bcp, amount, splits: [{ category_id: cats[category], amount }] },
  });

  // Desde Más
  await page.goto("/mas");
  await page.getByRole("link", { name: /Presupuesto/ }).click();
  await expect(page).toHaveURL("/presupuesto");

  // Paso 1: qué es, la plata para repartir y los sobres de ahorro
  await expect(page.getByRole("heading", { name: "Dale un trabajo a cada sol" })).toBeVisible();
  await expect(page.getByText("S/ 1,500.00")).toBeVisible();
  await page.getByRole("button", { name: "Otro sobre de ahorro" }).click();
  await page.getByLabel("¿Para qué ahorras?").fill("Viaje");
  await page.getByRole("button", { name: "Agregar" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();

  // Paso 2: repartir; Por asignar baja con cada monto
  await expect(page).toHaveURL("/presupuesto/repartir");
  await page.getByLabel("Para Comida y bebida").fill("400");
  await page.getByLabel("Para Transporte").fill("50");
  await page.getByLabel("Para Fondo de emergencia").fill("300");
  await expect(page.getByText("S/ 750.00", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Empezar" }).click();

  // El mes: Por asignar, los sobres de gasto y de ahorro
  await expect(page).toHaveURL("/presupuesto");
  const porAsignar = page.getByRole("region", { name: "Por asignar" });
  await expect(porAsignar).toContainText("S/ 750.00");
  await expect(page.getByRole("link", { name: /Comida y bebida/ })).toContainText("S/ 400.00");
  await expect(page.getByRole("link", { name: /Viaje/ })).toContainText("S/ 0.00");
  await expect(page.getByText("La edad de tu plata")).toBeVisible();

  // Gastar baja el sobre; el sobre muestra el movimiento
  await spend("Supermercado y mercado", "120");
  await spend("Taxi y apps", "80");
  await page.reload();
  await expect(page.getByRole("link", { name: /Comida y bebida/ })).toContainText("Gastaste S/ 120.00 de S/ 400.00");
  const transporte = page.getByRole("link", { name: /Transporte/ });
  await expect(transporte).toContainText("Te pasaste S/ 30.00. Cúbrelo");
  await expect(porAsignar).toContainText("S/ 750.00");                 // gastar no toca Por asignar

  await page.getByRole("link", { name: /Comida y bebida/ }).click();
  await expect(page.getByRole("heading", { name: "Comida y bebida" })).toBeVisible();
  await expect(page.getByText("S/ 280.00").first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Supermercado y mercado/ })).toContainText("− S/ 120.00");
  await expect(page.getByText("Asignado al empezar")).toBeVisible();

  // Asignar más desde Por asignar
  await page.getByRole("button", { name: "Asignar", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Asignar a Comida y bebida" });
  await sheet.getByLabel("Monto").fill("100");
  await expect(sheet).toContainText("Comida y bebida quedará con S/ 380.00.");
  await sheet.getByRole("button", { name: "Asignar", exact: true }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByText("S/ 380.00").first()).toBeVisible();

  // Mover a otro: un sobre no da más de lo que tiene
  await page.getByRole("button", { name: "Mover a otro" }).click();
  const move = page.getByRole("dialog", { name: "Mover de Comida y bebida" });
  await move.getByLabel("Monto").fill("1000");
  await move.getByRole("button", { name: "Mover", exact: true }).click();
  await expect(move).toContainText("Comida y bebida tiene 380.00 disponible");
  await page.keyboard.press("Escape");
  await expect(move).toBeHidden();

  // Cubrir el rojo de Transporte desde Por asignar
  await page.getByRole("link", { name: "Volver al presupuesto" }).click();
  await transporte.click();
  await page.getByRole("button", { name: "Cubrir" }).click();
  const cover = page.getByRole("dialog", { name: "Transporte se pasó S/ 30.00" });
  await cover.getByRole("button", { name: "Cubrir S/ 30.00" }).click();
  await expect(cover).toBeHidden();
  await page.getByRole("link", { name: "Volver al presupuesto" }).click();
  await expect(transporte).toContainText("S/ 0.00");
  await expect(porAsignar).toContainText("S/ 620.00");                  // 750 − 100 − 30

  // De dónde sale Por asignar: la ecuación con los números
  await porAsignar.getByRole("link").click();
  await expect(page.getByRole("heading", { name: "De dónde sale Por asignar" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Tu plata" })).toContainText("S/ 1,300.00");
  await expect(page.getByRole("region", { name: "Lo que ya tiene trabajo" })).toContainText("S/ 620.00");

  // Sacar el BCP del presupuesto desde su ficha
  await page.goto(`/cuentas/${bcp}`);
  await page.getByRole("switch", { name: "BCP en el presupuesto" }).click();
  const out = page.getByRole("dialog", { name: "Sacar del presupuesto" });
  await expect(out).toContainText("Desde hoy");
  await out.getByRole("button", { name: "Sacar del presupuesto" }).click();
  await expect(out).toBeHidden();
  await expect(page.getByRole("switch", { name: "BCP en el presupuesto" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByText(/Lo que pasas aquí sale de Construir patrimonio/)).toBeVisible();

  // La tarjeta del Inicio: sin el BCP hay menos plata que la de los sobres, y se ve en rojo
  await page.goto("/inicio");
  const card = page.getByRole("link", { name: /Presupuesto de/ });
  await expect(card).toContainText("Asignaste de más");
  await expect(card).toContainText("− S/ 380.00");                      // P 500 − sobres 880
  await card.click();
  await expect(page).toHaveURL("/presupuesto");
});

test("la tarjeta del presupuesto se esconde desde Más › Inicio", async ({ page }) => {
  await readyUser(page);
  await page.request.post("/api/budget/start", { data: { month: new Date().toISOString().slice(0, 7), savings: [] } });
  await page.goto("/inicio");
  await expect(page.getByRole("link", { name: /Presupuesto de/ })).toBeVisible();
  await page.goto("/mas/inicio");
  await page.getByRole("switch", { name: "Ver el presupuesto en el Inicio" }).click();
  await page.goto("/inicio");
  await expect(page.getByText("Lo que realmente tengo hoy")).toBeVisible();
  await expect(page.getByRole("link", { name: /Presupuesto de/ })).toHaveCount(0);
});
