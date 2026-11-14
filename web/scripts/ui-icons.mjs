// Los íconos que usa la interfaz de PPM: toda palabra entre comillas del código (src/) que sea el
// nombre de un ícono de Material Symbols. Con esa lista (más los íconos de las categorías y cuentas
// de cada persona, y data/template-icons.json, los de las categorías de fábrica) se pide a Google Fonts una fuente a la medida en vez de la completa de 1.4 MB.
// Uso: node scripts/ui-icons.mjs  (lo revisa src/lib/icons.test.ts)
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const root = join(process.cwd(), "src");   // se corre desde web/ (el script y vitest)
const catalog = new Set(JSON.parse(readFileSync(join(root, "data/material-icons.json"), "utf8")).icons.map((i) => i[0]));

export function uiIcons() {
  const found = new Set();
  const walk = (dir) => {
    for (const f of readdirSync(dir)) {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) { if (f !== "data") walk(p); continue; }
      if (!/\.(ts|tsx)$/.test(f) || /\.test\.tsx?$/.test(f)) continue;
      for (const m of readFileSync(p, "utf8").matchAll(/["'`]([a-z][a-z0-9_]*)["'`]/g)) {
        if (catalog.has(m[1])) found.add(m[1]);
      }
    }
  };
  walk(root);
  // Más los de las categorías que trae PPM de fábrica (account_account_template), para que la fuente
  // base ya los tenga y solo haga falta otra si la persona elige uno distinto
  for (const i of JSON.parse(readFileSync(join(root, "data/template-icons.json"), "utf8"))) if (catalog.has(i)) found.add(i);
  return [...found].sort();
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const list = uiIcons();
  writeFileSync(join(root, "data/ui-icons.json"), JSON.stringify(list) + "\n");
  console.log(`${list.length} íconos de la interfaz`);
}
