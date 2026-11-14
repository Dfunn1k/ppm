// X1 · Recurrentes: lo que entra y sale en 30 días y las recurrentes por su próxima fecha; el detalle
// de una (lo que viene, «solo esta vez», lo ya registrado, pausar y terminar).
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { type RecurringNext, type RecurringRow, useMe, useOccurrence, useRecurring, useRecurringList, useRecurringState } from "@/api/hooks";
import { CategoryChip } from "@/components/CategorySheet";
import { DateField } from "@/components/DateSheet";
import { Segmented, Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon, PrimaryButton, Spinner } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { formatAmount, isNegative, parseAmount, symbolOf } from "@/lib/money";
import { MODE_NAME, ruleText } from "@/lib/recurrence";

const WEEK = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

/** «Jue 12 nov». */
export function dayDate(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  return `${WEEK[(d.getDay() + 6) % 7]} ${shortDate(iso)}`;
}

function RowIcon({ row }: { row: RecurringRow }) {
  if (row.kind === "transfer") {
    return <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="sync_alt" /></span>;
  }
  return <CategoryChip category={row.category ?? { icon: "repeat", color: 0 }} />;
}

function ModeChip({ row }: { row: RecurringRow }) {
  const paused = row.state === "paused";
  const cls = paused || row.mode === "reminder" ? "border-border text-muted-foreground"
    : row.mode === "draft" ? "border-dashed border-input-line" : "border-primary bg-primary text-primary-foreground";
  return (
    <span className={`rounded-full border px-2 text-[11px] leading-[18px] font-semibold ${cls}`}>
      {paused ? "Pausada" : MODE_NAME[row.mode]}
    </span>
  );
}

function caption(row: RecurringRow) {
  if (row.state === "paused") return "Pausada";
  const when = row.next ? shortDate(row.next.date) : "Sin próximas fechas";
  if (row.mode === "reminder") return `${when} · te avisamos`;
  return `${when} · ${row.kind === "transfer" ? `a ${row.to_account}` : row.account}`;
}

export function Recurrentes() {
  const me = useMe().data;
  const list = useRecurringList();
  if (!me?.currency || list.isPending) return <Spinner />;
  if (list.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{list.error.message}</ErrorAlert></main>;
  const lang = me.lang ?? "es-PE";
  const { rows } = list.data;
  const sym = symbolOf(list.data.currency);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/mas" aria-label="Volver a Más" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
      </div>
      <h1 className="mt-1 text-title-hero">Recurrentes</h1>
      {rows.length === 0 ? (
        <div className="mt-10 flex flex-col items-center gap-3 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-muted"><Icon name="repeat" className="text-[30px]" /></span>
          <span className="font-display text-[22px] font-bold">Nada se repite todavía</span>
          <p className="text-muted-foreground">El sueldo, el alquiler o Netflix: anótalos una vez y PPM los registra cada vez que toca. Al registrar cualquier movimiento, activa «Se repite».</p>
        </div>
      ) : (
        <>
          <section aria-label="Próximos 30 días" className="mt-4 grid grid-cols-2 gap-3 rounded-lg border border-border bg-card p-4 tabular-nums">
            <span className="col-span-2 text-label text-muted-foreground">Próximos 30 días</span>
            <span className="flex flex-col">
              <span className="text-caption text-muted-foreground">Entra</span>
              <span className="font-semibold text-income">+ {formatAmount(list.data.incoming, sym, lang)}</span>
            </span>
            <span className="flex flex-col">
              <span className="text-caption text-muted-foreground">Sale</span>
              <span className="font-semibold text-expense">− {formatAmount(list.data.outgoing, sym, lang)}</span>
            </span>
          </section>
          <span className="mt-5 border-b border-border pb-1 text-label text-muted-foreground">Activas · por fecha</span>
          <ul className="flex flex-col">
            {rows.map((r) => (
              <li key={r.id}>
                <Link to={r.loan_account_id ? `/prestamos/${r.loan_account_id}` : `/mas/recurrentes/${r.id}`}
                  className={`flex min-h-16 items-center gap-3 border-b border-border ${r.state === "paused" ? "opacity-55" : ""}`}>
                  <RowIcon row={r} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold">{r.name}</span>
                    <span className="truncate text-caption text-muted-foreground">{caption(r)}</span>
                  </span>
                  <span className="flex flex-col items-end gap-1">
                    <span className={`text-amount ${r.kind === "transfer" ? "" : isNegative(r.amount) ? "text-expense" : "text-income"}`}>
                      {r.kind === "transfer" ? "" : isNegative(r.amount) ? "− " : "+ "}{formatAmount(r.amount.replace("-", ""), symbolOf(r.currency), lang)}
                    </span>
                    <ModeChip row={r} />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}
      <Link to="/registrar?repite=1"
        className="mt-5 flex h-12 items-center justify-center gap-1.5 rounded-lg border border-dashed border-input-line font-semibold">
        <Icon name="add" />Nuevo recurrente
      </Link>
    </main>
  );
}

export function Recurrente() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const me = useMe().data;
  const rec = useRecurring(id);
  const state = useRecurringState(id);
  const [picked, setPicked] = useState<RecurringNext | null>(null);
  const [ending, setEnding] = useState(false);
  if (!me?.currency || rec.isPending) return <Spinner />;
  if (rec.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{rec.error.message}</ErrorAlert></main>;
  const lang = me.lang ?? "es-PE";
  const { row, rule } = rec.data;
  const sym = symbolOf(row.currency);
  const money = (v: string) => formatAmount(v.replace("-", ""), sym, lang);
  const paused = row.state === "paused";
  const done = row.state === "done";
  const label = `${paused ? "Pausada" : done ? "Terminada" : MODE_NAME[row.mode]} · ${ruleText(rule).toLowerCase()}`;
  const where = row.kind === "transfer" ? `de ${row.account} a ${row.to_account}`
    : `${rec.data.categories.map((c) => c.name).join(", ")} · ${row.kind === "income" ? "entra a" : "sale de"} ${row.account}`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-8">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/mas/recurrentes" aria-label="Volver a Recurrentes" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
        {!done && (
          <Link to={`/mas/recurrentes/${id}/editar`} aria-label="Cambiar la recurrente" className="grid size-11 place-items-center rounded-full"><Icon name="edit" className="text-[24px]" /></Link>
        )}
      </div>
      <span className="mt-1 text-label text-muted-foreground">{label}</span>
      <h1 className="mt-1 text-title-hero">{row.name}</h1>
      <span className="mt-2 text-[28px] leading-9 font-semibold tabular-nums">
        {row.kind === "transfer" ? "" : isNegative(row.amount) ? "− " : "+ "}{money(row.amount)}
        {row.mode === "draft" && <span className="ml-2 text-caption font-normal text-muted-foreground">más o menos</span>}
      </span>
      <span className="text-caption text-muted-foreground">{where} · desde el {shortDate(rule.start)}</span>

      {paused && (
        <div role="status" className="mt-4 flex gap-2.5 rounded-md bg-muted p-3 text-caption">
          <Icon name="pause_circle" />
          <span>No se crea nada hasta que la reanudes; las fechas de la pausa no vuelven.</span>
        </div>
      )}

      {!done && rec.data.next.length > 0 && (
        <>
          <span className="mt-5 border-b border-border pb-1 text-label text-muted-foreground">Próximas fechas · toca una para cambiarla</span>
          <ul className={paused ? "opacity-45" : ""}>
            {rec.data.next.map((n) => (
              <li key={n.occurrence}>
                <button type="button" onClick={() => setPicked(n)} disabled={paused}
                  className="flex min-h-14 w-full items-center gap-3 border-b border-border text-left">
                  <Icon name={n.skipped ? "event_busy" : n.moved || n.changed ? "edit_calendar" : "event"} className="text-[22px] text-muted-foreground" />
                  <span className="flex flex-1 flex-col">
                    <span className={`font-semibold ${n.skipped ? "line-through" : ""}`}>{dayDate(n.date)}</span>
                    <span className="text-caption text-muted-foreground">
                      {n.skipped ? "Saltada: esta vez no"
                        : n.moved || n.changed ? [n.moved && `Movida del ${Number(n.occurrence.slice(8))}`, n.changed && "otro monto"].filter(Boolean).join(" · ")
                          : row.mode === "auto" ? "Se registra sola ese día" : row.mode === "draft" ? "Se crea por confirmar ese día" : "Te avisamos ese día"}
                    </span>
                  </span>
                  <span className={`tabular-nums ${n.skipped ? "text-muted-foreground line-through" : ""}`}>{money(n.amount)}</span>
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      {rec.data.done.length > 0 && (
        <>
          <span className="mt-5 border-b border-border pb-1 text-label text-muted-foreground">Ya registradas</span>
          <ul>
            {rec.data.done.map((d) => (
              <li key={d.move_id}>
                <Link to={`/movimientos/${d.move_id}`} className="flex min-h-14 items-center gap-3 border-b border-border">
                  <span className="flex flex-1 flex-col">
                    <span className="font-semibold">{dayDate(d.date)}</span>
                    <span className="text-caption text-muted-foreground">
                      {!d.posted ? "Por confirmar" : d.from_bank ? "Enlazada con el extracto del banco" : "Confirmada"}
                    </span>
                  </span>
                  <span className="tabular-nums">{money(d.amount)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </>
      )}

      {!done && (
        <>
          <p className="mt-4 text-caption text-muted-foreground">Si cambias el monto o la regla, aplica desde la próxima fecha; lo ya registrado no cambia.</p>
          <div className="mt-4 grid grid-cols-2 gap-3">
            <button type="button" onClick={() => state.mutate(paused ? "resume" : "pause")}
              className="flex h-12 items-center justify-center gap-1.5 rounded-lg border border-border font-semibold">
              <Icon name={paused ? "play_circle" : "pause_circle"} />{paused ? "Reanudar" : "Pausar"}
            </button>
            <button type="button" onClick={() => setEnding(true)}
              className="flex h-12 items-center justify-center gap-1.5 rounded-lg border border-border font-semibold text-destructive">
              <Icon name="stop_circle" />Terminar
            </button>
          </div>
          {state.error && <div className="mt-3"><ErrorAlert>{state.error.message}</ErrorAlert></div>}
        </>
      )}

      <Sheet title="¿Terminar esta recurrente?" open={ending} onClose={() => setEnding(false)}>
        <p className="mx-1 text-muted-foreground">Ya no se crea nada más. Lo ya registrado se queda en Movimientos.</p>
        <div className="mx-1 mt-4">
          <PrimaryButton type="button" pending={state.isPending}
            onClick={() => state.mutate("end", { onSuccess: () => navigate("/mas/recurrentes", { replace: true }) })}>
            Terminar
          </PrimaryButton>
        </div>
      </Sheet>
      {picked && (
        <OccurrenceSheet id={id} next={picked} name={row.name} money={money} lang={lang} onClose={() => setPicked(null)} />
      )}
    </main>
  );
}

/** «Solo esta vez»: otra fecha, otro monto o saltarla; o dejarla como siempre. */
function OccurrenceSheet({ id, next, name, money, lang, onClose }: {
  id: number; next: RecurringNext; name: string; money: (v: string) => string; lang: string; onClose: () => void;
}) {
  const change = useOccurrence(id);
  const [tab, setTab] = useState<"date" | "amount" | "skip">(next.skipped ? "skip" : next.changed && !next.moved ? "amount" : "date");
  const [date, setDate] = useState<string | null>(next.moved ? next.date : null);
  const [amount, setAmount] = useState(next.changed ? money(next.amount).replace(/^[^\d]+/, "") : "");
  const [problem, setProblem] = useState<string | null>(null);
  const done = { onSuccess: onClose };
  const submit = () => {
    setProblem(null);
    if (tab === "skip") return change.mutate({ occurrence: next.occurrence, skip: true }, done);
    if (tab === "date") {
      if (!date) return setProblem("Elige qué día esta vez");
      return change.mutate({ occurrence: next.occurrence, date }, done);
    }
    const total = parseAmount(amount, lang);
    if (!total || Number(total) <= 0) return setProblem("Escribe cuánto esta vez");
    change.mutate({ occurrence: next.occurrence, total }, done);
  };
  return (
    <Sheet title={`Solo el ${dayDate(next.occurrence).toLowerCase()}`} open onClose={onClose}>
      <span className="mx-1 -mt-2 text-caption text-muted-foreground">{name} · {money(next.amount)} · las demás fechas no cambian</span>
      <div className="mx-1 mt-3">
        <Segmented label="Qué cambias" size="sm" value={tab} onChange={(v) => setTab(v as typeof tab)}
          options={[{ value: "date", label: "Otra fecha" }, { value: "amount", label: "Otro monto" }, { value: "skip", label: "Saltar" }]} />
      </div>
      <div className="mx-1 mt-4">
        {tab === "date" && <DateField label="¿Qué día esta vez?" value={date} onChange={setDate} />}
        {tab === "amount" && (
          <label className="flex flex-col gap-0.5 text-caption font-semibold">
            ¿Cuánto esta vez?
            <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="h-12 border-0 border-b-2 border-input-line bg-transparent p-0 text-[28px] font-semibold tabular-nums" />
          </label>
        )}
        {tab === "skip" && (
          <div className="flex gap-2.5 rounded-md bg-muted p-3"><Icon name="event_busy" /><span>Esa fecha no se registra nada; la siguiente sigue como siempre.</span></div>
        )}
      </div>
      {(problem || change.error) && <div className="mx-1 mt-3"><ErrorAlert>{problem ?? change.error?.message}</ErrorAlert></div>}
      <div className="mx-1 mt-4 flex flex-col gap-1">
        <PrimaryButton type="button" pending={change.isPending} onClick={submit}>
          {tab === "skip" ? "Saltar esta vez" : tab === "amount" ? "Cambiar el monto esta vez" : "Moverla esta vez"}
        </PrimaryButton>
        {(next.skipped || next.moved || next.changed) && (
          <button type="button" onClick={() => change.mutate({ occurrence: next.occurrence, reset: true }, done)}
            className="h-11 font-semibold underline">Dejarlo como siempre</button>
        )}
      </div>
    </Sheet>
  );
}
