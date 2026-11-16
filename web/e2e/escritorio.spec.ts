// Escritorio (desde 1024 px): el riel en vez de la barra de abajo, la lista con lo elegido al lado,
// Registrar en un panel sobre la pantalla en la que estabas y los atajos de teclado.
import { expect, type Page, test } from "@playwright/test";

/** Una persona lista: Perú, Efectivo S/ 500 y BCP S/ 1,000. */
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
  await page.request.post("/api/accounts/bank", { data: { name: "BCP", currency: "PEN", bank_id: banks.find((b) => b.name === "BCP")!.id, opening: { amount: "1000" } } });
}

async function spend(page: Page, amount: string, note: string) {
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill(amount);
  await page.getByRole("button", { name: /^Sale de/ }).click();
  await page.getByRole("radio", { name: /^BCP/ }).click();
  await page.getByRole("button", { name: /En qué/ }).first().click();
  await page.getByRole("dialog").getByRole("radio", { name: "Restaurantes y delivery" }).click();
  await page.getByLabel("Nota").fill(note);
}

test("el riel reemplaza la barra de abajo y marca dónde estás", async ({ page }) => {
  await readyUser(page);
  const riel = page.getByRole("navigation", { name: "Navegación principal" });
  await expect(riel).toHaveCount(1);   // la barra de abajo no está
  await riel.getByRole("link", { name: "Personas" }).click();
  await expect(page).toHaveURL("/personas");
  await expect(riel.getByRole("link", { name: "Personas" })).toHaveAttribute("aria-current", "page");
  await riel.getByRole("link", { name: "Reportes" }).click();
  // Reportes abre Gastos al lado de su índice
  await expect(page).toHaveURL("/mas/reportes/gastos");
  await expect(page.getByRole("heading", { name: "Reportes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Gastos" })).toBeVisible();
});

test("Registrar se abre en un panel y al cerrarlo sigues donde estabas", async ({ page }) => {
  await readyUser(page);
  await page.goto("/cuentas");
  await page.getByRole("link", { name: /^BCP/ }).click();
  await expect(page).toHaveURL(/\/cuentas\/\d+$/);
  const cuenta = page.url();
  // La lista sigue a la izquierda, con la cuenta marcada
  await expect(page.getByRole("link", { name: /^BCP/ })).toHaveAttribute("aria-current", "page");

  await page.keyboard.press("n");
  const panel = page.getByRole("dialog", { name: "Registrar" });
  await expect(panel).toBeVisible();
  await expect(page.getByRole("heading", { name: "BCP" })).toBeVisible();   // la cuenta sigue detrás
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(cuenta);

  // Pasar a Ingreso y a «Más» tipos no saca del panel
  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await page.getByRole("radio", { name: "Ingreso" }).click();
  await expect(panel).toBeVisible();
  await page.getByRole("radio", { name: "Más" }).click();
  await page.getByRole("dialog").getByRole("link").first().click();
  await expect(panel.getByRole("textbox", { name: "¿Cuánto le prestaste?" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "BCP" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(cuenta);

  // Todos los de «Más» se abren en el panel, también «De antes de PPM»
  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await page.getByRole("radio", { name: "Más" }).click();
  await page.getByRole("dialog").getByRole("link", { name: /De antes de PPM/ }).click();
  await expect(panel.getByRole("heading", { name: "De antes de PPM" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(cuenta);

  // Esc apenas elegido el tipo, mientras la hoja de tipos todavía se va: igual cierra el panel.
  // Con el procesador frenado (como en CI) el Esc cae siempre dentro de esos 200 ms
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 8 });
  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await page.getByRole("radio", { name: "Más" }).click();
  await page.getByRole("dialog").getByRole("link").first().click();
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(cuenta);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: 1 });

  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await spend(page, "35.50", "Almuerzo del viernes");
  await expect(panel).toBeVisible();
  await page.getByLabel("Nota").press("Control+Enter");   // Ctrl + Enter guarda
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL("/movimientos");
  await expect(page.getByRole("link", { name: /Almuerzo del viernes/ })).toBeVisible();
});

test("en Movimientos el detalle se abre al lado y las flechas pasan al siguiente", async ({ page }) => {
  await readyUser(page);
  for (const [amount, note] of [["10", "Café"], ["20", "Menú"]] as const) {
    await page.goto("/registrar");
    await spend(page, amount, note);
    await page.getByRole("button", { name: "Registrar gasto" }).click();
    await expect(page).toHaveURL("/movimientos");
  }
  await expect(page.getByText("Elige un movimiento")).toBeVisible();
  await page.getByRole("link", { name: /Menú/ }).click();
  await expect(page).toHaveURL(/\/movimientos\/\d+$/);
  await expect(page.getByRole("heading", { name: "Menú" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Café/ })).toBeVisible();   // la lista sigue ahí

  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("heading", { name: "Café" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page).toHaveURL("/movimientos");

  await page.keyboard.press("/");
  await expect(page.getByRole("textbox", { name: "Buscar movimientos" })).toBeFocused();
});
