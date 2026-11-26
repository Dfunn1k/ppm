// X2 · Gastos e Ingresos: el total del periodo contra el anterior; en Gastos la dona por grupo (tocar
// un segmento lo destaca); en un año, las barras de cada mes (apiladas por grupo en Gastos); y la
// lista por grupo, que se despliega con sus categorías. Una categoría abre sus movimientos.
// El color de cada grupo es el de su categoría, siempre con su ícono y nombre al lado.
import { useState } from "react";
import { Link } from "react-router";
import { Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";

import { type CategoryReport, useCategoryReport } from "@/api/hooks";
import { CategoryChip } from "@/components/CategorySheet";
import { catBg } from "@/components/Avatar";
import { SectionHeading } from "@/components/SectionHeading";
import { ErrorAlert, Icon } from "@/components/ui";
import { add } from "@/lib/money";
import { ReportBones } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";
import { monthName, monthOnly } from "@/lib/months";

import {
  ChartTip, MONTH_SHORT, PeriodBar, ReportHeader, ShareBar, Trend, Versus, against, catColor, delta, useMoney, usePeriod,
} from "./common";

type Group = CategoryReport["groups"][number];

/** Al cambiar de reporte o de periodo se empieza en general: sin grupo elegido ni desplegado. */
export function ReporteCategorias({ kind }: { kind: "expense" | "income" }) {
  const p = usePeriod();
  return <CategoryReportView key={`${kind}-${p.period}`} kind={kind} p={p} />;
}

function CategoryReportView({ kind, p }: { kind: "expense" | "income"; p: ReturnType<typeof usePeriod> }) {
  const report = useCategoryReport(kind, p.period);
  const money = useMoney();
  // Los grupos resaltados en la dona y en las barras: todos los que abriste o tocaste, no solo el último
  const [marked, setMarked] = useState<number[]>([]);
  const [open, setOpen] = useState<number[]>([]);
  const expense = kind === "expense";

  if (report.isPending) return <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-10"><ReportHeader title={expense ? "Gastos" : "Ingresos"} /><PeriodBar p={p} /><ReportBones chart={expense ? "donut" : "bars"} /></main>;
  if (report.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{report.error.message}</ErrorAlert></main>;
  const r = report.data;
  const vs = against(p);
  const top = r.groups.filter((g) => Number(g.amount) > 0);
  const picked = top.filter((g) => marked.includes(g.id));
  const lit = (id: number) => marked.length === 0 || marked.includes(id);
  const centerLabel = picked.length === 0 ? "Total" : picked.length === 1 ? picked[0]!.name.split(" ")[0] : `${picked.length} grupos`;
  const centerAmount = picked.length === 0 ? r.total : picked.reduce((s, g) => add(s, g.amount), "0.00");
  const markToggle = (id: number) => setMarked((m) => (m.includes(id) ? m.filter((x) => x !== id) : [...m, id]));
  // Lo que pesa en el total: la barra de cada fila se llena hasta ahí y la dona lo dice al elegir un grupo
  const share = (amount: string | number) => (Number(r.total) ? Math.round((Number(amount) / Number(r.total)) * 100) : 0);
  // Desplegar un grupo lo suma a lo resaltado; plegarlo lo quita. Sin ninguno resaltado, la dona muestra el total
  const toggle = (g: Group) => {
    if (open.includes(g.id)) {
      setOpen(open.filter((x) => x !== g.id));
      setMarked((m) => m.filter((x) => x !== g.id));
    } else {
      setOpen([...open, g.id]);
      setMarked((m) => (m.includes(g.id) ? m : [...m, g.id]));
    }
  };
  const moves = (id: number, name: string) =>
    `/movimientos?mes=${p.month}&categoria=${id}&categoria_nombre=${encodeURIComponent(name)}`;
  type MonthRow = { label: string; month: string; total: number; [group: string]: string | number };
  const months: MonthRow[] = r.months.map((m, i) => ({
    label: MONTH_SHORT[i]!, month: m.month, total: Number(m.total),
    ...Object.fromEntries(r.groups.map((g, k) => [`g${g.id}`, Number(m.groups[k] ?? 0)])),
    ...Object.fromEntries(r.groups.map((g, k) => [`s${g.id}`, m.groups[k] ?? "0"])),
  }));

  const when = p.year ? `en ${p.year}` : `en ${monthName(p.month).split(" ")[0]!.toLowerCase()}`;
  if (r.groups.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-10">
        <ReportHeader title={expense ? "Gastos" : "Ingresos"} />
        <PeriodBar p={p} />
        <EmptyState icon={expense ? "donut_large" : "bar_chart"} title={expense ? `Nada gastado ${when}` : `Nada entró ${when}`}
          action={{ to: expense ? "/registrar" : "/registrar?tipo=income", label: expense ? "Registrar un gasto" : "Registrar un ingreso" }}>
          {expense ? "Cuando registres un gasto, aquí ves en qué se va la plata, por grupo y categoría."
            : "Cuando registres un ingreso, aquí ves de dónde entra la plata."}
        </EmptyState>
        {r.unclassified.count > 0 && (
          <Link to="/por-clasificar" className="mt-6 flex min-h-control items-center gap-2 rounded-md bg-attention-soft px-3 text-caption font-semibold text-attention">
            <Icon name="inbox" size="sm" />
            <span className="flex-1">{r.unclassified.count === 1 ? "1 movimiento por clasificar no entra" : `${r.unclassified.count} movimientos por clasificar no entran`}</span>
            <Icon name="chevron_right" size="sm" />
          </Link>
        )}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-10">
      <ReportHeader title={expense ? "Gastos" : "Ingresos"} />
      <PeriodBar p={p} />

      <div className="flex items-center gap-5">
        {expense && top.length > 0 && (
          <div className="relative size-37 flex-none" role="img"
            aria-label={`Gasto por grupo: ${top.map((g) => `${g.name} ${money(g.amount)}`).join(", ")}`}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie data={top.map((g) => ({ id: g.id, name: g.name, value: Number(g.amount), color: g.color }))} dataKey="value"
                  innerRadius={46} outerRadius={70} paddingAngle={1} startAngle={90} endAngle={-270} isAnimationActive={false}
                  stroke="var(--background)" strokeWidth={2}
                  onClick={(_, i: number) => { const id = top[i]?.id; if (id !== undefined) markToggle(id); }}>
                  {top.map((g) => (
                    <Cell key={g.id} fill={catColor(g.color)} opacity={lit(g.id) ? 1 : 0.3} className="cursor-pointer" />
                  ))}
                </Pie>
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
              <span className="text-caption text-muted-foreground">{centerLabel}</span>
              <span className={`${money(centerAmount).length > 11 ? "text-caption-sm" : "text-body"} leading-5 font-semibold tabular-nums`}>
                {money(centerAmount)}
              </span>
              {picked.length > 0 && <span className="text-caption font-semibold tabular-nums">{share(centerAmount)} %</span>}
            </div>
          </div>
        )}
        <div className="flex min-w-0 flex-1 flex-col">
          <span className="text-caption text-muted-foreground">{expense ? "Gastaste" : "Entró"}</span>
          <span className="text-amount-display-2">{money(r.total)}</span>
          <Versus now={r.total} before={r.previous} against={vs} />
        </div>
      </div>

      {p.year && (
        <section aria-label="Mes a mes" className="mt-5 flex flex-col gap-1.5">
          <SectionHeading>Mes a mes</SectionHeading>
          <div className="h-40" role="img" aria-label={`${expense ? "Gasto" : "Ingreso"} de cada mes: ${months.map((m) => `${m.month} ${money(m.total)}`).join(", ")}`}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={months} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 12, fill: "var(--muted-foreground)" }} />
                <Tooltip cursor={{ fill: "var(--muted)" }} content={({ active, payload }) => {
                  const m = payload?.[0]?.payload as MonthRow | undefined;
                  return <ChartTip active={active && !!m} title={m ? <span className="flex justify-between gap-3"><span>{monthOnly(m.month)}</span><span className="tabular-nums">{money(m.total)}</span></span> : ""}
                    rows={expense && m ? r.groups.filter((g) => Number(m[`g${g.id}`])).map((g) => ({
                      dot: catBg(g.color), label: g.name, value: money(m[`s${g.id}`]!) })) : []} />;
                }} />
                {expense ? r.groups.map((g, k) => (
                  <Bar key={g.id} dataKey={`g${g.id}`} stackId="a" fill={catColor(g.color)} stroke="var(--background)" strokeWidth={2}
                    radius={k === r.groups.length - 1 ? [4, 4, 0, 0] : 0} isAnimationActive={false} fillOpacity={lit(g.id) ? 1 : 0.3} />
                )) : <Bar dataKey="total" fill={catColor(10)} radius={[4, 4, 0, 0]} isAnimationActive={false} />}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}

      {r.unclassified.count > 0 && (
        <Link to="/por-clasificar" className="mt-4 flex min-h-control items-center gap-2 rounded-md bg-attention-soft px-3 text-caption font-semibold text-attention">
          <Icon name="inbox" size="sm" />
          <span className="flex-1">
            {r.unclassified.count === 1 ? "1 movimiento por clasificar no entra" : `${r.unclassified.count} movimientos por clasificar no entran`} ({money(r.unclassified.amount)})
          </span>
          <Icon name="chevron_right" size="sm" />
        </Link>
      )}

      <section aria-label={expense ? "Por grupo" : "Por categoría"} className="mt-5 flex flex-col">
        <SectionHeading action={<span className="text-label text-muted-foreground">vs. {vs}</span>}>{expense ? "Por grupo" : "Por categoría"}</SectionHeading>
        {r.groups.map((g) => {
          const isOpen = open.includes(g.id);
          const expandable = g.children.length > 0;
          const row = (
            <>
              <CategoryChip category={g} />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex justify-between gap-2"><span className="font-semibold">{g.name}</span><span className="text-amount">{money(g.amount)}</span></span>
                <ShareBar pct={share(g.amount)} color={g.color} />
                <span className="flex justify-end text-caption text-muted-foreground tabular-nums">
                  <span className="sr-only">Cambio: </span><Trend now={g.amount} before={g.previous} />
                </span>
              </span>
            </>
          );
          return (
            <div key={g.id} className={`flex flex-col border-b border-border ${marked.includes(g.id) ? "bg-card" : ""}`}>
              {expandable ? (
                <button type="button" aria-expanded={isOpen} onClick={() => toggle(g)} className="flex min-h-16 items-center gap-3 text-left">
                  {row}<Icon name={isOpen ? "expand_less" : "expand_more"} size="md" className="text-muted-foreground" />
                </button>
              ) : (
                <Link to={moves(g.id, g.name)} className="flex min-h-16 items-center gap-3">
                  {row}<Icon name="chevron_right" className="text-muted-foreground" />
                </Link>
              )}
              {expandable && isOpen && (
                <div className="flex flex-col pb-2 pl-12">
                  {g.children.map((k) => (
                    <Link key={k.id} to={moves(k.id, k.name)} className="flex min-h-12 items-center gap-2.5">
                      <CategoryChip category={k} size={28} />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span className="truncate font-semibold">{k.name}</span>
                        <span className="text-caption text-muted-foreground">
                          {Number(k.refunded) > 0 ? `${money(k.refunded)} reembolsado` : `${Number(g.amount) ? Math.round((Number(k.amount) / Number(g.amount)) * 100) : 0} % del grupo`}
                        </span>
                      </span>
                      <span className="flex flex-col items-end tabular-nums">
                        <span className="font-medium">{money(k.amount)}</span>
                        <span className="text-caption text-muted-foreground">{delta(k.amount, k.previous)}</span>
                      </span>
                      <Icon name="chevron_right" className="text-muted-foreground" />
                    </Link>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </section>
      <span className="mt-2.5 text-caption text-muted-foreground">
        {expense
          ? "Toca un grupo para ver sus categorías; una categoría abre sus movimientos. Las cuotas cuentan en el mes que se facturan; los reembolsos restan."
          : "Lo que te devuelven o te pagan de una deuda no es ingreso, y tampoco lo que pasas entre tus cuentas."}
      </span>
    </main>
  );
}
