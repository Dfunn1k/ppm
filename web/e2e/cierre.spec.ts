// X4 · Cierre de periodo: cerrar el mes pasado, ver el candado en un movimiento de ese mes y reabrir.
import { expect, type Page, test } from "@playwright/test";

const lima = (offsetDays: number) =>
  new Date(Date.now() + offsetDays * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
const HOY = lima(0);
const FIN_MES_PASADO = (() => {
  const [y, m] = HOY.split("-").map(Number);
  return new Date(Date.UTC(y!, m! - 1, 0)).toISOString().slice(0, 10);
})();

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
}

test("cerrar el mes pasado, el candado en un movimiento y reabrir", async ({ page }) => {
  await readyUser(page);
  const accounts = await (await page.request.get("/api/accounts")).json();
  const cash = accounts.have[0].id as number;
  const groups = (await (await page.request.get("/api/categories?kind=expense")).json()).groups as { children: { id: number; name: string }[] }[];
  const hogar = groups.flatMap((g) => g.children).find((k) => k.name === "Hogar")!.id;
  // El efectivo nació hoy: el gasto del mes pasado va con su propio saldo inicial de ese mes
  await page.request.put(`/api/accounts/${cash}/opening`, { data: { amount: "500", date: lima(-60) } });
  const r = await page.request.post("/api/moves", {
    data: { kind: "expense", account_id: cash, amount: "40", date: FIN_MES_PASADO, ref: "Mercado",
            splits: [{ category_id: hogar, amount: "40" }] },
  });
  expect(r.status()).toBe(201);
  const id = (await r.json()).summary.id as number;

  await page.goto("/mas");
  await page.getByRole("link", { name: /Cierre de periodo/ }).click();
  await expect(page.getByText("Nada cerrado")).toBeVisible();
  await expect(page.getByRole("region", { name: "Antes de cerrar" })).toContainText("Nada por confirmar");
  await page.screenshot({ path: "test-results/cierre-listo.png" });
  await page.getByRole("button", { name: /^Cerrar hasta el/ }).click();
  await expect(page.getByText(/Cerrado hasta el/)).toBeVisible();
  await page.screenshot({ path: "test-results/cierre-cerrado.png" });

  await page.goto(`/movimientos/${id}`);
  await expect(page.getByText(/Periodo cerrado hasta el/)).toBeVisible();
  await expect(page.getByRole("link", { name: "Editar" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Borrar movimiento" })).toHaveCount(0);

  await page.goto("/mas/cierre");
  await page.getByRole("button", { name: "Reabrir todo" }).click();
  await expect(page.getByText("Nada cerrado")).toBeVisible();
  await page.goto(`/movimientos/${id}`);
  await expect(page.getByRole("button", { name: "Borrar movimiento" })).toBeVisible();
});
