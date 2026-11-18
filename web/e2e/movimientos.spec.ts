// Registrar y Movimientos de punta a punta: gasto, ingreso, dividir, transferir entre monedas,
// por confirmar, editar, borrar, buscar y filtrar.
import { expect, type Page, test } from "@playwright/test";

/** Una persona lista: Perú con dólares, Efectivo S/ 500, BCP S/ 1,000 y BBVA US$ 200. */
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
  // Las cuentas de banco, directo por la API (con la misma sesión)
  const banks = (await (await page.request.get("/api/catalog")).json()).banks as { id: number; name: string }[];
  const bank = (name: string) => banks.find((b) => b.name === name)!.id;
  await page.request.post("/api/accounts/bank", { data: { name: "BCP", currency: "PEN", bank_id: bank("BCP"), opening: { amount: "1000" } } });
  await page.request.post("/api/accounts/bank", { data: { name: "BBVA dólares", currency: "USD", bank_id: bank("BBVA"), opening: { amount: "200", rate: "3.70" } } });
}

async function chooseAccount(page: Page, label: "Sale de" | "Entra a", name: string) {
  await page.getByRole("button", { name: new RegExp(`^${label}`) }).click();
  await page.getByRole("radio", { name: new RegExp(`^${name}`) }).click();
}

async function chooseCategory(page: Page, opener: RegExp, name: string) {
  await page.getByRole("button", { name: opener }).first().click();
  await page.getByRole("dialog").getByRole("radio", { name }).click();
}

test("un gasto simple: aparece en el mes y baja la cuenta", async ({ page }) => {
  await readyUser(page);
  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("35.50");
  await chooseAccount(page, "Sale de", "BCP");
  await chooseCategory(page, /En qué/, "Restaurantes y delivery");
  await page.getByLabel("Nota").fill("Almuerzo con el equipo");
  await page.getByRole("button", { name: "Registrar gasto" }).click();

  await expect(page).toHaveURL("/movimientos");
  const fila = page.getByRole("link", { name: /Almuerzo con el equipo/ });
  await expect(fila).toContainText("BCP");                          // la cuenta; la categoría ya es el ícono
  await expect(fila).not.toContainText("Restaurantes y delivery");
  await expect(fila).not.toContainText("·");
  await expect(fila).toContainText("− 35.50");
  await expect(page.getByText("Salió − S/ 35.50")).toBeVisible();

  await page.getByRole("link", { name: "Cuentas" }).click();
  await expect(page.getByRole("link", { name: /BCP.*S\/ 964\.50/ })).toBeVisible();
});

test("un ingreso usa las categorías de ingreso", async ({ page }) => {
  await readyUser(page);
  await page.goto("/registrar");
  await page.getByRole("radio", { name: "Ingreso" }).click();
  await page.getByRole("textbox", { name: "¿Cuánto entró?" }).fill("4200");
  await chooseAccount(page, "Entra a", "BCP");
  await page.getByRole("button", { name: /De qué/ }).click();
  const hoja = page.getByRole("dialog");
  await expect(hoja.getByRole("heading", { name: "¿De qué es este ingreso?" })).toBeVisible();
  await expect(hoja.getByRole("radio", { name: "Restaurantes y delivery" })).toHaveCount(0);
  await hoja.getByRole("radio", { name: "Salario y facturas" }).click();
  await page.getByRole("button", { name: "Registrar ingreso" }).click();
  await expect(page.getByText("Entró + S/ 4,200.00")).toBeVisible();
});

test("dividir un gasto en dos categorías", async ({ page }) => {
  await readyUser(page);
  await page.goto("/registrar");
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("186.40");
  await chooseAccount(page, "Sale de", "BCP");
  await page.getByLabel("Nota").fill("Plaza Vea");
  await page.getByRole("switch", { name: "Dividir en varias categorías" }).check();
  await chooseCategory(page, /^Elige una categoría/, "Supermercado y mercado");
  await page.getByLabel("Monto para Supermercado y mercado").fill("120");
  await expect(page.getByText("Falta S/ 66.40")).toBeVisible();
  await chooseCategory(page, /^Elige una categoría/, "Hogar");
  await page.getByLabel("Monto para Hogar").fill("66.40");
  await expect(page.getByText("Suma S/ 186.40")).toBeVisible();
  await page.getByRole("button", { name: "Registrar gasto" }).click();

  await page.getByRole("link", { name: /Plaza Vea/ }).click();
  await expect(page.getByText("S/ 120.00")).toBeVisible();
  await expect(page.getByText("S/ 66.40")).toBeVisible();
});

test("cambiar soles a dólares con los dos montos", async ({ page }) => {
  await readyUser(page);
  await page.goto("/registrar");
  await page.getByRole("radio", { name: "Transferir" }).click();
  await page.getByRole("textbox", { name: "¿Cuánto pasas?" }).fill("375");
  await chooseAccount(page, "Sale de", "BCP");
  await chooseAccount(page, "Entra a", "BBVA dólares");
  await page.getByRole("textbox", { name: "Entraron" }).fill("100");
  await expect(page.getByText("Tipo de cambio 3.750, sale solo de los dos montos.")).toBeVisible();
  await page.getByRole("button", { name: "Registrar transferencia" }).click();

  const fila = page.getByRole("link", { name: /Transferencia a BBVA dólares/ });
  await expect(fila).toContainText("BCP → BBVA dólares");
  await expect(fila).toContainText("US$ 100.00 a 3.750");            // lo que llegó y a cuánto
  await expect(page.getByText("Salió − S/ 0.00")).toBeVisible();   // una transferencia no es gasto
  await page.goto("/cuentas");
  await expect(page.getByRole("link", { name: /BBVA dólares.*US\$ 300\.00/ })).toBeVisible();
});

test("por confirmar, confirmar, editar y borrar", async ({ page }) => {
  await readyUser(page);
  await page.goto("/registrar");
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("50");
  await chooseAccount(page, "Sale de", "BCP");
  await chooseCategory(page, /En qué/, "Servicios");
  await page.getByLabel("Nota").fill("Luz");
  await page.getByRole("switch", { name: /Por confirmar/ }).check();
  await page.getByRole("button", { name: "Guardar por confirmar" }).click();

  await expect(page.getByRole("button", { name: "1 por confirmar" })).toBeVisible();
  await page.getByRole("link", { name: /Luz/ }).click();
  await expect(page.getByRole("status")).toContainText("Por confirmar");
  await page.getByRole("button", { name: "Confirmar" }).click();
  await expect(page.getByRole("button", { name: "Pasar a por confirmar" })).toBeVisible();

  await page.getByRole("link", { name: "Editar" }).click();
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("62.30");
  await page.getByRole("button", { name: "Guardar cambios" }).click();
  await expect(page.getByText("− S/ 62.30")).toBeVisible();

  await page.getByRole("button", { name: "Borrar movimiento" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Borrar movimiento" }).click();
  await expect(page).toHaveURL("/movimientos");
  await expect(page.getByRole("link", { name: /Luz/ })).toHaveCount(0);
});

test("buscar y filtrar en el mes", async ({ page }) => {
  await readyUser(page);
  const cats = (await (await page.request.get("/api/categories?kind=expense")).json()).groups
    .flatMap((g: { children: { id: number; name: string }[] }) => g.children);
  const cat = (name: string) => cats.find((c: { name: string }) => c.name === name).id;
  const accounts = (await (await page.request.get("/api/accounts")).json()).have as { id: number; name: string }[];
  const acc = (name: string) => accounts.find((a) => a.name === name)!.id;
  for (const [ref, account, category, amount] of [
    ["Almuerzo", "BCP", "Restaurantes y delivery", "35.50"],
    ["Taxi", "Efectivo", "Taxi y apps", "12"],
  ] as const) {
    await page.request.post("/api/moves", {
      data: { kind: "expense", account_id: acc(account), amount, ref, splits: [{ category_id: cat(category), amount }] },
    });
  }
  await page.goto("/movimientos");
  await page.getByLabel("Buscar movimientos").fill("almu");
  await expect(page.getByRole("link", { name: /Almuerzo/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Taxi/ })).toHaveCount(0);
  await page.getByRole("button", { name: "Borrar búsqueda" }).click();

  await page.getByRole("button", { name: "Cuenta" }).click();
  await page.getByRole("radio", { name: /^Efectivo/ }).click();
  await expect(page.getByRole("link", { name: /Taxi/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Almuerzo/ })).toHaveCount(0);
  // El filtro se recuerda al ir a otra pestaña y volver por la barra
  const nav = page.getByRole("navigation", { name: "Navegación principal" });
  await nav.getByRole("link", { name: "Inicio" }).click();
  await expect(page).toHaveURL("/inicio");
  await nav.getByRole("link", { name: "Movimientos" }).click();
  await expect(page).toHaveURL(`/movimientos?cuenta=${acc("Efectivo")}`);
  await expect(page.getByRole("button", { name: "Efectivo" })).toBeVisible();
  await expect(page.getByRole("link", { name: /Almuerzo/ })).toHaveCount(0);

  // Quitado con su ✕, la pestaña vuelve a abrir la lista completa
  await page.getByRole("button", { name: "Efectivo" }).click();
  await expect(page.getByRole("link", { name: /Almuerzo/ })).toBeVisible();
  await nav.getByRole("link", { name: "Inicio" }).click();
  await nav.getByRole("link", { name: "Movimientos" }).click();
  await expect(page).toHaveURL("/movimientos");
});

test("registrar desde una cuenta vuelve a esa cuenta", async ({ page }) => {
  await readyUser(page);
  await page.getByRole("link", { name: "Cuentas" }).click();
  await page.getByRole("link", { name: /BCP/ }).first().click();
  await expect(page).toHaveURL(/\/cuentas\/\d+$/);
  const cuenta = new URL(page.url()).pathname;
  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("12");
  await chooseCategory(page, /En qué/, "Restaurantes y delivery");
  await page.getByLabel("Nota").fill("Café desde la cuenta");
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(page).toHaveURL(cuenta);
  await expect(page.getByText("Café desde la cuenta")).toBeVisible();
});
