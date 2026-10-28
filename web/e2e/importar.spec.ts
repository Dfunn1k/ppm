// Importar extracto y Por clasificar de punta a punta: subir el CSV, revisar las columnas que
// propone, ver que el saldo cuadra antes de importar, clasificar uno y varios a la vez, y deshacer.
import { expect, type Page, test } from "@playwright/test";

const lima = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
const ddmm = (offsetDays: number) => lima(offsetDays).split("-").reverse().join("/");

/** Una persona lista: Perú, Efectivo S/ 500 y un banco con S/ 1,000 desde hace un mes. Devuelve el id del banco. */
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
    data: { name: "Interbank", currency: "PEN", bank_id: banks.find((b) => b.name === "Interbank")!.id,
            opening: { amount: "1000", date: lima(-30) } },
  });
  expect(r.status()).toBe(201);
  return (await r.json()).account.id as number;
}

const CSV = [
  "Fecha,Descripción,Monto,N° operación",
  `${ddmm(-2)},POS PLAZA VEA SURCO,-186.40,06771621`,
  `${ddmm(-3)},YAPE A JUAN PER,-50.00,004512`,
  `${ddmm(-4)},PLIN-MARIA LOPEZ,120.00,`,
].join("\n");

async function importCsv(page: Page, bank: number) {
  await page.goto(`/cuentas/${bank}`);
  await page.getByRole("link", { name: "Importar extracto" }).click();
  await expect(page).toHaveURL(`/cuentas/${bank}/importar`);
  await expect(page.getByText("Es tu primer extracto de esta cuenta")).toBeVisible();
  await page.getByLabel("Archivo del extracto").setInputFiles({ name: "interbank-oct.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) });

  await expect(page.getByRole("heading", { name: "¿Qué columna es qué?" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Fecha: columna Fecha. Cambiar" })).toBeVisible();
  await expect(page.getByRole("button", { name: "N.º de operación: columna N° operación. Cambiar" })).toBeVisible();
  await expect(page.getByText("POS PLAZA VEA SURCO")).toBeVisible();
  await page.getByLabel(/Saldo según tu banco/).fill("883.60");
  await page.getByRole("button", { name: "Revisar las 3 filas" }).click();

  await expect(page.getByRole("heading", { name: "Antes de importar" })).toBeVisible();
  await expect(page.getByText("El saldo cuadra")).toBeVisible();
  await page.getByRole("button", { name: "Importar 3 movimientos" }).click();
  await expect(page).toHaveURL(`/por-clasificar?cuenta=${bank}`);
}

test("importar un extracto, clasificar uno y luego dos a la vez", async ({ page }) => {
  const bank = await readyUser(page);
  await importCsv(page, bank);
  await expect(page.getByRole("heading", { name: "Por clasificar" })).toBeVisible();
  await expect(page.getByText("3 movimientos que trajiste del banco")).toBeVisible();

  // Uno: el súper
  const plaza = page.getByRole("listitem").filter({ hasText: "POS PLAZA VEA SURCO" });
  await plaza.getByRole("button", { name: "¿En qué fue?" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByLabel("Buscar categoría").fill("super");
  await sheet.getByRole("radio", { name: "Supermercado y mercado" }).click();
  await sheet.getByRole("button", { name: "Clasificar como Supermercado y mercado" }).click();
  await expect(page.getByText("2 movimientos que trajiste del banco")).toBeVisible();

  // Dos a la vez: a Efectivo, como transferencia
  await page.getByRole("button", { name: "Elegir varios" }).click();
  await page.getByRole("checkbox", { name: "Elegir YAPE A JUAN PER" }).click();
  await page.getByRole("checkbox", { name: "Elegir PLIN-MARIA LOPEZ" }).click();
  await expect(page.getByText("2 elegidos")).toBeVisible();
  await page.getByRole("button", { name: "¿En qué fueron?" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "Mis cuentas" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: /Efectivo/ }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Es una transferencia" }).click();
  await expect(page.getByText("Bandeja vacía")).toBeVisible();

  // La cuenta dice que el saldo cuadra y que no falta nada
  await page.goto(`/cuentas/${bank}`);
  await expect(page.getByText("El saldo cuadra")).toBeVisible();
  await expect(page.getByText("por clasificar de esta cuenta")).toHaveCount(0);
});

test("el Inicio avisa, el detalle dice lo que dijo el banco y deshacer borra lo pendiente", async ({ page }) => {
  const bank = await readyUser(page);
  await importCsv(page, bank);

  await page.goto("/inicio");
  await page.getByRole("link", { name: "3 movimientos del banco por clasificar" }).click();
  await expect(page).toHaveURL("/por-clasificar");

  await page.getByRole("link", { name: "YAPE A JUAN PER" }).click();
  await expect(page.getByText("Falta decir en qué fue")).toBeVisible();
  const bankSays = page.getByRole("region", { name: "Lo que dice el banco" });
  await expect(bankSays).toContainText("004512");
  await bankSays.getByRole("link", { name: /interbank-oct\.csv/ }).click();

  await expect(page.getByRole("heading", { name: "interbank-oct.csv" })).toBeVisible();
  await expect(page.getByText("El saldo cuadra")).toBeVisible();
  await page.getByRole("button", { name: "Deshacer esta importación" }).click();
  await page.getByRole("button", { name: "Borrar 3 y deshacer" }).click();
  await expect(page).toHaveURL(`/cuentas/${bank}`);
  await expect(page.getByText("Trae tus movimientos")).toBeVisible();
  await page.goto("/por-clasificar");
  await expect(page.getByText("Bandeja vacía")).toBeVisible();
});
