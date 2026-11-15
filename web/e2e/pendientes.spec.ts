// Pendientes de punta a punta: la bandeja por urgencia, posponer un aviso, tus recordatorios (en la
// bandeja y en el detalle de una persona), el resumen del Inicio y con cuántos días avisar.
import { expect, type Page, test } from "@playwright/test";

const lima = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Lima" });

/** Perú, Efectivo S/ 500 y BCP S/ 1,000. Devuelve el id del BCP. */
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
  const r = await page.request.post("/api/accounts/bank", {
    data: { name: "BCP", currency: "PEN", bank_id: banks.find((b) => b.name === "BCP")!.id, opening: { amount: "1000" } },
  });
  return (await r.json()).account.id as number;
}

/** Le prestaste a Luis desde el BCP y vence en `days` días. Devuelve el id de Luis. */
async function luisOwes(page: Page, bcp: number, days: number) {
  const luis = (await (await page.request.post("/api/partners", { data: { name: "Luis Pérez" } })).json()).id as number;
  await page.request.post("/api/moves", { data: { kind: "lend", account_id: bcp, amount: "50", partner_id: luis } });
  const [item] = (await (await page.request.get(`/api/partners/${luis}`)).json()).owes_me as { line_id: number }[];
  await page.request.put(`/api/move-lines/${item!.line_id}/maturity`, { data: { date: lima(days) } });
  return luis;
}

test("lo vencido va arriba y posponerlo lo esconde hasta su fecha", async ({ page }) => {
  const bcp = await readyUser(page);
  await luisOwes(page, bcp, -1);

  await page.goto("/inicio");
  const card = page.getByRole("region", { name: "Pendientes" });
  await expect(card).toContainText("Pendientes · 1 · 1 vencido");
  await expect(card).toContainText("Luis Pérez te debe S/ 50.00");
  await card.getByRole("link", { name: "Ver todo" }).click();

  await expect(page).toHaveURL("/pendientes");
  const late = page.getByRole("region", { name: "Vencidos" });
  await expect(late).toContainText("Luis Pérez te debe S/ 50.00");
  await late.getByRole("button", { name: "Posponer" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "En 3 días" }).click();

  await expect(page.getByRole("region", { name: "Vencidos" })).toHaveCount(0);
  await expect(page.getByText("Nada te espera por ahora.")).toBeVisible();
  await page.getByRole("button", { name: "Pospuestos (1)" }).click();
  await page.getByRole("button", { name: "Traer ahora" }).click();
  await expect(page.getByRole("region", { name: "Vencidos" })).toContainText("Luis Pérez");
});

test("un recordatorio tuyo se escribe, se ve en el Inicio y queda hecho", async ({ page }) => {
  await readyUser(page);
  await page.goto("/pendientes");
  await page.getByRole("button", { name: "Escribir un recordatorio" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Agregar recordatorio" }).click();
  await expect(sheet).toContainText("Escribe qué tienes que hacer");
  await sheet.getByLabel("Qué tienes que hacer").fill("Renovar el SOAT");
  await sheet.getByRole("button", { name: "Agregar recordatorio" }).click();

  const today = page.getByRole("region", { name: "Hoy" });
  await expect(today).toContainText("Renovar el SOAT");
  await page.goto("/inicio");
  await expect(page.getByRole("region", { name: "Pendientes" })).toContainText("Renovar el SOAT");

  await page.goto("/pendientes");
  await page.getByRole("checkbox", { name: "Hecho: Renovar el SOAT" }).click();
  await expect(page.getByText("Nada te espera por ahora.")).toBeVisible();
  await page.goto("/inicio");
  await expect(page.getByRole("region", { name: "Pendientes" })).toHaveCount(0);
});

test("en el detalle de una persona: sus recordatorios, también los hechos", async ({ page }) => {
  const bcp = await readyUser(page);
  const luis = await luisOwes(page, bcp, 20);
  await page.goto(`/personas/${luis}`);
  const section = page.getByRole("region", { name: "Recordatorios" });
  await section.getByRole("button", { name: "Agregar recordatorio" }).click();
  await page.getByRole("dialog").getByLabel("Qué tienes que hacer").fill("Recordarle el préstamo");
  await page.getByRole("dialog").getByRole("button", { name: "Agregar recordatorio" }).click();
  await expect(section).toContainText("Recordarle el préstamo");
  await expect(section).toContainText("Para hoy");

  await section.getByRole("checkbox", { name: "Hecho: Recordarle el préstamo" }).click();
  await expect(section).toContainText("Hecho el");
  await page.goto("/pendientes");
  await expect(page.getByText("Nada te espera por ahora.")).toBeVisible();
});

test("con más días de aviso llega lo que vence después", async ({ page }) => {
  const bcp = await readyUser(page);
  await luisOwes(page, bcp, 7);
  await page.goto("/pendientes");
  await expect(page.getByText("Nada te espera por ahora.")).toBeVisible();
  await expect(page.getByText("Avisarme 3 días antes")).toBeVisible();
  for (let i = 0; i < 4; i++) await page.getByRole("button", { name: "Un día más" }).click();
  await expect(page.getByText("Avisarme 7 días antes")).toBeVisible();
  await expect(page.getByRole("region", { name: "Próximos días" })).toContainText("Luis Pérez te debe S/ 50.00");
});
