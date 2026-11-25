// Junta lo que dejaron las capturas y axe en capturas-salida/RESUMEN.md: por tamaño y tema, el
// scroll horizontal, lo que se toca y mide menos de 44×44 px y los posibles cortes; y las
// violaciones de axe por regla y pantalla.
//   docker compose run --rm e2e node capturas/resumen.mjs
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";

const OUT = process.env.PPM_CAPTURAS ?? "capturas-salida";
const lines = ["# Resumen de las capturas", "", `Generado: ${new Date().toISOString()}`, ""];

const medidas = existsSync(`${OUT}/medidas`) ? readdirSync(`${OUT}/medidas`).filter((f) => f.endsWith(".json")) : [];
lines.push("## Por tamaño y tema", "", "| Tema y tamaño | Pantallas | Con scroll horizontal | Lo que se toca < 44 px (sin enlaces en el texto) | Menos de 24 px | Posibles cortes | Errores |", "|---|---|---|---|---|---|---|");
const overflow = [];
const tiny = new Map();
for (const f of medidas.sort()) {
  const d = JSON.parse(readFileSync(`${OUT}/medidas/${f}`, "utf8"));
  const rows = d.rows ?? [];
  const ox = rows.filter((r) => r.m?.overflowX > 0);
  for (const r of ox) overflow.push(`${f.replace(".json", "")} ${r.screen} (+${r.m.overflowX} px)`);
  let small = 0, below24 = 0, clipped = 0;
  for (const r of rows) {
    const s = (r.m?.small ?? []).filter((x) => !x.inline);
    small += s.length;
    for (const x of s) if (x.w < 24 || x.h < 24) { below24++; tiny.set(x.what, (tiny.get(x.what) ?? 0) + 1); }
    clipped += r.m?.clipped?.length ?? 0;
  }
  lines.push(`| ${f.replace(".json", "")} | ${rows.length} | ${ox.length} | ${small} | ${below24} | ${clipped} | ${rows.filter((r) => r.error).length} |`);
}
lines.push("", "### Con scroll horizontal", "", ...(overflow.length ? overflow.map((x) => `- ${x}`) : ["Ninguna."]));
lines.push("", "### Lo que se toca y mide menos de 24 px (lo más repetido)", "");
for (const [what, n] of [...tiny].sort((a, b) => b[1] - a[1]).slice(0, 40)) lines.push(`- ${what}: ${n}`);

const axeDir = `${OUT}/axe`;
if (existsSync(axeDir)) {
  lines.push("", "## axe (WCAG 2.2 A y AA)", "");
  const byRule = new Map();
  for (const f of readdirSync(axeDir).sort()) {
    for (const s of JSON.parse(readFileSync(`${axeDir}/${f}`, "utf8"))) {
      for (const v of s.violations ?? []) {
        const k = `${v.id} (${v.impact})`;
        const e = byRule.get(k) ?? { help: v.help, where: new Set(), nodes: 0 };
        e.where.add(`${s.screen}@${f.replace(".json", "")}`);
        e.nodes += v.nodes.length;
        byRule.set(k, e);
      }
    }
  }
  lines.push("| Regla | Qué pide | Elementos | Dónde |", "|---|---|---|---|");
  for (const [k, e] of [...byRule].sort((a, b) => b[1].nodes - a[1].nodes)) {
    const where = [...e.where];
    lines.push(`| ${k} | ${e.help} | ${e.nodes} | ${where.slice(0, 8).join(", ")}${where.length > 8 ? ` y ${where.length - 8} más` : ""} |`);
  }
}
writeFileSync(`${OUT}/RESUMEN.md`, lines.join("\n") + "\n");
console.log(`${OUT}/RESUMEN.md`);
