// Cancelar las cuotas que faltan de una compra en cuotas: «Pagué lo que faltaba» desde el banco,
// deshacerlo y «Lo devolví». Las cuotas ya facturadas no cambian.
import { expect, type Page, test } from "@playwright/test";

const lima = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
const CORTE_DIA = Number(lima(-3).slice(8));

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
  await page.request.post("/api/accounts/bank", {
    data: { name: "BCP", currency: "PEN", bank_id: banks.find((b) => b.name === "BCP")!.id, opening: { amount: "3000" } },
  });
}

/** El televisor: S/ 1,200 en 6 cuotas de S/ 215, comprado hace 70 días con una tarjeta nueva. */
async function televisor(page: Page) {
  const card = await page.request.post("/api/cards", {
    data: { name: "Visa BBVA", closing_day: CORTE_DIA, credit_limit: "5000", brand: "Visa", last4: "4417", to_pay: [] },
  });
  expect(card.status()).toBe(201);
  const cardId = (await card.json()).account.id as number;
  const cats = (await (await page.request.get("/api/categories?kind=expense")).json()).groups
    .flatMap((g: { children: { id: number; name: string }[] }) => g.children);
  const r = await page.request.post("/api/moves", {
    data: { kind: "expense", account_id: cardId, amount: "1200.00", date: lima(-70), ref: "Televisor",
            installments: 6, installment_amount: "215.00",
            splits: [{ category_id: cats.find((c: { name: string }) => c.name === "Hogar").id, amount: "1200.00" }] },
  });
  expect(r.status()).toBe(201);
  const move = await r.json();
  const left = move.plan.lines.filter((x: { billed: boolean }) => !x.billed).length as number;
  return { id: move.summary.id as number, left };
}

test("pagué lo que faltaba desde el BCP, y deshacerlo", async ({ page }) => {
  await readyUser(page);
  const { id, left } = await televisor(page);
  await page.goto(`/movimientos/${id}`);
  await page.getByRole("button", { name: "Cancelar las cuotas que faltan" }).click();
  const hoja = page.getByRole("dialog", { name: "Cancelar las cuotas que faltan" });
  await expect(hoja).toContainText(`faltan ${left} de 6 cuotas`);
  await hoja.getByRole("radio", { name: /Pagué lo que faltaba/ }).check();
  const faltaba = 215 * left;
  await hoja.getByLabel("Lo que te cobró el banco").fill(String(faltaba - 20));
  await expect(hoja).toContainText("Pago de la tarjeta desde BCP");
  await page.screenshot({ path: "test-results/cancelar-hoja.png" });
  await hoja.getByRole("button", { name: "Registrar el pago adelantado" }).click();

  await expect(page.getByText(/Pagaste lo que faltaba el/)).toBeVisible();
  await expect(page.getByText("Te ahorraste S/ 20.00 de interés.", { exact: false })).toBeVisible();
  await expect(page.getByText("Cancelada", { exact: true })).toHaveCount(left);
  await expect(page.getByRole("button", { name: "Cancelar las cuotas que faltan" })).toHaveCount(0);
  await page.screenshot({ path: "test-results/cancelar-hecho.png", fullPage: true });

  await expect(page.getByText("Deshacer también borra el pago de la tarjeta", { exact: false })).toBeVisible();
  await page.getByRole("button", { name: "Deshacer", exact: true }).click();
  await expect(page.getByRole("button", { name: "Cancelar las cuotas que faltan" })).toBeVisible();
  await expect(page.getByText("Cancelada", { exact: true })).toHaveCount(0);
  // El pago al BCP también se deshizo
  const have = (await (await page.request.get("/api/accounts")).json()).have as { name: string; balances: { amount: string }[] }[];
  expect(have.find((a) => a.name === "BCP")!.balances[0]!.amount).toBe("3000.00");
});

test("lo devolví: la tarjeta baja por lo que faltaba", async ({ page }) => {
  await readyUser(page);
  const { id, left } = await televisor(page);
  await page.goto(`/movimientos/${id}`);
  await page.getByRole("button", { name: "Cancelar las cuotas que faltan" }).click();
  const hoja = page.getByRole("dialog", { name: "Cancelar las cuotas que faltan" });
  await expect(hoja).toContainText("Ninguno");
  await hoja.getByRole("button", { name: left === 1 ? "Cancelar la cuota" : `Cancelar las ${left} cuotas` }).click();
  await expect(page.getByText(/Lo devolviste el/)).toBeVisible();
  await expect(page.getByText("No es gasto tuyo.", { exact: false })).toBeVisible();
});
