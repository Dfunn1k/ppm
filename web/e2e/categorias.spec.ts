// Categorías de punta a punta: crear una dentro de un grupo, una con un grupo nuevo y una de
// ingreso desde Más › Categorías, y usarla al registrar.
import { expect, type Page, test } from "@playwright/test";

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

async function chooseGroup(page: Page, name: string) {
  await page.getByRole("button", { name: /¿Dentro de qué grupo?/ }).click();
  await page.getByRole("dialog").getByRole("radio", { name }).click();
}

async function chooseIcon(page: Page, search: string, icon: string) {
  await page.getByLabel("Buscar ícono").fill(search);
  await page.getByRole("radiogroup", { name: "Ícono" }).getByRole("radio", { name: icon }).click();
}

test("crear una de gasto en un grupo, otra con un grupo nuevo y usarla al registrar", async ({ page }) => {
  await readyUser(page);
  await page.goto("/mas");
  await page.getByRole("link", { name: /Categorías/ }).click();
  await expect(page).toHaveURL("/mas/categorias");
  await page.getByRole("link", { name: "Nueva categoría de gasto" }).click();

  await page.getByLabel("Nombre", { exact: true }).fill("Panadería");
  await chooseGroup(page, "Comida y bebida");
  await chooseIcon(page, "pan", "bakery_dining");
  await expect(page.getByRole("status")).toContainText("Gasto · dentro de Comida y bebida · su color");
  await page.getByRole("button", { name: "Crear categoría" }).click();
  await expect(page).toHaveURL("/mas/categorias");
  const comida = page.getByRole("listitem").filter({ hasText: "Comida y bebida" });
  await expect(comida).toContainText("Panadería");

  await page.getByRole("link", { name: "Nueva categoría de gasto" }).click();
  await chooseGroup(page, "Un grupo nuevo");
  await page.getByLabel("Nombre del grupo").fill("Mascotas");
  await page.getByLabel("Nombre", { exact: true }).fill("Veterinario");
  await chooseIcon(page, "perro", "pets");
  await page.getByRole("radio", { name: "frambuesa" }).click();
  await expect(page.getByRole("status")).toContainText("Gasto · dentro de Mascotas, grupo nuevo");
  await page.getByRole("button", { name: "Crear categoría" }).click();
  const mascotas = page.getByRole("listitem").filter({ has: page.getByText("Mascotas", { exact: true }) });
  await expect(mascotas).toContainText("1 categoría");
  await expect(mascotas).toContainText("Veterinario");

  // repetir el nombre del grupo se avisa
  await page.getByRole("link", { name: "Nueva categoría de gasto" }).click();
  await chooseGroup(page, "Un grupo nuevo");
  await page.getByLabel("Nombre del grupo").fill("Mascotas");
  await page.getByLabel("Nombre", { exact: true }).fill("Otra");
  await chooseIcon(page, "perro", "pets");
  await page.getByRole("button", { name: "Crear categoría" }).click();
  await expect(page.getByText("Ya tienes un grupo con ese nombre")).toBeVisible();

  await page.goto("/registrar");
  await page.getByRole("button", { name: /En qué/ }).first().click();
  await expect(page.getByRole("dialog").getByRole("radio", { name: "Veterinario" })).toBeVisible();
});

test("una de ingreso va suelta", async ({ page }) => {
  await readyUser(page);
  await page.goto("/mas/categorias");
  await page.getByRole("radio", { name: "De ingreso" }).click();
  await page.getByRole("link", { name: "Nueva categoría de ingreso" }).click();
  await expect(page.getByText("Las de ingreso van sueltas: no tienen grupo.")).toBeVisible();
  await page.getByLabel("Nombre", { exact: true }).fill("Freelance");
  await chooseIcon(page, "freelance", "work");
  await page.getByRole("button", { name: "Crear categoría" }).click();
  await expect(page).toHaveURL("/mas/categorias?tipo=ingreso");
  await expect(page.getByRole("listitem").filter({ hasText: "Ingresos" })).toContainText("Freelance");
});
