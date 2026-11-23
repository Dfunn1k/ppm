// Una deuda con una persona, como tarjeta (decisión «La persona que te debe», opción C2): a la izquierda
// la hoja de calendario con el día y el mes en que nació, ámbar si ya tiene 3 meses; al lado el nombre,
// lo que falta, cuánto tiempo lleva, lo ya pagado en una barra y el vencimiento. La misma tarjeta va en
// la persona, en «Me pagó» y en la hoja para elegir qué deuda paga; la elegida se pinta con el acento y
// una marca en la esquina que no mueve nada.
import type { ReactNode } from "react";

import type { OpenItem } from "@/api/hooks";
import { MONTHS } from "@/lib/dates";
import { formatAmount, subtract, symbolOf } from "@/lib/money";
import { cn } from "@/lib/utils";

import { maturityText } from "./MaturitySheet";
import { Icon } from "./ui";

/** Desde cuántos días una deuda se ve vieja (ámbar). */
export const OLD_DEBT_DAYS = 90;

/** «Hoy», «Hace 3 días», «Hace 2 semanas», «Hace 5 meses», «Hace 1 año». */
export function debtAge(days: number): string {
  if (days <= 0) return "Hoy";
  if (days === 1) return "Ayer";
  if (days < 7) return `Hace ${days} días`;
  if (days < 31) { const w = Math.floor(days / 7); return `Hace ${w} ${w === 1 ? "semana" : "semanas"}`; }
  if (days < 365) { const m = Math.floor(days / 30.44); return `Hace ${m} ${m === 1 ? "mes" : "meses"}`; }
  const y = Math.floor(days / 365);
  return `Hace ${y} ${y === 1 ? "año" : "años"}`;
}

/** La hoja de calendario: el día grande y el mes chico. */
export function DayTile({ date, old }: { date: string; old: boolean }) {
  const [, m, d] = date.split("-");
  return (
    <span aria-hidden="true" className={cn("flex w-[52px] flex-none flex-col items-center rounded-[12px] py-1.5 leading-none",
      old ? "bg-attention-soft text-attention" : "bg-muted")}>
      <span className="font-display text-[24px] leading-[26px] font-extrabold tabular-nums">{Number(d)}</span>
      <span className={cn("text-[11px] font-bold tracking-[0.06em] uppercase", !old && "text-muted-foreground")}>{MONTHS[Number(m) - 1]}</span>
    </span>
  );
}

/** El vencimiento en su pastilla; ámbar si ya venció o vence hoy. Botón si se puede cambiar. */
export function DueChip({ item, onClick }: { item: OpenItem; onClick?: () => void }) {
  const m = maturityText(item);
  if (!m) return null;
  const cls = cn("relative z-[1] inline-flex h-7 items-center gap-1.5 self-start rounded-full px-2.5 text-caption font-semibold",
    m.late ? "bg-attention-soft text-attention" : "bg-muted text-foreground");
  const body = <><Icon name={m.late ? "schedule" : "event"} className="text-[16px]" />{m.text}</>;
  return onClick ? <button type="button" onClick={onClick} className={cls}>{body}</button> : <span className={cls}>{body}</span>;
}

/** La tarjeta. «paid» dice «Te pagó» o «Le pagaste»; el título y el monto pueden venir armados (una compra
 *  en cuotas muestra su total); lo de adentro va al pie (las cuotas, el vencimiento con su botón). */
export function DebtCard({ item, lang, paid, selected, title, amount, detail, due = true, children }: {
  item: OpenItem; lang: string; paid: string; selected?: boolean; title?: ReactNode; amount?: string;
  detail?: ReactNode; due?: boolean; children?: ReactNode;
}) {
  const old = item.days >= OLD_DEBT_DAYS;
  const money = (v: string) => formatAmount(v, symbolOf(item.currency), lang);
  const partial = !item.parts && item.open !== item.amount;
  const done = partial ? Number(subtract(item.amount, item.open)) : 0;
  return (
    <span className={cn("relative flex w-full gap-3.5 rounded-[16px] border bg-card p-3.5 text-left",
      selected ? "border-transparent bg-[color-mix(in_srgb,var(--primary)_14%,var(--card))] ring-2 ring-primary" : "border-border")}>
      {selected && (
        <span aria-hidden="true" className="absolute -top-2.5 -right-2.5 grid size-[26px] place-items-center rounded-full bg-primary text-primary-foreground ring-[3px] ring-card">
          <Icon name="check" className="text-[16px]" />
        </span>
      )}
      <DayTile date={item.date} old={old} />
      <span className="flex min-w-0 flex-1 flex-col gap-1">
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 font-semibold">{title ?? item.ref}</span>
          <span className="font-display text-[20px] leading-6 font-extrabold tracking-[-0.02em] whitespace-nowrap tabular-nums">{amount ?? money(item.open)}</span>
        </span>
        <span className={cn("text-caption", old ? "font-semibold text-attention" : "text-muted-foreground")}>{detail ?? debtAge(item.days)}</span>
        {partial && (
          <span className="mt-0.5 flex flex-col gap-1">
            <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
              <span className="block h-2 rounded-full bg-income" style={{ width: `${Math.min(100, Math.round(done / Number(item.amount) * 100))}%` }} />
            </span>
            <span className="flex justify-between text-caption tabular-nums">
              <span className="font-semibold text-income">{paid} {money(done.toFixed(2))}</span>
              <span className="text-muted-foreground">de {money(item.amount)}</span>
            </span>
          </span>
        )}
        {due && <DueChip item={item} />}
        {children}
      </span>
    </span>
  );
}
