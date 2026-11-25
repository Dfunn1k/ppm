// La matriz de tamaños de la misión del frontend (docs/frontend/MISION.md): ancho × alto.
// Por debajo de 1024 px se emula un celular o tablet (táctil); desde 1024 px, una computadora.

export type Size = { id: string; width: number; height: number; touch: boolean; note?: string };

const t = (width: number, height: number, note?: string): Size =>
  ({ id: `${width}x${height}`, width, height, touch: width < 1024, note });

export const SIZES: Size[] = [
  t(280, 653, "plegable cerrado"),
  t(320, 568),
  t(360, 800),
  t(375, 667),
  t(390, 844),
  t(393, 852),
  t(412, 915),
  t(430, 932),
  { ...t(844, 390, "celular en horizontal"), touch: true },
  t(768, 1024, "tablet"),
  t(820, 1180, "tablet"),
  { ...t(1024, 768, "riel con poco alto"), touch: false },
  t(1280, 800),
  t(1440, 900),
  t(1920, 1080),
  t(2560, 1440),
];

/** Casos especiales, aproximados (ver «Cómo se toman» en docs/frontend/PROGRESO.md):
 *  - zoom al 200 %: una ventana de 1280×800 con el doble de zoom equivale a 640×400 píxeles CSS.
 *  - texto grande: 390×844 con la letra base del navegador a 20 px en vez de 16 px (125 %).
 *  - teclado abierto: 390×844 menos el teclado virtual (~336 px), solo en formularios. */
export const SPECIAL: Size[] = [
  { id: "zoom200", width: 640, height: 400, touch: false, note: "1280×800 al 200 %" },
  { id: "texto-grande", width: 390, height: 844, touch: true, note: "letra base 125 %" },
  { id: "teclado", width: 390, height: 508, touch: true, note: "390×844 con el teclado abierto" },
];

export const THEMES = ["light", "dark"] as const;
export const ACCENTS = ["tinta", "trigo", "morado", "azul"] as const;

/** Filtros por variable de entorno, para correr una parte: PPM_TAMANOS=390x844,1440x900 */
export function pick<T extends { id: string }>(all: T[], env: string | undefined): T[] {
  if (!env) return all;
  const want = new Set(env.split(",").map((s) => s.trim()));
  return all.filter((x) => want.has(x.id));
}
export const OUT = process.env.PPM_CAPTURAS ?? "capturas-salida";
