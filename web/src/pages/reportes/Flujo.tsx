// X2 · Flujo: de dónde entró la plata (ingresos) y a dónde fue (grupos de gasto) más lo que guardaste,
// en un Sankey (por esto se eligió Recharts); tocar un destino resalta su plata. Debajo, el % guardado
// de 12 meses: la barra trigo del Inicio, mes por mes. Si salió más de lo que entró, la diferencia
// viene «De tus ahorros».
import { useState } from "react";
import { CartesianGrid, Layer, Line, LineChart, Rectangle, ResponsiveContainer, Sankey, Tooltip, XAxis, YAxis } from "recharts";

import { type FlowReport, useFlowReport } from "@/api/hooks";
import { ErrorAlert } from "@/components/ui";
import { monthName } from "@/lib/months";

import { ChartTip, MONTH_LETTER, PeriodBar, ReportHeader, catColor, useMoney, usePeriod } from "./common";
import { ReportBones } from "@/components/Skeleton";
import { EmptyState } from "@/components/EmptyState";

type Node = FlowReport["uses"][number] & { side: "in" | "out"; fill: string };

/** En el Sankey va el nombre corto (el tooltip dice el completo): «Salario y facturas» → «Salario». */
function short(name: string) {
  return name.length <= 14 ? name : name.split(" ")[0]!;
}

function fillOf(n: FlowReport["uses"][number], side: "in" | "out") {
  if (n.id === null) return n.name === "Guardaste" ? "var(--trigo)" : "var(--muted-foreground)";
  return side === "in" ? catColor(10) : catColor(n.color);
}

export function ReporteFlujo() {
  const p = usePeriod();
  const report = useFlowReport(p.period);
  const money = useMoney();
  const [sel, setSel] = useState<number | null>(null);

  if (report.isPending) return <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-10"><ReportHeader title="Flujo" /><PeriodBar p={p} /><ReportBones chart="bars" /></main>;
  if (report.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{report.error.message}</ErrorAlert></main>;
  const r = report.data;
  const nodes: Node[] = [
    ...r.sources.map((n) => ({ ...n, side: "in" as const, fill: fillOf(n, "in") })),
    ...r.uses.map((n) => ({ ...n, side: "out" as const, fill: fillOf(n, "out") })),
  ];
  const inTotal = r.sources.reduce((a, n) => a + Number(n.amount), 0);
  // Cada fuente reparte su plata entre los destinos en la proporción de cada destino
  const links = r.sources.flatMap((s, i) => r.uses.map((u, j) => ({
    source: i, target: r.sources.length + j, value: inTotal ? (Number(s.amount) * Number(u.amount)) / inTotal : 0,
  }))).filter((l) => l.value > 0);
  const savings = r.savings.map((m) => ({ ...m, label: MONTH_LETTER[Number(m.month.slice(5, 7)) - 1], pct: m.percent }));
  const negative = Number(r.saved) < 0;

  if (links.length === 0) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-10">
        <ReportHeader title="Flujo" />
        <PeriodBar p={p} />
        <EmptyState icon="water" title="Todavía no hay flujo">
          Cuando entre y salga plata en este periodo, aquí ves de dónde vino, a dónde fue y cuánto guardaste.
        </EmptyState>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-10">
      <ReportHeader title="Flujo" />
      <PeriodBar p={p} />

      <span className="text-caption text-muted-foreground">{negative ? "Salió más de lo que entró" : "Guardaste"}</span>
      <span className="font-display text-[34px] leading-[38px] font-extrabold tracking-[-0.02em] tabular-nums">{money(String(Math.abs(Number(r.saved)).toFixed(2)))}</span>
      <span className="mt-0.5 text-caption text-muted-foreground tabular-nums">
        {Number(r.income) > 0 ? `${Math.round((Number(r.saved) / Number(r.income)) * 100)} % de ${money(r.income)} que entraron; ` : "No entró nada; "}salieron {money(r.expense)}
      </span>

      <section aria-label="De dónde entró y a dónde fue" className="mt-5 flex flex-col gap-1.5">
        <div className="flex justify-between border-b border-border pb-1 text-label text-muted-foreground"><span>Entró</span><span>Salió y guardaste</span></div>
          <div className="h-[320px]" role="img"
            aria-label={`Entró ${money(r.income)}: ${r.sources.map((n) => `${n.name} ${money(n.amount)}`).join(", ")}. Fue a: ${r.uses.map((n) => `${n.name} ${money(n.amount)}`).join(", ")}`}>
            <ResponsiveContainer width="100%" height="100%">
              <Sankey data={{ nodes, links }} nodeWidth={8} nodePadding={24} iterations={0} sort={false}
                margin={{ top: 8, right: 104, bottom: 8, left: 92 }}
                node={(props) => {
                  const { x, y, width, height, index, payload } = props as unknown as { x: number; y: number; width: number; height: number; index: number; payload: Node };
                  const n = payload;
                  const left = n.side === "in";
                  const mid = y + height / 2;
                  return (
                    <Layer key={`n${index}`} onClick={left ? undefined : () => setSel((s) => (s === index ? null : index))} style={{ cursor: left ? "default" : "pointer" }}>
                      <Rectangle x={x} y={y} width={width} height={Math.max(height, 2)} radius={2} fill={n.fill} />
                      <text x={left ? x - 6 : x + width + 6} y={mid - 2} textAnchor={left ? "end" : "start"} fontSize={12} fontWeight={600} fill="var(--foreground)">{short(n.name)}</text>
                      <text x={left ? x - 6 : x + width + 6} y={mid + 12} textAnchor={left ? "end" : "start"} fontSize={11} fill="var(--muted-foreground)">{money(n.amount)}</text>
                    </Layer>
                  );
                }}
                link={(props) => {
                  const { sourceX, targetX, sourceY, targetY, sourceControlX, targetControlX, linkWidth, index, payload } = props as unknown as {
                    sourceX: number; targetX: number; sourceY: number; targetY: number; sourceControlX: number; targetControlX: number;
                    linkWidth: number; index: number; payload: { target: Node; source: Node } };
                  const target = nodes.indexOf(payload.target);
                  const op = sel === null ? 0.35 : sel === target ? 0.75 : 0.08;
                  return (
                    <path key={`l${index}`} fill="none" stroke={payload.target.fill} strokeWidth={Math.max(linkWidth, 1)} strokeOpacity={op}
                      d={`M${sourceX},${sourceY} C${sourceControlX},${sourceY} ${targetControlX},${targetY} ${targetX},${targetY}`} />
                  );
                }}>
                <Tooltip content={({ active, payload }) => {
                  // Recharts manda { name, value, payload }: en una cinta, el payload trae su origen y destino
                  type Item = { source?: Node; target?: Node; payload?: Item } & Partial<Node>;
                  const entry = payload?.[0] as { value?: number; payload?: Item } | undefined;
                  const link: Item | undefined = entry?.payload?.payload ?? entry?.payload;
                  if (!entry || entry.value == null || !link) return null;
                  if (link.source && link.target) {
                    return <ChartTip active={active} title={`${link.source.name} → ${link.target.name}`}
                      rows={[{ color: link.target.fill, label: "Plata", value: money(Number(entry.value).toFixed(2)) }]} />;
                  }
                  const n = link as unknown as Node;
                  return <ChartTip active={active} rows={[{ color: n.fill, label: n.name, value: money(n.amount) }]} />;
                }} />
              </Sankey>
            </ResponsiveContainer>
          </div>
        <span className="text-caption text-muted-foreground">Toca un destino para seguir su plata. Pasar plata entre tus cuentas o pagar la tarjeta no es flujo: no sale de ti.</span>
      </section>

      {savings.some((m) => m.pct !== null) && <section aria-label="Cuánto guardas" className="mt-6 flex flex-col gap-1.5">
        <div className="flex justify-between border-b border-border pb-1 text-label text-muted-foreground"><span>Cuánto guardas para mayo</span><span>12 meses</span></div>
        <div className="h-[170px]" role="img" aria-label={`Porcentaje guardado: ${savings.map((m) => `${monthName(m.month)} ${m.pct ?? "sin ingresos"}${m.pct === null ? "" : " %"}`).join(", ")}`}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={savings} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
              <CartesianGrid vertical={false} stroke="var(--border)" />
              <XAxis dataKey="label" tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} />
              <YAxis tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickFormatter={(v: number) => `${v}%`}
                domain={[(min: number) => Math.min(0, Math.floor(min / 10) * 10), (max: number) => Math.max(80, Math.ceil(max / 10) * 10)]} />
              <Tooltip cursor={{ stroke: "var(--muted-foreground)", strokeDasharray: "3 3" }} content={({ active, payload }) => {
                const m = payload?.[0]?.payload as (typeof savings)[number] | undefined;
                return <ChartTip active={active && !!m} title={m ? monthName(m.month) : ""} rows={m ? [
                  { color: "var(--trigo)", label: "Guardaste", value: m.pct === null ? "—" : `${m.pct} %` },
                  { label: "Entró", value: money(m.income) }, { label: "Salió", value: money(m.expense) }] : []} />;
              }} />
              <Line type="monotone" dataKey="pct" stroke="var(--trigo)" strokeWidth={2} connectNulls={false} isAnimationActive={false}
                dot={{ r: 4, fill: "var(--trigo)", stroke: "var(--background)", strokeWidth: 2 }} activeDot={{ r: 6, stroke: "var(--background)", strokeWidth: 2 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
        <span className="text-caption text-muted-foreground">El % de lo que entró que no salió.</span>
      </section>}
    </main>
  );
}
