// Recorrido con el teclado: en cada pantalla aprieta Tab hasta dar la vuelta (máximo 120) y anota, por
// cada parada, qué recibió el foco, si el foco se ve (contorno o anillo en el elemento o en la caja que lo
// envuelve), si queda tapado por algo fijo (la barra de abajo, el riel) y si es invisible (mide 0 o está
// dentro de algo con aria-hidden).
//   docker compose run --rm e2e corepack pnpm capturas -g teclado
// Salida: capturas-salida/teclado/<tamaño>.json
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { test } from "@playwright/test";
import type { Ids } from "./datos";
import { OUT, pick, SIZES } from "./matriz";
import { settle } from "./medir";
import { screens } from "./pantallas";

const only = process.env.PPM_PANTALLAS?.split(",");

type Stop = { what: string; visible: boolean; covered: string | null; hidden: boolean };

for (const size of pick(SIZES, process.env.PPM_TAMANOS_TECLADO ?? "390x844,1440x900")) {
  test(`teclado ${size.id}`, async ({ browser }) => {
    test.setTimeout(20 * 60_000);
    const ctx = (session?: string) => browser.newContext({
      viewport: { width: size.width, height: size.height }, colorScheme: "light", locale: "es-PE",
      timezoneId: "America/Lima", storageState: session ? `${OUT}/${session}.sesion.json` : undefined,
    });
    const ctxs = { pub: await ctx(), auth: await ctx("muestra") };
    const ids: Ids = JSON.parse(readFileSync(`${OUT}/muestra.ids.json`, "utf8"));
    const out: object[] = [];
    for (const sc of screens(ids)) {
      if (only && !only.includes(sc.id)) continue;
      const page = await (sc.auth ? ctxs.auth : ctxs.pub).newPage();
      const stops: Stop[] = [];
      try {
        await page.goto(sc.path);
        await settle(page);
        for (let i = 0; i < 120; i++) {
          await page.keyboard.press("Tab");
          const s = await page.evaluate(() => {
            const el = document.activeElement as HTMLElement | null;
            if (!el || el === document.body) return null;
            // Dio la vuelta si vuelve a un elemento ya visitado (no por su posición: al bajar, cambia)
            const seen = el.dataset.tecladoVisto === "1";
            el.dataset.tecladoVisto = "1";
            const name = (el.getAttribute("aria-label") ?? el.innerText ?? (el as HTMLInputElement).placeholder ?? "")
              .replace(/\s+/g, " ").trim().slice(0, 50);
            const what = `${el.tagName.toLowerCase()}${el.getAttribute("role") ? `[${el.getAttribute("role")}]` : ""} «${name}»`;
            const ring = (e: Element) => {
              const cs = getComputedStyle(e);
              return (cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0) || cs.boxShadow !== "none";
            };
            const wrap = el.closest("label, [class*='focus-within']");
            const visible = ring(el) || (!!wrap && ring(wrap))
              || getComputedStyle(el).borderBottomColor !== getComputedStyle(el).borderTopColor;
            const r = el.getBoundingClientRect();
            const hidden = r.width === 0 || r.height === 0 || !!el.closest("[aria-hidden='true']");
            let covered: string | null = null;
            if (!hidden) {
              const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
              const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
              const top = document.elementFromPoint(x, y);
              if (top && !el.contains(top) && !top.contains(el)) {
                let f: Element | null = top;
                while (f && getComputedStyle(f).position !== "fixed" && getComputedStyle(f).position !== "sticky") f = f.parentElement;
                if (f && !f.contains(el)) covered = (f.getAttribute("aria-label") ?? f.className.toString()).slice(0, 60);
              }
            }
            return { what, visible, covered, hidden, seen };
          });
          if (!s) continue;
          if (s.seen) break;
          stops.push({ what: s.what, visible: s.visible, covered: s.covered, hidden: s.hidden });
        }
        out.push({ screen: sc.id, stops });
      } catch (e) {
        out.push({ screen: sc.id, error: String(e).slice(0, 300), stops });
      }
      await page.close();
    }
    await ctxs.pub.close();
    await ctxs.auth.close();
    mkdirSync(`${OUT}/teclado`, { recursive: true });
    writeFileSync(`${OUT}/teclado/${size.id}.json`, JSON.stringify(out, null, 1));
  });
}
