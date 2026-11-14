// La fuente de íconos a la medida: cada ícono que usa la interfaz se dibuja como ícono (un cuadrado),
// no como su nombre en letras. Si falla, falta regenerar src/data/ui-icons.json o el ícono no existe.
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

const icons = JSON.parse(readFileSync(new URL("../src/data/ui-icons.json", import.meta.url), "utf8")) as string[];

test("todos los íconos de la interfaz están en la fuente a la medida", async ({ page }) => {
  await page.goto("/entrar");
  const href = await page.locator("#icon-font").getAttribute("href");
  expect(href).toContain("icon_names=");
  const wide = await page.evaluate(async (names) => {
    const box = document.createElement("div");
    box.innerHTML = names.map((n) => `<span class="ms-check" style="font-family:'Material Symbols Rounded';font-size:24px;line-height:1;display:inline-block">${n}</span>`).join("");
    document.body.append(box);
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 300));
    return [...box.querySelectorAll<HTMLElement>(".ms-check")].filter((s) => s.getBoundingClientRect().width > 36).map((s) => s.textContent);
  }, icons);
  expect(wide).toEqual([]);
});
