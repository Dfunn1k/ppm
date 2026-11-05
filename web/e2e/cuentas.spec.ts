// Cuentas de punta a punta: el paso 3 con saldos, nuevas cuentas en soles y dólares, plata que
// guardo de otros, y el detalle con su menú (renombrar, corregir saldo, archivar).
import { expect, type Page, test } from "@playwright/test";

const PASSWORD = "pan-para-mayo-2026";

function newEmail() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@prueba.ppm`;
}

async function signup(page: Page) {
  await page.goto("/crear-cuenta");
  await page.getByLabel("¿Cómo te llamamos?").fill("Ana");
  await page.getByLabel("Correo").fill(newEmail());
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL("/bienvenida/1");
}

/** Crea la cuenta y pasa los 3 pasos (Perú, con dólares) sin anotar saldos. */
async function readyUser(page: Page) {
  await signup(page);
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Guardar y empezar" }).click();
  await expect(page).toHaveURL("/inicio");
  await page.goto("/cuentas");
}

async function pickBank(page: Page, bank: string) {
  await page.getByRole("button", { name: /^Banco/ }).click();
  await page.getByRole("radio", { name: new RegExp(`^${bank}`) }).click();
}

test("el paso 3 guarda el efectivo y crea los bancos al empezar", async ({ page }) => {
  await signup(page);
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Lo que hay hoy en Efectivo").fill("320");

  await page.getByRole("link", { name: "Agregar cuenta de banco" }).click();
  await page.getByLabel("Nombre").fill("Cuenta digital BCP");
  await pickBank(page, "BCP");
  await page.getByLabel("¿Cuánto tiene hoy?").fill("8,240.30");
  await page.getByRole("button", { name: "Número y CCI" }).click();
  await page.getByLabel("CCI (opcional, 20 dígitos)").fill("002-191-001234567890-12");
  await page.getByRole("button", { name: "Agregar" }).click();

  await expect(page).toHaveURL("/bienvenida/3");
  await expect(page.getByText("Cuenta digital BCP")).toBeVisible();
  await expect(page.getByLabel("Lo que hay hoy en Efectivo")).toHaveValue("320");   // no se perdió
  await page.getByRole("button", { name: "Guardar y empezar" }).click();

  await expect(page).toHaveURL("/inicio");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("S/ 8,560.30");
  await page.getByRole("link", { name: "Cuentas" }).click();
  await expect(page.getByRole("link", { name: /Efectivo.*S\/ 320\.00/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Cuenta digital BCP.*S\/ 8,240\.30/ })).toBeVisible();
});

test("una cuenta en dólares pide el tipo de cambio y se ve en soles", async ({ page }) => {
  await readyUser(page);
  await page.getByRole("link", { name: "Nueva cuenta" }).click();
  await page.getByRole("link", { name: /Cuenta de banco/ }).click();
  await page.getByLabel("Nombre").fill("Ahorros BBVA");
  await pickBank(page, "BBVA");
  await page.getByRole("radio", { name: /Dólares/ }).click();
  await page.getByLabel("¿Cuánto tiene hoy?").fill("1520");
  await page.getByLabel("Tipo de cambio").fill("3.75");   // el saldo inicial queda en libros a 3.75
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  await expect(page.getByRole("heading", { name: "Ahorros BBVA" })).toBeVisible();
  await expect(page.getByText("US$ 1,520.00")).toBeVisible();
  // En soles cuenta al tipo de hoy; sin ningún tipo cargado, a lo que costó
  const rates = (await (await page.request.get("/api/rates")).json()) as { currency: string; buy: string }[];
  const buy = rates.find((r) => r.currency === "USD")?.buy;
  const soles = buy ? (Math.round(1520 * Number(buy) * 100) / 100).toLocaleString("en-US", { minimumFractionDigits: 2 }) : "5,700.00";
  await page.getByRole("link", { name: "Volver a cuentas" }).click();
  await expect(page.getByText(`son S/ ${soles}`, { exact: false })).toBeVisible();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(`S/ ${soles}`);
});

test("un CCI de otro banco se avisa antes de enviar", async ({ page }) => {
  await readyUser(page);
  await page.goto("/cuentas/nueva/banco");
  await page.getByLabel("Nombre").fill("Cuenta BCP");
  await pickBank(page, "BCP");
  await page.getByRole("button", { name: "Número y CCI" }).click();
  await page.getByLabel("CCI (opcional, 20 dígitos)").fill("01100101234567890123");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByText("Ese CCI no es de BCP: los de BCP empiezan con 002")).toBeVisible();
  await expect(page).toHaveURL("/cuentas/nueva/banco");
});

test("plata que guardo de otros: no suma a lo que realmente tengo", async ({ page }) => {
  await readyUser(page);
  await page.goto("/cuentas/nueva/efectivo");
  await page.getByLabel("Nombre").fill("Billetera");
  await page.getByLabel("¿Cuánto hay hoy?").fill("500");
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page.getByRole("heading", { name: "Billetera" })).toBeVisible();

  await page.goto("/cuentas/nueva");
  await page.getByRole("link", { name: /Plata que guardo de otros/ }).click();
  await page.getByRole("radio", { name: "Nueva persona" }).click();
  await page.getByLabel("¿Cómo se llama?").fill("Sandra Machado");
  await page.getByLabel("¿Cuánto te dio para guardar?").fill("200");
  await page.getByRole("button", { name: "Guardar" }).click();

  await expect(page).toHaveURL("/cuentas");
  await expect(page.getByRole("region", { name: "Guardo de otros" })).toContainText("Sandra Machado");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("S/ 300.00");   // 500 − 200
});

test("el detalle: copiar el CCI, renombrar, corregir el saldo y archivar", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await readyUser(page);
  await page.goto("/cuentas/nueva/banco");
  await page.getByLabel("Nombre").fill("Cuenta sueldo");
  await pickBank(page, "Interbank");
  await page.getByLabel("¿Cuánto tiene hoy?").fill("1000");
  await page.getByRole("button", { name: "Número y CCI" }).click();
  await page.getByLabel("CCI (opcional, 20 dígitos)").fill("00312345678901234567");
  await page.getByRole("button", { name: "Crear cuenta" }).click();

  await expect(page.getByText("003-123-456789012345-67")).toBeVisible();
  await page.getByRole("button", { name: "Copiar cci" }).click();
  await expect(page.getByRole("button", { name: "CCI copiado" })).toBeVisible();
  if (await page.evaluate(() => window.isSecureContext)) {
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe("00312345678901234567");
  }

  await page.getByRole("button", { name: "Más opciones de la cuenta" }).click();
  await page.getByRole("button", { name: "Renombrar" }).click();
  await page.getByLabel("Nombre").fill("Cuenta sueldo Interbank");
  await page.getByRole("button", { name: "Guardar" }).click();
  await expect(page.getByRole("heading", { name: "Cuenta sueldo Interbank" })).toBeVisible();

  // El + de la barra registra con la cuenta que estás mirando
  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await expect(page).toHaveURL(/\/registrar\?cuenta=\d+$/);
  await expect(page.getByRole("button", { name: /^Sale de/ })).toContainText("Cuenta sueldo Interbank");
  await page.goBack();

  // Con saldo no se archiva
  await page.getByRole("button", { name: "Más opciones de la cuenta" }).click();
  await page.getByRole("button", { name: "Archivar cuenta" }).click();
  await expect(page.getByRole("dialog")).toContainText("su saldo tiene que estar en cero");
  await page.getByRole("button", { name: "Cancelar" }).click();

  // Se corrige el saldo inicial a cero, y entonces sí
  await page.getByRole("button", { name: "Más opciones de la cuenta" }).click();
  await page.getByRole("button", { name: "Corregir el saldo inicial" }).click();
  await page.getByRole("textbox", { name: "Saldo inicial", exact: true }).fill("0");
  await page.getByRole("button", { name: "Guardar saldo" }).click();
  await expect(page.getByText("S/ 0.00").first()).toBeVisible();

  await page.getByRole("button", { name: "Más opciones de la cuenta" }).click();
  await page.getByRole("button", { name: "Archivar cuenta" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Archivar cuenta" }).click();
  await expect(page).toHaveURL("/cuentas");
  await expect(page.getByText("Cuenta sueldo Interbank")).toHaveCount(0);
});
