// Los recorridos de acceso, como los haría una persona, contra la API y la base de verdad.
// Cada prueba usa un correo nuevo @prueba.ppm.
import { expect, type Page, test } from "@playwright/test";

const PASSWORD = "pan-para-mayo-2026";
const MAILPIT = process.env.MAILPIT_URL ?? "http://mailpit:8025";

function newEmail() {
  return `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 8)}@prueba.ppm`;
}

async function signup(page: Page, email: string, name = "Dany") {
  await page.goto("/crear-cuenta");
  await page.getByLabel("¿Cómo te llamamos?").fill(name);
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(PASSWORD);
  await page.getByRole("button", { name: "Crear cuenta" }).click();
}

async function login(page: Page, email: string, password = PASSWORD) {
  await page.goto("/entrar");
  await page.getByLabel("Correo").fill(email);
  await page.getByLabel("Contraseña", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Iniciar sesión" }).click();
}

/** El enlace del último correo que recibió `email` en Mailpit. */
async function resetLinkFor(email: string) {
  for (let i = 0; i < 20; i++) {
    const search = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
    const { messages } = (await search.json()) as { messages: { ID: string }[] };
    if (messages.length) {
      const message = (await (await fetch(`${MAILPIT}/api/v1/message/${messages[0]!.ID}`)).json()) as { Text: string };
      const token = /\/restablecer\?token=(\S+)/.exec(message.Text)?.[1];
      if (token) return `/restablecer?token=${token}`;
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`No llegó el correo a ${email}`);
}

test("crear cuenta, los 3 pasos y llegar al inicio", async ({ page }) => {
  await signup(page, newEmail(), "Ana");

  await expect(page).toHaveURL("/bienvenida/1");
  await expect(page.getByRole("heading", { name: "¿Dónde vives?" })).toBeVisible();
  await expect(page.getByText("Hola, Ana")).toBeVisible();
  await expect(page.getByText("S/ 1,284.90")).toBeVisible();
  await page.getByRole("button", { name: /^Idioma y formato/ }).click();
  await page.getByRole("radio", { name: /Español \(España\)/ }).click();
  await expect(page.getByText("S/ 1.284,90")).toBeVisible();
  await page.getByRole("button", { name: /^Idioma y formato/ }).click();
  await page.getByRole("radio", { name: /Español \(Perú\)/ }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();

  await expect(page).toHaveURL("/bienvenida/2");
  await expect(page.getByLabel("Dólar estadounidense")).toBeChecked();
  await page.getByLabel("Volver al paso 1").click();
  await expect(page).toHaveURL("/bienvenida/1");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await expect(page.getByLabel("Dólar estadounidense")).toBeChecked(); // volver no borra lo elegido
  await page.getByRole("button", { name: "Siguiente" }).click();

  await expect(page).toHaveURL("/bienvenida/3");
  await expect(page.getByText("soles y dólares")).toBeVisible();
  await page.getByRole("button", { name: "Guardar y empezar" }).click();

  await expect(page).toHaveURL("/inicio");
  await expect(page.getByText("Lo que realmente tengo · hoy")).toBeVisible();
  await page.getByRole("link", { name: "Más" }).click();
  await page.getByRole("link", { name: /Ana/ }).click();
  await expect(page.getByRole("heading", { name: "Ana" })).toBeVisible();
  await expect(page.getByText("soles y dólares", { exact: false })).toBeVisible();

  // Ya configurada, los pasos no vuelven
  await page.goto("/bienvenida/1");
  await expect(page).toHaveURL("/inicio");
});

test("cerrar sesión y volver a entrar", async ({ page }) => {
  const email = newEmail();
  await signup(page, email);
  await expect(page).toHaveURL("/bienvenida/1");
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Siguiente" }).click();
  await page.getByRole("button", { name: "Guardar y empezar" }).click();
  await expect(page).toHaveURL("/inicio");
  await page.goto("/mas/cuenta");
  await page.getByRole("button", { name: "Cerrar sesión", exact: true }).click();

  await expect(page).toHaveURL("/entrar");
  await page.goto("/inicio");
  await expect(page).toHaveURL("/entrar"); // sin sesión, no hay inicio

  await login(page, email);
  await expect(page).toHaveURL("/inicio");
});

test("un correo ya usado lo dice y ofrece entrar", async ({ page, browser }) => {
  const email = newEmail();
  await signup(page, email);
  await expect(page).toHaveURL("/bienvenida/1");

  const other = await browser.newPage();
  await signup(other, email.toUpperCase());
  await expect(other.getByRole("alert")).toContainText("Ese correo ya tiene una cuenta");
  await expect(other.getByRole("link", { name: "Inicia sesión" }).first()).toBeVisible();
});

test("correo o contraseña incorrectos", async ({ page }) => {
  await login(page, newEmail(), "no-es-esta");
  await expect(page.getByRole("alert")).toContainText("Correo o contraseña incorrectos. Revísalos e intenta otra vez.");
  await expect(page).toHaveURL("/entrar");
});

test("recuperar la contraseña con el enlace del correo", async ({ page }) => {
  const email = newEmail();
  await signup(page, email);
  await expect(page).toHaveURL("/bienvenida/1");
  await page.context().clearCookies();

  await page.goto("/entrar");
  await page.getByRole("link", { name: "¿Olvidaste tu contraseña?" }).click();
  await expect(page.getByRole("heading", { name: "Recupera tu contraseña." })).toBeVisible();
  await page.getByLabel("Correo").fill(email);
  await page.getByRole("button", { name: "Enviar enlace" }).click();
  await expect(page.getByRole("heading", { name: "Revisa tu correo." })).toBeVisible();

  const link = await resetLinkFor(email);
  await page.goto(link);
  await page.getByLabel("Contraseña nueva").fill("otra-frase-larga-mia");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();

  await expect(page).toHaveURL("/entrar");
  await expect(page.getByRole("status")).toContainText("Contraseña cambiada. Entra con la nueva.");
  await login(page, email, "otra-frase-larga-mia");
  await expect(page).toHaveURL("/bienvenida/1");

  // El enlace sirve una sola vez
  await page.context().clearCookies();
  await page.goto(link);
  await page.getByLabel("Contraseña nueva").fill("una-tercera-frase");
  await page.getByRole("button", { name: "Guardar contraseña" }).click();
  await expect(page.getByRole("heading", { name: "Este enlace ya no sirve." })).toBeVisible();
});
