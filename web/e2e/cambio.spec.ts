// Dólares y tipo de cambio de punta a punta: el tipo del día en el formulario, vender dólares con su
// costo del cambio, el Inicio con los dólares al tipo de hoy y Z1 solo para el administrador.
import { expect, type Page, test } from "@playwright/test";

import { pickDate } from "./fechas";

const PASSWORD = "pan-para-mayo-2026";

/** Perú con dólares: Efectivo S/ 500 y BBVA US$ 200 comprados a 3.70 (costaron S/ 740). */
async function readyUser(page: Page, email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@prueba.ppm`) {
  await page.goto("/crear-cuenta");
  await page.getByLabel("¿Cómo te llamamos?").fill("Ana");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("heading", { name: "¿Usas otras monedas?" })).toBeVisible();   // el paso 2 ya se dibujó
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Lo que hay hoy en Efectivo").fill("500");
  await page.getByRole("button", { name: "Guardar y empezar" }).click();
  await expect(page).toHaveURL("/inicio");
  const banks = (await (await page.request.get("/api/catalog")).json()).banks as { id: number; name: string }[];
  const bbva = banks.find((b) => b.name === "BBVA")!.id;
  const r = await page.request.post("/api/accounts/bank", {
    data: { name: "BBVA dólares", currency: "USD", bank_id: bbva, opening: { amount: "200", rate: "3.70" } },
  });
  expect(r.ok()).toBeTruthy();
}

async function chooseAccount(page: Page, label: "Sale de" | "Entra a", name: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  await page.getByRole("radio", { name: new RegExp(`^${name}`) }).click();
}

/** El tipo de compra que la API sugiere hoy, con 3 decimales (o null si no hay ninguno). */
async function todayBuy(page: Page): Promise<string | null> {
  const rates = (await (await page.request.get("/api/rates")).json()) as { currency: string; buy: string }[];
  const usd = rates.find((r) => r.currency === "USD");
  return usd ? Number(usd.buy).toFixed(3) : null;
}

test("vender dólares por debajo de su costo muestra y registra el costo del cambio", async ({ page }) => {
  await readyUser(page);
  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await page.getByRole("radio", { name: "Transferir" }).click();
  await page.getByRole("textbox", { name: "¿Cuánto pasas?" }).fill("100");
  await chooseAccount(page, "Sale de", "BBVA dólares");
  await chooseAccount(page, "Entra a", "Efectivo");
  await page.getByRole("textbox", { name: "Entraron" }).fill("343");

  const antes = page.getByRole("region", { name: "Costo del cambio" });
  await expect(antes).toContainText("− S/ 27.00");
  await expect(antes).toContainText("Esos US$ 100.00 te costaron S/ 370.00 (a 3.700 en promedio) y recibes S/ 343.00.");
  await page.getByRole("button", { name: "Registrar transferencia" }).click();
  await expect(page).toHaveURL("/movimientos");

  await page.getByRole("link", { name: /Transferencia a Efectivo/ }).click();
  await expect(page.getByText("Cambio de moneda")).toBeVisible();
  const detalle = page.getByRole("region", { name: "Costo del cambio" });
  await expect(detalle).toContainText("− S/ 27.00");
  await expect(detalle).toContainText("Te costaron (a 3.700 en promedio)");
  await expect(page.getByText("3.430")).toBeVisible();
});

test("un gasto en dólares trae el tipo del día y dice cuánto es en soles", async ({ page }) => {
  await readyUser(page);
  const buy = await todayBuy(page);
  test.skip(buy === null, "No hay ningún tipo de cambio cargado todavía");
  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await chooseAccount(page, "Sale de", "BBVA dólares");
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("10");
  await expect(page.getByLabel("Tipo de cambio")).toHaveValue(buy!);
  await expect(page.getByText(/de SUNAT .*Cámbialo si tu banco usó otro\./)).toBeVisible();
  await page.getByLabel("Tipo de cambio").fill("3.5");
  await expect(page.getByText("S/ 35.00")).toBeVisible();
});

test("el Inicio cuenta los dólares al último tipo de cambio", async ({ page }) => {
  await readyUser(page);
  const buy = await todayBuy(page);
  test.skip(buy === null, "No hay ningún tipo de cambio cargado todavía");
  await page.reload();
  // Los días en que SUNAT no publica (feriados, fines de semana) se cuenta con el último: «del 14 nov»
  await expect(page.getByText(new RegExp(`dólar a ${buy!.replace(".", "\\.")} (de hoy|del \\d{2} \\S+)`)))
    .toContainText("US$ 200.00 = S/");
});

test("Z1: solo el administrador ve el tipo de cambio y lo carga a mano", async ({ browser }) => {
  // Alguien que no es administrador no lo ve
  const otra = await browser.newPage();
  await readyUser(otra);
  await otra.getByRole("link", { name: "Más" }).click();
  await expect(otra.getByRole("link", { name: /Tipo de cambio/ })).toHaveCount(0);
  await otra.goto("/mas/tipo-de-cambio");
  await expect(otra).toHaveURL("/mas");

  // El de las pruebas está en ADMIN_EMAILS (docker-compose.yml)
  const page = await browser.newPage();
  await readyUser(page, "e2e-admin@prueba.ppm");
  await page.getByRole("link", { name: "Más" }).click();
  await page.getByRole("link", { name: /Tipo de cambio/ }).click();
  await expect(page.getByRole("heading", { name: "Tipo de cambio" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Dólar", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Cargar a mano" }).click();
  const hoja = page.getByRole("dialog");
  await pickDate(page, /^Día/, "2000-12-28");
  await hoja.getByLabel("Compra").fill("3.52");
  await hoja.getByLabel("Venta").fill("3.51");
  await hoja.getByRole("button", { name: "Guardar tipo de cambio" }).click();
  await expect(hoja.getByText("La venta no puede ser menor que la compra", { exact: true })).toBeVisible();
  await hoja.getByLabel("Venta").fill("3.529");
  await hoja.getByRole("button", { name: "Guardar tipo de cambio" }).click();
  await expect(hoja).toBeHidden();

  const r = (await (await page.request.get("/api/rates?date=2000-12-31")).json()) as { currency: string; buy: string }[];
  expect(r.find((x) => x.currency === "USD")?.buy).toBe("3.5200");
});
