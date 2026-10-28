// Rebanada 8b de punta a punta: la cuota del cronograma con sus intereses, prestar la tarjeta en
// cuotas (cada parte vence con la fecha de pago de su corte) y ponerle fecha a una deuda.
import { expect, type Page, test } from "@playwright/test";

import { pickInOpenCalendar } from "./fechas";

const lima = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
const CORTE_DIA = Number(lima(-3).slice(8));

/** Perú, Efectivo S/ 500, BCP S/ 1,000 y una Visa con corte hace 3 días. Devuelve el id de la Visa. */
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
    data: { name: "BCP", currency: "PEN", bank_id: banks.find((b) => b.name === "BCP")!.id, opening: { amount: "1000" } },
  });
  const r = await page.request.post("/api/cards", {
    data: { name: "Visa BBVA", closing_day: CORTE_DIA, credit_limit: "5000", brand: "Visa", last4: "4417", to_pay: [] },
  });
  return (await r.json()).account.id as number;
}

async function chooseAccount(page: Page, label: string, name: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  await page.getByRole("dialog").getByRole("radio", { name: new RegExp(`^${name}`) }).click();
}

test("un gasto en 6 cuotas de S/ 207: el precio a la categoría y S/ 42 de intereses", async ({ page }) => {
  const visa = await readyUser(page);
  await page.goto(`/registrar?cuenta=${visa}`);
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("1200");
  await page.getByRole("button", { name: /En qué/ }).click();
  await page.getByRole("dialog").getByLabel("Buscar categoría").fill("hogar");
  await page.getByRole("dialog").getByRole("radio", { name: "Hogar" }).click();
  await page.getByRole("switch", { name: /En cuotas/ }).check();
  await page.getByRole("textbox", { name: "¿De cuánto cada una?" }).fill("207");
  await expect(page.getByText("Le deberás S/ 1,242.00 al banco · 6 cuotas de S/ 207.00")).toBeVisible();
  await page.getByRole("button", { name: "Registrar gasto en 6 cuotas" }).click();

  await expect(page).toHaveURL(/\/movimientos/);
  await page.getByRole("link", { name: /Hogar/ }).first().click();
  await expect(page.getByText("Intereses")).toBeVisible();
  await expect(page.getByText("6 cuotas · 0 facturadas")).toBeVisible();
});

test("prestarle la tarjeta a Luis en cuotas y poner la fecha de pago del corte", async ({ page }) => {
  const visa = await readyUser(page);
  const luis = (await (await page.request.post("/api/partners", { data: { name: "Luis Pérez" } })).json()).id;
  await page.goto(`/registrar/persona/lend?persona=${luis}`);
  await page.getByRole("textbox", { name: "¿Cuánto le prestaste?" }).fill("1200");
  await chooseAccount(page, "Sale de", "Visa BBVA");
  await page.getByRole("switch", { name: /En cuotas/ }).check();
  await page.getByRole("button", { name: "Una cuota menos" }).click();
  await page.getByRole("button", { name: "Una cuota menos" }).click();
  await page.getByRole("button", { name: "Una cuota menos" }).click();       // 3 cuotas
  await page.getByRole("textbox", { name: "¿De cuánto cada una?" }).fill("410");
  await expect(page.getByText("Luis te deberá S/ 1,230.00 · 3 cuotas de S/ 410.00")).toBeVisible();
  await page.getByRole("button", { name: "Registrar préstamo en 3 cuotas" }).click();

  await expect(page).toHaveURL(`/personas/${luis}`);
  await expect(page.getByText("3 partes")).toBeVisible();
  const primera = page.getByRole("button", { name: /^Parte 1 de 3/ });
  await expect(primera).toContainText("Vence con el pago del corte del");

  // La fecha de pago de ese ciclo, escrita en la tarjeta, la toma la parte 1
  const corte = (await (await page.request.get(`/api/partners/${luis}`)).json()).owes_me[0].maturity_closing as string;
  const pago = new Date(Date.parse(corte) + 15 * 86_400_000).toISOString().slice(0, 10);
  expect((await page.request.put(`/api/cards/${visa}/due-date`, { data: { closing_date: corte, date_due: pago } })).status()).toBe(200);
  await page.reload();
  await expect(page.getByRole("button", { name: /^Parte 1 de 3/ })).toContainText("Vence el");
});

test("ponerle fecha de vencimiento a un préstamo y verla vencida", async ({ page }) => {
  await readyUser(page);
  const luis = (await (await page.request.post("/api/partners", { data: { name: "Luis Pérez" } })).json()).id;
  await page.goto(`/registrar/persona/lend?persona=${luis}`);
  await page.getByRole("textbox", { name: "¿Cuánto le prestaste?" }).fill("50");
  await chooseAccount(page, "Sale de", "BCP");
  await page.getByLabel("Nota").fill("Para el pasaje");
  await page.getByRole("button", { name: "Registrar préstamo" }).click();

  // Sin vencimiento la ficha no muestra nada: la fecha se pone desde el detalle del movimiento
  await expect(page).toHaveURL(`/personas/${luis}`);
  await expect(page.getByText("Sin fecha de vencimiento")).toHaveCount(0);
  await page.getByRole("link", { name: /Para el pasaje/ }).click();
  await page.getByRole("button", { name: /Sin fecha de vencimiento/ }).click();
  await expect(page.getByRole("dialog", { name: "¿Hasta cuándo te paga Luis?" })).toBeVisible();
  await pickInOpenCalendar(page, lima(-3));
  await page.goto(`/personas/${luis}`);
  await expect(page.getByText(/Vencida hace 3 días/)).toBeVisible();
  await expect(page.getByText("S/ 50.00 vencidos")).toBeVisible();

  await page.getByRole("button", { name: /Vencida hace 3 días/ }).click();
  await page.getByRole("button", { name: "Quitar la fecha" }).click();
  await expect(page.getByText(/Vencida/)).toHaveCount(0);
});
