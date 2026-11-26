// De dónde sale Por asignar (sección 4 del boceto): tu plata menos lo que ya tiene trabajo. Es la
// ecuación del presupuesto con tus números, que siempre cuadra: cada sol está en un solo lugar. «Si cambiaras
// hoy» solo informa: no se reparte una ganancia que no cobraste (D4). En escritorio, en dos columnas.
import { useBudget } from "@/api/hooks";
import { EmptyState } from "@/components/EmptyState";
import { DetailSkeleton } from "@/components/Skeleton";
import { BackLink } from "@/components/PageHeader";
import { SectionHeading } from "@/components/SectionHeading";
import { ErrorAlert, Icon } from "@/components/ui";
import { add, isNegative, isZero, subtract } from "@/lib/money";
import { monthName, monthOnly } from "@/lib/months";

import { addMonth, useBudgetMonth, useMoney, withMonth } from "./common";

function Row({ label, value, strong, mark }: { label: string; value: string; strong?: boolean; mark?: boolean }) {
  return (
    <div className={`flex min-h-9 items-baseline justify-between gap-3 tabular-nums ${strong ? "border-t border-border pt-1.5 font-semibold" : ""} ${mark ? "text-body-lg" : ""}`}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

export function PorAsignar() {
  const [month] = useBudgetMonth();
  const budget = useBudget(month);
  const { money, signed } = useMoney();
  if (budget.isPending) return <DetailSkeleton back={withMonth("/presupuesto", month)} />;
  if (budget.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{budget.error.message}</ErrorAlert></main>;
  const b = budget.data;
  if (!b.started) {
    return <div className="grid h-full place-items-center px-10"><div className="max-w-sm">
      <EmptyState icon="savings" title="Empieza tu presupuesto">Elige el mes y tus sobres de ahorro a la izquierda. Aquí verás de dónde sale cada sol de Por asignar.</EmptyState>
    </div></div>;
  }
  const minus = (v: string) => money(subtract("0", v));
  const sum = (kind: string) => b.posts.filter((p) => p.kind === kind).reduce((s, p) => add(s, p.available), "0.00");
  const expense = sum("expense");
  const saving = sum("saving");
  const un = b.unclassified.available;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28 lg:max-w-220 lg:px-14 lg:pt-10 lg:pb-10">
      <div className="-mx-2.5 flex items-center gap-1 lg:hidden">
        <BackLink to={withMonth("/presupuesto", month)} label="Volver al presupuesto" />
      </div>
      <h1 className="mt-2 text-title-hero lg:mt-0">De dónde sale Por asignar</h1>
      <span className="text-caption text-muted-foreground">{monthName(month)}</span>

      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:gap-14">
        <section aria-label="Tu plata" className="flex flex-1 flex-col">
          <SectionHeading line={false}>Tu plata</SectionHeading>
          <Row label="Efectivo y bancos" value={money(b.plata.accounts)} />
          {!isZero(b.plata.cards) && <Row label="Lo que debes en tarjetas" value={money(b.plata.cards)} />}
          {!isZero(b.plata.installments) && <Row label="Cuotas por venir" value={signed(b.plata.installments)} />}
          {!isZero(b.plata.owed) && <Row label="Lo que debes a otros" value={money(b.plata.owed)} />}
          <Row label="Tu plata para repartir" value={money(b.plata.total)} strong />
        </section>
        <section aria-label="Lo que ya tiene trabajo" className="flex flex-1 flex-col">
          <SectionHeading line={false}>Lo que ya tiene trabajo</SectionHeading>
          <Row label="En los sobres de gasto" value={minus(expense)} />
          <Row label="En los sobres de ahorro" value={minus(saving)} />
          {!isZero(un) && <Row label={isNegative(un) ? "Gastado sin clasificar" : "Entró sin clasificar"} value={isNegative(un) ? `+ ${money(subtract("0", un))}` : minus(un)} />}
          {!isZero(b.future) && <Row label={`Asignado a ${monthOnly(addMonth(month, 1)).toLowerCase()} y después`} value={minus(b.future)} />}
          <Row label="Por asignar" value={money(b.to_assign)} strong mark />
        </section>
      </div>

      <div className="mt-5 flex gap-2 rounded-md bg-muted p-3 text-caption text-muted-foreground">
        <Icon name="info" size="sm" />
        <span>Tu plata para repartir = Por asignar + lo que hay en los sobres. Siempre cuadra: cada sol está en un solo lugar.</span>
      </div>
      {b.plata.if_exchanged !== null && !isZero(b.plata.if_exchanged) && (
        <div className="mt-2 flex justify-between text-caption text-muted-foreground tabular-nums">
          <span>Si cambiaras hoy tus dólares</span><span>{signed(b.plata.if_exchanged)}</span>
        </div>
      )}
    </main>
  );
}
