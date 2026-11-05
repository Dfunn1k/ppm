// P1 · Pendientes: la bandeja con lo que espera algo de ti, por urgencia (Vencidos, Hoy, Próximos días).
// Mezcla los avisos que calcula PPM, que se van solos al resolverse, con tus recordatorios. Abajo, lo
// pospuesto y con cuántos días de anticipación avisan el pago de tarjeta y los vencimientos.
import { useState } from "react";

import { type Activity, type Notice, useMe, usePending, useSnooze, useUpdateMe } from "@/api/hooks";
import { ActivityItem, ActivitySheet, NoticeItem, type Section, noticeView, sectionOf } from "@/components/Pending";
import { ErrorAlert, Icon, Spinner } from "@/components/ui";
import { shortDate } from "@/lib/dates";

const TITLES: Record<Section, string> = { late: "Vencidos", today: "Hoy", soon: "Próximos días" };

type Item = { notice: Notice } | { activity: Activity };

export function Pendientes() {
  const me = useMe().data;
  const inbox = usePending();
  const [adding, setAdding] = useState(false);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const snooze = useSnooze();
  const update = useUpdateMe();

  if (!me || inbox.isPending) return <Spinner />;
  if (inbox.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{inbox.error.message}</ErrorAlert></main>;
  const box = inbox.data;
  const lang = me.lang ?? "es-PE";
  const days = me.notice_days;

  const items: (Item & { date: string; section: Section })[] = [
    ...box.notices.map((n) => ({ notice: n, date: n.date, section: sectionOf(n, box.today) })),
    ...box.activities.map((a) => ({ activity: a, date: a.date, section: sectionOf(a, box.today) })),
  ].sort((x, y) => x.date.localeCompare(y.date));
  const empty = items.length === 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-8 pb-28">
      <h1 className="text-title-hero">Pendientes</h1>
      <p className="mt-1 text-muted-foreground">
        {empty ? "Nada te espera por ahora." : box.late > 0 ? `${box.late === 1 ? "1 ya pasó" : `${box.late} ya pasaron`} su fecha.` : "Todo a tiempo."}
      </p>

      {(["late", "today", "soon"] as const).map((s) => {
        const list = items.filter((i) => i.section === s);
        if (list.length === 0) return null;
        return (
          <section key={s} aria-label={TITLES[s]} className="mt-5 flex flex-col">
            <span className={`border-b border-border pb-1 text-label ${s === "late" ? "text-attention" : "text-muted-foreground"}`}>{TITLES[s]}</span>
            {list.map((i) => "notice" in i
              ? <NoticeItem key={i.notice.key} n={i.notice} today={box.today} lang={lang} />
              : <ActivityItem key={`a${i.activity.id}`} a={i.activity} today={box.today} />)}
          </section>
        );
      })}

      <button type="button" aria-haspopup="dialog" onClick={() => setAdding(true)} className="mt-3 flex min-h-12 items-center gap-1.5 font-semibold">
        <Icon name="add" />Escribir un recordatorio
      </button>
      <ActivitySheet open={adding} onClose={() => setAdding(false)} />

      {box.snoozed.length > 0 && (
        <section aria-label="Pospuestos" className="mt-5 flex flex-col">
          <button type="button" aria-expanded={showSnoozed} onClick={() => setShowSnoozed(!showSnoozed)}
            className="flex min-h-12 items-center justify-between border-b border-border font-semibold">
            Pospuestos ({box.snoozed.length})
            <Icon name={showSnoozed ? "expand_less" : "expand_more"} className="text-[22px] text-muted-foreground" />
          </button>
          {showSnoozed && box.snoozed.map((n) => (
            <div key={n.key} className="flex min-h-[60px] items-center gap-3 border-b border-border">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{noticeView(n, box.today, lang).title}</span>
                <span className="text-caption text-muted-foreground">Vuelve el {shortDate(n.snooze_until!)}</span>
              </span>
              <button type="button" disabled={snooze.isPending} onClick={() => snooze.mutate({ key: n.key, until: null })}
                className="h-9 rounded-full border border-border px-3 text-[14px] font-semibold">Traer ahora</button>
            </div>
          ))}
        </section>
      )}

      <div className="mt-6 flex min-h-14 items-center justify-between gap-3 border-t border-border pt-3">
        <span className="flex flex-col">
          <span id="dias" className="font-semibold">Avisarme {days === 0 ? "el mismo día" : `${days === 1 ? "1 día" : `${days} días`} antes`}</span>
          <span className="text-caption text-muted-foreground">Del pago de tarjeta y de lo que vence</span>
        </span>
        <span role="group" aria-labelledby="dias" className="flex items-center gap-2">
          <button type="button" aria-label="Un día menos" disabled={days <= 0} onClick={() => update.mutate({ notice_days: days - 1 })}
            className="grid size-9 place-items-center rounded-full border border-border disabled:opacity-40"><Icon name="remove" /></button>
          <span className="w-6 text-center font-semibold tabular-nums">{days}</span>
          <button type="button" aria-label="Un día más" disabled={days >= 60} onClick={() => update.mutate({ notice_days: days + 1 })}
            className="grid size-9 place-items-center rounded-full border border-border disabled:opacity-40"><Icon name="add" /></button>
        </span>
      </div>
      {(update.error ?? snooze.error) && <div className="mt-2"><ErrorAlert>{(update.error ?? snooze.error)!.message}</ErrorAlert></div>}
    </main>
  );
}
