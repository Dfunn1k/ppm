// Entrar con Google, de punta a punta con la Google falsa (servicio google-falsa del compose de desarrollo):
// crear la cuenta con Google, unir una que ya existe con su contraseña, y vincular, crear contraseña y
// desvincular desde Mi cuenta.
import { expect, type Page, test } from "@playwright/test";

const PASSWORD = "pan-para-mayo-2026";
const BASE = process.env.BASE_URL ?? "http://web:5173";

function newEmail() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@prueba.ppm`;
}

/** La API manda al navegador a http://localhost:8099 (la Google falsa vista desde tu equipo) y Google
 *  vuelve a APP_URL (localhost:5173). Dentro de Docker, el navegador las alcanza como google-falsa y web.
 *  Playwright no intercepta el destino de una redirección: se corrige la dirección en la respuesta. */
async function throughFakeGoogle(page: Page) {
  const fix = (url: string) => url.replace("http://localhost:8099", "http://google-falsa:8099").replace("http://localhost:5173", BASE);
  const handler = async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    const res = await route.fetch({ maxRedirects: 0 });
    const headers = res.headers();
    if (headers.location) headers.location = fix(headers.location);
    await route.fulfill({ response: res, headers });
  };
  await page.route("**/api/auth/google/start**", handler);
  await page.route("http://google-falsa:8099/**", handler);
}

/** En la Google falsa: elegir la cuenta. */
async function chooseAccount(page: Page, email: string, name = "Ana Torres") {
  await expect(page.getByRole("heading", { name: "Google de prueba" })).toBeVisible();
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Nombre").fill(name);
  await page.getByRole("button", { name: "Continuar" }).click();
}

async function setupSteps(page: Page) {
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Guardar y empezar" }).click();
  await expect(page).toHaveURL("/inicio");
}

test("crear la cuenta con Google, sin contraseña, y crearla luego en Mi cuenta", async ({ page }) => {
  await throughFakeGoogle(page);
  const email = newEmail();
  await page.goto("/entrar");
  await page.getByRole("link", { name: "Continuar con Google" }).click();
  await chooseAccount(page, email, "Ana");
  await expect(page).toHaveURL("/bienvenida/1");
  await expect(page.getByText("Hola, Ana")).toBeVisible();
  await setupSteps(page);

  await page.goto("/mas/cuenta");
  await expect(page.getByText(`Entras con ${email} · para desvincular, primero crea una contraseña`)).toBeVisible();
  await expect(page.getByRole("button", { name: "Desvincular Google" })).toHaveCount(0);
  await page.getByRole("button", { name: /Crear contraseña/ }).click();
  const hoja = page.getByRole("dialog", { name: "Crear contraseña" });
  await hoja.getByLabel("Contraseña nueva").fill(PASSWORD);
  await hoja.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByRole("status")).toContainText("Contraseña creada");
  await page.getByRole("button", { name: "Desvincular Google" }).click();
  await expect(page.getByText(`Entras con ${email}`)).toHaveCount(0);
  await expect(page.getByRole("link", { name: /Vincular con Google/ })).toBeVisible();
});

test("el correo ya tiene cuenta: Google pide su contraseña una vez para unirlas", async ({ page }) => {
  await throughFakeGoogle(page);
  const email = newEmail();
  await page.goto("/crear-cuenta");
  await page.getByLabel("¿Cómo te llamamos?").fill("Dany");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await expect(page).toHaveURL("/bienvenida/1");
  await page.context().clearCookies();

  await page.goto("/entrar");
  await page.getByRole("link", { name: "Continuar con Google" }).click();
  await chooseAccount(page, email);
  await expect(page).toHaveURL("/entrar/google");
  await expect(page.getByRole("heading", { name: "Une tu cuenta con Google" })).toBeVisible();
  await expect(page.getByText(`Ya tienes una cuenta en PPM con ${email}`)).toBeVisible();
  await page.getByLabel("Contraseña de PPM").fill("no-es-esta");
  await page.getByRole("button", { name: "Unir y entrar" }).click();
  await expect(page.getByText("No es la contraseña de esa cuenta")).toBeVisible();
  await page.getByLabel("Contraseña de PPM").fill(PASSWORD);
  await page.getByRole("button", { name: "Unir y entrar" }).click();
  await expect(page).toHaveURL("/bienvenida/1");
  await expect(page.getByText("Hola, Dany")).toBeVisible();

  // Desde ahora entra directo
  await page.context().clearCookies();
  await page.goto("/entrar");
  await page.getByRole("link", { name: "Continuar con Google" }).click();
  await chooseAccount(page, email);
  await expect(page).toHaveURL("/bienvenida/1");
});

test("vincular desde Mi cuenta una Google con otro correo, y cancelar en Google", async ({ page }) => {
  await throughFakeGoogle(page);
  await page.goto("/crear-cuenta");
  await page.getByLabel("¿Cómo te llamamos?").fill("Dany");
  await page.getByLabel("Correo").fill(newEmail());
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await setupSteps(page);

  await page.goto("/mas/cuenta");
  await page.getByRole("link", { name: /Vincular con Google/ }).click();
  await page.getByRole("link", { name: "Cancelar" }).click();
  await expect(page).toHaveURL("/mas/cuenta?google=cancelado");
  await expect(page.getByRole("alert")).toContainText("No se completó la vinculación con Google.");

  const other = newEmail();
  await page.getByRole("link", { name: /Vincular con Google/ }).click();
  await chooseAccount(page, other);
  await expect(page).toHaveURL("/mas/cuenta?google=vinculado");
  await expect(page.getByRole("status")).toContainText("Listo: ya puedes entrar con Google.");
  await expect(page.getByText(`Entras con ${other}`)).toBeVisible();
});
