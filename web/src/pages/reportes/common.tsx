// Lo que comparten los reportes: el encabezado, el periodo (Mes / Año con ‹ ›, en la URL: ?p=2026-10
// o ?p=2026), los montos, la comparación con el periodo anterior y el tooltip de los gráficos
// (Recharts, con el estilo de las hojas de PPM).
import type { ReactNode } from "react";
import { Link, useSearchParams } from "react-router";

import { useMe } from "@/api/hooks";
import { Segmented } from "@/components/Sheet";
import { Icon } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { formatAmount, symbolOf } from "@/lib/money";
import { monthName } from "@/lib/months";

export const catColor = (c: number | null | undefined) => `var(--cat-${c ?? 0})`;

export function ReportHeader({ title }: { title: string }) {
  return (
    <>
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/mas/reportes" aria-label="Volver a Reportes" className="grid size-11 place-items-center rounded-full">
          <Icon name="arrow_back" className="text-[24px]" />
        </Link>
      </div>
      <h1 className="mt-3 font-display text-[40px] leading-[42px] font-extrabold tracking-[-0.03em]">{title}</h1>
    </>
  );
}

/** El periodo del reporte, en la URL: el mes de hoy si no dice otro. */
export function usePeriod() {
  const [params, setParams] = useSearchParams();
  const thisMonth = todayISO().slice(0, 7);
  const period = params.get("p") ?? thisMonth;
  const year = period.length === 4;
  const go = (p: string) => setParams(p === thisMonth ? {} : { p }, { replace: true });
  const shift = (n: number) => {
    if (year) return go(String(Number(period) + n));
    const d = new Date(Number(period.slice(0, 4)), Number(period.slice(5, 7)) - 1 + n, 1);
    go(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  return {
    period, year,
    label: year ? period : monthName(period),
    canNext: year ? Number(period) < Number(thisMonth.slice(0, 4)) : period < thisMonth,
    prev: () => shift(-1),
    next: () => shift(1),
    setYear: (y: boolean) => go(y ? period.slice(0, 4) : period.slice(0, 4) === thisMonth.slice(0, 4) ? thisMonth : `${period.slice(0, 4)}-12`),
    /** El mes para abrir Movimientos: el del periodo, o en un año el último que cuenta. */
    month: year ? (period === thisMonth.slice(0, 4) ? thisMonth : `${period}-12`) : period,
  };
}

export function PeriodBar({ p }: { p: ReturnType<typeof usePeriod> }) {
  return (
    <div className="mt-4 flex flex-col gap-2">
      <Segmented label="Periodo" size="sm" value={p.year ? "year" : "month"} onChange={(v) => p.setYear(v === "year")}
        options={[{ value: "month", label: "Mes" }, { value: "year", label: "Año" }]} />
      <div className="flex items-center justify-between">
        <button type="button" aria-label={p.year ? "Año anterior" : "Mes anterior"} onClick={p.prev}
          className="grid size-11 place-items-center rounded-full"><Icon name="chevron_left" className="text-[24px]" /></button>
        <span className="font-semibold">{p.label}</span>
        <button type="button" aria-label={p.year ? "Año siguiente" : "Mes siguiente"} onClick={p.next} disabled={!p.canNext}
          className="grid size-11 place-items-center rounded-full disabled:opacity-30"><Icon name="chevron_right" className="text-[24px]" /></button>
      </div>
    </div>
  );
}

/** Los montos en la moneda de la persona. */
export function useMoney() {
  const me = useMe().data;
  const lang = me?.lang ?? "es-PE";
  const symbol = symbolOf(me?.currency ?? "PEN");
  return (v: string | number) => formatAmount(String(v), symbol, lang);
}

/** «−12 %», «+4 %», «igual» o «nuevo». */
export function delta(now: string, before: string) {
  const a = Number(now), b = Number(before);
  if (!b) return a ? "nuevo" : "igual";
  const d = Math.round(((a - b) / Math.abs(b)) * 100);
  return d === 0 ? "igual" : `${d > 0 ? "+" : "−"}${Math.abs(d)} %`;
}

/** El cambio contra el periodo anterior con su flecha (caso 7): ↗ 12 %, ↘ 4 %, «Igual» o «Nuevo». */
export function Trend({ now, before }: { now: string; before: string }) {
  const a = Number(now), b = Number(before);
  if (!b) return <>{a ? "Nuevo" : "Igual"}</>;
  const d = Math.round(((a - b) / Math.abs(b)) * 100);
  if (d === 0) return <>Igual</>;
  return (
    <span className="inline-flex items-center gap-0.5">
      <Icon name={d > 0 ? "trending_up" : "trending_down"} className="text-[15px]" />{Math.abs(d)} %
    </span>
  );
}

/** «12 % menos que setiembre» con su flecha. */
export function Versus({ now, before, against }: { now: string; before: string; against: string }) {
  const a = Number(now), b = Number(before);
  if (!b) return <span className="text-caption text-muted-foreground">Sin datos de {against} para comparar</span>;
  const d = Math.round(((a - b) / Math.abs(b)) * 100);
  return (
    <span className="flex items-center gap-0.5 text-caption text-muted-foreground">
      <Icon name={a < b ? "south_east" : "north_east"} className="text-[16px]" />
      {d === 0 ? `Igual que ${against}` : `${Math.abs(d)} % ${a < b ? "menos" : "más"} que ${against}`}
    </span>
  );
}

/** Contra qué se compara: «setiembre» o «enero a octubre de 2025». */
export function against(p: ReturnType<typeof usePeriod>) {
  if (!p.year) {
    const d = new Date(Number(p.period.slice(0, 4)), Number(p.period.slice(5, 7)) - 2, 1);
    return monthName(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`).split(" ")[0]!.toLowerCase();
  }
  const thisYear = todayISO().slice(0, 4);
  return p.period === thisYear ? `enero a ${monthName(todayISO().slice(0, 7)).split(" ")[0]!.toLowerCase()} de ${Number(p.period) - 1}` : String(Number(p.period) - 1);
}

/** El tooltip de los gráficos: una tarjeta chica con el nombre y el monto. */
export function ChartTip({ active, title, rows }: { active?: boolean; title?: ReactNode; rows: { color?: string; label: string; value: string }[] }) {
  if (!active || rows.length === 0) return null;
  return (
    <div className="flex min-w-36 flex-col gap-1 rounded-md border border-border bg-card px-3 py-2 text-caption shadow-lg">
      {title && <span className="font-semibold">{title}</span>}
      {rows.map((r) => (
        <span key={r.label} className="flex items-center gap-2 tabular-nums">
          {r.color && <span aria-hidden="true" className="size-2.5 flex-none rounded-[3px]" style={{ background: r.color }} />}
          <span className="flex-1 text-muted-foreground">{r.label}</span>
          <span className="font-semibold">{r.value}</span>
        </span>
      ))}
    </div>
  );
}

/** El eje de los gráficos de 12 meses: tres letras, porque con una se repiten (dos M, dos J, dos A). */
export const MONTH_SHORT = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Set", "Oct", "Nov", "Dic"];

/** Lo que pesa un grupo en el total: la barra se llena hasta ahí y el número va en la punta (dentro, si casi la llena). */
export function ShareBar({ pct, color }: { pct: number; color: string }) {
  const inside = pct > 82;
  return (
    <span className="relative block h-4 overflow-hidden rounded-md bg-muted">
      <span aria-hidden="true" className="block h-4 rounded-md" style={{ width: `${Math.min(100, Math.max(0, pct))}%`, background: color }} />
      <span className={`absolute top-0 text-[11px] leading-4 font-semibold tabular-nums ${inside ? "text-on-category" : ""}`}
        style={inside ? { right: 6 } : { left: `calc(${Math.max(0, pct)}% + 6px)` }}>
        {pct} %<span className="sr-only"> del total</span>
      </span>
    </span>
  );
}
