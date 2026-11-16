// M2 · Detalle de un movimiento: los datos, lo dividido, el costo del cambio (o la ganancia) al cambiar
// de moneda, con quién (y qué deudas cancela), las líneas de un asiento manual, editar, confirmar o
// pasar a por confirmar, y borrar. Una compra en cuotas muestra su calendario y no se edita; si es
// tuya, se pueden cancelar las cuotas que faltan (y borrar esa cancelación la deshace). Lo repartido
// en el tiempo muestra sus partes y «Cancelar lo que falta»; sus partes se arman solas.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { useAccounts, useDeleteMove, useMe, useMove, useSetMoveState } from "@/api/hooks";
import { MoveAttachments } from "@/components/Attachments";
import { CancelPlanSheet } from "@/components/CancelPlanSheet";
import { CategoryChip } from "@/components/CategorySheet";
import { ClassifySheet } from "@/components/ClassifySheet";
import { DeferralSection, deferralCaption } from "@/components/Deferral";
import { Activities } from "@/components/Pending";
import { type Maturity, MaturitySheet, maturityText } from "@/components/MaturitySheet";
import { Avatar } from "@/components/MoveBits";
import { Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { KIND_NAME, flow, isPersonKind, tone as toneOf } from "@/lib/kinds";
import { add, divide, formatAmount, isNegative, subtract, symbolOf } from "@/lib/money";
import { useBack } from "@/lib/transitions";
import { DetailSkeleton } from "@/components/Skeleton";

const FX_GROUP = { gain: "Ingresos", loss: "Gastos financieros" } as const;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function fullDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${DAYS[new Date(y!, m! - 1, d!).getDay()]} ${d} de ${MONTHS[m! - 1]} de ${y}`;
}

export function DetalleMovimiento() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const back = useBack();
  const me = useMe().data;
  const move = useMove(id);
  const accounts = useAccounts().data;
  const state = useSetMoveState(id);
  const remove = useDeleteMove(id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [canceling, setCanceling] = useState(false);
  const undoCancel = useDeleteMove(move.data?.plan?.canceled?.move_id ?? 0);
  const [classifying, setClassifying] = useState(false);
  const [dating, setDating] = useState<(Maturity & { owesMe: boolean }) | null>(null);
  if (move.isPending || !me) return <DetailSkeleton back="/movimientos" rows={3} />;
  if (move.isError) {
    return (
      <main className="mx-auto max-w-md px-6 pt-8">
        <ErrorAlert>{move.error.message}</ErrorAlert>
        <Link to="/movimientos" className="mt-4 block text-primary-strong underline">Volver a movimientos</Link>
      </main>
    );
  }
  const d = move.data;
  const s = d.summary;
  const lang = me.lang ?? "es-PE";
  const transfer = s.kind === "transfer";
  const f = flow(s.kind, s.incoming);
  const unclassified = s.kind === "unclassified";
  const bank = d.bank ?? [];
  // Las deudas que nacen con este movimiento (no los pagos): cada una puede tener su vencimiento
  const debts = ["lend", "borrow", "opening", "expense"].includes(s.kind)
    ? d.lines.filter((l) => l.partner_id && l.line_id) : [];
  const sign = d.deferral ? (d.deferral.kind === "income" ? "+ " : "− ") : f === "in" ? "+ " : f === "out" ? "− " : "";
  const tone = d.deferral ? toneOf(d.deferral.kind) : f === "none" ? "" : toneOf(s.kind);
  const person = isPersonKind(s.kind) || s.kind === "offset" || s.kind === "write_off" || s.kind === "opening" || d.paid_by_partner_id;
  const partnerId = d.partner_id ?? d.paid_by_partner_id ?? s.partner_id;
  const plan = d.plan;
  const cancels = d.cancels;
  const locked = d.locked;
  // Repartido en el tiempo: el original (de la cuenta a lo que espera), una parte o su cancelación
  const deferral = d.deferral;
  const of = d.deferral_of;
  const part = of && of.sequence != null;
  // Lo de antes de PPM con una persona se corrige en su formulario; el saldo inicial de una cuenta, desde la cuenta
  const editable = s.kind !== "offset" && s.kind !== "write_off" && (s.kind !== "opening" || !!s.partner) && !unclassified && !plan && !cancels
    && !deferral && !of && !locked;
  const canceled = plan?.canceled;
  // Solo una compra tuya (con su categoría) que aún tiene cuotas por facturar
  const cancelable = !!plan && transfer && !!plan.category && !canceled && Number(plan.remaining) > 0 && s.posted;   // aunque la compra esté en un mes cerrado: la cancelación va con su propia fecha
  // Saldo inicial con una persona: lo que ya había antes de PPM (te debía, o le debías)
  const opening = s.kind === "opening" && s.partner
    ? d.lines.some((l) => l.partner_id && Number(l.debit) > 0) ? `${s.partner} ya te debía esto cuando empezaste a usar PPM.` : `Ya le debías esto a ${s.partner} cuando empezaste a usar PPM.`
    : null;
  const [from, to] = transfer ? s.account.split(" → ") : [s.account, null];
  // El ícono de la cuenta, como en Cuentas; si todavía no llegó la lista, el de una billetera.
  const iconOf = (name: string | null | undefined) =>
    [...(accounts?.have ?? []), ...(accounts?.owe ?? [])].find((a) => a.name === name)?.icon ?? "account_balance_wallet";
  const exchange = transfer && s.to_currency !== s.currency && s.to_amount;
  // En un cambio que toca la moneda base, el tipo sale de los dos montos
  const exchangeRate = exchange
    ? s.to_currency === me.currency ? divide(s.to_amount!, s.amount) : s.currency === me.currency ? divide(s.amount, s.to_amount!) : null
    : null;
  const gain = s.fx != null && !isNegative(s.fx);
  // Un cobro o un pago en otra moneda: cuánto de la deuda canceló, a qué tipo y cuánto valía en libros
  const debtCross = !transfer && s.to_currency && s.to_amount && s.to_currency !== s.currency ? s.to_amount : null;
  const debtRate = debtCross
    ? s.currency === me.currency ? divide(s.amount, debtCross) : s.to_currency === me.currency ? divide(debtCross, s.amount) : null
    : null;
  const debtBook = debtCross && s.fx != null ? (s.kind === "collect" ? subtract(s.base, s.fx) : add(s.base, s.fx)) : null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28">
      <div className="-mx-2.5 flex items-center justify-between">
        <button type="button" aria-label="Volver" onClick={back} className="grid size-11 place-items-center rounded-full">
          <Icon name="arrow_back" className="text-[24px]" />
        </button>
        <span className="pr-2.5 text-label text-muted-foreground">
          {deferral ? (deferral.kind === "expense" ? "Gasto repartido" : "Ingreso repartido") : exchange ? "Cambio de moneda" : plan && transfer ? "Gasto en cuotas" : plan && s.kind === "lend" ? "Préstamo en cuotas" : plan ? "Cuotas de antes de PPM" : KIND_NAME[s.kind]}
        </span>
      </div>

      {locked && (
        <div role="status" className="mt-2 flex items-start gap-2 rounded-md bg-muted p-3 text-caption">
          <Icon name="lock" />
          <span>
            <b>Periodo cerrado hasta el {shortDate(me.lock_date!)}.</b> Este movimiento no se cambia ni se borra. Para corregirlo,
            reabre en <Link to="/mas/cierre" className="font-semibold underline">Más › Cierre de periodo</Link>.
          </span>
        </div>
      )}
      {!s.posted && (
        <div role="status" className="mt-2 flex items-center gap-2 rounded-md bg-attention-soft py-2.5 pr-2.5 pl-3 text-caption text-attention">
          <Icon name="schedule" /><span className="flex-1"><b>Por confirmar.</b> No cuenta en tus saldos todavía.</span>
          {!locked && (
            <button type="button" disabled={state.isPending} onClick={() => state.mutate(false)}
              className="flex h-10 flex-none items-center gap-1 rounded-full bg-primary px-3.5 text-[14px] font-semibold text-primary-foreground">
              <Icon name="check" className="text-[18px]" />Confirmar
            </button>
          )}
        </div>
      )}
      <h1 className="mt-4 text-title-hero">{s.ref}</h1>
      {cancels && (
        <Link to={`/movimientos/${cancels.move_id}`} className="mt-3 flex items-center gap-2.5 rounded-[12px] bg-muted py-2.5 pr-2.5 pl-3.5">
          <Icon name="event_busy" />
          <span className="flex-1 text-[14px]">Cancela las cuotas que faltaban de «{cancels.ref}». Para deshacerla, bórrala.</span>
          <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
        </Link>
      )}
      {of && (
        <Link to={`/movimientos/${of.move_id}`} className="mt-3 flex items-center gap-2.5 rounded-[12px] bg-muted py-2.5 pr-2.5 pl-3.5">
          <Icon name={part ? "date_range" : "event_busy"} />
          <span className="flex-1 text-[14px]">
            {part ? `Parte ${of.sequence} de ${of.parts} de «${of.ref}». Se arma sola: para cambiarla, ve al original.`
              : `Cancela lo que faltaba de «${of.ref}». Para deshacerla, bórrala.`}
          </span>
          <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
        </Link>
      )}
      {unclassified && (
        <div className="mt-4 flex items-center gap-2.5 rounded-[12px] bg-attention-soft py-2.5 pr-2.5 pl-3.5 text-attention">
          <Icon name="inbox" />
          <span className="flex-1 text-[14px]">Falta decir en qué fue. Hasta entonces no cuenta como {f === "in" ? "ingreso" : "gasto"}.</span>
          <button type="button" onClick={() => setClassifying(true)}
            className="h-10 flex-none rounded-full bg-primary px-3.5 text-[14px] font-semibold text-primary-foreground">Clasificar</button>
        </div>
      )}
      {opening && <p className="mt-2 text-caption text-muted-foreground">{opening}</p>}
      <span className={`mt-3 flex flex-wrap items-center gap-x-1 ${exchange ? "text-[32px] leading-10 font-semibold tracking-[-0.02em] tabular-nums whitespace-nowrap" : "text-amount-hero"} ${tone}`}>
        {sign}{formatAmount(s.amount, symbolOf(s.currency), lang)}
        {exchange && <><Icon name="arrow_forward" aria-label="a" className="text-[26px] text-muted-foreground" />{formatAmount(s.to_amount!, symbolOf(s.to_currency), lang)}</>}
      </span>
      {plan?.price && plan.installment_amount && (
        <span className="text-caption text-muted-foreground tabular-nums">
          {plan.n_installments} cuotas de {formatAmount(plan.installment_amount, symbolOf(plan.currency), lang)} · precio {formatAmount(plan.price, symbolOf(plan.currency), lang)}
        </span>
      )}
      {deferral && (
        <span className="text-caption text-muted-foreground tabular-nums">
          {deferralCaption(deferral, (v) => formatAmount(v, symbolOf(me.currency), lang))}
        </span>
      )}
      {s.currency !== me.currency && !transfer && (
        <span className="text-caption text-muted-foreground tabular-nums">
          Son {formatAmount(s.base, symbolOf(me.currency), lang)}{d.rate ? ` al ${Number(d.rate).toFixed(3)}` : ""}
        </span>
      )}

      <div className="mt-5 flex flex-col">
        {person && partnerId && (
          <Link to={`/personas/${partnerId}`} className="flex min-h-14 items-center gap-3 border-b border-border">
            <Avatar name={s.partner} />
            <span className="flex flex-1 flex-col">
              <span className="text-caption text-muted-foreground">{d.paid_by_partner_id ? "Pagó" : "Con"}</span>
              <span className="font-semibold">{s.partner}</span>
            </span>
            <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
          </Link>
        )}
        {deferral ? (
          deferral.kind === "expense"
            ? <Field icon={iconOf(from)} label="Salió de" value={from!} />
            : <Field icon={iconOf(to)} label="Entró a" value={to!} />
        ) : (transfer || d.account_id) && s.kind !== "other" && (
          <Field icon={iconOf(from)} label={f === "in" ? "Entró a" : "Salió de"} value={from!} />
        )}
        {plan?.category && <Field icon="category" label="En qué" value={plan.category} />}
        {transfer && !plan && !deferral && (
          <Field icon={iconOf(to)} label="Entró a"
            value={`${to}${s.to_amount && s.to_currency !== s.currency ? ` · ${formatAmount(s.to_amount, symbolOf(s.to_currency), lang)}` : ""}`} />
        )}
        {debtCross && (
          <Field icon="handshake" label="Canceló de la deuda" value={formatAmount(debtCross, symbolOf(s.to_currency), lang)} />
        )}
        {(exchangeRate ?? debtRate) && (
          <div className="flex min-h-[52px] items-center gap-3 border-b border-border">
            <Icon name="currency_exchange" className="w-9 text-center text-muted-foreground" />
            <span className="flex-1">Tipo de cambio</span>
            <span className="font-semibold tabular-nums">{exchangeRate ?? debtRate}</span>
          </div>
        )}
        {d.splits.length > 0 && (
          <div className="flex flex-col border-b border-border py-2">
            <span className="text-caption text-muted-foreground">{s.kind === "income" ? "De qué" : "En qué"}</span>
            {d.splits.map((x) => (
              <div key={x.category?.id ?? `p${x.partner_id}`} className="flex min-h-12 items-center gap-3">
                {x.category && <CategoryChip category={x.category} size={32} />}
                <span className="flex-1 font-semibold">{x.category?.name ?? `Parte de ${x.partner}`}</span>
                {d.splits.length > 1 && <span className="tabular-nums">{formatAmount(x.amount, symbolOf(s.currency), lang)}</span>}
              </div>
            ))}
          </div>
        )}
        {s.kind === "other" && d.lines.length > 0 && (
          <div className="flex flex-col border-b border-border py-2">
            <div className="grid grid-cols-[1fr_84px_84px] gap-2 text-label text-muted-foreground">
              <span>Cuenta</span><span className="text-right">Entra a</span><span className="text-right">Sale de</span>
            </div>
            {d.lines.map((l, i) => (
              <div key={i} className="grid min-h-11 grid-cols-[1fr_84px_84px] items-center gap-2 tabular-nums">
                <span className="truncate font-semibold">{l.account}{l.partner ? ` · ${l.partner}` : ""}</span>
                <span className="text-right">{Number(l.debit) ? l.debit : ""}</span>
                <span className="text-right">{Number(l.credit) ? l.credit : ""}</span>
              </div>
            ))}
          </div>
        )}
        {d.settled.length > 0 && (
          <div className="flex flex-col border-b border-border py-2">
            <span className="text-caption text-muted-foreground">{s.kind === "collect" || s.kind === "repay" || s.kind === "offset" ? "Cancela" : "Lo pagado"}</span>
            {d.settled.map((x) => (
              <Link key={x.line_id} to={`/movimientos/${x.move_id}`} className="flex min-h-11 items-center gap-3">
                <span className="flex-1 truncate font-semibold">{x.ref}</span>
                <span className="text-caption text-muted-foreground">{shortDate(x.date)}</span>
                <span className="tabular-nums">{formatAmount(x.amount, symbolOf(debtCross ? s.to_currency : s.currency), lang)}</span>
              </Link>
            ))}
          </div>
        )}
        <div className="flex min-h-[52px] items-center gap-3 border-b border-border">
          <Icon name="event" className="w-9 text-center text-muted-foreground" />
          <span>{fullDate(s.date)}</span>
        </div>
      </div>

      {debts.length > 0 && (
        <section aria-label="Vencimiento" className="mt-1 flex flex-col">
          {debts.map((l, k) => {
            const m = maturityText(l);
            const owesMe = Number(l.debit) > 0;
            return (
              <button key={l.line_id} type="button"
                onClick={() => setDating({ line_id: l.line_id!, date_maturity: l.date_maturity, maturity_manual: l.maturity_manual, maturity_closing: l.maturity_closing, owesMe })}
                className="flex min-h-[52px] items-center gap-3 border-b border-border text-left">
                <Icon name={m?.late ? "schedule" : "event_available"} className={`w-9 text-center ${m?.late ? "text-attention" : "text-muted-foreground"}`} />
                <span className="flex flex-1 flex-col">
                  <span className="text-caption text-muted-foreground">{debts.length > 1 ? `Parte ${k + 1} · ${formatAmount(l.amount.replace("-", ""), symbolOf(l.currency), lang)}` : "Vence"}</span>
                  <span className={`font-semibold ${m?.late ? "text-attention" : ""}`}>{m?.text ?? "Sin fecha de vencimiento"}</span>
                </span>
                <span className="text-caption font-semibold text-primary-strong">{m ? "Cambiar" : "Poner"}</span>
              </button>
            );
          })}
        </section>
      )}

      {bank.length > 0 && (
        <>
          <section aria-label="Lo que dice el banco" className="mt-4 flex flex-col gap-2 rounded-[12px] bg-muted px-3.5 py-3">
            <span className="text-label text-muted-foreground">Lo que dice el banco</span>
            {bank.map((b) => (
              <div key={b.statement_id} className="flex flex-col gap-1">
                <span className="font-mono text-[14px] leading-5">{b.payment_ref}</span>
                <span className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
                  <span>{b.operation_number ? <>Operación <span className="font-mono text-foreground">{b.operation_number}</span></> : ""}</span>
                  <Link to={`/extractos/${b.statement_id}`} className="flex items-center gap-0.5 font-semibold text-foreground">
                    <span className="max-w-[180px] truncate">{b.statement}</span><Icon name="chevron_right" className="text-[18px]" />
                  </Link>
                </span>
              </div>
            ))}
          </section>
          <span className="mt-2 text-caption text-muted-foreground">El nombre de arriba es tuyo y lo puedes cambiar; lo que dice el banco no cambia.</span>
        </>
      )}

      {plan && (
        <section aria-label="Cuotas" className="mt-4 flex flex-col">
          <div className="flex justify-between border-b border-border pb-1 text-label text-muted-foreground tabular-nums">
            <span>
              {plan.n_installments} cuotas · {billedText(plan.lines.filter((x) => x.billed).length)}
              {canceled ? ` · ${plan.lines.filter((x) => x.canceled).length} canceladas` : ""}
            </span>
            <span>Quedan {formatAmount(plan.remaining, symbolOf(plan.currency), lang)}</span>
          </div>
          {plan.lines.map((x) => (
            <div key={x.sequence} className="flex min-h-11 items-center gap-3 border-b border-border py-1.5">
              <span className={`grid size-[26px] flex-none place-items-center rounded-full text-[12px] font-semibold ${x.billed ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                {x.sequence}
              </span>
              <span className={`flex flex-1 flex-col ${x.canceled ? "text-muted-foreground" : ""}`}>
                <span>Corte del {shortDate(x.closing_date)}</span>
                {x.interest != null && (
                  <span className="text-caption text-muted-foreground tabular-nums">
                    Capital {formatAmount(subtract(x.principal, x.interest), symbolOf(plan.currency), lang)} + interés {formatAmount(x.interest, symbolOf(plan.currency), lang)}
                  </span>
                )}
              </span>
              {x.billed && <span className="text-caption font-semibold text-income">Facturada</span>}
              {x.canceled && <span className="text-caption font-semibold text-muted-foreground">Cancelada</span>}
              <span className={`w-24 text-right font-medium tabular-nums ${x.canceled ? "text-muted-foreground line-through" : ""}`}>{formatAmount(x.principal, symbolOf(plan.currency), lang)}</span>
            </div>
          ))}
          <p className="mt-3 text-caption text-muted-foreground">
            {transfer
              ? `Cada cuota es gasto${plan.category ? ` de «${plan.category}»` : ""} en el corte que la factura. Con el estado de cuenta, la cuota facturada se divide en capital e interés.`
              : s.kind === "lend"
              ? "No es tu gasto: te debe todas las cuotas y cada una vence con su corte."
              : "Una compra de antes de PPM: no es un gasto de este mes. Si te equivocaste, bórrala y vuelve a anotarla desde la tarjeta."}
          </p>
          {canceled && (
            <div className="mt-3 flex flex-col gap-1 rounded-xl bg-muted p-3.5">
              <span className="font-semibold">
                {canceled.kind === "returned" ? "Lo devolviste" : "Pagaste lo que faltaba"} el {shortDate(canceled.date)}
              </span>
              <span className="text-caption text-muted-foreground">
                {canceled.kind === "returned"
                  ? `Las cuotas que faltaban (${formatAmount(canceled.amount, symbolOf(plan.currency), lang)}) salieron de la tarjeta. No es gasto tuyo.`
                  : `El banco te cobró ${formatAmount(canceled.charged ?? "0", symbolOf(plan.currency), lang)}, que van a ${plan.category ?? "su categoría"}.`
                    + (Number(subtract(canceled.amount, canceled.charged ?? canceled.amount)) > 0
                      ? ` Te ahorraste ${formatAmount(subtract(canceled.amount, canceled.charged ?? canceled.amount), symbolOf(plan.currency), lang)} de interés.` : "")}
              </span>
              {canceled.payment_move_id && (
                <span className="text-caption text-muted-foreground">Deshacer también borra el pago de la tarjeta que se registró con ella.</span>
              )}
              {undoCancel.error && <ErrorAlert>{undoCancel.error.message}</ErrorAlert>}
              <button type="button" disabled={undoCancel.isPending} onClick={() => undoCancel.mutate()}
                className="mt-1 min-h-11 self-start text-[14px] font-semibold underline">
                Deshacer
              </button>
            </div>
          )}
        </section>
      )}

      {deferral && <div className="mt-1"><DeferralSection moveId={s.id} deferral={deferral} title={s.ref} posted={s.posted} locked={locked} /></div>}

      {s.fx != null && (d.cost != null || debtBook != null) && (
        <section aria-label={gain ? "Ganancia por tipo de cambio" : "Costo del cambio"}
          className="mt-4 flex flex-col gap-2 rounded-lg border border-border bg-card p-3.5">
          <span className="flex items-center gap-3">
            <CategoryChip category={{ icon: "currency_exchange", color: gain ? 10 : 1 }} />
            <span className="flex flex-1 flex-col">
              <span className="font-semibold">{gain ? "Ganancia por tipo de cambio" : "Costo del cambio"}</span>
              <span className="text-caption text-muted-foreground">{FX_GROUP[gain ? "gain" : "loss"]}</span>
            </span>
            <span className={`font-semibold tabular-nums ${gain ? "text-income" : "text-expense"}`}>
              {gain ? "+ " : "− "}{formatAmount(s.fx.replace("-", ""), symbolOf(me.currency), lang)}
            </span>
          </span>
          <dl className="grid grid-cols-[1fr_auto] gap-y-0.5 border-t border-border pt-2 text-caption text-muted-foreground tabular-nums">
            {debtBook != null ? (
              <>
                <dt>La deuda valía</dt>
                <dd>{formatAmount(debtBook, symbolOf(me.currency), lang)}</dd>
                <dt>{s.kind === "collect" ? "Te pagaron" : "Pagaste"}</dt>
                <dd>{formatAmount(s.base, symbolOf(me.currency), lang)}</dd>
              </>
            ) : (
              <>
                <dt>Te costaron (a {Number(d.cost_rate).toFixed(3)} en promedio)</dt>
                <dd>{formatAmount(d.cost!, symbolOf(me.currency), lang)}</dd>
                <dt>Recibiste</dt>
                <dd>{formatAmount(s.to_amount ?? "0", symbolOf(s.to_currency), lang)}</dd>
              </>
            )}
          </dl>
        </section>
      )}

      <MoveAttachments moveId={s.id} caption={`${s.ref} · ${formatAmount(s.amount, symbolOf(s.currency), lang)}`} />
      <Activities target={{ move_id: s.id }} />

      <div className="min-h-6 flex-1" />
      <div className="flex flex-col gap-2">
        {(state.error || remove.error) && <ErrorAlert>{(state.error ?? remove.error)?.message}</ErrorAlert>}
        {cancelable && (
          <>
            <button type="button" onClick={() => setCanceling(true)}
              className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-input-line font-semibold">
              <Icon name="event_busy" />Cancelar las cuotas que faltan
            </button>
            <p className="text-caption text-muted-foreground">Si lo devolviste o pagaste lo que faltaba. Las cuotas ya facturadas se quedan donde están.</p>
          </>
        )}
        {editable && (
          <Link to={`/movimientos/${s.id}/editar`}
            className="flex h-14 items-center justify-between rounded-xl bg-primary px-5 font-semibold text-primary-foreground">
            <span>Editar</span><Icon name="edit" className="text-[22px]" />
          </Link>
        )}
        {s.posted && !(plan || cancels || deferral || of) && !locked && (
          <button type="button" disabled={state.isPending} onClick={() => state.mutate(s.posted)}
            className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-input-line font-semibold">
            <Icon name={s.posted ? "schedule" : "check"} />
            {s.posted ? "Pasar a por confirmar" : "Confirmar"}
          </button>
        )}
        {!locked && !part && <button type="button" onClick={() => setConfirmDelete(true)}
          className="flex h-11 items-center justify-center gap-1.5 text-[14px] font-semibold text-destructive">
          <Icon name={cancels || of ? "undo" : "delete"} />
          {plan ? "Borrar la compra y sus cuotas" : cancels || of ? "Deshacer la cancelación" : deferral ? "Borrar el movimiento y su reparto" : "Borrar movimiento"}
        </button>}
      </div>

      {plan && cancelable && <CancelPlanSheet plan={plan} title={s.ref} open={canceling} onClose={() => setCanceling(false)} />}

      {unclassified && classifying && (
        <ClassifySheet open onClose={() => setClassifying(false)} items={[{
          move_id: s.id, title: bank[0]?.payment_ref ?? s.ref, caption: `${shortDate(s.date)} · ${s.account}`,
          account_id: d.account_id ?? 0, currency: s.currency, amount: f === "out" ? `-${s.amount}` : s.amount,
        }]} />
      )}

      {dating && (
        <MaturitySheet key={dating.line_id} open onClose={() => setDating(null)} item={dating}
          title={dating.owesMe ? `¿Hasta cuándo te paga${s.partner ? ` ${s.partner.split(" ")[0]}` : ""}?` : `¿Hasta cuándo le pagas${s.partner ? ` a ${s.partner.split(" ")[0]}` : ""}?`} />
      )}

      <Sheet title={cancels || of ? "¿Deshacer la cancelación?" : "¿Borrar este movimiento?"} open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <div className="flex flex-col gap-4 px-3">
          <p className="text-muted-foreground">
            {cancels
              ? `Las cuotas que faltaban de «${cancels.ref}» vuelven a su calendario y a la tarjeta.`
              : of
              ? `Las partes que faltaban de «${of.ref}» vuelven a su calendario y lo devuelto sale de la cuenta.`
              : `«${s.ref}» desaparece de tus movimientos${plan ? ", con sus cuotas," : deferral ? ", con las partes que ya contaron," : ""} y sus montos vuelven a las cuentas. No se puede deshacer.`}
            {bank.length > 0 && " Si vuelves a importar el extracto, regresa: el banco dice que pasó."}
          </p>
          <button type="button" disabled={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => navigate(plan ? `/tarjetas/${plan.card_id}` : cancels ? `/movimientos/${cancels.move_id}` : of ? `/movimientos/${of.move_id}` : "/movimientos", { replace: true }) })}
            className="flex h-14 items-center justify-center gap-2 rounded-xl bg-destructive font-semibold text-destructive-foreground">
            <Icon name={cancels || of ? "undo" : "delete"} />{cancels || of ? "Deshacer la cancelación" : "Borrar movimiento"}
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)} className="h-11 text-caption font-semibold text-primary-strong underline">
            Cancelar
          </button>
        </div>
      </Sheet>
    </main>
  );
}

function billedText(n: number) {
  return n === 1 ? "1 facturada" : `${n} facturadas`;
}

function Field({ icon, label, value }: { icon: string; label: string; value: string }) {
  return (
    <div className="flex min-h-14 items-center gap-3 border-b border-border">
      <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name={icon} /></span>
      <span className="flex flex-col">
        <span className="text-caption text-muted-foreground">{label}</span>
        <span className="font-semibold">{value}</span>
      </span>
    </div>
  );
}
