// Inicio a tu medida: en Más › Inicio se eligen las cuentas del Inicio, su orden y con cuál arranca el +;
// el ojo del Inicio esconde los montos y se recuerda.
import { expect, type Page, test } from "@playwright/test";

/** Perú, Efectivo S/ 500 y BCP S/ 1,000. Devuelve el id del BCP. */
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
    data: { name: "BCP", currency: "PEN", bank_id: banks.find((b) => b.name === "BCP")!.id, opening: { amount: "1000" } },
  });
  return (await r.json()).account.id as number;
}

test("elegir qué cuentas se ven, su orden y la cuenta del +", async ({ page }) => {
  const bcp = await readyUser(page);
  await page.goto("/inicio");
  const cuentas = page.getByRole("region", { name: "Mis cuentas" });
  await expect(cuentas.getByRole("link", { name: /Efectivo|BCP/ })).toHaveText([/Efectivo/, /BCP/]);
  await cuentas.getByRole("link", { name: "Elegir cuáles" }).click();

  await expect(page).toHaveURL("/mas/inicio");
  await page.getByRole("button", { name: "Subir BCP" }).click();
  await page.getByRole("switch", { name: "Ver Efectivo en el Inicio" }).click();
  await expect(page.getByText("No se ve en el Inicio")).toBeVisible();
  await page.getByRole("button", { name: /Al tocar \+ desde el Inicio/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: /^BCP/ }).click();

  await page.goto("/inicio");
  await expect(cuentas.getByRole("link", { name: /Efectivo|BCP/ })).toHaveText([/BCP/]);
  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await expect(page).toHaveURL(`/registrar?cuenta=${bcp}`);
});

test("el ojo esconde los montos del Inicio y se recuerda", async ({ page }) => {
  await readyUser(page);
  await page.goto("/inicio");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("S/ 1,500.00");
  await page.getByRole("button", { name: "Esconder los montos" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("S/ ••••");
  await expect(page.getByText("Montos escondidos · toca el ojo para verlos")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("S/ ••••");
  await page.getByRole("button", { name: "Mostrar los montos" }).click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("S/ 1,500.00");
});
