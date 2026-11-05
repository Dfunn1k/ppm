// Elegir una fecha en el calendario de PPM (una hoja con el mes, el año y los días), como lo haría
// una persona: abrir el campo, saltar al mes y al año, y tocar el día.
import type { Page } from "@playwright/test";

const MESES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

export async function pickDate(page: Page, label: string | RegExp, iso: string) {
  await page.getByRole("button", { name: label }).click();
  await pickInOpenCalendar(page, iso);
}

/** Con el calendario ya abierto (la última hoja): mes, año y día. */
export async function pickInOpenCalendar(page: Page, iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const hoja = page.getByRole("dialog").last();
  await hoja.getByRole("button", { name: /^Elegir el año/ }).click();
  await hoja.getByRole("group", { name: "Años" }).getByRole("button", { name: String(y), exact: true }).click();
  await hoja.getByRole("group", { name: /^Meses de/ }).getByRole("button").nth(m! - 1).click();
  await hoja.getByRole("grid").getByRole("button", { name: new RegExp(`(^|\\D)${d} de ${MESES[m! - 1]}`) }).click();
}
