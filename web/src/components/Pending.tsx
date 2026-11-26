// Las piezas de Pendientes: qué dice cada aviso que calcula PPM y a dónde lleva, posponerlo con atajos,
// tus recordatorios (escribir, cambiar, marcar hecho) y la sección «Recordatorios» del detalle de un
// movimiento, una persona o una cuenta.
import { zodResolver } from "@hookform/resolvers/zod";
import { type ReactNode, useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";

import {
  type Activity, type ActivityTarget, type Notice, useActivities, useActivityDone, useDeleteActivity, useReminderDone,
  useSaveActivity, useSnooze,
} from "@/api/hooks";
import { shortDate, todayISO } from "@/lib/dates";
import { formatAmount, isNegative, symbolOf } from "@/lib/money";

import { Button } from "./Button";
import { DateField, DateSheet, addDays } from "./DateSheet";
import { Sheet } from "./Sheet";
import { Pill } from "./Pill";
import { ErrorAlert, Icon, LineField } from "./ui";

export type Section = "late" | "today" | "soon";

/** Vencidos, Hoy o Próximos días. Por confirmar y por clasificar no vencen: van en Hoy. */
export function sectionOf(item: { date: string; late: boolean }, today: string): Section {
  return item.late ? "late" : item.date <= today ? "today" : "soon";
}

const plural = (n: number, one: string, many: string) => (n === 1 ? `1 ${one}` : `${n} ${many}`);

function when(n: Notice, today: string, verb: { past: string; today: string; future: string }) {
  if (n.date < today) return `${verb.past} el ${shortDate(n.date)}`;
  if (n.date === today) return verb.today;
  return `${verb.future} ${shortDate(n.date)}`;
}

/** Lo que dice un aviso y a dónde lleva tocarlo: lo que hay que hacer (`name`) y, aparte, el monto, que
 *  va a la derecha como en una fila de Movimientos, uno por moneda (caso 9, opción C). */
export function noticeView(n: Notice, today: string, lang: string): { icon: string; caption: ReactNode; to: string; name: string; amounts: string[] } {
  const money = (a: { amount: string; currency: string }) => formatAmount(a.amount.replace("-", ""), symbolOf(a.currency), lang);
  switch (n.kind) {
    case "maturity": {
      const owed = isNegative(n.amounts[0]?.amount ?? "0");
      return {
        icon: owed ? "call_made" : "call_received",
        name: owed ? `Le debes a ${n.partner}` : `${n.partner} te debe`,
        amounts: n.amounts.map(money),
        caption: when(n, today, { past: "Venció", today: "Vence hoy", future: "Vence el" }),
        to: `/personas/${n.partner_id}`,
      };
    }
    case "card_due":
      return {
        icon: "credit_card",
        name: `Pagar ${n.account}`,
        amounts: n.amounts.map(money),
        caption: when(n, today, { past: "Venció el pago", today: "Hoy es el último día de pago", future: "Pagar antes del" }),
        to: `/tarjetas/${n.account_id}`,
      };
    case "draft": {
      const title = `${plural(n.count, "movimiento", "movimientos")} por confirmar`;
      return {
        icon: "schedule",
        name: title,
        amounts: [],
        caption: n.bank_charges > 0
          ? withPill(`${plural(n.bank_charges, "es un cargo", "son cargos")} del banco`, "Ya es su día")
          : "Ya llegaron a su día",
        to: n.count === 1 && n.move_id ? `/movimientos/${n.move_id}` : "/movimientos?pendientes=1",
      };
    }
    case "suspense": {
      const title = `${plural(n.count, "movimiento", "movimientos")} por clasificar`;
      return {
        icon: "inbox",
        name: title,
        amounts: [],
        caption: "Del banco: falta decir en qué fueron",
        to: "/por-clasificar",
      };
    }
    case "recurring": {
      const a = n.amounts[0];
      const out = !a || isNegative(a.amount);
      return {
        icon: "notifications",
        name: n.name ?? "",
        amounts: a ? [money(a)] : [],
        caption: n.date < today
          ? withPill(`Desde el ${shortDate(n.date)}`, "Sin registrar", true)
          : out ? "Te toca pagarlo hoy" : "Te toca recibirlo hoy",
        to: `/registrar/aviso/${n.recurring_id}/${n.occurrence}`,
      };
    }
  }
}

/** Un texto con su pastilla al lado (caso 7 de «Sin punto como conector»): «Desde el 10 nov» y «Sin registrar». */
function withPill(text: string, pill: string, attention = false) {
  return <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-0.5">{text}<Pill attention={attention}>{pill}</Pill></span>;
}

/** Lo que dice un recordatorio tuyo debajo de su texto: de qué cuelga y, en su pastilla, para cuándo. */
export function activityCaption(a: Activity, today: string, withTarget = true): ReactNode {
  const target = withTarget ? (a.partner ?? a.move ?? a.account) : null;
  const date = a.done_date
    ? `Hecho el ${shortDate(a.done_date)}`
    : a.date < today ? `Era para el ${shortDate(a.date)}` : a.date === today ? "Para hoy" : `Para el ${shortDate(a.date)}`;
  return target ? withPill(target, date, a.late && !a.done_date) : date;
}

const row = "flex min-h-row items-center gap-3 border-b border-border py-2";
const chip = (late: boolean) =>
  `grid size-10 flex-none place-items-center rounded-full ${late ? "bg-attention-soft text-attention" : "bg-secondary text-secondary-foreground"}`;
const small = "hit-area h-9 rounded-full border border-border px-3 text-body-sm font-semibold";

/** Los montos de un aviso, a la derecha y uno por línea. */
export function NoticeAmounts({ amounts }: { amounts: string[] }) {
  if (amounts.length === 0) return null;
  return <span className="flex flex-none flex-col items-end font-medium tabular-nums">{amounts.map((a) => <span key={a}>{a}</span>)}</span>;
}

/** Un aviso en la bandeja: tocarlo lleva a donde se resuelve; «Posponer» abre los atajos. Con `split`
 *  (en la computadora) no va la flecha. */
export function NoticeItem({ n, today, lang, split }: { n: Notice; today: string; lang: string; split?: boolean }) {
  const v = noticeView(n, today, lang);
  const [snoozing, setSnoozing] = useState(false);
  const done = useReminderDone();
  return (
    <div className="flex flex-col gap-2 border-b border-border py-2.5">
      <Link to={v.to} className="flex min-h-control items-center gap-3">
        <span className={chip(n.late)}><Icon name={v.icon} /></span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">{v.name}</span>
          <span className={`text-caption ${n.late ? "text-attention" : "text-muted-foreground"}`}>{v.caption}</span>
        </span>
        <NoticeAmounts amounts={v.amounts} />
        {!split && <Icon name="chevron_right" size="md" className="text-muted-foreground" />}
      </Link>
      <div className="flex flex-wrap gap-2 pl-13">
        {n.kind === "recurring" && (
          <>
            <Link to={v.to} className={`${small} flex items-center border-primary bg-primary text-primary-foreground`}>
              {n.amounts[0] && !isNegative(n.amounts[0].amount) ? "Registrar el cobro" : "Registrar el pago"}
            </Link>
            <button type="button" disabled={done.isPending} className={small}
              onClick={() => done.mutate({ id: n.recurring_id!, occurrence: n.occurrence! })}>Ya lo hice</button>
          </>
        )}
        <button type="button" aria-haspopup="dialog" onClick={() => setSnoozing(true)} className={`${small} flex items-center gap-1`}>
          <Icon name="snooze" size="sm" />Posponer
        </button>
      </div>
      <SnoozeSheet open={snoozing} onClose={() => setSnoozing(false)} noticeKey={n.key} title={v.name} today={today} />
    </div>
  );
}

/** Los atajos para posponer: mañana, en 3 días, el lunes o el día que elijas. */
export function SnoozeSheet({ open, onClose, noticeKey, title, today }: {
  open: boolean; onClose: () => void; noticeKey: string; title: string; today: string;
}) {
  const snooze = useSnooze();
  const dow = new Date(`${today}T12:00:00`).getDay();          // 0 = domingo
  const monday = addDays(((8 - dow) % 7) || 7, today);
  return (
    <DateSheet open={open} onClose={onClose} title="Posponer hasta" value={null} min={addDays(1, today)}
      onChange={(until) => snooze.mutate({ key: noticeKey, until })}
      shortcuts={[{ label: "Mañana", value: addDays(1, today) }, { label: "En 3 días", value: addDays(3, today) },
        { label: "El lunes", value: monday }]}>
      <span className="mx-3 mt-2 text-caption text-muted-foreground">{title}: vuelve ese día si sigue pendiente.</span>
      {snooze.error && <div className="mx-3 mt-2"><ErrorAlert>{snooze.error.message}</ErrorAlert></div>}
    </DateSheet>
  );
}

/** Un recordatorio tuyo: la casilla lo marca hecho; tocar el texto lo edita. */
export function ActivityItem({ a, today, withTarget = true }: { a: Activity; today: string; withTarget?: boolean }) {
  const done = useActivityDone();
  const [editing, setEditing] = useState(false);
  const isDone = !!a.done_date;
  return (
    <div className={row}>
      <button type="button" role="checkbox" aria-checked={isDone} aria-label={isDone ? `Deshacer: ${a.summary}` : `Hecho: ${a.summary}`}
        disabled={done.isPending} onClick={() => done.mutate({ id: a.id, done: !isDone })}
        className="grid size-control flex-none place-items-center">
        <Icon name={isDone ? "check_box" : "check_box_outline_blank"} fill={isDone} size="md"
          className={a.late ? "text-attention" : isDone ? "text-muted-foreground" : ""} />
      </button>
      <button type="button" aria-haspopup="dialog" onClick={() => setEditing(true)} className="flex min-w-0 flex-1 flex-col text-left">
        <span className={`font-semibold ${isDone ? "text-muted-foreground line-through" : ""}`}>{a.summary}</span>
        <span className={`text-caption ${a.late ? "text-attention" : "text-muted-foreground"}`}>{activityCaption(a, today, withTarget)}</span>
      </button>
      <ActivitySheet open={editing} onClose={() => setEditing(false)} activity={a} />
    </div>
  );
}

/** Escribir un recordatorio (colgado de `target` o suelto) o cambiar uno: texto y fecha; también borrarlo. */
export function ActivitySheet({ open, onClose, activity, target }: {
  open: boolean; onClose: () => void; activity?: Activity; target?: ActivityTarget;
}) {
  return (
    <Sheet title={activity ? "Recordatorio" : "Nuevo recordatorio"} open={open} onClose={onClose}>
      {open && <ActivityForm activity={activity} target={target} onDone={onClose} />}
    </Sheet>
  );
}

const activitySchema = z.object({
  summary: z.string().trim().min(1, { error: "Escribe qué tienes que hacer" }).max(200, { error: "Usa 200 caracteres o menos" }),
  date: z.string(),
});

function ActivityForm({ activity, target, onDone }: { activity?: Activity; target?: ActivityTarget; onDone: () => void }) {
  const form = useForm({
    resolver: zodResolver(activitySchema),
    defaultValues: { summary: activity?.summary ?? "", date: activity?.date ?? todayISO() },
  });
  const save = useSaveActivity();
  const remove = useDeleteActivity();
  const date = form.watch("date");
  return (
    <form noValidate onSubmit={form.handleSubmit((v) => save.mutate({ id: activity?.id, ...v, target }, { onSuccess: onDone }))}
      className="mx-3 flex flex-col gap-4">
      <LineField label="Qué tienes que hacer" autoFocus={!activity} placeholder="Llamar a Damaris por la cuota"
        error={form.formState.errors.summary?.message} {...form.register("summary")} />
      <DateField label="Para cuándo" value={date} onChange={(d) => form.setValue("date", d)}
        shortcuts={[{ label: "Hoy", value: todayISO() }, { label: "Mañana", value: addDays(1) }, { label: "En una semana", value: addDays(7) }]} />
      {(save.error ?? remove.error) && <ErrorAlert>{(save.error ?? remove.error)!.message}</ErrorAlert>}
      <Button type="submit" pending={save.isPending}>{activity ? "Guardar" : "Agregar recordatorio"}</Button>
      {activity && (
        <button type="button" disabled={remove.isPending} onClick={() => remove.mutate(activity.id, { onSuccess: onDone })}
          className="min-h-control text-body-sm font-semibold text-destructive underline">Borrar el recordatorio</button>
      )}
    </form>
  );
}

/** La sección «Recordatorios» del detalle de un movimiento, una persona o una cuenta. */
/** Los recordatorios de algo. Con `hideEmpty`, la sección no aparece mientras no haya ninguno
    (se agregan desde el menú ⋮ de la pantalla). */
export function Activities({ target, hideEmpty }: { target: ActivityTarget; hideEmpty?: boolean }) {
  const list = useActivities(target).data ?? [];
  const [adding, setAdding] = useState(false);
  const today = todayISO();
  if (hideEmpty && list.length === 0) return null;
  return (
    <section aria-label="Recordatorios" className="mt-6 flex flex-col">
      <span className="border-b border-border pb-1 text-label text-muted-foreground">Recordatorios</span>
      {list.map((a) => <ActivityItem key={a.id} a={a} today={today} withTarget={false} />)}
      <button type="button" aria-haspopup="dialog" onClick={() => setAdding(true)} className="flex min-h-12 items-center gap-1.5 font-semibold">
        <Icon name="add" />Agregar recordatorio
      </button>
      <ActivitySheet open={adding} onClose={() => setAdding(false)} target={target} />
    </section>
  );
}
