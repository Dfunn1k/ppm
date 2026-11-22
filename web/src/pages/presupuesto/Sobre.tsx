// Un sobre (sección 5 del boceto): lo que te queda, la cuenta completa (traías + asignaste − gastaste),
// el ritmo del mes y los movimientos que lo tocaron. Los de ahorro usan la misma pantalla con sus
// palabras y dicen qué cuentas de fuera salen de él (D10).
import { useState } from "react";
import { Link, useParams } from "react-router";

import { type BudgetMove, useBudget, useBudgetLines, useBudgetMoves, useBudgetScopes, useUndoAssign } from "@/api/hooks";
import { CategoryChip } from "@/components/CategorySheet";
import { DetailSkeleton } from "@/components/Skeleton";
import { ErrorAlert, Icon } from "@/components/ui";
import { shortDate, todayISO } from "@/lib/dates";
import { useDesktop } from "@/lib/desktop";
import { isNegative, isZero } from "@/lib/money";
import { monthOnly } from "@/lib/months";

import { abs, PostChip, postFigures, previousMonthName, useBudgetMonth, useMoney, withMonth } from "./common";
import { type AssignTarget, AssignSheet, CoverSheet } from "./Sheets";

function Row({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex min-h-9 items-baseline justify-between tabular-nums ${strong ? "border-t border-border pt-1.5 font-semibold" : ""}`}>
      <span>{label}</span><span>{value}</span>
    </div>
  );
}

/** «Vas en el día 22 de 30 y gastaste el 47 %»: solo en el mes de hoy y si el sobre tuvo plata. */
function rhythm(month: string, had: number, spent: number) {
  const today = todayISO();
  if (today.slice(0, 7) !== month || had <= 0) return null;
  const [y, m] = month.split("-").map(Number);
  const days = new Date(y!, m!, 0).getDate();
  return `Vas en el día ${Number(today.slice(8, 10))} de ${days} y gastaste el ${Math.round(Math.max(spent, 0) / had * 100)} %.`;
}

export function Sobre() {
  const id = Number(useParams().id);
  const [month] = useBudgetMonth();
  const budget = useBudget(month);
  const lines = useBudgetLines(id, month);
  const moves = useBudgetMoves(month);
  const scopes = useBudgetScopes();
  const undo = useUndoAssign();
  const { money, signed } = useMoney();
  const desktop = useDesktop();
  const [assigning, setAssigning] = useState<AssignTarget | null>(null);
  const [covering, setCovering] = useState(false);

  if (budget.isPending) return <DetailSkeleton back={withMonth("/presupuesto", month)} />;
  if (budget.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{budget.error.message}</ErrorAlert></main>;
  const b = budget.data;
  const p = b.posts.find((x) => x.id === id);
  if (!p) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>Este sobre no tiene nada en {monthOnly(month).toLowerCase()}.</ErrorAlert></main>;
  const saving = p.kind === "saving";
  const { had, spent } = postFigures(p);
  const red = isNegative(p.available);
  const pace = saving ? null : rhythm(month, had, spent);
  const nameOf = (pid: number | null) => (pid === null ? "Por asignar" : b.posts.find((x) => x.id === pid)?.name ?? "otro sobre");
  const mine = (moves.data ?? []).filter((m) => m.to_post_id === id || m.from_post_id === id);
  const moveText = (m: BudgetMove) => {
    const into = m.to_post_id === id;
    if (m.source === "cover") return into ? `Cubierto desde ${nameOf(m.from_post_id)}` : `Cubrió ${nameOf(m.to_post_id)}`;
    if (into) return m.from_post_id === null ? (m.source === "start" ? "Asignado al empezar" : "Asignado desde Por asignar") : `Movido desde ${nameOf(m.from_post_id)}`;
    return m.to_post_id === null ? "Devuelto a Por asignar" : `Movido a ${nameOf(m.to_post_id)}`;
  };
  const accounts = (scopes.data ?? []).filter((s) => !s.on_budget && (s.post_id === id || (s.post_id === null && p.role === "patrimony")));
  const open = !b.locked && p.active;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28 lg:max-w-[880px] lg:px-14 lg:pt-8 lg:pb-10">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to={withMonth("/presupuesto", month)} aria-label="Volver al presupuesto" className="grid size-11 place-items-center rounded-full lg:invisible">
          <Icon name="arrow_back" className="text-[24px]" />
        </Link>
      </div>
      <span className="mt-1 flex items-center gap-2.5">
        <PostChip post={p} size={28} /><span className="text-label text-muted-foreground">{saving ? "Ahorro" : monthOnly(month)}</span>
      </span>
      <h1 className="mt-1.5 font-display text-[32px] leading-[38px] font-extrabold tracking-[-0.03em] lg:text-[40px] lg:leading-[46px]">{p.name}</h1>

      <div className="lg:mt-4 lg:flex lg:items-start lg:gap-14">
        <div className="flex flex-col lg:w-[300px] lg:flex-none">
          <span className="mt-3 text-caption text-muted-foreground lg:mt-0">{saving ? "Guardado" : red ? "Te pasaste" : "Te queda"}</span>
          <span className={`font-display text-[40px] leading-[46px] font-extrabold tracking-[-0.03em] tabular-nums ${red ? "text-expense" : ""}`}>{money(red ? abs(p.available) : p.available)}</span>
          {!saving && (
            <span aria-hidden="true" className="my-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <span className="block h-1.5 rounded-full" style={{ width: `${had > 0 ? Math.min(Math.max(spent / had, 0), 1) * 100 : red ? 100 : 0}%`, background: red ? "var(--expense)" : `var(--cat-${p.color ?? 0})` }} />
            </span>
          )}
          {pace && <span className="text-caption text-muted-foreground">{pace}</span>}
          {open && (
            <div className="mt-4 flex gap-2">
              {red ? (
                <button type="button" onClick={() => setCovering(true)} className="flex h-11 flex-1 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">Cubrir</button>
              ) : (
                <button type="button" onClick={() => setAssigning({ from: null, to: p.id, fixed: "to" })} className="flex h-11 flex-1 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground">Asignar</button>
              )}
              <button type="button" disabled={Number(p.available) <= 0} onClick={() => setAssigning({ from: p.id, to: null, fixed: "from" })}
                className="flex h-11 flex-1 items-center justify-center rounded-full bg-secondary font-semibold text-secondary-foreground disabled:opacity-50">
                {saving ? "Usar" : "Mover a otro"}
              </button>
            </div>
          )}
        </div>
        <div className="mt-4 flex flex-1 flex-col lg:mt-0 lg:max-w-[360px]">
          <Row label={`Traías de ${previousMonthName(month)}`} value={signed(p.carried)} />
          <Row label="Asignaste" value={signed(p.assigned)} />
          <Row label={saving ? "Usaste" : "Gastaste"} value={isZero(p.activity) ? money("0") : signed(p.activity)} />
          <Row label={saving ? "Guardado" : "Te queda"} value={money(p.available)} strong />
          {!saving && Number(p.average) > 0 && <span className="mt-1 text-caption text-muted-foreground tabular-nums">En los últimos 3 meses gastaste {money(p.average)} por mes.</span>}
        </div>
      </div>

      {saving && (
        <div className="mt-4 flex gap-2 rounded-md bg-muted p-3 text-caption text-muted-foreground">
          <Icon name="info" className="text-[18px]" />
          <span>Un sobre de ahorro guarda plata que sigue en tus cuentas. Lo que sobra pasa solo al mes siguiente y va creciendo.</span>
        </div>
      )}

      <div className="mt-6 flex justify-between border-b border-border pb-1 text-label text-muted-foreground"><span>Este mes</span></div>
      {lines.data && lines.data.length === 0 && mine.length === 0 && (
        <span className="py-3 text-caption text-muted-foreground">Nada todavía en {monthOnly(month).toLowerCase()}.</span>
      )}
      {(lines.data ?? []).map((x) => (
        <Link key={x.move_id} to={`/movimientos/${x.move_id}`}
          className="flex min-h-14 items-center gap-3 border-b border-border py-2 lg:grid lg:grid-cols-[72px_1fr_140px] lg:gap-3">
          {desktop && <span className="text-caption text-muted-foreground">{shortDate(x.date)}</span>}
          <span className="flex min-w-0 flex-1 items-center gap-3">
            <CategoryChip category={{ icon: x.icon, color: x.color ?? p.color ?? 0 }} size={32} />
            <span className="flex min-w-0 flex-col lg:flex-row lg:items-baseline lg:gap-2">
              <span className="truncate font-semibold">{x.label}</span>
              <span className="truncate text-caption text-muted-foreground">{desktop ? x.account : [shortDate(x.date), x.account].filter(Boolean).join(", ")}</span>
            </span>
          </span>
          <span className={`text-right font-semibold tabular-nums ${isNegative(x.amount) ? "text-expense" : ""}`}>{signed(x.amount)}</span>
        </Link>
      ))}
      {mine.map((m) => {
        const into = m.to_post_id === id;
        return (
          <div key={m.id} className="flex min-h-14 items-center gap-3 border-b border-border py-2">
            <span className="grid size-8 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="call_split" className="text-[18px]" /></span>
            <span className="flex-1 font-semibold">{moveText(m)}</span>
            <span className="font-semibold tabular-nums">{into ? `+ ${money(m.amount)}` : money(`-${m.amount}`)}</span>
            {!b.locked && (
              <button type="button" aria-label={`Deshacer: ${moveText(m)}`} disabled={undo.isPending} onClick={() => undo.mutate(m.id)}
                className="grid size-9 place-items-center rounded-full text-muted-foreground"><Icon name="undo" className="text-[20px]" /></button>
            )}
          </div>
        );
      })}
      {undo.isError && <div className="mt-3"><ErrorAlert>{undo.error.message}</ErrorAlert></div>}

      {saving && (
        <>
          <div className="mt-6 border-b border-border pb-1 text-label text-muted-foreground">Cuentas que salen de aquí</div>
          {accounts.length === 0
            ? <span className="py-3 text-caption text-muted-foreground">Ninguna. Al sacar una cuenta del presupuesto, eliges de qué sobre sale lo que le pasas.</span>
            : accounts.map((s) => (
              <div key={s.account_id} className="flex min-h-14 items-center gap-3 border-b border-border">
                <span className="grid size-8 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="account_balance" className="text-[18px]" /></span>
                <span className="flex flex-col"><span className="font-semibold">{s.name}</span><span className="text-caption text-muted-foreground">Fuera del presupuesto</span></span>
              </div>
            ))}
        </>
      )}

      <AssignSheet budget={b} month={month} target={assigning} onClose={() => setAssigning(null)} />
      <CoverSheet budget={b} month={month} post={covering ? p : null} onClose={() => setCovering(false)} />
    </main>
  );
}
