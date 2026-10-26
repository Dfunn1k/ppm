// Los meses en palabras y los que se ofrecen en el selector (Inicio y Movimientos).
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Setiembre", "Octubre", "Noviembre", "Diciembre"];

/** «2026-10» → «Octubre 2026». */
export function monthName(ym: string) {
  return `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;
}

/** «2026-10» → «Octubre». */
export function monthOnly(ym: string) {
  return MONTHS[Number(ym.slice(5, 7)) - 1] ?? "";
}

/** Los últimos 12 meses y el siguiente (para lo que está por confirmar), el más nuevo primero. */
export function monthOptions(): string[] {
  const now = new Date();
  return Array.from({ length: 14 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() + 1 - i, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  });
}
