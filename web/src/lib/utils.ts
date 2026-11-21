import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

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
