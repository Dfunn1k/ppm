// X4 · Cierre de periodo: cerrar el mes pasado, ver el candado en un movimiento de ese mes y reabrir.
import { expect, type Page, test } from "@playwright/test";

const lima = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
const HOY = lima(0);
const FIN_MES_PASADO = (() => {
  const [y, m] = HOY.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 0)).toISOString().slice(0, 10);
})();

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
}

test("cerrar el mes pasado, el candado en un movimiento y reabrir", async ({ page }) => {
  await readyUser(page);
  const accounts = await (await page.request.get("/api/accounts")).json();
  const cash = accounts.have[0].id as number;
  const groups = (await (await page.request.get("/api/categories?kind=expense")).json()).groups as { children: { id: number; name: string }[] }[];
  const hogar = groups.flatMap((g) => g.children).find((k) => k.name === "Hogar")!.id;
  // El efectivo nació hoy: el gasto del mes pasado va con su propio saldo inicial de ese mes
  await page.request.put(`/api/accounts/${cash}/opening`, { data: { amount: "500", date: lima(-60) } });
  const r = await page.request.post("/api/moves", {
    data: { kind: "expense", account_id: cash, amount: "40", date: FIN_MES_PASADO, ref: "Mercado",
            splits: [{ category_id: hogar, amount: "40" }] },
  });
  expect(r.status()).toBe(201);
  const id = (await r.json()).summary.id as number;

  await page.goto("/mas");
  await page.getByRole("link", { name: /Cierre de periodo/ }).click();
  await expect(page.getByText("Nada cerrado")).toBeVisible();
  await expect(page.getByRole("region", { name: "Antes de cerrar" })).toContainText("Nada por confirmar");
  await page.screenshot({ path: "test-results/cierre-listo.png" });
  await page.getByRole("button", { name: /^Cerrar hasta el/ }).click();
  await expect(page.getByText(/Cerrado hasta el/)).toBeVisible();
  await page.screenshot({ path: "test-results/cierre-cerrado.png" });

  await page.goto(`/movimientos/${id}`);
  await expect(page.getByText(/Periodo cerrado hasta el/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Editar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Borrar movimiento" })).toHaveCount(0);

  await page.goto("/mas/cierre");
  await page.getByRole("button", { name: "Reabrir todo" }).click();
  await expect(page.getByText("Nada cerrado")).toBeVisible();
  await page.goto(`/movimientos/${id}`);
  await expect(page.getByRole("button", { name: "Borrar movimiento" })).toBeVisible();
});

test("con el mes cerrado, las cuotas que faltan de una compra de ese mes se pueden cancelar", async ({ page }) => {
  await readyUser(page);
  const card = await page.request.post("/api/cards", {
    data: { name: "Visa BBVA", closing_day: Number(lima(-3).slice(8)), credit_limit: "5000", brand: "Visa", last4: "4417", to_pay: [] },
  });
  const cardId = (await card.json()).account.id as number;
  const groups = (await (await page.request.get("/api/categories?kind=expense")).json()).groups as { children: { id: number; name: string }[] }[];
  const hogar = groups.flatMap((g) => g.children).find((k) => k.name === "Hogar")!.id;
  const r = await page.request.post("/api/moves", {
    data: { kind: "expense", account_id: cardId, amount: "1200.00", date: lima(-70), ref: "Televisor",
            installments: 6, installment_amount: "215.00", splits: [{ category_id: hogar, amount: "1200.00" }] },
  });
  const id = (await r.json()).summary.id as number;
  expect((await page.request.put("/api/closing", { data: { lock_date: FIN_MES_PASADO } })).status()).toBe(200);

  await page.goto(`/movimientos/${id}`);
  await expect(page.getByText(/Periodo cerrado hasta el/)).toBeVisible();
  await page.getByRole("button", { name: "Cancelar las cuotas que faltan" }).click();
  const hoja = page.getByRole("dialog", { name: "Cancelar las cuotas que faltan" });
  await hoja.getByRole("button", { name: /^Cancelar (la cuota|las \d+ cuotas)$/ }).click();
  await expect(page.getByText(/Lo devolviste el/)).toBeVisible();
});

test("con el mes cerrado, las fechas de los asientos no dejan elegir sus días, y lo dicen", async ({ page }) => {
  await readyUser(page);
  const accounts = await (await page.request.get("/api/accounts")).json();
  const cash = accounts.have[0].id as number;
  await page.request.put(`/api/accounts/${cash}/opening`, { data: { amount: "500", date: lima(-60) } });
  expect((await page.request.put("/api/closing", { data: { lock_date: FIN_MES_PASADO } })).status()).toBe(200);

  // Corregir el saldo inicial, fuera de Registrar
  await page.goto(`/cuentas/${cash}`);
  await page.getByRole("button", { name: "Más opciones de la cuenta" }).click();
  await page.getByRole("button", { name: "Corregir el saldo inicial" }).click();
  await page.getByRole("button", { name: /^Al día/ }).click();
  const hoja = page.getByRole("dialog").last();
  await expect(hoja.getByText(/^Cerrado hasta el .*reábrelo en Más › Cierre de periodo\.$/)).toBeVisible();
  // El calendario abre en el mes del saldo inicial, que ya está cerrado: su día no se puede elegir
  const [, m, d] = lima(-60).split("-").map(Number);
  const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  await expect(hoja.getByRole("grid").getByRole("button", { name: new RegExp(`(^|\\D)${d} de ${MESES[m! - 1]}`) })).toBeDisabled();
});
