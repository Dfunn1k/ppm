// @vitest-environment node
// El inspector de estilos (docs/frontend/SISTEMA.md, 4.2): falla si un archivo de web/src tiene más
// valores escritos a mano que su tope en estilo-tope.json, y también si tiene menos (para que el tope
// baje junto con el arreglo). Así la cuenta solo puede achicarse. Al terminar la Fase 4, los topes
// quedan en cero y solo valen las excepciones de estilo-excepciones.ts.
//   Bajar los topes después de arreglar algo:  ESTILO_TOPE=bajar pnpm test estilo
//   (El primer tope se creó una sola vez con ESTILO_TOPE=crear, el 25-nov, con lo que había.)
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { describe, expect, it } from "vitest";
import { EXCEPCIONES } from "./estilo-excepciones";

const SRC = join(process.cwd(), "src");
const TOPE = join(SRC, "estilo-tope.json");

/** Lo que el inspector cuenta, con la regla de SISTEMA.md 4.1 que rompe. */
export const REGLAS: Record<string, { re: RegExp; solo?: RegExp; que: string }> = {
  arbitrario: {
    // algo-[…] de Tailwind, salvo los selectores (aria-[…], data-[…], has-[…], supports-[…]) y las variantes de grupo
    re: /(?<![\w-])(?:[\w-]+:)*(?!aria-|data-|has-|supports-|group-|peer-|not-)[a-z][a-z0-9-]*-\[[^\]\s"'`]+\]/g,
    que: "valor arbitrario de Tailwind: usa un token (regla 1)",
  },
  hex: { re: /#[0-9a-fA-F]{3,8}\b(?![-\w])/g, solo: /\.tsx?$/, que: "color hex en un componente (regla 1)" },
  rgb: { re: /\b(?:rgba?|hsla?|color-mix)\(/g, solo: /\.tsx?$/, que: "rgb(), hsl() o color-mix() en un componente (regla 1)" },
  colorTailwind: {
    re: /(?<![\w-])(?:[\w-]+:)*(?:bg|text|border|ring|fill|stroke|from|via|to|outline|decoration|divide|shadow)-(?:black|white|slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose)(?:-\d{2,3})?(?:\/\d+)?(?![\w-])/g,
    que: "color de Tailwind fuera del tema (regla 1)",
  },
  sombra: { re: /(?<![\w-])(?:[\w-]+:)*shadow(?:-md|-xl|-2xl|-xs)?(?![\w-])/g, solo: /\.tsx?$/, que: "sombra que no es shadow-sm ni shadow-lg (1.7)" },
  radio: { re: /(?<![\w-])(?:[\w-]+:)*rounded(?:-(?:2xl|3xl))?(?![\w-])/g, solo: /\.tsx?$/, que: "radio sin token: usa rounded-xs a rounded-xl (1.6)" },
  capa: { re: /(?<![\w-])(?:[\w-]+:)*z-\d+(?![\w-])/g, solo: /\.tsx?$/, que: "capa con número: usa z-raised, z-nav… (1.8)" },
  enLinea: { re: /style=\{\{(?![^}]*(?:%|var\(--|\$\{))/g, solo: /\.tsx$/, que: "estilo en línea sin nada dinámico (regla 2)" },
  importante: { re: /!important/g, que: "!important: solo en «reducir movimiento» (regla 2)" },
  aMano: { re: /\.(?:toFixed|toLocaleString)\(/g, solo: /\.tsx$/, que: "monto o número formateado a mano: usa money.ts (regla 6)" },
};

type Cuenta = Record<string, Record<string, number>>;

function archivos(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = join(dir, e.name);
    if (e.isDirectory()) return e.name === "api" ? [] : archivos(p);
    return /\.(tsx?|css)$/.test(e.name) && !/\.test\.tsx?$|estilo-excepciones\.ts$|\.d\.ts$/.test(e.name) ? [p] : [];
  });
}

/** Quita los comentarios para no contar lo que se explica en ellos. */
function sinComentarios(texto: string) {
  return texto.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
}

export function contar(): Cuenta {
  const out: Cuenta = {};
  for (const f of archivos(SRC)) {
    const rel = relative(SRC, f);
    const texto = sinComentarios(readFileSync(f, "utf8"));
    for (const [k, r] of Object.entries(REGLAS)) {
      if (r.solo && !r.solo.test(f)) continue;
      let n = texto.match(r.re)?.length ?? 0;
      n -= EXCEPCIONES.filter((e) => e.archivo === rel && e.regla === k).reduce((a, e) => a + e.veces, 0);
      if (n > 0) (out[rel] ??= {})[k] = n;
    }
  }
  return out;
}

describe("inspector de estilos", () => {
  const hoy = contar();
  if (!existsSync(TOPE) && process.env.ESTILO_TOPE === "crear") writeFileSync(TOPE, JSON.stringify(hoy, null, 1) + "\n");
  const tope: Cuenta = JSON.parse(readFileSync(TOPE, "utf8"));

  if (process.env.ESTILO_TOPE === "bajar") {
    const nuevo: Cuenta = {};
    for (const [f, ks] of Object.entries(tope)) for (const [k, n] of Object.entries(ks)) {
      const v = Math.min(n, hoy[f]?.[k] ?? 0);
      if (v > 0) (nuevo[f] ??= {})[k] = v;
    }
    writeFileSync(TOPE, JSON.stringify(nuevo, null, 1) + "\n");
  }

  it("ningún archivo pasa su tope", () => {
    const pasados = Object.entries(hoy).flatMap(([f, ks]) => Object.entries(ks)
      .filter(([k, n]) => n > (tope[f]?.[k] ?? 0))
      .map(([k, n]) => `${f}: ${n} × ${REGLAS[k]!.que} (tope ${tope[f]?.[k] ?? 0})`));
    expect(pasados, "Hay valores escritos a mano nuevos. Usa los tokens y moldes de docs/frontend/SISTEMA.md").toEqual([]);
  });

  it.skipIf(process.env.ESTILO_TOPE)("el tope baja cuando se arregla algo", () => {
    const sobra = Object.entries(tope).flatMap(([f, ks]) => Object.entries(ks)
      .filter(([k, n]) => n > (hoy[f]?.[k] ?? 0))
      .map(([k, n]) => `${f}: ${k} tope ${n}, hay ${hoy[f]?.[k] ?? 0}`));
    expect(sobra, "Arreglaste algo: baja el tope con ESTILO_TOPE=bajar pnpm test estilo").toEqual([]);
  });

  it("cada excepción dice por qué", () => {
    for (const e of EXCEPCIONES) expect(e.motivo.length, `${e.archivo}`).toBeGreaterThan(10);
  });
});
