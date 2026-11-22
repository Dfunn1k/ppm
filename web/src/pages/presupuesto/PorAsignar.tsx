// De dónde sale Por asignar (sección 4 del boceto): tu plata menos lo que ya tiene trabajo. Es la
// ecuación del presupuesto con tus números, que siempre cuadra como el debe y el haber. «Si cambiaras
// hoy» solo informa: no se reparte una ganancia que no cobraste (D4). En escritorio, en dos columnas.
import { Link } from "react-router";

import { useBudget } from "@/api/hooks";
import { EmptyState } from "@/components/EmptyState";
import { DetailSkeleton } from "@/components/Skeleton";
import { ErrorAlert, Icon } from "@/components/ui";
import { isZero } from "@/lib/money";
import { monthName, monthOnly } from "@/lib/months";

import { addMonth, useBudgetMonth, useMoney, withMonth } from "./common";

function Row({ label, value, strong, mark }: { label: string; value: string; strong?: boolean; mark?: boolean }) {
  return (
    <div className={`flex min-h-9 items-baseline justify-between gap-3 tabular-nums ${strong ? "border-t border-border pt-1.5 font-semibold" : ""} ${mark ? "text-[17px]" : ""}`}>
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
  const minus = (v: number) => money((-v).toFixed(2));
  const expense = b.posts.filter((p) => p.kind === "expense").reduce((s, p) => s + Number(p.available), 0);
  const saving = b.posts.filter((p) => p.kind === "saving").reduce((s, p) => s + Number(p.available), 0);
  const un = Number(b.unclassified.available);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28 lg:max-w-[880px] lg:px-14 lg:pt-10 lg:pb-10">
      <div className="-mx-2.5 flex items-center gap-1 lg:hidden">
        <Link to={withMonth("/presupuesto", month)} aria-label="Volver al presupuesto" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
      </div>
      <h1 className="mt-1 font-display text-[26px] leading-8 font-extrabold tracking-[-0.03em] lg:text-[40px] lg:leading-[46px]">De dónde sale Por asignar</h1>
      <span className="text-caption text-muted-foreground">{monthName(month)}</span>

      <div className="mt-5 flex flex-col gap-6 lg:flex-row lg:gap-14">
        <section aria-label="Tu plata" className="flex flex-1 flex-col">
          <span className="text-label text-muted-foreground">Tu plata</span>
          <Row label="Efectivo y bancos" value={money(b.plata.accounts)} />
          {!isZero(b.plata.cards) && <Row label="Lo que debes en tarjetas" value={money(b.plata.cards)} />}
          {!isZero(b.plata.installments) && <Row label="Cuotas por venir" value={signed(b.plata.installments)} />}
          {!isZero(b.plata.owed) && <Row label="Lo que debes a otros" value={money(b.plata.owed)} />}
          <Row label="Tu plata para repartir" value={money(b.plata.total)} strong />
        </section>
        <section aria-label="Lo que ya tiene trabajo" className="flex flex-1 flex-col">
          <span className="text-label text-muted-foreground">Lo que ya tiene trabajo</span>
          <Row label="En los sobres de gasto" value={minus(expense)} />
          <Row label="En los sobres de ahorro" value={minus(saving)} />
          {un !== 0 && <Row label={un < 0 ? "Gastado sin clasificar" : "Entró sin clasificar"} value={un < 0 ? `+ ${money((-un).toFixed(2))}` : minus(un)} />}
          {!isZero(b.future) && <Row label={`Asignado a ${monthOnly(addMonth(month, 1)).toLowerCase()} y después`} value={minus(Number(b.future))} />}
          <Row label="Por asignar" value={money(b.to_assign)} strong mark />
        </section>
      </div>

      <div className="mt-5 flex gap-2 rounded-md bg-muted p-3 text-caption text-muted-foreground">
        <Icon name="info" className="text-[18px]" />
        <span>Tu plata para repartir = Por asignar + lo que hay en los sobres. Siempre cuadra, como el debe y el haber.</span>
      </div>
      {b.plata.if_exchanged !== null && !isZero(b.plata.if_exchanged) && (
        <div className="mt-2 flex justify-between text-caption text-muted-foreground tabular-nums">
          <span>Si cambiaras hoy tus dólares</span><span>{signed(b.plata.if_exchanged)}</span>
        </div>
      )}
    </main>
  );
}
