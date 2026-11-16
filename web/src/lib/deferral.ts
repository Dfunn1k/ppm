// Repartir en el tiempo: el mismo calendario que arma la API (app/moves.py · deferral_schedule), para
// mostrar en Registrar cómo se reparte antes de guardar. Por días: una parte por mes según los días
// que cubre; por meses: partes iguales el mismo día de cada mes. La última cierra el redondeo.
import { add, divide, proportion, subtract } from "./money";

export type DeferralMethod = "days" | "months";
export type DeferralPart = { date: string; days: number | null; amount: string };

const iso = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const parts = (s: string) => s.split("-").map(Number) as [number, number, number];
const lastDay = (y: number, m: number) => new Date(y, m, 0).getDate();
const dayNumber = (s: string) => { const [y, m, d] = parts(s); return Date.UTC(y, m - 1, d) / 864e5; };

/** El mismo día k meses después; si ese mes es más corto, su último día (31 ene → 28 feb). */
export function addMonths(on: string, k: number): string {
  const [y, m, d] = parts(on);
  const total = y * 12 + (m - 1) + k;
  const year = Math.floor(total / 12), month = (total % 12) + 1;
  return iso(year, month, Math.min(d, lastDay(year, month)));
}

/** Un día antes: el fin de un periodo de un año que empieza hoy es dentro de un año menos un día. */
export function dayBefore(on: string): string {
  const [y, m, d] = parts(on);
  const t = new Date(Date.UTC(y, m - 1, d - 1));
  return iso(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

export function daysBetween(start: string, end: string): number {
  return dayNumber(end) - dayNumber(start) + 1;
}

/** Las partes, o null si así no se puede repartir (que la API dirá por qué). */
export function deferralSchedule(total: string, method: DeferralMethod, start: string, end: string | null,
  months: number | null): DeferralPart[] | null {
  const out: DeferralPart[] = [];
  if (method === "days") {
    if (!end || end <= start) return null;
    const span = daysBetween(start, end);
    if (span > 1830) return null;
    let cur = start, used = "0.00";
    while (cur <= end) {
      const [y, m] = parts(cur);
      const monthEnd = iso(y, m, lastDay(y, m));
      const segEnd = monthEnd < end ? monthEnd : end;
      const days = daysBetween(cur, segEnd);
      const amount = segEnd === end ? subtract(total, used) : proportion(total, `${days}.00`, `${span}.00`);
      out.push({ date: cur, days, amount });
      used = add(used, amount);
      const [ny, nm] = m === 12 ? [y + 1, 1] : [y, m + 1];
      cur = iso(ny, nm, 1);
    }
    if (out.length < 2) return null;
  } else {
    const n = months ?? 0;
    if (n < 2 || n > 60) return null;
    const part = divide(total, `${n}.00`, 2);
    let used = "0.00";
    for (let k = 0; k < n; k++) {
      const amount = k < n - 1 ? part : subtract(total, used);
      out.push({ date: addMonths(start, k), days: null, amount });
      used = add(used, amount);
    }
  }
  return out.every((p) => Number(p.amount) > 0) ? out : null;
}
