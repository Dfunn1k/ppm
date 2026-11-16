// X2 · Etiquetas: lo gastado con cada etiqueta en el mes o el año, con su barra, y cada una se
// despliega por categoría. Un gasto con dos etiquetas cuenta en las dos, pero una sola vez en el
// total. «Ver sus movimientos» abre Movimientos filtrado por la etiqueta.
import { useState } from "react";
import { Link } from "react-router";

import { useTagReport } from "@/api/hooks";
import { EmptyState } from "@/components/EmptyState";
import { ReportBones } from "@/components/Skeleton";
import { tagColor } from "@/components/Tags";
import { ErrorAlert, Icon } from "@/components/ui";
import { monthName } from "@/lib/months";

import { PeriodBar, ReportHeader, useMoney, usePeriod } from "./common";

/** Al cambiar de periodo se empieza en general: sin ninguna desplegada. */
export function ReporteEtiquetas() {
  const p = usePeriod();
  return <TagReportView key={p.period} p={p} />;
}

function TagReportView({ p }: { p: ReturnType<typeof usePeriod> }) {
  const report = useTagReport(p.period);
  const money = useMoney();
  const [open, setOpen] = useState<number[]>([]);

  if (report.isPending) return <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-10"><ReportHeader title="Etiquetas" /><PeriodBar p={p} /><ReportBones chart="bars" /></main>;
  if (report.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{report.error.message}</ErrorAlert></main>;
  const r = report.data;
  const max = Math.max(...r.tags.map((t) => Number(t.amount)), 1);
  const when = p.year ? `en ${p.year}` : `en ${monthName(p.month).split(" ")[0]!.toLowerCase()}`;
  const toggle = (id: number) => setOpen((o) => (o.includes(id) ? o.filter((x) => x !== id) : [...o, id]));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-10">
      <ReportHeader title="Etiquetas" />
      <PeriodBar p={p} />
      {r.tags.length === 0 ? (
        <EmptyState icon="sell" title={`Nada con etiqueta ${when}`} action={{ to: "/mas/etiquetas", label: "Ver mis etiquetas" }}>
          Ponle una etiqueta a un gasto al registrarlo o desde su detalle, como «Viaje a Cusco», y aquí ves cuánto se fue en ella.
        </EmptyState>
      ) : (
        <>
          <span className="text-caption text-muted-foreground">Gastaste con etiqueta</span>
          <span className="font-display text-[30px] leading-[34px] font-extrabold tracking-[-0.02em] tabular-nums">{money(r.total)}</span>
          <section aria-label="Por etiqueta" className="mt-5 flex flex-col">
            <span className="border-b border-border pb-1 text-label text-muted-foreground">Por etiqueta</span>
            {r.tags.map((t) => {
              const isOpen = open.includes(t.id);
              const moves = `/movimientos?mes=${p.month}&etiqueta=${t.id}`;
              return (
                <div key={t.id} className="flex flex-col border-b border-border">
                  <button type="button" aria-expanded={isOpen} onClick={() => toggle(t.id)} className="flex min-h-16 items-center gap-3 text-left">
                    <span aria-hidden="true" className="grid size-9 flex-none place-items-center rounded-full" style={{ background: tagColor(t.color), color: "var(--on-category)" }}>
                      <Icon name="sell" className="text-[18px]" />
                    </span>
                    <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                      <span className="flex justify-between gap-2"><span className="font-semibold">{t.name}</span><span className="text-amount">{money(t.amount)}</span></span>
                      <span className="flex items-center gap-2">
                        <span aria-hidden="true" className="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
                          <span className="block h-1.5 rounded-full" style={{ width: `${Math.max(0, (Number(t.amount) / max) * 100)}%`, background: tagColor(t.color) }} />
                        </span>
                        <span className="text-caption text-muted-foreground tabular-nums">{t.moves === 1 ? "1 movimiento" : `${t.moves} movimientos`}</span>
                      </span>
                    </span>
                    <Icon name={isOpen ? "expand_less" : "expand_more"} className="text-[22px] text-muted-foreground" />
                  </button>
                  {isOpen && (
                    <div className="flex flex-col pb-2 pl-12">
                      {t.categories.map((k) => (
                        <div key={k.id} className="flex min-h-11 items-center justify-between gap-2">
                          <span className="truncate">{k.name}</span>
                          <span className="tabular-nums">{money(k.amount)}</span>
                        </div>
                      ))}
                      <Link to={moves} className="flex min-h-11 items-center gap-1 font-semibold">
                        Ver sus movimientos<Icon name="chevron_right" className="text-[20px]" />
                      </Link>
                    </div>
                  )}
                </div>
              );
            })}
          </section>
          <span className="mt-2.5 text-caption text-muted-foreground">
            Un gasto con dos etiquetas cuenta en las dos, así que la suma de la lista puede pasar del total. Las cuotas y las partes repartidas llevan las etiquetas de su compra; los reembolsos restan.
          </span>
        </>
      )}
    </main>
  );
}
