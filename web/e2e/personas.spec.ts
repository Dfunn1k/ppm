// Personas de punta a punta: prestar desde «Más», cobrar sin pasarse, la lista y el detalle de una
// persona, compensar, dividir un gasto con alguien, el gasto que pagó otra persona y el asiento manual.
import { expect, type Page, test } from "@playwright/test";

import { pickDate } from "./fechas";

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

async function chooseAccount(page: Page, label: "Sale de" | "Entra a", name: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  await page.getByRole("radio", { name: new RegExp(`^${name}`) }).click();
}

async function newPerson(page: Page, name: string) {
  await page.getByRole("combobox").last().fill(name);
  await page.getByRole("option", { name: `Nueva persona «${name}»` }).click();
  await expect(page.getByRole("dialog").getByLabel("¿Cómo se llama?")).toHaveValue(name);
  await page.getByRole("button", { name: "Guardar persona" }).click();
}

test("prestar desde Más, cobrar sin pasarse y verlo en Personas", async ({ page }) => {
  await readyUser(page);
  await page.goto("/registrar");
  await page.getByRole("radio", { name: "Más" }).click();
  await page.getByRole("link", { name: /Le presté a alguien/ }).click();
  await expect(page).toHaveURL(/\/registrar\/persona\/lend\?cuenta=\d+$/);   // con la cuenta que ya estaba elegida
  await page.getByRole("textbox", { name: "¿Cuánto le prestaste?" }).fill("59");
  await newPerson(page, "Sandra Machado");
  await chooseAccount(page, "Sale de", "BCP");
  await expect(page.getByText("Sandra te quedará debiendo S/ 59.00")).toBeVisible();
  await page.getByRole("button", { name: "Registrar préstamo" }).click();

  await expect(page.getByRole("heading", { name: "Sandra Machado" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Préstamo a Sandra/ })).toContainText("S/ 59.00");

  await page.getByRole("button", { name: "Registrar que me pagó" }).click();
  await page.getByRole("link", { name: /Me pagó/ }).click();
  await page.getByRole("textbox", { name: "¿Cuánto te pagaron?" }).fill("80");
  await expect(page.getByRole("alert")).toContainText("Sandra te debe S/ 59.00. Escribe hasta S/ 59.00");
  await expect(page.getByRole("button", { name: "Registrar cobro" })).toBeDisabled();
  await page.getByRole("textbox", { name: "¿Cuánto te pagaron?" }).fill("20");
  await chooseAccount(page, "Entra a", "BCP");
  await expect(page.getByText("Sandra te debe: S/ 59.00, Quedará en: S/ 39.00")).toBeVisible();
  await page.getByRole("button", { name: "Registrar cobro" }).click();

  await expect(page.getByRole("link", { name: /Préstamo a Sandra/ })).toContainText("Era: S/ 59.00, Te pagó: S/ 20.00");
  await page.goto("/cuentas");
  await page.getByRole("link", { name: /Me deben.*1 persona/ }).click();
  await expect(page).toHaveURL("/personas?ver=me-deben");
  await expect(page.getByRole("region", { name: "Me deben" }).getByRole("link", { name: /Sandra Machado/ })).toContainText("S/ 39.00");
});

test("un gasto compartido con alguien y uno que pagó otra persona se compensan", async ({ page }) => {
  await readyUser(page);
  // Pagaste tú S/ 100 y Luis pone la mitad
  await page.goto("/registrar");
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("100");
  await chooseAccount(page, "Sale de", "BCP");
  await page.getByRole("button", { name: /En qué/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "Restaurantes y delivery" }).click();
  await page.getByRole("switch", { name: /Compartido/ }).check();
  await expect(page.getByRole("textbox", { name: "¿Cuánto costó en total?" })).toHaveValue("100");
  await page.getByRole("button", { name: "Agregar a alguien" }).click();
  await page.getByRole("button", { name: "Nueva persona" }).click();
  await page.getByRole("dialog").getByLabel("¿Cómo se llama?").fill("Luis Pérez");
  await page.getByRole("button", { name: "Guardar persona" }).click();
  const bloque = page.getByRole("region", { name: "Compartido" });
  await expect(bloque.getByRole("status")).toContainText("S/ 50.00 son gasto tuyo en Restaurantes y delivery; Luis te debe S/ 50.00");
  await page.getByRole("button", { name: "Registrar gasto compartido" }).click();
  await expect(page).toHaveURL("/movimientos");
  await expect(page.getByText("Salió − S/ 50.00")).toBeVisible();      // tu gasto es tu parte

  // Pagó Luis S/ 60, mitad y mitad: le debes S/ 30
  await page.goto("/registrar");
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("60");
  await page.getByRole("button", { name: /En qué/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "Cafés y bares" }).click();
  await page.getByRole("switch", { name: /Compartido/ }).check();
  await page.getByRole("button", { name: "Agregar a alguien" }).click();
  await page.getByRole("dialog").getByRole("combobox").fill("luis");      // sin tilde ni mayúscula
  await page.getByRole("option", { name: /Luis Pérez/ }).click();
  await bloque.getByRole("radio", { name: "Luis" }).click();
  await expect(page.getByRole("button", { name: /^Sale de/ })).toHaveCount(0);   // de tus cuentas no sale nada
  await expect(bloque.getByRole("status")).toContainText("Tu parte, S/ 30.00, es gasto en Cafés y bares y se la debes a Luis");
  await page.getByRole("button", { name: "Registrar lo que le debo" }).click();
  await expect(page).toHaveURL("/movimientos");

  await page.goto("/personas");
  await page.getByRole("link", { name: /Luis Pérez/ }).click();
  await page.getByRole("button", { name: "Compensar" }).click();
  await page.getByRole("button", { name: "Compensar S/ 30.00" }).click();
  await expect(page.getByRole("region", { name: "Te debe" })).toContainText("S/ 20.00");
  await expect(page.getByRole("region", { name: "Le debes" })).toHaveCount(0);
});

test("el asiento manual no deja guardar hasta que cuadre", async ({ page }) => {
  await readyUser(page);
  await page.goto("/registrar/manual");
  const pick = async (name: string) => {
    await page.getByRole("button", { name: /Elige la cuenta/ }).first().click();
    await page.getByRole("dialog").getByRole("radio", { name }).click();
  };
  await pick("BCP");
  await pick("Restaurantes y delivery");
  await page.getByRole("textbox", { name: "Sale de BCP" }).fill("40");
  await page.getByRole("textbox", { name: "Entra a Restaurantes y delivery" }).fill("30");
  await expect(page.getByRole("status")).toContainText("Falta S/ 10.00 en «Entra a» para que cuadre");
  await expect(page.getByRole("button", { name: "Registrar movimiento" })).toBeDisabled();
  await page.getByRole("textbox", { name: "Entra a Restaurantes y delivery" }).fill("40");
  await expect(page.getByText("Cuadra: entran y salen S/ 40.00.")).toBeVisible();
  await page.getByRole("button", { name: "Registrar movimiento" }).click();
  await expect(page).toHaveURL("/movimientos");
});

test("lo que una persona ya me debía antes de PPM queda como deuda abierta con su fecha", async ({ page }) => {
  await readyUser(page);
  const luis = (await (await page.request.post("/api/partners", { data: { name: "Luis Pérez" } })).json()).id;
  await page.goto(`/personas/${luis}`);
  await page.getByRole("link", { name: "De antes de PPM" }).click();
  await expect(page.getByRole("heading", { name: "De antes de PPM" })).toBeVisible();
  await page.getByRole("textbox", { name: "¿Cuánto te debía?" }).fill("300");
  const hace = new Date(Date.now() - 140 * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  await pickDate(page, /¿Desde cuándo\?/, hace);
  await page.getByLabel("Nota").fill("Lo del celular");
  await page.getByRole("button", { name: "Anotar lo que me debía" }).click();

  await expect(page).toHaveURL(`/personas/${luis}`);
  const deuda = page.getByRole("link", { name: /Lo del celular/ });
  await expect(deuda).toContainText(/hace 14\d días/);
  await expect(deuda).toContainText("S/ 300.00");

  // Se corrige con «Editar», en el mismo formulario
  await deuda.click();
  await page.getByRole("link", { name: "Editar" }).click();
  await expect(page.getByText("Editar movimiento")).toBeVisible();
  await expect(page.getByRole("textbox", { name: "¿Cuánto te debía?" })).toHaveValue("300.00");
  await expect(page.getByLabel("Nota")).toHaveValue("Lo del celular");
  await page.getByRole("textbox", { name: "¿Cuánto te debía?" }).fill("250");
  await page.getByLabel("Nota").fill("El celular");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page).toHaveURL(/\/movimientos\/\d+$/);
  await expect(page.getByRole("heading", { name: "El celular" })).toBeVisible();
  await expect(page.getByText("S/ 250.00").first()).toBeVisible();

  await page.goto("/cuentas");
  await expect(page.getByRole("link", { name: /BCP.*S\/ 1,000\.00/ })).toBeVisible();   // tu banco no se movió
});

test("sin deudas todavía, Personas se abre desde Cuentas y el saldo inicial se anota desde «Más»", async ({ page }) => {
  await readyUser(page);
  await page.goto("/cuentas");
  await page.getByRole("link", { name: "Personas", exact: true }).click();
  await expect(page).toHaveURL("/personas");

  await page.goto("/registrar");
  await page.getByRole("radio", { name: "Más" }).click();
  await page.getByRole("link", { name: /De antes de PPM/ }).click();
  await expect(page).toHaveURL("/registrar/saldo-inicial");
  await newPerson(page, "Rosa Díaz");
  await page.getByRole("radio", { name: "Yo le debía" }).click();
  await page.getByRole("textbox", { name: "¿Cuánto le debías?" }).fill("80");
  await page.getByRole("button", { name: "Anotar lo que le debía" }).click();

  await expect(page).toHaveURL(/\/personas\/\d+$/);
  await expect(page.getByText("S/ 80.00").first()).toBeVisible();
  await page.goto("/cuentas");
  await expect(page.getByRole("link", { name: /Debo a personas/ })).toContainText("S/ 80.00");

  // Cada fila abre Personas ya filtrada
  await page.getByRole("link", { name: /Debo a personas/ }).click();
  await expect(page).toHaveURL("/personas?ver=debo");
  await expect(page.getByRole("region", { name: "Les debo" })).toContainText("Rosa Díaz");
  await page.getByRole("button", { name: /^Me deben/ }).click();
  await expect(page.getByRole("region", { name: "Me deben" })).toContainText("Nadie por ahora.");
});

test("cobrar en soles lo que te deben en dólares", async ({ page }) => {
  await readyUser(page);
  const banks = (await (await page.request.get("/api/catalog")).json()).banks as { id: number; name: string }[];
  const bbva = (await (await page.request.post("/api/accounts/bank", {
    data: { name: "BBVA dólares", currency: "USD", bank_id: banks.find((b) => b.name === "BBVA")!.id, opening: { amount: "200", rate: "3.70" } },
  })).json()).account.id as number;
  const paul = (await (await page.request.post("/api/partners", { data: { name: "Paul" } })).json()).id as number;
  const r = await page.request.post("/api/moves", {
    data: { kind: "lend", account_id: bbva, amount: "133.38", rate: "3.50", partner_id: paul, ref: "Vuelos" },
  });
  expect(r.ok()).toBeTruthy();

  await page.goto(`/registrar/persona/collect?persona=${paul}`);
  await page.getByRole("textbox", { name: "¿Cuánto te pagaron?" }).fill("466.90");
  await chooseAccount(page, "Entra a", "BCP");
  const debt = page.getByRole("textbox", { name: "¿Cuánto de la deuda en dólares cancela?" });
  await expect(debt).toBeVisible();
  await debt.fill("133.38");
  await expect(page.getByText("La deuda es en dólares y la plata entra en soles: a 3.501 por US$.")).toBeVisible();
  await expect(page.getByText("Paul te debe: US$ 133.38, Quedará en: US$ 0.00")).toBeVisible();
  await page.getByRole("button", { name: "Registrar cobro" }).click();

  await expect(page).toHaveURL(`/personas/${paul}`);
  await expect(page.getByText("Están a mano: no hay nada pendiente.")).toBeVisible();
  await page.goto("/movimientos");
  await page.getByRole("link", { name: /Paul me pagó/ }).click();
  await expect(page.getByText("Canceló de la deuda")).toBeVisible();
  await expect(page.getByRole("link", { name: /Vuelos/ })).toContainText("US$ 133.38");   // la deuda, en su moneda
  const fx = page.getByRole("region", { name: "Ganancia por tipo de cambio" });
  await expect(fx).toContainText("+ S/ 0.07");
  await expect(fx).toContainText("La deuda valía");
});
