// La URL de Google Fonts para una fuente de Material Symbols Rounded con solo esos íconos
// (icon_names, que Google pide en orden alfabético). Sin lista: la fuente completa (para el selector).
const BASE = "https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..24,400,0..1,0";

export function iconFontUrl(icons: string[] | null): string {
  if (icons === null) return `${BASE}&display=block`;
  return `${BASE}&icon_names=${[...new Set(icons)].sort().join(",")}&display=block`;
}
