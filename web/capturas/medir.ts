// Lo que se mide en cada captura, dentro de la página: scroll horizontal, lo que se toca y mide
// menos de 44×44 px y los textos que no caben en su caja (posibles cortes).
import type { Page } from "@playwright/test";

export type Medidas = {
  overflowX: number;                 // cuántos px se pasa de ancho (0 = sin scroll horizontal)
  small: { what: string; w: number; h: number; inline: boolean }[];
  clipped: { what: string; w: number; scroll: number; h: number; scrollH: number }[];
};

export function medir(page: Page): Promise<Medidas> {
  return page.evaluate(() => {
    const label = (el: Element) => {
      const aria = el.getAttribute("aria-label");
      const text = (aria ?? (el as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim();
      return `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""} «${text.slice(0, 40)}»`;
    };
    const visible = (el: Element) => {
      const r = el.getBoundingClientRect();
      const st = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && st.visibility !== "hidden" && st.display !== "none";
    };
    const sel = "a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=radio],[role=switch],[role=checkbox],[role=option],[tabindex]:not([tabindex='-1'])";
    const small: Medidas["small"] = [];
    for (const el of document.querySelectorAll(sel)) {
      if (!visible(el)) continue;
      // Un campo dentro de su etiqueta (o con label for) se toca por toda la etiqueta: se mide la más grande
      const own = el.getBoundingClientRect();
      const lab = el.closest("label") ?? (el.id ? document.querySelector(`label[for="${CSS.escape(el.id)}"]`) : null);
      const box = lab && lab.getBoundingClientRect().width * lab.getBoundingClientRect().height > own.width * own.height ? lab.getBoundingClientRect() : own;
      // Lo que se ve chico pero se toca en grande (la utilidad hit-area: un ::after de al menos 44×44)
      const after = getComputedStyle(el, "::after");
      const grow = after.position === "absolute" && after.content !== "none" ? { w: parseFloat(after.width) || 0, h: parseFloat(after.height) || 0 } : { w: 0, h: 0 };
      const r = { width: Math.max(box.width, grow.w), height: Math.max(box.height, grow.h) };
      if (r.width < 44 || r.height < 44) {
        small.push({ what: label(lab ?? el), w: Math.round(r.width), h: Math.round(r.height), inline: getComputedStyle(el).display === "inline" });
      }
    }
    const clipped: Medidas["clipped"] = [];
    for (const el of document.querySelectorAll("body *")) {
      const h = el as HTMLElement;
      if (!h.childNodes.length || !visible(el)) continue;
      const st = getComputedStyle(el);
      const hides = ["hidden", "clip"].includes(st.overflowX) || ["hidden", "clip"].includes(st.overflowY);
      // Lo que se recorta sin «…»: el texto no cabe en su caja, ni a lo ancho ni a lo alto
      const over = h.scrollWidth > h.clientWidth + 2 || h.scrollHeight > h.clientHeight + 2;   // 1-2 px es el ícono más alto que la línea
      if (hides && st.textOverflow !== "ellipsis" && !st.webkitLineClamp?.match(/\d/) && over && h.innerText?.trim() && !h.classList.contains("icon")) {
        clipped.push({ what: label(el), w: h.clientWidth, scroll: h.scrollWidth, h: h.clientHeight, scrollH: h.scrollHeight });
      }
    }
    return { overflowX: Math.max(0, document.documentElement.scrollWidth - window.innerWidth), small, clipped };
  });
}

/** Esperar a que la pantalla termine de cargar: red quieta, tipografías y un respiro para Recharts. */
export async function settle(page: Page) {
  await page.waitForLoadState("networkidle").catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(300);
}

/** Dos fotos: lo que se ve al abrir (`<id>.jpg`) y, si la página es más alta que la ventana, la página
 *  entera (`<id>-entera.jpg`) estirando la ventana a su alto, para que la barra de abajo quede abajo
 *  (con fullPage de Playwright, lo fijo queda flotando a media página). */
export async function shoot(page: Page, file: string) {
  const opts = { type: "jpeg", quality: 60, animations: "disabled" } as const;
  await page.screenshot({ ...opts, path: `${file}.jpg` });
  const vp = page.viewportSize()!;
  const height = await page.evaluate(() => Math.max(document.documentElement.scrollHeight, document.body.scrollHeight));
  if (height > vp.height + 4) {
    await page.setViewportSize({ width: vp.width, height: Math.min(height, 12_000) });
    await page.waitForTimeout(200);
    await page.screenshot({ ...opts, path: `${file}-entera.jpg` });
    await page.setViewportSize(vp);
  }
}
