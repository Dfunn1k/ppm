// Reportes: desde Más, el índice con la cifra de cada reporte; Gastos con sus grupos que se despliegan
// y llevan a Movimientos; Flujo, Patrimonio y Personas con sus tramos.
import { expect, type Page, test } from "@playwright/test";

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

test("los reportes: índice, gastos por grupo, flujo, patrimonio y personas", async ({ page }) => {
  const bcp = await readyUser(page);
  const cats: Record<string, number> = {};
  for (const kind of ["expense", "income"]) {
    for (const g of (await (await page.request.get(`/api/categories?kind=${kind}`)).json()).groups) for (const k of g.children) cats[k.name] = k.id;
  }
  const post = (data: object) => page.request.post("/api/moves", { data });
  await post({ kind: "income", account_id: bcp, amount: "1000", splits: [{ category_id: cats["Salario y facturas"], amount: "1000" }] });
  await post({ kind: "expense", account_id: bcp, amount: "300", splits: [{ category_id: cats["Supermercado y mercado"], amount: "300" }] });
  await post({ kind: "expense", account_id: bcp, amount: "100", splits: [{ category_id: cats["Taxi y apps"], amount: "100" }] });
  const luis = (await (await page.request.post("/api/partners", { data: { name: "Luis Pérez" } })).json()).id;
  await post({ kind: "lend", account_id: bcp, amount: "50", partner_id: luis });

  await page.goto("/mas");
  await page.getByRole("link", { name: /Reportes/ }).click();
  await expect(page).toHaveURL("/mas/reportes");
  await expect(page.getByRole("link", { name: /Gastos/ })).toContainText("S/ 400.00");
  await expect(page.getByRole("link", { name: /Flujo/ })).toContainText("Te quedó 60 %");
  await expect(page.getByRole("link", { name: /Personas/ })).toContainText("Te deben S/ 50.00");

  await page.getByRole("link", { name: /Gastos/ }).click();
  const grupos = page.getByRole("region", { name: "Por grupo" });
  const dona = page.getByRole("img", { name: /Gasto por grupo/ });
  await expect(dona).toContainText("Total");                       // sin elegir nada: el general
  await expect(grupos.getByRole("button", { name: /Comida y bebida/ })).toContainText("75 % del total");   // la barra dice lo que pesa
  await grupos.getByRole("button", { name: /Comida y bebida/ }).click();
  await expect(dona).toContainText("Comida");
  await grupos.getByRole("button", { name: /Transporte/ }).click();     // con dos abiertos, la dona suma los dos
  await expect(dona).toContainText("2 grupos");
  await expect(dona).toContainText("S/ 400.00");
  await grupos.getByRole("button", { name: /Comida y bebida/ }).click();
  await expect(dona).toContainText("Transporte");
  await expect(dona).toContainText("S/ 100.00");
  await expect(dona).toContainText("25 %");
  await grupos.getByRole("button", { name: /Transporte/ }).click();
  await expect(dona).toContainText("Total");                       // al plegarlos vuelve al general
  await page.getByRole("radio", { name: "Año" }).click();
  await expect(page.getByRole("region", { name: "Mes a mes" })).toContainText("Ene");   // el eje con tres letras
  await page.getByRole("radio", { name: "Mes" }).click();
  await expect(dona).toContainText("Total");
  await grupos.getByRole("button", { name: /Comida y bebida/ }).click();
  await grupos.getByRole("link", { name: /Supermercado y mercado/ }).click();
  await expect(page).toHaveURL(/\/movimientos\?mes=\d{4}-\d{2}&categoria=\d+/);

  await page.goto("/mas/reportes/gastos");
  await page.getByRole("radio", { name: "Año" }).click();
  await expect(page.getByRole("region", { name: "Mes a mes" })).toBeVisible();

  await page.goto("/mas/reportes/flujo");
  await expect(page.getByRole("img", { name: /Entró S\/ 1,000.00/ })).toBeVisible();
  await expect(page.getByText("S/ 600.00").first()).toBeVisible();
  // Tu plata: con cuánto empezaste, lo que entró y salió de tus cuentas y por qué no es tu patrimonio
  const plata = page.getByRole("region", { name: "Tu plata" });
  await expect(plata).toContainText("Ingresos que entraron");
  await expect(plata).toContainText("Le prestaste a alguien");
  await expect(plata).toContainText("S/ 2,050.00");                // 1,500 de antes de PPM + 1,000 − 400 − 50
  await plata.getByRole("button", { name: /Gastos pagados con tu plata/ }).click();
  const hoja = page.getByRole("dialog", { name: "Gastos pagados con tu plata" });
  await expect(hoja).toContainText("2 movimientos");
  await expect(hoja).toContainText("S/ 400.00");
  await page.keyboard.press("Escape");
  await expect(hoja).toBeHidden();
  const porque = page.getByRole("region", { name: "Por qué no subió lo mismo" });
  await expect(porque).toContainText("Creció tu patrimonio");
  await porque.getByRole("button", { name: /Te deben más/ }).click();
  await expect(porque).toContainText("Luis Pérez");
  await expect(porque).toContainText("Te debe S/ 50.00 más");

  await page.goto("/mas/reportes/patrimonio");
  await expect(page.getByRole("region", { name: "Cómo está repartido hoy" })).toContainText("Me deben");

  await page.goto("/mas/reportes/personas");
  await page.getByRole("group", { name: "Tramos" }).getByRole("button", { name: /\+90/ }).click();
  await expect(page.getByText("Nadie en este tramo.")).toBeVisible();
});
