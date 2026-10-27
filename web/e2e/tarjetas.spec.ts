// Tarjetas de punta a punta: el alta con lo que toca pagar y la fecha de pago, un gasto en cuotas,
// pagarla un bolsillo a la vez y las cuotas de antes de PPM.
import { expect, type Page, test } from "@playwright/test";

const lima = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
// El corte de la tarjeta de prueba fue hace 3 días
const CORTE = lima(-3);
const CORTE_DIA = Number(CORTE.slice(8));

/** Una persona lista: Perú con dólares, Efectivo S/ 500 y BCP S/ 1,000. */
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
}

/** Una tarjeta por la API, con lo que toca pagar en soles. Devuelve su id. */
async function card(page: Page, toPay = "0") {
  const r = await page.request.post("/api/cards", {
    data: { name: "Visa BBVA", closing_day: CORTE_DIA, credit_limit: "5000", brand: "Visa", last4: "4417",
            to_pay: [{ currency: "PEN", amount: toPay }] },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).account.id as number;
}

test("crear una tarjeta con lo que toca pagar y escribir después la fecha de pago", async ({ page }) => {
  await readyUser(page);
  await page.goto("/cuentas");
  await page.getByRole("link", { name: "Nueva cuenta" }).click();
  await page.getByRole("link", { name: /Tarjeta de crédito/ }).click();
  await expect(page).toHaveURL("/cuentas/nueva/tarjeta");
  await page.getByRole("button", { name: /^Banco/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "BBVA" }).click();
  await expect(page.getByLabel("Nombre")).toHaveValue("Visa BBVA");
  await page.getByLabel("Últimos 4 (opcional)").fill("4417");
  await page.getByLabel("Día de corte").fill(String(CORTE_DIA));
  await page.getByLabel(/Línea de crédito/).fill("5,000");
  await page.getByRole("textbox", { name: "¿Cuánto toca pagar?" }).fill("1284.90");
  await page.getByRole("button", { name: "Crear tarjeta" }).click();

  await expect(page).toHaveURL(/\/tarjetas\/\d+$/);
  await expect(page.getByRole("heading", { name: "Visa BBVA" })).toBeVisible();
  await expect(page.getByText("S/ 1,284.90").first()).toBeVisible();
  await expect(page.getByText("Falta la fecha de pago.")).toBeVisible();
  await page.getByRole("button", { name: "Escribir fecha de pago" }).click();
  await page.getByLabel("Último día de pago").fill(lima(10));
  await page.getByRole("button", { name: "Guardar fecha" }).click();
  await expect(page.getByText(/A pagar antes del .* faltan 10 días/)).toBeVisible();

  await page.goto("/cuentas");
  await expect(page.getByRole("link", { name: /Visa BBVA/ })).toContainText("Pagar S/ 1,284.90 antes del");
});

test("un gasto con tarjeta en 6 cuotas: cuenta completo y se factura de a poco", async ({ page }) => {
  await readyUser(page);
  const id = await card(page);
  await page.goto(`/registrar?cuenta=${id}`);
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("1200");
  await page.getByRole("button", { name: /En qué/ }).first().click();
  await page.getByRole("dialog").getByRole("radio", { name: "Hogar" }).click();
  await page.getByLabel("Nota").fill("Televisor");
  await page.getByRole("switch", { name: /En cuotas/ }).check();
  await expect(page.getByRole("status")).toContainText("6 cuotas de S/ 200.00");
  await page.getByRole("button", { name: "Registrar gasto en 6 cuotas" }).click();
  await expect(page).toHaveURL("/movimientos");

  await page.goto(`/tarjetas/${id}`);
  const cuota = page.getByRole("region", { name: "Cuotas que faltan" }).getByRole("link", { name: /Televisor/ });
  await expect(cuota).toContainText("S/ 1,200.00");
  await cuota.click();
  await expect(page.getByText("6 cuotas · 0 facturadas")).toBeVisible();
  await expect(page.getByRole("link", { name: "Editar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Borrar la compra y sus cuotas" })).toBeVisible();
});

test("pagar la tarjeta desde el banco deja nada por pagar", async ({ page }) => {
  await readyUser(page);
  const id = await card(page, "300");
  await page.goto(`/tarjetas/${id}`);
  await page.getByRole("link", { name: "Pagar tarjeta" }).click();
  await expect(page.getByRole("textbox", { name: "¿Cuánto pagas?" })).toHaveValue("300.00");
  await page.getByRole("button", { name: "Pagar S/ 300.00" }).click();

  await expect(page).toHaveURL(`/tarjetas/${id}`);
  await expect(page.getByText("Nada por pagar ahora")).toBeVisible();
  await page.goto("/cuentas");
  await expect(page.getByRole("link", { name: /BCP.*S\/ 700\.00/ })).toBeVisible();
});

test("sin dólares, la deuda en dólares lleva a comprarlos primero", async ({ page }) => {
  await readyUser(page);
  const r = await page.request.post("/api/cards", {
    data: { name: "Visa BBVA", closing_day: CORTE_DIA, credit_limit: "5000",
            to_pay: [{ currency: "PEN", amount: "0" }, { currency: "USD", amount: "45", rate: "3.762" }] },
  });
  const id = (await r.json()).account.id as number;
  await page.goto(`/tarjetas/${id}/pagar?moneda=USD`);
  await expect(page.getByRole("alert")).toContainText("No tienes una cuenta en dólares con plata");
  await expect(page.getByRole("link", { name: "Comprar dólares" })).toBeVisible();
});

test("las cuotas de antes de PPM no son gasto y se facturan desde el próximo corte", async ({ page }) => {
  await readyUser(page);
  const id = await card(page);
  await page.goto(`/tarjetas/${id}`);
  await page.getByRole("link", { name: "Cuotas de antes de PPM" }).click();
  await page.getByLabel("¿Qué compraste?").fill("Laptop");
  await page.getByLabel("¿Cuánto es cada cuota?").fill("250");
  await expect(page.getByRole("status")).toContainText("Le debes S/ 1,000.00 al banco por laptop");
  await page.getByRole("button", { name: "Agregar 4 cuotas" }).click();

  await expect(page).toHaveURL(`/tarjetas/${id}`);
  await expect(page.getByRole("region", { name: "Cuotas que faltan" }).getByRole("link", { name: /Laptop/ }))
    .toContainText("De antes de PPM");
  await expect(page.getByText("Nada por pagar ahora")).toBeVisible();
});
