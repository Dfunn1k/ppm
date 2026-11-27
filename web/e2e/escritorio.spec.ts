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
  await expect(panel.getByRole("textbox", { name: /¿Cuánto gastaste\?/ })).toBeFocused();   // se escribe el monto de una
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(cuenta);

  // Pasar a Ingreso y a «Más» tipos no saca del panel
  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await page.getByRole("radio", { name: "Ingreso" }).click();
  await expect(panel).toBeVisible();
  await page.getByRole("radio", { name: "Más" }).click();
  await page.getByRole("dialog").getByRole("link").first().click();
  await expect(panel.getByRole("textbox", { name: "¿Cuánto le prestaste?" })).toBeFocused();
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
  await expect(page).toHaveURL(cuenta);                     // vuelve a la cuenta desde donde registraste
  await expect(page.getByText("Almuerzo del viernes")).toBeVisible();
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

test("Editar se abre en el panel de Registrar, sobre el movimiento, y al guardar sigues en él", async ({ page }) => {
  await readyUser(page);
  await page.goto("/registrar");
  await spend(page, "25", "Almuerzo");
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(page).toHaveURL("/movimientos");
  await page.getByRole("link", { name: /Almuerzo/ }).click();
  await expect(page).toHaveURL(/\/movimientos\/\d+$/);
  const movimiento = page.url();

  // Con el botón: el panel a la derecha, y el movimiento y la lista siguen detrás
  await page.getByRole("link", { name: /^Editar/ }).click();
  const panel = page.getByRole("dialog", { name: "Editar movimiento" });
  await expect(panel).toBeVisible();
  await expect(page.getByRole("heading", { name: "Almuerzo" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Almuerzo/ }).first()).toBeVisible();
  await expect(panel.getByRole("textbox", { name: "¿Cuánto gastaste?" })).toHaveValue("25.00");
  await page.keyboard.press("Escape");
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(movimiento);

  // Con la tecla, y al guardar queda el movimiento con lo nuevo
  await page.keyboard.press("e");
  await expect(panel).toBeVisible();
  await panel.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("30");
  await panel.getByRole("button", { name: /^Guardar cambios/ }).click();
  await expect(panel).toBeHidden();
  await expect(page).toHaveURL(movimiento);
  await expect(page.getByText("− S/ 30.00").first()).toBeVisible();
});

test("etiquetas en escritorio: el reporte se abre al lado y Más › Etiquetas tiene su pantalla", async ({ page }) => {
  await readyUser(page);
  const tag = (await (await page.request.post("/api/tags", { data: { name: "Mudanza" } })).json()).id as number;
  await page.goto("/registrar");
  await spend(page, "45", "Cajas");
  await page.getByRole("button", { name: /Etiquetas/ }).click();
  await page.getByRole("dialog", { name: "Etiquetas" }).getByRole("checkbox", { name: "Mudanza" }).click();
  await page.getByRole("dialog", { name: "Etiquetas" }).getByRole("button", { name: "Listo" }).click();
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(page).toHaveURL("/movimientos");

  await page.goto("/mas/reportes/etiquetas");
  await expect(page.getByRole("link", { name: /Gastos/ })).toBeVisible();          // el índice sigue al lado
  await expect(page.getByRole("region", { name: "Por etiqueta" })).toContainText("Mudanza");
  await page.goto(`/movimientos?etiqueta=${tag}`);
  await expect(page.getByRole("link", { name: /Cajas/ })).toBeVisible();
  await page.goto("/mas/etiquetas");
  await expect(page.getByRole("heading", { name: "Etiquetas" })).toBeVisible();
  await expect(page.getByRole("button", { name: /Mudanza/ })).toContainText("1 movimiento");
});

test("atajos: ? muestra todos, se cambia una tecla y las pistas se apagan", async ({ page }) => {
  await readyUser(page);
  await page.goto("/movimientos");
  await expect(page.getByRole("textbox", { name: "Buscar movimientos" })).toBeVisible();

  // A · «?» y el botón del riel abren la hoja
  await page.keyboard.press("?");
  const hoja = page.getByRole("dialog", { name: "Atajos de teclado" });
  await expect(hoja).toContainText("Registrar un movimiento");
  await page.keyboard.press("Escape");
  await expect(hoja).toBeHidden();
  await page.getByRole("button", { name: /Atajos de teclado/ }).click();
  await expect(hoja).toBeVisible();

  // C · Más › Atajos: cambiar Registrar a R
  await hoja.getByRole("link", { name: /Cambiar teclas/ }).click();
  await expect(page).toHaveURL("/mas/atajos");
  // A · la tecla es el botón: al tocarla espera la nueva; las fijas no se tocan
  await expect(page.getByRole("button", { name: "Cambiar la tecla de Registrar" })).toHaveText(/^N/);   // la tecla y el lápiz
  await expect(page.getByRole("region", { name: "Fijas" })).toContainText("Esc");
  await expect(page.getByRole("region", { name: "Fijas" }).getByRole("button")).toHaveCount(0);
  await page.getByRole("button", { name: "Cambiar la tecla de Registrar" }).click();
  await expect(page.getByRole("button", { name: "Cambiar la tecla de Registrar" })).toContainText("Aprieta una tecla…");
  await page.keyboard.press("r");
  await expect(page.getByRole("button", { name: "Cambiar la tecla de Registrar" })).toHaveText(/^R/);
  await expect(page.getByRole("button", { name: /Volver a los de fábrica/ })).toBeVisible();
  await page.getByRole("button", { name: "Cambiar la tecla de Buscar" }).click();
  await page.keyboard.press("r");                                    // ya la usa Registrar
  await expect(page.getByText("Esa tecla ya la usa otro atajo")).toBeVisible();

  await page.goto("/movimientos");
  await expect(page.getByRole("button", { name: /Atajos de teclado \(tecla \?\)/ })).toBeVisible();
  await expect(page.getByRole("link", { name: "Registrar un movimiento" })).toHaveAttribute("aria-keyshortcuts", "R");
  await page.keyboard.press("n");
  await expect(page).toHaveURL("/movimientos");
  await page.keyboard.press("r");
  await expect(page).toHaveURL(/\/registrar/);
  await page.keyboard.press("Escape");

  // B · las pistas se apagan con el interruptor
  await page.goto("/movimientos");
  await expect(page.locator("label:has(input[aria-label='Buscar movimientos']) kbd")).toHaveText("/");
  await page.goto("/mas/atajos");
  await page.getByRole("switch", { name: /Mostrar las pistas/ }).uncheck();
  await page.goto("/movimientos");
  await expect(page.getByRole("textbox", { name: "Buscar movimientos" })).toBeVisible();
  await expect(page.locator("label:has(input[aria-label='Buscar movimientos']) kbd")).toHaveCount(0);

  await page.goto("/mas/atajos");
  await page.getByRole("button", { name: /Volver a los de fábrica/ }).click();
  await expect(page.getByRole("button", { name: /Volver a los de fábrica/ })).toBeHidden();
});

test("Recurrentes y Más en dos paneles, y Pendientes en tres columnas", async ({ page }) => {
  await readyUser(page);
  await page.goto("/registrar?repite=1");
  await page.getByRole("textbox", { name: "¿Cuánto es?" }).fill("44.90");
  await page.getByRole("button", { name: /^Sale de/ }).click();
  await page.getByRole("radio", { name: /^BCP/ }).click();
  await page.getByRole("button", { name: /En qué/ }).first().click();
  await page.getByRole("dialog").getByRole("radio", { name: "Software y apps" }).click();
  await page.getByLabel("Nota").fill("Netflix");
  await page.getByRole("button", { name: "Guardar recurrente" }).click();

  // La recurrente se abre al lado de la lista, con sus acciones arriba
  await expect(page).toHaveURL(/\/mas\/recurrentes\/\d+$/);
  await expect(page.getByRole("heading", { name: "Recurrentes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Netflix" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Netflix/ })).toHaveAttribute("aria-current", "page");
  await page.getByRole("button", { name: "Pausar" }).click();
  await expect(page.getByRole("button", { name: "Reanudar" })).toBeVisible();

  // Más abre Mi cuenta al lado de su índice; lo que ya está en el riel no se repite
  const riel = page.getByRole("navigation", { name: "Navegación principal" });
  await riel.getByRole("link", { name: "Más" }).click();
  await expect(page).toHaveURL("/mas/cuenta");
  await expect(page.getByRole("heading", { name: "Más" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Ana" })).toBeVisible();
  const indice = page.locator(".pane-list");
  await expect(indice.getByRole("link", { name: /Reportes|Recurrentes|Pendientes/ })).toHaveCount(0);
  await expect(indice.getByText("BETA")).toBeVisible();
  await indice.getByRole("link", { name: /Apariencia/ }).click();
  await expect(page).toHaveURL("/mas/apariencia");
  await expect(indice.getByRole("link", { name: /Apariencia/ })).toHaveAttribute("aria-current", "page");

  // Pendientes: las tres columnas siempre, aunque alguna esté vacía
  await riel.getByRole("link", { name: "Pendientes" }).click();
  for (const name of ["Vencidos", "Hoy", "Próximos días"]) await expect(page.getByRole("region", { name })).toBeVisible();
  await expect(page.getByRole("button", { name: "Escribir un recordatorio" })).toBeVisible();
});

test("presupuesto en escritorio: en el riel, la lista a la izquierda y lo elegido al lado", async ({ page }) => {
  await readyUser(page);
  await page.request.post("/api/budget/start", { data: { month: new Date().toISOString().slice(0, 7), savings: [] } });
  const riel = page.getByRole("navigation", { name: "Navegación principal" });
  await riel.getByRole("link", { name: "Presupuesto" }).click();
  // Al entrar se abre Por asignar al lado
  await expect(page).toHaveURL("/presupuesto/por-asignar");
  await expect(riel.getByRole("link", { name: "Presupuesto" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "De dónde sale Por asignar" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Por asignar" })).toContainText("S/ 1,500.00");
  // Un sobre se abre al lado y queda marcado en la lista
  await page.getByRole("link", { name: /Comida y bebida/ }).click();
  await expect(page).toHaveURL(/\/presupuesto\/sobres\/\d+$/);
  await expect(page.getByRole("heading", { name: "Comida y bebida" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Comida y bebida/ })).toHaveAttribute("aria-current", "page");
  // También está en Más
  await riel.getByRole("link", { name: "Más" }).click();
  await expect(page.getByRole("link", { name: /Presupuesto Tus sobres/ })).toBeVisible();
});

test("con poco alto el + no se encoge y lo que no cabe en el riel pasa a Más", async ({ page }) => {
  await readyUser(page);
  const riel = page.getByRole("navigation", { name: "Navegación principal" });
  const plus = riel.getByRole("link", { name: "Registrar un movimiento" });
  // 640 px: no caben Reportes, Presupuesto ni Pendientes; se van a Más en ese orden
  await page.setViewportSize({ width: 1440, height: 640 });
  for (const name of ["Reportes", "Presupuesto", "Pendientes"]) await expect(riel.getByRole("link", { name, exact: true })).toHaveCount(0);
  await expect(riel.getByRole("link", { name: "Personas" })).toBeVisible();
  const box = await plus.boundingBox();
  expect(box && [Math.round(box.width), Math.round(box.height)]).toEqual([52, 52]);
  await riel.getByRole("link", { name: "Más" }).click();
  await expect(page.getByRole("link", { name: /^Pendientes/ })).toBeVisible();
  await page.getByRole("link", { name: /^Reportes/ }).click();
  await expect(riel.getByRole("link", { name: "Más" })).toHaveAttribute("aria-current", "page");
  // 724 px: vuelve Pendientes
  await page.setViewportSize({ width: 1440, height: 724 });
  await expect(riel.getByRole("link", { name: "Pendientes" })).toBeVisible();
  await expect(riel.getByRole("link", { name: "Presupuesto" })).toHaveCount(0);
  // 900 px: todo en el riel otra vez
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(riel.getByRole("link", { name: "Reportes" })).toBeVisible();
  await expect(riel.getByRole("link", { name: "Presupuesto" })).toBeVisible();
});

test("Por clasificar en escritorio: la lista a la izquierda y se clasifica al lado, uno tras otro", async ({ page }) => {
  await readyUser(page);
  const accounts = (await (await page.request.get("/api/accounts")).json()) as { have: { id: number; name: string }[] };
  const bcp = accounts.have.find((a) => a.name === "BCP")!.id;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Lima" });
  for (const [amount, ref] of [["48.90", "TOTTUS LA MOLINA"], ["18.70", "UBER TRIP"]] as const) {
    const r = await page.request.post("/api/moves", { data: {
      kind: "expense", account_id: bcp, amount, date: today, ref, pending: false, splits: [], lines: [], later: true,
      to_account_id: null, to_amount: null, rate: null, currency: null, paid_by_partner_id: null, installments: null, installment_amount: null, tag_ids: [],
    } });
    expect(r.ok()).toBeTruthy();
  }
  await page.goto("/por-clasificar");
  // Sin ventana: el primero ya está abierto al lado
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByText("1 de 2")).toBeVisible();
  const first = (await page.getByRole("heading", { level: 2, name: /TOTTUS|UBER/ }).textContent())!;
  await page.getByRole("radio", { name: "Supermercado y mercado" }).click();
  await page.getByRole("button", { name: "Clasificar como Supermercado y mercado" }).click();
  // Queda el otro, ya abierto
  await expect(page.getByText("1 de 1")).toBeVisible();
  await expect(page.getByRole("heading", { level: 2, name: /TOTTUS|UBER/ })).not.toHaveText(first);
  // Enter sobre la categoría elegida clasifica y la bandeja queda vacía
  await page.getByRole("radio", { name: "Taxi y apps" }).click();
  await page.getByRole("radio", { name: "Taxi y apps" }).press("Enter");
  await expect(page.getByText("Bandeja vacía")).toBeVisible();
});
