// X2 · Reportes: el índice. Una tarjeta por reporte con su cifra del mes elegido y un gráfico chico;
// tocarla abre el reporte completo en ese mes.
import { useState } from "react";
import { Link, NavLink, useSearchParams } from "react-router";
import { Area, AreaChart, Cell, Pie, PieChart } from "recharts";

import { useReportSummary } from "@/api/hooks";
import { OptionList, Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { monthName, monthOptions } from "@/lib/months";
import { isZero } from "@/lib/money";

import { Versus, catColor, useMoney } from "./common";
import { ListSkeleton } from "@/components/Skeleton";

/** Una tarjeta del índice. Con `empty` no muestra ceros que parecen datos: dice que todavía no hay. */
function Card({ to, label, value, children, note, empty, icon }: {
  to: string; label: string; value: string; children: React.ReactNode; note: React.ReactNode; empty?: string; icon: string;
}) {
  return (
    <NavLink to={to} className="flex items-center gap-3.5 rounded-xl border border-border bg-card px-4 py-3.5 lg:aria-[current=page]:border-foreground lg:aria-[current=page]:shadow-[inset_0_0_0_1px_var(--foreground)]">
      <span aria-hidden="true" className="grid size-16 flex-none place-items-center">
        {empty ? <span className="grid size-12 place-items-center rounded-full bg-secondary text-muted-foreground"><Icon name={icon} /></span> : children}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-label text-muted-foreground">{label}</span>
        {empty ? <span className="font-semibold">{empty}</span> : <>
          <span className="text-[22px] leading-7 font-semibold tabular-nums">{value}</span>
          {note}
        </>}
      </span>
      <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
    </NavLink>
  );
}

export function Reportes() {
  const [params, setParams] = useSearchParams();
  const thisMonth = todayISO().slice(0, 7);
  const month = params.get("mes") ?? thisMonth;
  const summary = useReportSummary(month);
  const money = useMoney();
  const [picking, setPicking] = useState(false);

  if (summary.isPending) return <ListSkeleton back="/mas" title="Reportes" />;
  if (summary.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{summary.error.message}</ErrorAlert></main>;
  const s = summary.data;
  const q = month === thisMonth ? "" : `?p=${month}`;
  const prevMonth = (() => { const d = new Date(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1); return monthName(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`).split(" ")[0]!.toLowerCase(); })();
  const nw = s.net_worth_months.map((v) => ({ v: Number(v) }));
  const yearChange = Number(s.net_worth) - Number(s.net_worth_year_ago);
  const nothing = `Todavía no hay datos de ${monthName(month).split(" ")[0]!.toLowerCase()}`;
  const noHistory = s.net_worth_months.every((v) => isZero(v)) && isZero(s.net_worth);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/mas" aria-label="Volver a Más" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
      </div>
      <h1 className="mt-6 text-title-hero">Reportes</h1>
      <button type="button" aria-haspopup="dialog" onClick={() => setPicking(true)} className="mt-3 flex items-center gap-0.5 self-start text-title-2">
        {monthName(month)}<Icon name="expand_more" className="text-[22px] text-muted-foreground" />
      </button>

      <div className="mt-4 flex flex-col gap-2.5">
        <Card to={`/mas/reportes/gastos${q}`} label="Gastos" value={money(s.expense)} icon="donut_large" empty={isZero(s.expense) ? nothing : undefined}
          note={<Versus now={s.expense} before={s.expense_previous} against={prevMonth} />}>
          {s.expense_groups.length > 0 ? (
            <PieChart width={64} height={64}>
              <Pie data={s.expense_groups.map((g) => ({ value: Number(g.amount), color: g.color }))} dataKey="value" innerRadius={19} outerRadius={30}
                paddingAngle={2} startAngle={90} endAngle={-270} stroke="none" isAnimationActive={false}>
                {s.expense_groups.map((g, i) => <Cell key={i} fill={catColor(g.color)} />)}
              </Pie>
            </PieChart>
          ) : <span className="size-[60px] rounded-full border-[10px] border-muted" />}
        </Card>

        <Card to={`/mas/reportes/ingresos${q}`} label="Ingresos" value={money(s.income)} icon="bar_chart" empty={isZero(s.income) ? nothing : undefined}
          note={<Versus now={s.income} before={s.income_previous} against={prevMonth} />}>
          <span className="flex w-[52px] flex-col gap-1.5">
            {[1, 0.25, 0.1].map((w, i) => <span key={i} className="h-2.5 rounded-[4px]" style={{ width: `${w * 100}%`, background: catColor(10), opacity: 1 - i * 0.25 }} />)}
          </span>
        </Card>

        <Card to={`/mas/reportes/flujo${q}`} label="Flujo" icon="water" empty={isZero(s.income) && isZero(s.expense) ? nothing : undefined}
          value={Number(s.saved) >= 0 ? `Te quedó ${s.saved_percent ?? 0} %` : "Salió más"}
          note={<span className="text-caption text-muted-foreground tabular-nums">
            {Number(s.saved) >= 0 ? `${money(s.saved)} de ${money(s.income)}` : `${money(String(-Number(s.saved)))} más de lo que entró`}
          </span>}>
          <span className="flex h-11 w-[52px] items-end gap-1">
            <span className="w-1/2 rounded-[4px]" style={{ height: "100%", background: catColor(10) }} />
            <span className="flex h-full w-1/2 flex-col gap-0.5">
              <span className="rounded-[4px] bg-muted-foreground" style={{ flex: Number(s.expense) || 1 }} />
              <span className="rounded-[4px] bg-trigo" style={{ flex: Math.max(Number(s.saved), 0) }} />
            </span>
          </span>
        </Card>

        <Card to="/mas/reportes/patrimonio" label="Patrimonio" value={money(s.net_worth)} icon="show_chart" empty={noHistory ? "Todavía no hay datos" : undefined}
          note={<span className="flex items-center gap-0.5 text-caption text-muted-foreground tabular-nums">
            <Icon name={yearChange >= 0 ? "north_east" : "south_east"} className="text-[16px]" />
            {money(Math.abs(yearChange).toFixed(2))} {yearChange >= 0 ? "más" : "menos"} que hace un año
          </span>}>
          <AreaChart width={64} height={48} data={nw} margin={{ top: 4, right: 4, bottom: 4, left: 4 }}>
            <Area type="monotone" dataKey="v" stroke="var(--foreground)" strokeWidth={2} fill="var(--foreground)" fillOpacity={0.1} isAnimationActive={false} dot={false} />
          </AreaChart>
        </Card>

        <Card to="/mas/reportes/personas" label="Personas" icon="group" value={`Te deben ${money(s.owes_me)}`}
          note={Number(s.owed_over_90) > 0
            ? <span className="flex items-center gap-1 text-caption text-attention"><Icon name="schedule" className="text-[16px]" />{money(s.owed_over_90)} hace más de 90 días</span>
            : <span className="text-caption text-muted-foreground">Nada de hace más de 90 días</span>}>
          <span className="flex h-2.5 w-[56px] gap-0.5">
            {[0, 1, 2, 3].map((i) => <span key={i} className="flex-1 rounded-[3px]" style={{ background: `var(--age-${i})` }} />)}
          </span>
        </Card>

        <Card to={`/mas/reportes/etiquetas${q}`} label="Etiquetas" icon="sell" value={money(s.tagged)}
          empty={isZero(s.tagged) ? `Nada con etiqueta en ${monthName(month).split(" ")[0]!.toLowerCase()}` : undefined}
          note={<span className="text-caption text-muted-foreground">{s.top_tag ? `La que más: ${s.top_tag}` : ""}</span>}>
          <span className="grid size-12 place-items-center rounded-full" style={{ background: catColor(s.top_tag_color), color: "var(--on-category)" }}>
            <Icon name="sell" />
          </span>
        </Card>
      </div>
      <span className="mt-3 text-caption text-muted-foreground">Cada reporte se ve por mes o por año. Lo por clasificar, las transferencias y el pago de la tarjeta no entran.</span>

      <Sheet title="Elige el mes" open={picking} onClose={() => setPicking(false)}>
        <OptionList search={false} value={month} options={monthOptions().slice(1).map((v) => ({ value: v, label: monthName(v) }))}
          onPick={(v) => { setParams(v === thisMonth ? {} : { mes: v }, { replace: true }); setPicking(false); }} />
      </Sheet>
    </main>
  );
}
