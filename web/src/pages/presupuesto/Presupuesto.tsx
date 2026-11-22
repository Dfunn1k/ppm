// Presupuesto (sección 3 del boceto, opción A): el mes con Por asignar arriba, Por clasificar si hay
// algo, los sobres de gasto, los de ahorro y la edad del dinero. La primera vez, Empezar (sección 2).
// En escritorio es la lista de la izquierda; lo elegido (Por asignar o un sobre) se abre al lado.
import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router";

import { type BudgetMonth, useBudget, useStartBudget } from "@/api/hooks";
import { OptionList, Segmented, Sheet } from "@/components/Sheet";
import { ListSkeleton } from "@/components/Skeleton";
import { ErrorAlert, Icon, LineField } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { useDesktop } from "@/lib/desktop";
import { isNegative, isZero } from "@/lib/money";
import { monthName, monthOnly, monthOptions } from "@/lib/months";

import { AgeOfMoney, abs, addMonth, Heading, PostRow, useBudgetMonth, useMoney, withMonth } from "./common";
import { type AssignTarget, AssignSheet } from "./Sheets";

export function Presupuesto() {
  const [month, setMonth] = useBudgetMonth();
  const budget = useBudget(month);
  const { money } = useMoney();
  const [picking, setPicking] = useState(false);
  const [assigning, setAssigning] = useState<AssignTarget | null>(null);
  const [menu, setMenu] = useState(false);
  const path = useLocation().pathname;
  const desktop = useDesktop();

  if (budget.isPending) return <ListSkeleton title="Presupuesto" />;
  if (budget.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{budget.error.message}</ErrorAlert></main>;
  const b = budget.data;
  if (!b.started) return <Empezar budget={b} />;

  const expense = b.posts.filter((p) => p.kind === "expense");
  const saving = b.posts.filter((p) => p.kind === "saving");
  const red = isNegative(b.to_assign);
  const before = b.start !== null && month < b.start.slice(0, 7);
  const selected = (id: number) => path === `/presupuesto/sobres/${id}`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-7 pb-28 lg:px-6 lg:pt-7 lg:pb-10">
      <div className="flex items-center justify-between">
        <span className="hidden text-label text-muted-foreground lg:block">Presupuesto</span>
        <button type="button" aria-haspopup="dialog" onClick={() => setPicking(true)} className="flex items-center gap-0.5 text-title-2 lg:hidden">
          {monthName(month)}<Icon name="expand_more" className="text-[22px] text-muted-foreground" />
        </button>
        <button type="button" aria-label="Más opciones del presupuesto" aria-haspopup="dialog" onClick={() => setMenu(true)}
          className="-mr-2.5 grid size-11 place-items-center rounded-full"><Icon name="more_vert" className="text-[22px]" /></button>
      </div>
      <button type="button" aria-haspopup="dialog" onClick={() => setPicking(true)}
        className="mt-2 hidden items-center gap-0.5 self-start font-display text-[22px] leading-7 font-extrabold tracking-[-0.02em] lg:flex">
        {monthName(month)}<Icon name="expand_more" className="text-[20px] text-muted-foreground" />
      </button>

      {before ? (
        <p className="mt-6 text-muted-foreground">Tu presupuesto empieza en {monthName(b.start!.slice(0, 7)).toLowerCase()}. Lo de antes no cuenta.</p>
      ) : (
        <>
          <section aria-label={red ? "Asignaste de más" : "Por asignar"}
            className={`mt-3 flex flex-col gap-1 rounded-lg border bg-card p-4 ${red ? "border-expense" : "border-border"} ${desktop && path === "/presupuesto/por-asignar" ? "shadow-[inset_3px_0_0_var(--foreground)]" : ""}`}>
            <Link to={withMonth("/presupuesto/por-asignar", month)} className="flex flex-col gap-1">
              <span className="flex items-center justify-between text-caption text-muted-foreground">
                {red ? "Asignaste de más" : "Por asignar"}<Icon name="chevron_right" className="text-[20px]" />
              </span>
              <span className={`font-display text-[40px] leading-[44px] font-extrabold tracking-[-0.03em] tabular-nums ${red ? "text-expense" : ""}`}>{money(b.to_assign)}</span>
              <span className="text-caption text-muted-foreground">
                {red ? "Saca plata de algún sobre para cuadrar." : "Plata que todavía no tiene trabajo."}
                {!isZero(b.future) && ` Ya asignaste ${money(b.future)} a los meses que vienen.`}
              </span>
            </Link>
            {b.locked ? (
              <span className="mt-2 flex items-center gap-1.5 text-caption text-muted-foreground"><Icon name="lock" className="text-[18px]" />Mes cerrado: ya no se asigna.</span>
            ) : (
              <button type="button" onClick={() => setAssigning({ from: null, to: null, fixed: "from" })}
                className="mt-2 flex h-11 items-center justify-center gap-1.5 rounded-full bg-primary font-semibold text-primary-foreground">
                <Icon name="call_split" className="text-[20px]" />Asignar
              </button>
            )}
          </section>

          {(!isZero(b.unclassified.available) || !isZero(b.unclassified.activity)) && (
            <Link to="/por-clasificar" className="mt-3 flex min-h-16 items-center gap-3 rounded-lg bg-attention-soft px-3 py-2">
              <span className="grid size-9 flex-none place-items-center rounded-full bg-card text-attention"><Icon name="inbox" /></span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">Por clasificar</span>
                <span className="text-caption text-attention tabular-nums">
                  {isNegative(b.unclassified.available)
                    ? `${money(abs(b.unclassified.available))} sin sobre. Clasifícalos y salen del sobre que toca.`
                    : `${money(b.unclassified.available)} que entraron sin clasificar. Clasifícalos para poder repartirlos.`}
                </span>
              </span>
              <Icon name="chevron_right" className="text-[20px] text-muted-foreground" />
            </Link>
          )}

          <Heading label="Gastos" right="Disponible" />
          {expense.map((p) => <PostRow key={p.id} post={p} month={month} money={money} selected={selected(p.id)} />)}
          {saving.length > 0 && <Heading label="Ahorro" />}
          {saving.map((p) => <PostRow key={p.id} post={p} month={month} money={money} selected={selected(p.id)} />)}
          <AgeOfMoney age={b.age} />
          <AssignSheet budget={b} month={month} target={assigning} onClose={() => setAssigning(null)} />
        </>
      )}

      <Sheet title="Elige el mes" open={picking} onClose={() => setPicking(false)}>
        <OptionList search={false} value={month} options={monthOptions().map((v) => ({ value: v, label: monthName(v) }))}
          onPick={(v) => { setMonth(v); setPicking(false); }} />
      </Sheet>
      <Sheet title="Presupuesto" open={menu} onClose={() => setMenu(false)}>
        <div className="mt-2 flex flex-col">
          <Link to="/presupuesto/cuentas" className="flex min-h-14 items-center gap-3 border-b border-border">
            <Icon name="account_balance_wallet" className="text-[22px]" />
            <span className="flex flex-1 flex-col"><span className="font-semibold">Cuentas del presupuesto</span>
              <span className="text-caption text-muted-foreground">Cuáles se reparten en sobres y cuáles quedan fuera</span></span>
          </Link>
        </div>
      </Sheet>
    </main>
  );
}

/** Empezar, paso 1 (sección 2 del boceto): qué es, la plata para repartir, desde qué mes y los sobres
 *  de ahorro. Al seguir, el presupuesto nace y el paso 2 reparte. */
function Empezar({ budget: b }: { budget: BudgetMonth }) {
  const { money } = useMoney();
  const now = todayISO().slice(0, 7);
  const [month, setMonth] = useState(now);
  const [emergency, setEmergency] = useState(true);
  const [others, setOthers] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const start = useStartBudget();
  const navigate = useNavigate();
  const months = [addMonth(now, -1), now];
  const go = () => start.mutate(
    { month, savings: [...(emergency ? ["Fondo de emergencia"] : []), ...others] },
    { onSuccess: () => navigate(month === now ? "/presupuesto/repartir" : `/presupuesto/repartir?mes=${month}`) });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-10 pb-28 lg:pb-10">
      <h1 className="font-display text-[30px] leading-[34px] font-extrabold tracking-[-0.03em]">Dale un trabajo a cada sol</h1>
      <p className="mt-3 text-muted-foreground">
        Repartes la plata que tienes hoy en sobres: comida, vivienda, transporte. Cuando gastas, sale del sobre. Si un sobre se acaba, decides de cuál sacar.
      </p>
      <div className="mt-4 flex flex-col gap-1 rounded-lg border border-border bg-card p-4">
        <span className="text-caption text-muted-foreground">Tu plata para repartir hoy</span>
        <span className="font-display text-[30px] leading-9 font-extrabold tracking-[-0.03em] tabular-nums">{money(b.plata.total)}</span>
        <span className="text-caption text-muted-foreground">Tus cuentas y tarjetas. No cuenta lo que te deben ni tus inversiones.</span>
      </div>
      <div className="mt-5">
        <Segmented label="¿Desde qué mes?" value={month} onChange={setMonth} options={months.map((m) => ({ value: m, label: monthOnly(m) }))} />
        <span className="mt-1.5 block text-caption text-muted-foreground">Lo que gastaste antes de ese mes no cuenta.</span>
      </div>
      <div className="mt-6 border-b border-border pb-1 text-label text-muted-foreground">Sobres para ahorrar</div>
      <div className="flex min-h-14 items-center gap-3 border-b border-border">
        <span className="grid size-5 flex-none place-items-center rounded-[5px] bg-primary/50 text-primary-foreground"><Icon name="lock" className="text-[14px]" /></span>
        <span className="flex flex-col"><span className="font-semibold">Construir patrimonio</span>
          <span className="text-caption text-muted-foreground">Para el capital de tus préstamos y lo que inviertes</span></span>
      </div>
      <label className="flex min-h-14 items-center gap-3 border-b border-border">
        <input type="checkbox" checked={emergency} onChange={() => setEmergency(!emergency)} className="size-5 accent-primary" />
        <span className="flex flex-col"><span className="font-semibold">Fondo de emergencia</span>
          <span className="text-caption text-muted-foreground">Para lo que no esperabas</span></span>
      </label>
      {others.map((o) => (
        <div key={o} className="flex min-h-14 items-center gap-3 border-b border-border">
          <Icon name="savings" className="text-[20px]" /><span className="flex-1 font-semibold">{o}</span>
          <button type="button" aria-label={`Quitar ${o}`} onClick={() => setOthers(others.filter((x) => x !== o))}
            className="grid size-10 place-items-center rounded-full"><Icon name="close" /></button>
        </div>
      ))}
      <button type="button" onClick={() => setAdding(true)} className="flex min-h-14 items-center gap-3 border-b border-border font-semibold">
        <Icon name="add" className="text-[20px]" />Otro sobre de ahorro
      </button>
      {start.isError && <div className="mt-4"><ErrorAlert>{start.error.message}</ErrorAlert></div>}
      <button type="button" onClick={go} disabled={start.isPending}
        className="mt-8 flex h-12 items-center justify-center gap-1.5 rounded-full bg-primary font-semibold text-primary-foreground disabled:opacity-60">
        {start.isPending && <Icon name="progress_activity" className="animate-spin text-[20px]" />}Siguiente
      </button>

      <Sheet title="Otro sobre de ahorro" open={adding} onClose={() => setAdding(false)}>
        <form className="mt-3 flex flex-col gap-4" onSubmit={(e) => {
          e.preventDefault();
          const n = name.trim();
          if (n && !others.includes(n) && n !== "Fondo de emergencia" && n !== "Construir patrimonio") setOthers([...others, n]);
          setName("");
          setAdding(false);
        }}>
          <LineField label="¿Para qué ahorras?" placeholder="Casa, viaje, estudios" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} />
          <button type="submit" className="flex h-12 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">Agregar</button>
        </form>
      </Sheet>
    </main>
  );
}
