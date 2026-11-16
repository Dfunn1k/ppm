// M2 · Lo repartido en el tiempo: el calendario de un gasto pagado por adelantado (o de un ingreso
// cobrado por adelantado), lo que todavía espera y «Cancelar lo que falta»: lo que te devolvieron
// (o devolviste) entra a (o sale de) tu cuenta y el resto cuenta ese día. Borrar la cancelación la deshace.
import { useState } from "react";
import { Link } from "react-router";

import { type MoveDetail, useAccounts, useCancelDeferral, useDeleteMove, useMe } from "@/api/hooks";
import { CategoryChip } from "@/components/CategorySheet";
import { addDays, DateField } from "@/components/DateSheet";
import { Sheet, SheetSelect } from "@/components/Sheet";
import { ErrorAlert, Icon, PrimaryButton } from "@/components/ui";
import { shortDate, todayISO } from "@/lib/dates";
import { daysBetween } from "@/lib/deferral";
import { formatAmount, formatNumber, parseAmount, subtract, symbolOf } from "@/lib/money";

type Deferral = NonNullable<MoveDetail["deferral"]>;

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const year = (iso: string) => iso.slice(0, 4);
const longDay = (iso: string) => `${shortDate(iso)} ${year(iso)}`;
const monthOf = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${year(iso)}`;

/** Lo que va debajo del monto: «Por días: del 16 nov 2026 al 15 nov 2027 · 365 días». */
export function deferralCaption(f: Deferral, money: (v: string) => string) {
  return f.method === "days"
    ? `Por días: del ${longDay(f.start)} al ${longDay(f.end!)} · ${daysBetween(f.start, f.end!)} días`
    : `Por meses: ${f.months} partes de ${money(f.parts[0]!.amount)}`;
}

export function DeferralSection({ moveId, deferral: f, title, posted, locked }: {
  moveId: number; deferral: Deferral; title: string; posted: boolean; locked: boolean;
}) {
  const me = useMe().data;
  const lang = me?.lang ?? "es-PE";
  const money = (v: string) => formatAmount(v, symbolOf(me?.currency), lang);
  const [canceling, setCanceling] = useState(false);
  const undo = useDeleteMove(f.canceled?.move_id ?? 0);
  const expense = f.kind === "expense";
  const counted = f.parts.filter((p) => p.move_id).length;
  const left = f.parts.filter((p) => !p.move_id && !p.canceled);
  const canceled = f.parts.filter((p) => p.canceled).length;
  const thisMonth = todayISO().slice(0, 7);
  const c = f.canceled;

  return (
    <>
      <div className="flex flex-col">
        <div className="flex min-h-14 items-center gap-3 border-b border-border">
          <CategoryChip category={f.category} size={36} />
          <span className="flex flex-1 flex-col">
            <span className="text-caption text-muted-foreground">{expense ? "En qué" : "De qué"}</span>
            <span className="font-semibold">{f.category.name}</span>
          </span>
          <span className="text-caption text-muted-foreground">
            {f.method === "days" ? "Cada parte, al empezar su mes" : `El ${Number(f.start.slice(8))} de cada mes`}
          </span>
        </div>
        <div className="flex min-h-14 items-center gap-3 border-b border-border">
          <span className="grid size-9 flex-none place-items-center rounded-full bg-muted"><Icon name={expense ? "hourglass_top" : "hourglass_bottom"} /></span>
          <span className="flex flex-1 flex-col">
            <span>{expense ? "Pagos por adelantado" : "Cobrado por adelantado"}</span>
            <span className="text-caption text-muted-foreground">{expense ? "Lo que pagaste y aún no usas" : "Lo que te pagaron y aún no ganas"}</span>
          </span>
          <span className="font-semibold tabular-nums">{money(f.remaining)}</span>
        </div>
      </div>

      <section aria-label="Partes" className="mt-4 flex flex-col">
        <div className="flex justify-between border-b border-border pb-1 text-label text-muted-foreground tabular-nums">
          <span>{f.parts.length} partes · {counted === 1 ? "1 contó" : `${counted} contaron`}{canceled ? ` · ${canceled} canceladas` : ""}</span>
          <span>Faltan {money(f.remaining)}</span>
        </div>
        {f.parts.map((p) => {
          const state = p.move_id ? (p.date.slice(0, 7) === thisMonth ? "Este mes" : p.posted ? "Contó" : "Por confirmar")
            : p.canceled ? "Cancelada" : p.date.slice(0, 7) === thisMonth ? "Próxima" : "";
          const body = (
            <>
              <span className={`grid size-[26px] flex-none place-items-center rounded-full text-[12px] font-semibold ${p.move_id ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {p.sequence}
              </span>
              <span className={`flex-1 ${p.canceled ? "text-muted-foreground" : ""}`}>
                {p.days ? `${monthOf(p.date)} · ${p.days} d` : longDay(p.date)}
              </span>
              {state && <span className={`text-caption font-semibold ${p.move_id ? "text-income" : "text-muted-foreground"}`}>{state}</span>}
              <span className={`w-24 text-right font-medium tabular-nums ${p.canceled ? "text-muted-foreground line-through" : ""}`}>{money(p.amount)}</span>
            </>
          );
          return p.move_id
            ? <Link key={p.sequence} to={`/movimientos/${p.move_id}`} className="flex min-h-11 items-center gap-3 border-b border-border py-1.5">{body}</Link>
            : <div key={p.sequence} className="flex min-h-11 items-center gap-3 border-b border-border py-1.5">{body}</div>;
        })}
        <p className="mt-3 text-caption text-muted-foreground">
          {expense
            ? `Cada parte es gasto de «${f.category.name}» cuando llega su fecha. Mientras, espera en «Pagos por adelantado».`
            : `Cada parte es ingreso de «${f.category.name}» cuando llega su fecha. Mientras, es algo que debes: «Cobrado por adelantado».`}
        </p>
        {c && (
          <div className="mt-3 flex flex-col gap-1 rounded-xl bg-muted p-3.5">
            <span className="font-semibold">Lo cancelaste el {longDay(c.date)}</span>
            <span className="text-caption text-muted-foreground">
              {Number(c.refund) > 0
                ? (expense ? `Te devolvieron ${money(c.refund)} a ${c.account}` : `Devolviste ${money(c.refund)} desde ${c.account}`)
                  + (Number(c.rest) > 0 ? ` y ${money(c.rest)} contaron como ${expense ? "gasto" : "ingreso"} de «${f.category.name}» ese día.` : ".")
                : `Los ${money(c.rest)} que faltaban contaron como ${expense ? "gasto" : "ingreso"} de «${f.category.name}» ese día.`}
            </span>
            {undo.error && <ErrorAlert>{undo.error.message}</ErrorAlert>}
            <button type="button" disabled={undo.isPending} onClick={() => undo.mutate()} className="mt-1 min-h-11 self-start text-[14px] font-semibold underline">
              Deshacer
            </button>
          </div>
        )}
      </section>

      {!c && posted && left.length > 0 && !locked && (
        <div className="mt-4 flex flex-col gap-2">
          <button type="button" onClick={() => setCanceling(true)}
            className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-input-line font-semibold">
            <Icon name="event_busy" />Cancelar lo que falta
          </button>
          <p className="text-caption text-muted-foreground">
            {expense
              ? "Si cancelaste el seguro o la suscripción. Lo que ya contó como gasto se queda donde está."
              : "Si el trabajo se canceló o devolviste parte del adelanto. Lo que ya contó como ingreso se queda donde está."}
          </p>
        </div>
      )}
      {canceling && <CancelDeferralSheet moveId={moveId} deferral={f} title={title} open onClose={() => setCanceling(false)} />}
    </>
  );
}

function CancelDeferralSheet({ moveId, deferral: f, title, open, onClose }: {
  moveId: number; deferral: Deferral; title: string; open: boolean; onClose: () => void;
}) {
  const me = useMe().data;
  const overview = useAccounts().data;
  const cancel = useCancelDeferral(moveId);
  const lang = me?.lang ?? "es-PE";
  const base = me?.currency ?? "PEN";
  const money = (v: string) => formatAmount(v, symbolOf(base), lang);
  const expense = f.kind === "expense";
  const left = f.parts.filter((p) => !p.move_id && !p.canceled);
  // No antes de la última parte que contó ni dentro del periodo cerrado
  const lastCounted = f.parts.filter((p) => p.move_id).at(-1)?.date;
  const afterLock = me?.lock_date ? addDays(1, me.lock_date) : undefined;
  const minDate = [lastCounted, afterLock].filter((x): x is string => !!x).sort().at(-1);

  const [typed, setTyped] = useState("");
  const [date, setDate] = useState(todayISO());
  const [accountId, setAccountId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const refund = typed.trim() ? parseAmount(typed, lang) : "0.00";
  const rest = refund ? subtract(f.remaining, refund) : null;
  // En moneda base: lo que espera ya está convertido
  const accounts = (overview?.have ?? []).filter((a) => ["cash", "bank"].includes(a.kind) && a.currency === base)
    .sort((x, y) => Number(x.kind !== "bank") - Number(y.kind !== "bank"));
  const account = accountId ?? (accounts[0] ? String(accounts[0].id) : "");
  const some = !!refund && Number(refund) > 0;

  const result: string[] = [`Las ${left.length} partes que faltaban se cancelan; las que ya contaron se quedan.`];
  if (some) {
    const name = accounts.find((a) => String(a.id) === account)?.name ?? "tu cuenta";
    result.push(expense ? `${money(refund!)} entran a ${name}: no es ingreso, es lo que no usaste.`
      : `${money(refund!)} salen de ${name}: no es gasto, es lo que no ganaste.`);
  }
  if (rest && Number(rest) > 0) {
    result.push(`${money(rest)} ${expense ? "que no te devolvieron cuentan como gasto" : "que te quedaste cuentan como ingreso"} de «${f.category.name}» ese día.`);
  }

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (refund === null || Number(refund) < 0) return setProblem("Escribe el monto como 600.00, o 0 si no hubo nada");
    if (Number(refund) > Number(f.remaining)) return setProblem(`No puede pasar de lo que falta: ${money(f.remaining)}`);
    if (some && !account) return setProblem(expense ? "Elige a qué cuenta entró" : "Elige de qué cuenta salió");
    cancel.mutate({ date, refund: refund ?? "0.00", account_id: some ? Number(account) : null }, { onSuccess: onClose });
  };

  const chip = (label: string, value: string) => {
    const on = (parseAmount(typed || "0", lang) ?? "") === value || (!typed && value === "0.00");
    return (
      <button key={label} type="button" aria-pressed={on} onClick={() => setTyped(value === "0.00" ? "" : formatNumber(value, lang))}
        className={`h-8 rounded-full border px-3 text-[13px] font-semibold ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
        {label}
      </button>
    );
  };

  return (
    <Sheet title="Cancelar lo que falta" open={open} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4 px-3">
        <span className="text-caption text-muted-foreground tabular-nums">
          {title} · faltan {money(f.remaining)} en {left.length === 1 ? "1 parte" : `${left.length} partes`}
        </span>
        <label className="flex flex-col gap-1.5 text-caption font-semibold">
          {expense ? "¿Cuánto te devolvieron?" : "¿Cuánto devolviste?"}
          <span className="flex h-11 items-center gap-1.5 border-b-2 border-input-line">
            <span aria-hidden="true" className="text-muted-foreground">{symbolOf(base)}</span>
            <input inputMode="decimal" placeholder="0.00" value={typed} onChange={(e) => setTyped(e.target.value)}
              className="h-10 min-w-0 flex-1 border-0 bg-transparent p-0 text-[17px] font-normal tabular-nums" />
          </span>
        </label>
        <div className="-mt-1 flex flex-wrap gap-1.5">
          {chip(expense ? "No me devolvieron nada" : "No devolví nada", "0.00")}
          {chip("Todo lo que falta", f.remaining)}
        </div>
        {some && (
          <SheetSelect label={expense ? "Entra a" : "Sale de"} sheetTitle={expense ? "¿A qué cuenta entró?" : "¿De qué cuenta salió?"}
            value={account} onChange={setAccountId}
            options={accounts.map((a) => ({ value: String(a.id), label: a.name, hint: formatAmount(a.balances[0]?.amount ?? "0.00", symbolOf(base), lang) }))} />
        )}
        <DateField label="Fecha" value={date} onChange={setDate} max={todayISO()} min={minDate} booked
          sheetTitle={expense ? "¿Cuándo lo cancelaste?" : "¿Cuándo devolviste el adelanto?"} />

        <section aria-label="Qué pasa al cancelar" className="flex flex-col gap-1.5 rounded-xl bg-muted p-3.5">
          {result.map((line) => <span key={line} className="text-[14px] leading-5">{line}</span>)}
        </section>

        {(problem || cancel.error) && <ErrorAlert>{problem ?? cancel.error?.message}</ErrorAlert>}
        <PrimaryButton pending={cancel.isPending}>{left.length === 1 ? "Cancelar la parte que falta" : `Cancelar las ${left.length} partes`}</PrimaryButton>
      </form>
    </Sheet>
  );
}
