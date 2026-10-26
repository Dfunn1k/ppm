// El Inicio, Más, Mi cuenta y Apariencia de punta a punta.
import { expect, type Page, test } from "@playwright/test";

const PASSWORD = "pan-para-mayo-2026";

async function readyUser(page: Page) {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@prueba.ppm`;
  await page.goto("/crear-cuenta");
  await page.getByLabel("¿Cómo te llamamos?").fill("Ana");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByLabel("Lo que hay hoy en Efectivo").fill("1000");
  await page.getByRole("button", { name: "Guardar y empezar" }).click();
  await expect(page).toHaveURL("/inicio");
  return email;
}

async function record(page: Page, body: Record<string, unknown>, categoria: string, monto: string) {
  const kind = body.kind === "income" ? "income" : "expense";
  const cats = (await (await page.request.get(`/api/categories?kind=${kind}`)).json()).groups
    .flatMap((g: { children: { id: number; name: string }[] }) => g.children);
  const efectivo = (await (await page.request.get("/api/accounts")).json()).have[0].id;
  const r = await page.request.post("/api/moves", {
    data: { account_id: efectivo, amount: monto, splits: [{ category_id: cats.find((c: { name: string }) => c.name === categoria).id, amount: monto }], ...body },
  });
  expect(r.ok()).toBeTruthy();
}

test("el Inicio: para mayo, en qué se va la plata y los últimos movimientos", async ({ page }) => {
  await readyUser(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("S/ 1,000.00");
  await expect(page.getByText("Todavía no hay movimientos este mes.")).toBeVisible();

  await record(page, { kind: "income", ref: "Sueldo" }, "Salario y facturas", "2000");
  await record(page, { kind: "expense", ref: "Mercado" }, "Supermercado y mercado", "300");
  await record(page, { kind: "expense", ref: "Almuerzo" }, "Restaurantes y delivery", "100");
  await record(page, { kind: "expense", ref: "Taxi" }, "Taxi y apps", "100");
  await page.reload();

  await expect(page.getByRole("heading", { level: 1 })).toHaveText("S/ 2,500.00");
  const mayo = page.getByRole("region", { name: "Para mayo" });
  await expect(mayo).toContainText("Guardaste S/ 1,500.00 este mes.");
  await expect(mayo).toContainText("75 % de lo que entró");
  const plata = page.getByRole("region", { name: "En qué se va la plata" });
  const filas = plata.getByRole("link", { name: /S\/ / });
  await expect(filas.first()).toContainText("Comida y bebida");   // la principal suma a sus hijas
  await expect(filas.first()).toContainText("S/ 400.00");
  await expect(page.getByRole("region", { name: "Últimos movimientos" }).getByRole("link", { name: /Taxi/ })).toBeVisible();

  // Otro mes: cambia lo del mes, no lo de hoy
  await page.getByRole("button", { name: /\d{4}$/ }).click();
  await page.getByRole("radio").nth(2).click();
  await expect(mayo).toContainText("Todavía no hay movimientos este mes.");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("S/ 2,500.00");
});

test("el aviso de los por confirmar lleva a Movimientos", async ({ page }) => {
  await readyUser(page);
  await record(page, { kind: "expense", ref: "Luz", pending: true }, "Servicios", "80");
  await page.reload();
  await page.getByRole("link", { name: "1 movimiento por confirmar ya llegó a su día" }).click();
  await expect(page).toHaveURL(/pendientes=1/);
  await expect(page.getByRole("link", { name: /Luz/ })).toBeVisible();
});

test("Apariencia: el tema y el acento se ven al instante y quedan guardados", async ({ page }) => {
  await readyUser(page);
  await page.getByRole("link", { name: "Más" }).click();
  await page.getByRole("link", { name: /Apariencia/ }).click();
  await page.getByRole("radio", { name: "Oscuro" }).click();
  await page.getByRole("radio", { name: "Morado" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "morado");

  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(page.locator("html")).toHaveAttribute("data-accent", "morado");
  await expect(page.getByRole("radio", { name: "Morado" })).toHaveAttribute("aria-checked", "true");
});

test("Mi cuenta: cambiar la contraseña y cerrar sesión", async ({ page }) => {
  const email = await readyUser(page);
  await page.goto("/mas/cuenta");
  await page.getByRole("button", { name: /Cambiar contraseña/ }).click();
  const hoja = page.getByRole("dialog");
  await hoja.getByLabel("Contraseña actual").fill("no-es-esta");
  await hoja.getByLabel("Contraseña nueva").fill("otra-frase-larga");
  await hoja.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(hoja.getByText("No es tu contraseña actual")).toBeVisible();
  await hoja.getByLabel("Contraseña actual").fill(PASSWORD);
  await hoja.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByRole("status")).toContainText("Contraseña cambiada");

  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();
  await expect(page).toHaveURL("/entrar");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill("otra-frase-larga");
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page).toHaveURL("/inicio");
});
