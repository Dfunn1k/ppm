// X2 · Patrimonio: lo que realmente tenías al cierre de cada mes (12 meses, cada uno al tipo de cambio
// de su último día; el último punto es hoy), cómo está repartido hoy y la diferencia de cambio de lo
// que tienes en otras monedas: lo que te costó contra lo que vale hoy.
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { useMe, useNetWorthReport } from "@/api/hooks";
import { ErrorAlert, Icon, Spinner } from "@/components/ui";
import { formatAmount, rateText, symbolOf } from "@/lib/money";
import { monthName } from "@/lib/months";

import { ChartTip, MONTH_LETTER, ReportHeader, useMoney } from "./common";

const PARTS: Record<string, { label: string; op: number }> = {
  bank: { label: "Bancos", op: 1 },
  foreign: { label: "En otras monedas", op: 0.7 },
  receivable: { label: "Me deben", op: 0.45 },
  cash: { label: "Efectivo", op: 0.25 },
  other: { label: "Otros (cuotas por venir, por clasificar)", op: 0.15 },
};

export function ReportePatrimonio() {
  const report = useNetWorthReport();
  const money = useMoney();
  const lang = useMe().data?.lang ?? "es-PE";

  if (report.isPending) return <Spinner />;
  if (report.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{report.error.message}</ErrorAlert></main>;
  const r = report.data;
  const first = r.months[0]!, last = r.months.at(-1)!;
  const change = Number(last.amount) - Number(first.amount);
  const points = r.months.map((m) => ({ ...m, value: Number(m.amount), label: MONTH_LETTER[Number(m.date.slice(5, 7)) - 1] }));
  const have = r.have.reduce((a, x) => a + Number(x.amount), 0);
  const gain = (f: (typeof r.foreign)[number]) => Number(f.today) - Number(f.book);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-10">
      <ReportHeader title="Patrimonio" />

      <span className="mt-4 text-caption text-muted-foreground">Lo que realmente tengo · hoy</span>
      <span className="font-display text-[34px] leading-[38px] font-extrabold tracking-[-0.02em] tabular-nums">{money(r.today)}</span>
      <span className="mt-0.5 flex items-center gap-0.5 text-caption text-muted-foreground tabular-nums">
        <Icon name={change >= 0 ? "north_east" : "south_east"} className="text-[16px]" />
        {money(Math.abs(change).toFixed(2))} {change >= 0 ? "más" : "menos"} que en {monthName(first.date.slice(0, 7)).toLowerCase()}
      </span>

      <section aria-label="Al cierre de cada mes" className="mt-5 flex flex-col gap-1.5">
        <div className="flex justify-between border-b border-border pb-1 text-label text-muted-foreground"><span>Al cierre de cada mes</span><span>12 meses</span></div>
        <div className="h-[190px]" role="img" aria-label={`Lo que realmente tenías: ${points.map((m) => `${monthName(m.date.slice(0, 7))} ${money(m.amount)}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }}
                domain={["auto", "auto"]} tickFormatter={(v: number) => (Math.abs(v) >= 1000 ? `${Math.round(v / 100) / 10}k` : String(v))} />
              <Tooltip cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} content={({ active, payload }) => {
                const m = payload?.[0]?.payload as (typeof points)[number] | undefined;
                const i = m ? points.indexOf(m) : -1;
                const prev = i > 0 ? points[i - 1]!.value : null;
                return <ChartTip active={active && !!m} title={m ? (i === points.length - 1 ? "Hoy" : `Cierre de ${monthName(m.date.slice(0, 7)).toLowerCase()}`) : ""}
                  rows={m ? [{ color: "var(--foreground)", label: "Tenías", value: money(m.amount) },
                    ...(prev === null ? [] : [{ label: "Vs. el mes anterior", value: `${m.value >= prev ? "+" : "−"} ${money(Math.abs(m.value - prev).toFixed(2))}` }])] : []} />;
              }} />
              <Area type="monotone" dataKey="value" stroke="var(--foreground)" strokeWidth={2} fill="var(--foreground)" fillOpacity={0.08}
                isAnimationActive={false} dot={false} activeDot={{ r: 5, stroke: "var(--background)", strokeWidth: 2 }} />
            </AreaChart>
          </ResponsiveContainer>
        </div>
        <span className="text-caption text-muted-foreground">Cada mes se cuenta con el tipo de cambio de su último día: la curva también muestra lo que hizo el dólar.</span>
      </section>

      <section aria-label="Cómo está repartido hoy" className="mt-6 flex flex-col gap-2">
        <span className="border-b border-border pb-1 text-label text-muted-foreground">Cómo está repartido hoy</span>
        <div className="flex h-6 gap-0.5 overflow-hidden rounded-[4px]" role="img"
          aria-label={`Lo que tienes, ${money(have.toFixed(2))}: ${r.have.map((x) => `${PARTS[x.key]!.label} ${money(x.amount)}`).join(", ")}`}>
          {r.have.filter((x) => Number(x.amount) > 0).map((x) => (
            <span key={x.key} className="h-full rounded-[4px] bg-foreground" style={{ flex: Number(x.amount), opacity: PARTS[x.key]!.op }} />
          ))}
        </div>
        <div className="flex flex-col">
          {r.have.map((x) => (
            <div key={x.key} className="flex min-h-10 items-center gap-2.5 border-b border-border">
              <span aria-hidden="true" className="size-3 flex-none rounded-[3px] bg-foreground" style={{ opacity: PARTS[x.key]!.op }} />
              <span className="flex-1">{PARTS[x.key]!.label}</span>
              <span className="text-caption text-muted-foreground tabular-nums">{have ? Math.round((Number(x.amount) / have) * 100) : 0} %</span>
              <span className="min-w-24 text-right font-medium tabular-nums">{money(x.amount)}</span>
            </div>
          ))}
          {Number(r.owe) > 0 && (
            <div className="flex min-h-10 items-center gap-2.5 border-b border-border">
              <span aria-hidden="true" className="size-3 flex-none rounded-[3px] border-[1.5px] border-dashed border-muted-foreground" />
              <span className="flex-1">Debo (tarjetas, préstamos y plata que guardo)</span>
              <span className="min-w-24 text-right font-medium tabular-nums">− {money(r.owe)}</span>
            </div>
          )}
        </div>
      </section>

      {r.foreign.map((f) => (
        <section key={f.currency} aria-label={`Tus ${f.currency}: diferencia de cambio`} className="mt-6 flex flex-col gap-2.5 rounded-lg border border-border bg-card p-4">
          <span className="text-label text-muted-foreground">Tus {f.currency === "USD" ? "dólares" : f.currency} · diferencia de cambio</span>
          <span className="flex justify-between tabular-nums"><span>Tienes</span><b>{formatAmount(f.amount, symbolOf(f.currency), lang)}</b></span>
          <span className="flex justify-between tabular-nums"><span>Te costaron</span><span>{money(f.book)}</span></span>
          <span className="flex justify-between tabular-nums"><span>Valen hoy (compra {rateText(f.rate)})</span><span>{money(f.today)}</span></span>
          <span className="flex justify-between border-t border-border pt-2.5 font-semibold tabular-nums">
            <span>Si los cambiaras hoy</span>
            <span className={`flex items-center gap-0.5 ${gain(f) >= 0 ? "text-income" : "text-expense"}`}>
              <Icon name={gain(f) >= 0 ? "north_east" : "south_east"} className="text-[18px]" />
              {gain(f) >= 0 ? "+" : "−"} {money(Math.abs(gain(f)).toFixed(2))}
            </span>
          </span>
          <span className="text-caption text-muted-foreground">
            No se registra: es lo que ganarías o perderías si vendieras hoy.
            {Number(r.realized) !== 0 && ` Este año ya ${Number(r.realized) > 0 ? "ganaste" : "perdiste"} ${money(Math.abs(Number(r.realized)).toFixed(2))} al cambiar moneda.`}
          </span>
        </section>
      ))}
    </main>
  );
}
