// La regla de una recurrente en palabras: «El 8 de cada mes», «Los jueves», «Cada año, el 8 nov».
import type { RuleIn } from "@/api/hooks";

import { shortDate } from "./dates";

const WEEKDAYS = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
const NTH: Record<number, string> = { 1: "primer", 2: "segundo", 3: "tercer", 4: "cuarto", [-1]: "último" };
const UNIT: Record<RuleIn["interval"], [string, string]> = {
  day: ["día", "días"], week: ["semana", "semanas"], month: ["mes", "meses"], year: ["año", "años"],
};

/** Día ISO de la semana (1 = lunes) de una fecha «2026-11-12». */
export function isoWeekday(iso: string): number {
  const d = new Date(`${iso}T12:00:00`);
  return ((d.getDay() + 6) % 7) + 1;
}

export function weekdayName(n: number): string {
  return WEEKDAYS[n - 1] ?? "";
}

type Rule = Pick<RuleIn, "interval" | "every" | "month_days" | "weekday"> & { nth?: number | null; start?: string | null };

export function ruleText(r: Rule): string {
  const every = r.every ?? 1;
  const start = r.start ?? "";
  const cada = every === 1 ? `cada ${UNIT[r.interval][0]}` : `cada ${every} ${UNIT[r.interval][1]}`;
  if (r.interval === "month") {
    if (r.weekday && r.nth) return `El ${NTH[r.nth]} ${weekdayName(r.weekday)} de ${cada}`;
    const days = r.month_days?.length ? r.month_days : [Number(start.slice(8, 10))];
    const list = days.map((d) => (d === 31 ? "último día" : String(d)));
    return `El ${list.join(" y el ")} de ${cada}`;
  }
  if (r.interval === "week") {
    const day = weekdayName(isoWeekday(start));
    const days = day.endsWith("s") ? day : `${day}s`;   // los jueves, los sábados
    return every === 1 ? `Los ${days}` : `Los ${days}, ${cada}`;
  }
  if (r.interval === "year") return `El ${shortDate(start)} de ${cada}`;
  return every === 1 ? "Todos los días" : `Cada ${every} días`;
}

/** El ícono de cada modo, junto a su nombre en el detalle de una recurrente. */
export const MODE_ICON: Record<"auto" | "draft" | "reminder", string> = {
  auto: "bolt", draft: "schedule", reminder: "notifications",
};

export const MODE_NAME: Record<"auto" | "draft" | "reminder", string> = {
  auto: "Automático", draft: "Por confirmar", reminder: "Recordatorio",
};
