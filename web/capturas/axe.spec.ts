// Auditoría automática de accesibilidad con axe (WCAG 2.0, 2.1 y 2.2, niveles A y AA) en cada
// pantalla, en el celular y en la computadora, en claro y en oscuro.
//   docker compose run --rm e2e corepack pnpm capturas -g axe
// Salida: capturas-salida/axe/<tema>-<tamaño>.json (cada violación con sus nodos)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import AxeBuilder from "@axe-core/playwright";
import { test } from "@playwright/test";
import type { Ids } from "./datos";
import { pick, SIZES, THEMES } from "./matriz";
import { settle } from "./medir";
import { screens } from "./pantallas";
import { OUT } from "./matriz";

const only = process.env.PPM_PANTALLAS?.split(",");

for (const theme of THEMES) {
  for (const size of pick(SIZES, process.env.PPM_TAMANOS_AXE ?? "390x844,1440x900")) {
    test(`axe ${theme} ${size.id}`, async ({ browser }) => {
      test.setTimeout(15 * 60_000);
      const ctx = (session?: string) => browser.newContext({
        viewport: { width: size.width, height: size.height }, isMobile: size.touch, hasTouch: size.touch,
        colorScheme: theme, locale: "es-PE", timezoneId: "America/Lima",
        storageState: session ? `${OUT}/${session}.sesion.json` : undefined,
      });
      const ctxs = { pub: await ctx(), auth: await ctx("muestra") };
      const out: object[] = [];
      const ids: Ids = JSON.parse(readFileSync(`${OUT}/muestra.ids.json`, "utf8"));   // lo deja «preparar»
      for (const sc of screens(ids)) {
        if (only && !only.includes(sc.id)) continue;
        const page = await (sc.auth ? ctxs.auth : ctxs.pub).newPage();
        try {
          await page.goto(sc.path);
          await settle(page);
          const r = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
          out.push({ screen: sc.id, path: sc.path, violations: r.violations.map((v) => ({
            id: v.id, impact: v.impact, help: v.help, tags: v.tags,
            nodes: v.nodes.map((n) => ({ target: n.target.join(" "), summary: n.failureSummary?.slice(0, 300) })),
          })) });
        } catch (e) {
          out.push({ screen: sc.id, path: sc.path, error: String(e).slice(0, 300) });
        }
        await page.close();
      }
      await ctxs.pub.close();
      await ctxs.auth.close();
      mkdirSync(`${OUT}/axe`, { recursive: true });
      writeFileSync(`${OUT}/axe/${theme}-${size.id}.json`, JSON.stringify(out, null, 1));
    });
  }
}
