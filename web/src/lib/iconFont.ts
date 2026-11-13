// La fuente de íconos que usa la página. Arranca con la de la interfaz (index.html); al conocer a la
// persona se le suman los íconos de sus categorías y cuentas; el selector de íconos pide la completa.
import ui from "@/data/ui-icons.json";

import { iconFontUrl } from "./iconFontUrl";

let full = false;

function setHref(href: string) {
  const link = document.getElementById("icon-font") as HTMLLinkElement | null;
  if (link && link.href !== href) link.href = href;
}

/** Suma a la fuente los íconos de la persona (los de sus categorías y cuentas). */
export function applyIconsOf(icons: string[] | undefined) {
  if (!icons || full) return;
  const missing = icons.filter((i) => !(ui as string[]).includes(i));
  if (missing.length) setHref(iconFontUrl([...(ui as string[]), ...missing]));
}

/** El selector: la fuente con todos los íconos de Material Symbols (solo se descarga aquí). */
export function loadFullIconFont() {
  full = true;
  setHref(iconFontUrl(null));
}
