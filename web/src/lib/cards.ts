// Los cortes de una tarjeta, con las mismas reglas que la base (card_closing_for): una compra entra
// al primer corte en o después de su fecha, y un corte 31 en febrero es el último día del mes.
import type { AccountRow } from "@/api/hooks";
import type { Fact } from "@/components/ui";

import { shortDate } from "./dates";
import { formatAmount, symbolOf } from "./money";

const pad = (n: number) => String(n).padStart(2, "0");

/** El día `day` del mes (año y mes de 1 a 12), o el último si no existe. */
function dayInMonth(year: number, month: number, day: number): string {
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${year}-${pad(month)}-${pad(Math.min(day, last))}`;
}

function plusMonth(year: number, month: number): [number, number] {
  return month === 12 ? [year + 1, 1] : [year, month + 1];
}

/** El corte que le toca a una fecha: el primero en o después de ella. */
export function closingFor(iso: string, day: number): string {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  const here = dayInMonth(y, m, day);
  return here >= iso ? here : dayInMonth(...plusMonth(y, m), day);
}

/** Los cortes de n cuotas, desde el de la compra. */
export function installmentClosings(iso: string, n: number, day: number): string[] {
  const out = [closingFor(iso, day)];
  while (out.length < n) {
    const [y, m] = out.at(-1)!.split("-").map(Number) as [number, number];
    out.push(dayInMonth(...plusMonth(y, m), day));
  }
  return out;
}

/** Lo que C1 dice de una tarjeta: «Pagar S/ 1,284.90 + US$ 45.00 antes del 05 nov». */
export function cardHint(a: AccountRow, lang: string): { text: string; facts?: Fact[]; attention: boolean } {
  const c = a.card;
  if (!c || c.to_pay.length === 0) return { text: a.subtitle ?? "Nada por pagar", attention: false };
  const money = c.to_pay.map((m) => formatAmount(m.amount, symbolOf(m.currency), lang)).join(" + ");
  if (!c.date_due) {
    return { text: `Cerró el ${shortDate(c.last_closing)} y falta la fecha de pago`, facts: [["Cerró", shortDate(c.last_closing)], ["Fecha de pago", "Falta"]], attention: true };
  }
  return { text: `Pagar ${money} antes del ${shortDate(c.date_due)}`, attention: false };
}

/** Días entre hoy y una fecha (0 = hoy). */
export function daysUntil(iso: string, today: string): number {
  return Math.round((Date.parse(iso) - Date.parse(today)) / 86_400_000);
}
