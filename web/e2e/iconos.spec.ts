// La fuente de íconos a la medida: cada ícono que usa la interfaz se dibuja como ícono (un cuadrado),
// no como su nombre en letras. Si falla, falta regenerar src/data/ui-icons.json o el ícono no existe.
// Y el catálogo de «Todos los íconos» (Nueva categoría) solo trae nombres que la fuente completa dibuja.
import { readFileSync } from "node:fs";

import { expect, test } from "@playwright/test";

import { iconFontUrl } from "../src/lib/iconFontUrl";

const icons = JSON.parse(readFileSync(new URL("../src/data/ui-icons.json", import.meta.url), "utf8")) as string[];
const catalog = (JSON.parse(readFileSync(new URL("../src/data/material-icons.json", import.meta.url), "utf8")) as { icons: [string, string, number][] })
  .icons.map((i) => i[0]);

/** Los nombres que, con la fuente de esa URL, salen en letras en vez de como un cuadrado. */
async function inLetters(page: import("@playwright/test").Page, href: string, names: string[]) {
  return page.evaluate(async ({ href, names }) => {
    const link = Object.assign(document.createElement("link"), { rel: "stylesheet", href });
    document.head.append(link);
    await new Promise((r) => { link.onload = r; });
    const box = document.createElement("div");
    box.innerHTML = names.map((n) => `<span class="ms-check" style="font-family:'Material Symbols Rounded';font-size:24px;line-height:1;display:inline-block;white-space:nowrap">${n}</span>`).join("");
    document.body.append(box);
    await document.fonts.load("24px 'Material Symbols Rounded'", "home");
    await document.fonts.ready;
    await new Promise((r) => setTimeout(r, 500));
    return [...box.querySelectorAll<HTMLElement>(".ms-check")].filter((s) => s.getBoundingClientRect().width > 36).map((s) => s.textContent);
  }, { href, names });
}

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

test("cada ícono del catálogo de «Todos los íconos» existe en la fuente completa", async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto("/entrar");
  expect(await inLetters(page, iconFontUrl(null), catalog)).toEqual([]);
});
