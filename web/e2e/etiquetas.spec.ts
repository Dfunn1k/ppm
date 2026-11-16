// Etiquetas de punta a punta: crear una al registrar, verla en el detalle, filtrar Movimientos,
// el reporte por etiqueta y Más › Etiquetas para renombrarla.
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

test("una etiqueta: se crea al registrar, filtra Movimientos, tiene su reporte y se renombra", async ({ page }) => {
  const bcp = await readyUser(page);
  const cats: Record<string, number> = {};
  for (const g of (await (await page.request.get("/api/categories?kind=expense")).json()).groups) for (const k of g.children) cats[k.name] = k.id;
  await page.request.post("/api/moves", { data: { kind: "expense", account_id: bcp, amount: "999", ref: "Sin etiqueta",
    splits: [{ category_id: cats["Hogar"], amount: "999" }] } });

  // Registrar: «Etiquetas · opcional» crea la nueva ahí mismo
  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("80");
  await page.getByRole("button", { name: /^Sale de/ }).click();
  await page.getByRole("radio", { name: /^BCP/ }).click();
  await page.getByRole("button", { name: /En qué/ }).first().click();
  await page.getByRole("dialog").getByRole("radio", { name: "Restaurantes y delivery" }).click();
  await page.getByLabel("Nota").fill("Cena en Cusco");
  await page.getByRole("button", { name: /Etiquetas · opcional/ }).click();
  const hoja = page.getByRole("dialog", { name: "Etiquetas" });
  await hoja.getByLabel("Buscar o crear etiqueta").fill("Viaje a Cusco");
  await hoja.getByRole("button", { name: /Crear «Viaje a Cusco»/ }).click();
  await expect(hoja.getByRole("checkbox", { name: "Viaje a Cusco" })).toHaveAttribute("aria-checked", "true");
  await hoja.getByRole("button", { name: "Listo" }).click();
  await expect(page.getByRole("button", { name: /Etiquetas · opcional/ })).toContainText("Viaje a Cusco");
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(page).toHaveURL("/movimientos");

  // Filtrar por la etiqueta: solo la cena
  await page.getByRole("button", { name: "Etiqueta" }).click();
  await page.getByRole("dialog").getByRole("radio", { name: "Viaje a Cusco" }).click();
  await expect(page).toHaveURL(/etiqueta=\d+/);
  await expect(page.getByRole("link", { name: /Cena en Cusco/ })).toBeVisible();
  await expect(page.getByRole("link", { name: /Sin etiqueta/ })).toHaveCount(0);

  // El detalle la muestra y deja cambiarla
  await page.getByRole("link", { name: /Cena en Cusco/ }).click();
  const fila = page.getByRole("button", { name: /^Etiquetas/ });
  await expect(fila).toContainText("Viaje a Cusco");
  await fila.click();
  await page.getByRole("dialog", { name: "Etiquetas" }).getByLabel("Buscar o crear etiqueta").fill("Comidas");
  await page.getByRole("dialog", { name: "Etiquetas" }).getByRole("button", { name: /Crear «Comidas»/ }).click();
  await page.getByRole("dialog", { name: "Etiquetas" }).getByRole("button", { name: "Listo" }).click();
  await expect(fila).toContainText("Comidas");

  // El reporte: tarjeta en el índice, la etiqueta con su categoría y el enlace a Movimientos
  await page.goto("/mas/reportes");
  await expect(page.getByRole("link", { name: /Etiquetas/ })).toContainText("S/ 80.00");
  await page.getByRole("link", { name: /Etiquetas/ }).click();
  const lista = page.getByRole("region", { name: "Por etiqueta" });
  await lista.getByRole("button", { name: /Viaje a Cusco/ }).click();
  await expect(lista).toContainText("Restaurantes y delivery");
  await lista.getByRole("link", { name: "Ver sus movimientos" }).click();
  await expect(page).toHaveURL(/\/movimientos\?mes=\d{4}-\d{2}&etiqueta=\d+/);

  // Más › Etiquetas: renombrar
  await page.goto("/mas");
  await page.getByRole("link", { name: /Etiquetas/ }).click();
  await page.getByRole("button", { name: /Viaje a Cusco/ }).click();
  const editar = page.getByRole("dialog", { name: "Editar etiqueta" });
  await editar.getByLabel("Nombre").fill("Cusco 2026");
  await editar.getByRole("button", { name: "Guardar" }).click();
  await expect(editar).toBeHidden();
  await expect(page.getByRole("button", { name: /Cusco 2026/ })).toContainText("1 movimiento");
});

test("una recurrente con etiqueta y «Con quién» al registrar, que se cambia desde el detalle", async ({ page }) => {
  const bcp = await readyUser(page);
  await page.request.post("/api/tags", { data: { name: "Ocio" } });
  await page.request.post("/api/partners", { data: { name: "Juan Pérez" } });

  // Se repite, con su etiqueta
  await page.getByRole("link", { name: "Registrar un movimiento" }).click();
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("44.90");
  await page.getByRole("button", { name: /^Sale de/ }).click();
  await page.getByRole("radio", { name: /^BCP/ }).click();
  await page.getByRole("button", { name: /En qué/ }).first().click();
  await page.getByRole("dialog").getByRole("radio", { name: "Software y apps" }).click();
  await page.getByLabel("Nota").fill("Netflix");
  await page.getByRole("switch", { name: /Se repite/ }).check();
  await page.getByRole("button", { name: /Etiquetas · opcional/ }).click();
  await page.getByRole("dialog", { name: "Etiquetas" }).getByRole("checkbox", { name: "Ocio" }).click();
  await page.getByRole("dialog", { name: "Etiquetas" }).getByRole("button", { name: "Listo" }).click();
  await page.getByRole("button", { name: "Guardar recurrente" }).click();
  await expect(page).toHaveURL(/\/mas\/recurrentes\/\d+$/);
  await expect(page.getByText("Ocio")).toBeVisible();

  // Un gasto con «Con quién», solo informativo
  await page.goto(`/registrar?cuenta=${bcp}`);
  await page.getByRole("textbox", { name: "¿Cuánto gastaste?" }).fill("80");
  await page.getByRole("button", { name: /En qué/ }).first().click();
  await page.getByRole("dialog").getByRole("radio", { name: "Restaurantes y delivery" }).click();
  await page.getByLabel("Nota").fill("Cena");
  await page.getByRole("button", { name: /Con quién · opcional/ }).click();
  await page.getByRole("combobox", { name: "Con quién · opcional" }).fill("Juan");
  await page.getByRole("option", { name: /Juan Pérez/ }).click();
  await page.getByRole("button", { name: "Registrar gasto" }).click();
  await expect(page).toHaveURL("/movimientos");
  await page.getByRole("link", { name: /Cena/ }).click();
  const fila = page.getByRole("button", { name: /Con quién/ });
  await expect(fila).toContainText("Juan Pérez");

  // Quitarlo desde el detalle
  await fila.click();
  await page.getByRole("dialog", { name: "Con quién" }).getByRole("button", { name: /Quitar/ }).click();
  await expect(fila).toContainText("Nadie");
});
