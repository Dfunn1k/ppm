// La cuota del banco es distinta: Unipiel se registró sin escribir la cuota (3 × S/ 231.00) y el
// estado de cuenta cobra S/ 262.02. La conciliación lo avisa y «Usar la del banco» ajusta la compra.
import { readFileSync } from "node:fs";

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
}

test("la cuota del banco es distinta: usar la del banco", async ({ page }) => {
  await readyUser(page);
  const r = await page.request.post("/api/cards", {
    data: { name: "Visa Qore", closing_day: 25, credit_limit: "7010.91", brand: "Visa", last4: "1111" },
  });
  const card = (await r.json()).account.id as number;
  const groups = (await (await page.request.get("/api/categories?kind=expense")).json()).groups as { children: { id: number; name: string }[] }[];
  const hogar = groups.flatMap((g) => g.children).find((k) => k.name === "Hogar")!.id;
  await page.request.post("/api/moves", {
    data: { kind: "expense", account_id: card, amount: "693.00", date: "2026-10-14", ref: "Unipiel", installments: 3,
            splits: [{ category_id: hogar, amount: "693.00" }] },
  });
  const text = readFileSync(new URL("./fixtures/bcp_visa_2026-10.txt", import.meta.url), "utf8");
  const printer = await page.context().newPage();
  await printer.setContent(`<pre style="font: 7px/9px monospace; margin: 0">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`);
  const pdf = await printer.pdf({ format: "A4", landscape: true });
  await printer.close();

  await page.goto(`/tarjetas/${card}`);
  await page.getByLabel("PDF del estado de cuenta").setInputFiles({ name: "EECC_VISA.pdf", mimeType: "application/pdf", buffer: pdf });
  const aviso = page.getByRole("region", { name: "La cuota del banco es distinta" });
  await expect(aviso).toContainText("Unipiel: el banco cobra S/ 262.02 por cuota");
  await expect(aviso).toContainText("En PPM cada cuota es S/ 231.00");
  await expect(aviso).toContainText("S/ 93.06");                      // 3 × 31.02: lo que sube la tarjeta
  await aviso.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/cuota-banco-aviso.png" });
  await aviso.getByRole("button", { name: "Usar la del banco" }).click();

  await expect(aviso).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Detalle plan cuotas" })).toContainText("Dividida en tu gasto");
  await page.getByRole("region", { name: "Detalle plan cuotas" }).getByRole("link").click();
  await expect(page.getByText("3 cuotas de S/ 262.02 · precio S/ 693.00")).toBeVisible();
});
