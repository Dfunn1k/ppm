// Capturas de todas las pantallas en toda la matriz, en claro y en oscuro, con sus medidas.
//   docker compose run --rm e2e corepack pnpm capturas
// Filtros: PPM_TAMANOS=390x844,1440x900  PPM_TEMAS=dark  PPM_PANTALLAS=inicio,movimientos
// Salida (no se sube al repo): capturas-salida/<tema>/<tamaño>/<pantalla>.jpg y medidas/*.json
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { type Browser, type BrowserContext, test } from "@playwright/test";
import type { Ids } from "./datos";
import { ACCENTS, pick, SIZES, type Size, SPECIAL, THEMES } from "./matriz";
import { type Medidas, medir, settle, shoot } from "./medir";
import { screens } from "./pantallas";
import { OUT } from "./matriz";

const ids = (who: string): Ids => JSON.parse(readFileSync(`${OUT}/${who}.ids.json`, "utf8"));
const themes = process.env.PPM_TEMAS ? THEMES.filter((t) => process.env.PPM_TEMAS!.split(",").includes(t)) : THEMES;
const only = process.env.PPM_PANTALLAS?.split(",");

async function open(browser: Browser, size: Size, theme: string, session?: string): Promise<BrowserContext> {
  const ctx = await browser.newContext({
    viewport: { width: size.width, height: size.height },
    isMobile: size.touch, hasTouch: size.touch, deviceScaleFactor: 1,
    colorScheme: theme as "light" | "dark", locale: "es-PE", timezoneId: "America/Lima",
    storageState: session ? `${OUT}/${session}.sesion.json` : undefined,
  });
  return ctx;
}

type Row = { screen: string; path: string; status: string; m?: Medidas; error?: string };

for (const theme of themes) {
  for (const size of [...pick(SIZES, process.env.PPM_TAMANOS), ...pick(SPECIAL, process.env.PPM_TAMANOS ?? "zoom200,texto-grande,teclado")]) {
    test(`${theme} ${size.id}`, async ({ browser }) => {
      test.setTimeout(15 * 60_000);
      const dir = `${OUT}/${theme}/${size.id}`;
      mkdirSync(dir, { recursive: true });
      mkdirSync(`${OUT}/medidas`, { recursive: true });
      const rows: Row[] = [];
      const ctxs = { pub: await open(browser, size, theme), auth: await open(browser, size, theme, "muestra") };
      for (const sc of screens(ids("muestra"))) {
        if (only && !only.includes(sc.id)) continue;
        if (size.id === "teclado" && !sc.form) continue;          // el teclado solo importa en formularios
        const page = await (sc.auth ? ctxs.auth : ctxs.pub).newPage();
        if (size.id === "texto-grande") {
          const cdp = await page.context().newCDPSession(page);
          await cdp.send("Page.setFontSizes", { fontSizes: { standard: 20 } });   // como subir la letra del sistema
        }
        try {
          const r = await page.goto(sc.path);
          await settle(page);
          if (size.id === "teclado") await page.locator("input:visible, textarea:visible").first().focus({ timeout: 2000 }).catch(() => {});
          const m = await medir(page);
          await shoot(page, `${dir}/${sc.id}`);
          rows.push({ screen: sc.id, path: new URL(page.url()).pathname, status: String(r?.status() ?? ""), m });
        } catch (e) {
          rows.push({ screen: sc.id, path: sc.path, status: "error", error: String(e).slice(0, 300) });
        }
        await page.close();
      }
      // La bienvenida (los 3 pasos): con una cuenta recién creada, antes de terminar la configuración
      if (!only || only.includes("bienvenida")) {
        {
          const ctx = await open(browser, size, theme);
          const page = await ctx.newPage();
          try {
            const email = `e2e-capturas-bienvenida-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@prueba.ppm`;
            await page.request.post("/api/auth/signup", { data: { name: "Ana", email, password: "pan-para-mayo-2026" } });
            for (const step of ["1", "2", "3"]) {
              await page.goto(`/bienvenida/${step}`);
              await settle(page);
              const m = await medir(page);
              await shoot(page, `${dir}/bienvenida-${step}`);
              rows.push({ screen: `bienvenida-${step}`, path: new URL(page.url()).pathname, status: "200", m });
            }
          } catch (e) {
            rows.push({ screen: "bienvenida", path: "/bienvenida", status: "error", error: String(e).slice(0, 300) });
          }
          await ctx.close();
        }
      }
      await ctxs.pub.close();
      await ctxs.auth.close();
      writeFileSync(`${OUT}/medidas/${theme}-${size.id}.json`, JSON.stringify({ theme, size, rows }, null, 1));
    });
  }
}

// Cada acento en las pantallas donde más se nota, con la otra persona de muestra
test("acentos", async ({ browser }) => {
  test.setTimeout(10 * 60_000);
  const rows: Row[] = [];
  for (const theme of themes) {
    for (const size of pick(SIZES, "390x844,1440x900")) {
      const ctx = await open(browser, size, theme, "acentos");
      for (const accent of ACCENTS) {
        await ctx.request.patch("/api/me", { data: { ui_accent: accent } });
        const dir = `${OUT}/acentos/${theme}/${size.id}`;
        mkdirSync(dir, { recursive: true });
        for (const [id, path] of [["inicio", "/inicio"], ["registrar", "/registrar"], ["apariencia", "/mas/apariencia"], ["reporte-gastos", "/mas/reportes/gastos"]] as const) {
          const page = await ctx.newPage();
          await page.goto(path);
          await settle(page);
          await shoot(page, `${dir}/${id}-${accent}`);
          rows.push({ screen: `${id}-${accent}`, path, status: "200", m: await medir(page) });
          await page.close();
        }
      }
      await ctx.request.patch("/api/me", { data: { ui_accent: "tinta" } });
      await ctx.close();
    }
  }
  mkdirSync(`${OUT}/medidas`, { recursive: true });
  writeFileSync(`${OUT}/medidas/acentos.json`, JSON.stringify({ rows }, null, 1));
});
