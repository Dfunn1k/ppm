// Tarjetas de punta a punta: el alta con lo que toca pagar y la fecha de pago, un gasto en cuotas,
// pagarla un bolsillo a la vez y las cuotas de antes de PPM.
import { readFileSync } from "node:fs";

import { expect, type Page, test } from "@playwright/test";

import { pickDate } from "./fechas";

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
  await expect(page.getByRole("heading", { name: "¿Usas otras monedas?" })).toBeVisible();   // el paso 2 ya se dibujó
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
  await pickDate(page, /Último día de pago/, lima(10));
  await page.getByRole("button", { name: "Guardar fecha" }).click();
  await expect(page.getByText(/A pagar antes del .* faltan 10 días/)).toBeVisible();

  await page.goto("/cuentas");
  await expect(page.getByRole("link", { name: /Visa BBVA/ })).toContainText("Pagar S/ 1,284.90 antes del");
});

test("un gasto con tarjeta en 6 cuotas: cada cuota se factura en su corte", async ({ page }) => {
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
  const cuota = page.getByRole("region", { name: "Cuotas por venir" }).getByRole("link", { name: /Televisor/ });
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
  await page.getByLabel("¿Cuánto es el capital de cada cuota?").fill("250");
  await expect(page.getByRole("status")).toContainText("Le debes S/ 1,000.00 al banco por laptop");
  await page.getByRole("button", { name: "Agregar 4 cuotas" }).click();

  await expect(page).toHaveURL(`/tarjetas/${id}`);
  await expect(page.getByRole("region", { name: "Cuotas por venir" }).getByRole("link", { name: /Laptop/ }))
    .toContainText("De antes de PPM");
  await expect(page.getByText("Nada por pagar ahora")).toBeVisible();
});

test("el desgravamen de cada corte nace por confirmar y avisa en el Inicio", async ({ page }) => {
  await readyUser(page);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  const r = await page.request.post("/api/cards", {
    data: { name: "Visa Qore", closing_day: Number(today.slice(8, 10)), credit_limit: "6000", brand: "Visa" },
  });
  const card = (await r.json()).account.id as number;
  await page.goto(`/tarjetas/${card}`);
  await page.getByRole("button", { name: "Agregar cargo del banco" }).click();
  await page.getByLabel("¿Cuánto fue el último?").fill("2.41");
  await page.getByRole("button", { name: "Agregar cargo", exact: true }).click();

  const cargos = page.getByRole("region", { name: "Cargos del banco" });
  await expect(cargos).toContainText("Seguro de desgravamen");
  await expect(cargos).toContainText("1 por confirmar");
  await expect(page.getByText("Por confirmar", { exact: true })).toBeVisible();     // en el ciclo, distinto

  await page.goto("/inicio");
  const pending = page.getByRole("region", { name: "Pendientes" });
  await expect(pending).toContainText("es un cargo del banco");
  await pending.getByRole("link", { name: /1 movimiento por confirmar/ }).click();
  await expect(page).toHaveURL(/\/movimientos\/\d+$/);
});

test("importar el PDF del estado de cuenta: la foto del banco y la cuota en capital e interés", async ({ page }) => {
  await readyUser(page);
  const r = await page.request.post("/api/cards", {
    data: { name: "Visa Qore", closing_day: 25, credit_limit: "7010.91", brand: "Visa", last4: "1111" },
  });
  const card = (await r.json()).account.id as number;
  const groups = (await (await page.request.get("/api/categories?kind=expense")).json()).groups as { children: { id: number; name: string }[] }[];
  const hogar = groups.flatMap((g) => g.children).find((k) => k.name === "Hogar")!.id;
  await page.request.post("/api/moves", {
    data: { kind: "expense", account_id: card, amount: "693.00", date: "2026-10-14", ref: "Unipiel", installments: 3,
            installment_amount: "262.02", splits: [{ category_id: hogar, amount: "693.00" }] },
  });
  // El PDF: el texto anonimizado del estado de cuenta, impreso por el navegador en letra de ancho fijo
  const text = readFileSync(new URL("./fixtures/bcp_visa_2026-10.txt", import.meta.url), "utf8");
  const printer = await page.context().newPage();
  await printer.setContent(`<pre style="font: 7px/9px monospace; margin: 0">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`);
  const pdf = await printer.pdf({ format: "A4", landscape: true });
  await printer.close();

  await page.goto(`/tarjetas/${card}`);
  await expect(page.getByText("Estimada")).toBeVisible();
  await page.getByLabel("PDF del estado de cuenta").setInputFiles({ name: "EECC_VISA.pdf", mimeType: "application/pdf", buffer: pdf });
  await expect(page.getByRole("heading", { name: "Estado de cuenta" })).toBeVisible();
  await expect(page.getByText("Ciclo del 28 set al 25 oct", { exact: false })).toBeVisible();
  const foto = page.getByRole("region", { name: "Foto del corte" });
  await expect(foto).toContainText("S/ 5,283.53");
  await expect(foto).toContainText("S/ 1,716.47");
  await expect(page.getByRole("region", { name: "Detalle plan cuotas" })).toContainText("Capital S/ 221.43 + interés S/ 40.59");

  await page.goto(`/tarjetas/${card}`);
  await expect(page.getByText("S/ 5,283.53")).toBeVisible();
  await page.getByRole("button", { name: "Ciclo anterior" }).click();     // se ve un ciclo a la vez: el del estado es el que cerró
  await expect(page.getByRole("link", { name: "Ver su estado de cuenta" })).toBeVisible();
});
