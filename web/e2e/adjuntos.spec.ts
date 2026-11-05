// Adjuntos: la boleta se elige en Registrar y se sube al guardar; en el detalle se ve, se agrega otra
// y se borra con confirmación.
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

const JPG = { name: "boleta-plaza-vea.jpg", mimeType: "image/jpeg", buffer: Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2048, 1)]) };
const PDF = { name: "comprobante.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n%%EOF\n") };

test("adjuntar la boleta al registrar y verla en el detalle", async ({ page }) => {
  const bcp = await readyUser(page);
  await page.goto(`/registrar?cuenta=${bcp}`);
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("186.40");
  await page.getByRole("button", { name: /En qué/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "Supermercado y mercado" }).click();
  await page.getByLabel("Nota").fill("Plaza Vea");
  await page.getByLabel("Elegir un archivo").setInputFiles(JPG);
  const adjuntos = page.getByRole("region", { name: "Adjuntos" });
  await expect(adjuntos).toContainText("boleta-plaza-vea.jpg");
  await expect(adjuntos.getByRole("button", { name: "Adjuntar otro" })).toBeVisible();
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(page).toHaveURL("/movimientos");

  await page.getByRole("link", { name: /Plaza Vea/ }).click();
  const seccion = page.getByRole("region", { name: "Adjuntos" });
  await expect(seccion.getByRole("button", { name: "Ver boleta-plaza-vea.jpg" })).toBeVisible();
  await page.getByLabel("Elegir un archivo").setInputFiles(PDF);
  await expect(seccion.getByRole("button", { name: "Ver comprobante.pdf" })).toBeVisible();

  await seccion.getByRole("button", { name: "Ver boleta-plaza-vea.jpg" }).click();
  const visor = page.getByRole("dialog", { name: "boleta-plaza-vea.jpg" });
  await expect(visor.getByRole("link", { name: "Descargar" })).toBeVisible();
  await visor.getByRole("button", { name: "Borrar" }).click();
  await expect(visor).toContainText("¿Borrar este adjunto? El movimiento queda igual.");
  await visor.getByRole("button", { name: "Sí, borrar" }).click();
  await expect(seccion.getByRole("button", { name: /^Ver / })).toHaveCount(1);
});

test("lo que no es foto ni PDF no se adjunta", async ({ page }) => {
  await readyUser(page);
  await page.goto("/registrar");
  await page.getByLabel("Elegir un archivo").setInputFiles({ name: "nota.txt", mimeType: "text/plain", buffer: Buffer.from("hola") });
  await expect(page.getByRole("alert")).toContainText("«nota.txt» no es una foto ni un PDF");
});
