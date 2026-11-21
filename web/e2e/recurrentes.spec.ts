// Recurrentes y préstamos de punta a punta: «Se repite» en Registrar, la lista y el detalle, «solo
// esta vez», pausar, el recordatorio del Inicio, y crear un préstamo y pagar su cuota.
import { expect, type Page, test } from "@playwright/test";

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
  const bcp = await page.request.post("/api/accounts/bank", {
    data: { name: "BCP", currency: "PEN", bank_id: banks.find((b) => b.name === "BCP")!.id, opening: { amount: "1000" } },
  });
  return (await bcp.json()).account.id as number;
}

async function category(page: Page, name: string) {
  for (const g of (await (await page.request.get("/api/categories?kind=expense")).json()).groups) {
    for (const k of g.children) if (k.name === name) return k.id as number;
  }
  throw new Error(name);
}

test("se repite: Netflix cada mes, saltar una vez y pausar", async ({ page }) => {
  await readyUser(page);
  await page.goto("/mas");
  await page.getByRole("link", { name: /Recurrentes/ }).click();
  await expect(page.getByText("Nada se repite todavía")).toBeVisible();
  await page.getByRole("link", { name: "Nuevo recurrente" }).click();

  await page.getByRole("textbox", { name: "¿Cuánto es?" }).fill("44.90");
  await page.getByRole("button", { name: /^Sale de/ }).click();
  await page.getByRole("radio", { name: /^BCP/ }).click();
  await page.getByRole("button", { name: /En qué/ }).first().click();
  await page.getByRole("dialog").getByRole("radio", { name: "Software y apps" }).click();
  await page.getByLabel("Nota").fill("Netflix");
  await expect(page.getByRole("switch", { name: /Se repite/ })).toBeChecked();
  await expect(page.getByRole("status")).toContainText("Se registra solo");
  await page.getByRole("button", { name: "Guardar recurrente" }).click();

  await expect(page).toHaveURL(/\/mas\/recurrentes\/\d+$/);
  await expect(page.getByRole("heading", { name: "Netflix" })).toBeVisible();
  await expect(page.getByText("Ya registradas")).toBeVisible();          // la de hoy ya salió

  await page.getByRole("button", { name: /Se registra sola ese día/ }).first().click();
  await page.getByRole("radio", { name: "Saltar" }).click();
  await page.getByRole("button", { name: "Saltar esta vez" }).click();
  await expect(page.getByText("Saltada: esta vez no")).toBeVisible();

  await page.getByRole("button", { name: "Pausar" }).click();
  await expect(page.getByRole("button", { name: "Reanudar" })).toBeVisible();
  await page.getByRole("link", { name: "Volver a Recurrentes" }).click();
  await expect(page.getByRole("link", { name: /Netflix/ })).toContainText("Pausada");
});

test("un recordatorio se ve en el Inicio y en Pendientes hasta que lo haces", async ({ page }) => {
  const bcp = await readyUser(page);
  const r = await page.request.post("/api/recurring", {
    data: {
      move: { kind: "expense", account_id: bcp, amount: "1200", ref: "Alquiler",
              splits: [{ category_id: await category(page, "Alquiler"), amount: "1200" }] },
      rule: { interval: "month" }, mode: "reminder",
    },
  });
  expect(r.status()).toBe(201);
  await page.goto("/inicio");
  const card = page.getByRole("region", { name: "Pendientes" }).getByRole("link", { name: /Alquiler/ });
  await expect(card).toContainText("S/ 1,200.00");   // el monto a la derecha (caso 9)
  await page.goto("/pendientes");
  const hoy = page.getByRole("region", { name: "Hoy" });
  await expect(hoy).toContainText("Te toca pagarlo hoy");
  await hoy.getByRole("button", { name: "Ya lo hice" }).click();
  await expect(page.getByText("Nada te espera por ahora.")).toBeVisible();
});

test("un préstamo que ya venía pagando: crearlo y pagar la cuota con la boleta", async ({ page }) => {
  await readyUser(page);
  await page.goto("/cuentas/nueva");
  await page.getByRole("link", { name: /Préstamo de banco/ }).click();
  await page.getByLabel("Nombre").fill("Préstamo vehicular");
  await page.getByRole("button", { name: /^Banco/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "BCP" }).click();
  await page.getByRole("textbox", { name: /¿Cuánto debes hoy\?/ }).fill("38850");
  await page.getByLabel("Cuotas que faltan").fill("23");
  await page.getByRole("textbox", { name: "Capital", exact: true }).fill("1050");
  await page.getByRole("textbox", { name: "Interés", exact: true }).fill("610");
  await page.getByRole("textbox", { name: "Seguro", exact: true }).fill("28");
  await expect(page.getByRole("status")).toContainText("Cuota de S/ 1,688.00");
  await page.getByRole("button", { name: "Crear préstamo" }).click();

  await expect(page).toHaveURL(/\/prestamos\/\d+$/);
  await expect(page.getByText("S/ 38,850.00")).toBeVisible();
  await expect(page.getByText("0 de 23 cuotas")).toBeVisible();
  await page.getByRole("link", { name: "Pagar cuota" }).click();
  await page.getByRole("textbox", { name: "Capital", exact: true }).fill("1050.10");
  await page.getByRole("textbox", { name: "Interés", exact: true }).fill("609.90");
  await page.getByRole("button", { name: "Pagar S/ 1,688.00" }).click();

  await expect(page).toHaveURL(/\/prestamos\/\d+$/);
  await expect(page.getByText("S/ 37,799.90")).toBeVisible();
  await expect(page.getByText("1 de 23 cuotas")).toBeVisible();
  await page.goto("/cuentas");
  await expect(page.getByRole("link", { name: /Préstamo vehicular/ })).toContainText("BCPPréstamo en soles")   // el banco en pastilla (caso 10);
});

test("un gasto que se repite, compartido con Luis: cada vez te debe su parte", async ({ page }) => {
  await readyUser(page);
  await page.request.post("/api/partners", { data: { name: "Luis Pérez" } });
  await page.goto("/registrar?repite=1");
  await page.getByRole("textbox", { name: "¿Cuánto es?" }).fill("120");
  await page.getByRole("button", { name: /^Sale de/ }).click();
  await page.getByRole("radio", { name: /^BCP/ }).click();
  await page.getByRole("button", { name: /En qué/ }).first().click();
  await page.getByRole("dialog").getByRole("radio", { name: "Internet" }).click();
  await page.getByLabel("Nota").fill("Internet");
  await page.getByRole("switch", { name: /Compartido/ }).check();
  await page.getByRole("button", { name: "Agregar a alguien" }).click();
  await page.getByRole("dialog").getByRole("combobox").fill("luis");
  await page.getByRole("option", { name: /Luis Pérez/ }).click();
  const bloque = page.getByRole("region", { name: "Compartido" });
  await expect(bloque.getByRole("status")).toContainText("Cada vez sale S/ 120.00 de BCP. S/ 60.00 son gasto tuyo en Internet; Luis te debe S/ 60.00");
  await expect(page.getByRole("switch", { name: /Se repite/ })).toBeChecked();
  await page.getByRole("button", { name: "Guardar recurrente" }).click();

  await expect(page).toHaveURL(/\/mas\/recurrentes\/\d+$/);
  const compartido = page.getByRole("region", { name: "Compartido" });
  await expect(compartido).toContainText("Luis Pérez");
  await expect(compartido).toContainText("Cada vez te debe");
  await compartido.getByRole("link", { name: /Luis Pérez/ }).click();

  await expect(page.getByRole("region", { name: "Te debe" })).toContainText("S/ 60.00");     // la de hoy ya se registró
  await expect(page.getByRole("region", { name: "Se repite con Luis" })).toContainText("Internet");
});
