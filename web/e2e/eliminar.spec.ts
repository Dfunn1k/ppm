// La página de privacidad (pública) y Eliminar mi cuenta: con la contraseña, o con el correo si la
// cuenta se creó con Google. Después vuelve a Iniciar sesión con el aviso y la cuenta ya no entra.
import { expect, type Page, test } from "@playwright/test";

const PASSWORD = "pan-para-mayo-2026";
const BASE = process.env.BASE_URL ?? "http://web:5173";

function newEmail() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@prueba.ppm`;
}

async function setupSteps(page: Page) {
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByRole("heading", { name: "¿Usas otras monedas?" })).toBeVisible();   // el paso 2 ya se dibujó
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Guardar y empezar" }).click();
  await expect(page).toHaveURL("/inicio");
}

test("la privacidad se abre sin sesión, desde Iniciar sesión", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByRole("link", { name: "Privacidad" }).click();
  await expect(page).toHaveURL("/privacidad");
  await expect(page.getByRole("heading", { name: "Privacidad", level: 1 })).toBeVisible();
  await expect(page.getByText("No lee tu Gmail, tu Drive ni tus contactos")).toBeVisible();
  await expect(page.getByRole("link", { name: "privacidad@ppm.local" })).toBeVisible();
  await page.getByRole("button", { name: "Volver" }).click();
  await expect(page).toHaveURL("/entrar");
});

test("eliminar la cuenta con su contraseña", async ({ page }) => {
  const email = newEmail();
  await page.goto("/crear-cuenta");
  await page.getByLabel("¿Cómo te llamamos?").fill("Dany");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
  await setupSteps(page);

  await page.goto("/mas/cuenta");
  await page.getByRole("link", { name: /Eliminar mi cuenta/ }).click();
  await expect(page.getByRole("heading", { name: "Eliminar tu cuenta" })).toBeVisible();
  const lost = page.getByRole("definition");
  await expect(lost.first()).not.toHaveText("…");
  await page.getByLabel("Tu contraseña de PPM").fill("no-es-esta");
  await page.getByRole("button", { name: "Eliminar mi cuenta" }).click();
  await expect(page.getByText("No es tu contraseña")).toBeVisible();
  await page.getByLabel("Tu contraseña de PPM").fill(PASSWORD);
  await page.getByRole("button", { name: "Eliminar mi cuenta" }).click();

  await expect(page).toHaveURL("/entrar?cuenta=eliminada");
  await expect(page.getByRole("status")).toContainText("Tu cuenta se eliminó.");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
  await expect(page.getByText("Correo o contraseña incorrectos")).toBeVisible();
});

test("eliminar una cuenta creada con Google: se confirma con el correo", async ({ page }) => {
  // Igual que en google.spec.ts: el navegador alcanza a la Google falsa y a la web por sus nombres en Docker
  const fix = (url: string) => url.replace("http://localhost:8099", "http://google-falsa:8099").replace("http://localhost:5173", BASE);
  const handler = async (route: Parameters<Parameters<Page["route"]>[1]>[0]) => {
    const res = await route.fetch({ maxRedirects: 0 });
    const headers = res.headers();
    if (headers.location) headers.location = fix(headers.location);
    await route.fulfill({ response: res, headers });
  };
  await page.route("**/api/auth/google/start**", handler);
  await page.route("http://google-falsa:8099/**", handler);

  const email = newEmail();
  await page.goto("/entrar");
  await page.getByRole("link", { name: "Continuar con Google" }).click();
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Nombre").fill("Ana");
  await page.getByRole("button", { name: "Continuar" }).click();
  await expect(page).toHaveURL("/bienvenida/1");
  await setupSteps(page);

  await page.goto("/mas/cuenta/eliminar");
  await expect(page.getByText(`Para confirmar: ${email}`)).toBeVisible();
  await page.getByLabel("Escribe tu correo").fill("otro@prueba.ppm");
  await page.getByRole("button", { name: "Eliminar mi cuenta" }).click();
  await expect(page.getByText("No es tu correo")).toBeVisible();
  await page.getByLabel("Escribe tu correo").fill(email);
  await page.getByRole("button", { name: "Eliminar mi cuenta" }).click();
  await expect(page).toHaveURL("/entrar?cuenta=eliminada");
});
