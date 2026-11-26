import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge necesita conocer los tokens de PPM para no confundirlos: sin esto, «text-title-hero»
// parece un color y se borra al lado de «text-foreground».
// En una sola cadena: scripts/ui-icons.mjs busca nombres de ícono entre comillas, y «code» o «toast»
// sueltos se colarían en la fuente de íconos.
const FONT_SIZES = "title-display title-hero title-1 title-2 amount-display amount-display-2 amount-input amount-input-symbol amount-xl amount-lg amount-hero amount body body-strong body-lg body-sm caption caption-sm label code".split(" ");
const LAYERS = "raised dropdown nav panel sheet toast".split(" ");

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["icon-sm", "icon", "icon-md", "icon-lg", "icon-xl"],
      spacing: ["target", "control", "button", "button-sm", "row-sm", "row", "row-option", "avatar", "avatar-sm"],
    },
    classGroups: {
      "font-size": [{ text: FONT_SIZES }],
      z: [{ z: LAYERS }],
    },
  },
});

// Une clases de Tailwind sin que se pisen (la utilidad estándar de shadcn/ui)
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** «a», «a y b», «a, b y c»: una lista dicha como frase, sin «·». */
export function listText(items: (string | false | null | undefined | 0)[]): string {
  const xs = items.filter(Boolean) as string[];
  return xs.length < 2 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`;
}

/** «soles y dólares» → «Soles y dólares». */
export function capitalize(t: string): string {
  return t.charAt(0).toUpperCase() + t.slice(1);
}
