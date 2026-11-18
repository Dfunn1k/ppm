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
  await expect(page.getByRole("link", { name: /Plaza Vea/ }).getByLabel("Tiene adjunto")).toBeVisible();   // el clip en la fila

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

/** Una boleta de verdad (PNG dibujado en un canvas) y un PDF de 2 páginas impreso por el navegador. */
async function realFiles(page: Page) {
  const png = await page.evaluate(() => {
    const c = document.createElement("canvas");
    c.width = 900; c.height = 1300;
    const g = c.getContext("2d")!;
    g.fillStyle = "#fffdf8"; g.fillRect(0, 0, 900, 1300);
    g.fillStyle = "#2b2b2b"; g.font = "bold 44px monospace"; g.fillText("PLAZA VEA", 320, 120);
    g.font = "32px monospace";
    ["Leche 1L x2      9.80", "Pan frances      4.50", "Arroz 5kg       24.90", "Pollo entero    28.60", "TOTAL S/       186.40"]
      .forEach((t, i) => g.fillText(t, 120, 260 + i * 80));
    return c.toDataURL("image/png").split(",")[1]!;
  });
  const printer = await page.context().newPage();
  await printer.setContent(`<h1 style="font-family:sans-serif">Estado de cuenta</h1><p>Página uno</p>
    <div style="page-break-before:always"><h1 style="font-family:sans-serif">Página dos</h1></div>`);
  const pdf = await printer.pdf({ format: "A4" });
  await printer.close();
  return { png: { name: "boleta.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") },
           pdf: { name: "estado.pdf", mimeType: "application/pdf", buffer: pdf } };
}

test("el visor: miniaturas, pasar al siguiente, el PDF por páginas y la vista de escritorio", async ({ page }) => {
  const bcp = await readyUser(page);
  const r = await page.request.post("/api/moves", { data: { kind: "expense", account_id: bcp, amount: "186.40", ref: "Plaza Vea",
    splits: [{ category_id: (await (await page.request.get("/api/categories?kind=expense")).json()).groups[0].children[0].id, amount: "186.40" }] } });
  const id = (await r.json()).summary.id as number;
  const files = await realFiles(page);
  for (const f of [files.png, files.pdf]) {
    await page.request.post(`/api/moves/${id}/attachments`, { multipart: { file: f } });
  }

  await page.goto(`/movimientos/${id}`);
  const seccion = page.getByRole("region", { name: "Adjuntos" });
  await expect(seccion).toContainText("Adjuntos2");
  const thumbs = seccion.locator("img");
  await expect(thumbs).toHaveCount(2);
  await expect.poll(() => thumbs.first().evaluate((i: HTMLImageElement) => i.naturalWidth)).toBeGreaterThan(0);
  await seccion.scrollIntoViewIfNeeded();
  await page.screenshot({ path: "test-results/adjuntos-tira.png" });

  await seccion.getByRole("button", { name: "Ver estado.pdf" }).click();     // el más reciente va primero
  const visor = page.getByRole("dialog", { name: "estado.pdf" });
  await expect(visor).toContainText("1 de 2");
  await expect(visor.getByRole("img", { name: /estado\.pdf, página/ })).toHaveCount(2);
  const primera = visor.getByRole("img", { name: "estado.pdf, página 1" });
  await expect.poll(() => primera.evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth), { timeout: 15_000 }).toBeGreaterThan(0);
  await expect(primera).not.toHaveClass(/opacity-0/);
  await page.screenshot({ path: "test-results/adjuntos-visor-pdf.png" });
  await visor.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("dialog", { name: "boleta.png" })).toContainText("2 de 2");
  await page.screenshot({ path: "test-results/adjuntos-visor-foto.png" });

  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(page.getByRole("complementary", { name: "Adjuntos del movimiento" })).toBeVisible();
  await page.keyboard.press("ArrowLeft");
  await expect(page.getByRole("dialog", { name: "estado.pdf" })).toBeVisible();
  await page.keyboard.press("ArrowRight");
  await page.screenshot({ path: "test-results/adjuntos-escritorio.png" });
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
