// P1 · Pendientes: la bandeja con lo que espera algo de ti, por urgencia (Vencidos, Hoy, Próximos días).
// Mezcla los avisos que calcula PPM, que se van solos al resolverse, con tus recordatorios. Abajo, lo
// pospuesto y con cuántos días de anticipación avisan el pago de tarjeta y los vencimientos. En la
// computadora es un tablero: las tres urgencias en columnas, siempre las tres, y los controles arriba.
import { useState } from "react";

import { type Activity, type Notice, useMe, usePending, useSnooze, useUpdateMe } from "@/api/hooks";
import { ActivityItem, ActivitySheet, NoticeAmounts, NoticeItem, type Section, noticeView, sectionOf } from "@/components/Pending";
import { ErrorAlert, Icon, Spinner } from "@/components/ui";
import { useDesktop } from "@/lib/desktop";
import { shortDate } from "@/lib/dates";

const TITLES: Record<Section, string> = { late: "Vencidos", today: "Hoy", soon: "Próximos días" };

type Item = { notice: Notice } | { activity: Activity };

export function Pendientes() {
  const me = useMe().data;
  const inbox = usePending();
  const [adding, setAdding] = useState(false);
  const [showSnoozed, setShowSnoozed] = useState(false);
  const desktop = useDesktop();
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
  const setDays = (notice_days: number) => update.mutate({ notice_days });
  const writeButton = (
    <button type="button" aria-haspopup="dialog" onClick={() => setAdding(true)}
      className={desktop
        ? "flex h-10 flex-none items-center gap-1.5 rounded-[10px] bg-primary px-3.5 text-[14px] font-semibold text-primary-foreground"
        : "mt-3 flex min-h-12 items-center gap-1.5 font-semibold"}>
      <Icon name="add" className={desktop ? "text-[20px]" : undefined} />Escribir un recordatorio
    </button>
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-8 pb-28 lg:max-w-none lg:px-10 lg:pb-10">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between lg:gap-6">
        <div className="flex flex-col">
          <h1 className="text-title-hero">Pendientes</h1>
          <p className="mt-1 text-muted-foreground">
            {empty ? "Nada te espera por ahora." : box.late > 0 ? `${box.late === 1 ? "1 ya pasó" : `${box.late} ya pasaron`} su fecha.` : "Todo a tiempo."}
          </p>
        </div>
        {desktop && (
          <div className="flex items-center gap-3">
            <div className="flex h-10 items-center gap-2.5 rounded-[10px] border border-border bg-card pr-1.5 pl-3.5">
              <span id="dias" className="text-[14px] font-semibold">{daysLabel(days)}</span>
              <DaysStepper days={days} onChange={setDays} small />
            </div>
            {writeButton}
          </div>
        )}
      </div>

      <div className="flex flex-col lg:mt-6 lg:grid lg:grid-cols-3 lg:items-start lg:gap-5">
      {(["late", "today", "soon"] as const).map((s) => {
        const list = items.filter((i) => i.section === s);
        // En el celular la sección vacía no sale; en el tablero cada columna queda en su lugar
        if (list.length === 0 && !desktop) return null;
        const late = s === "late";
        return (
          <section key={s} aria-label={TITLES[s]}
            className="mt-5 flex flex-col lg:mt-0 lg:overflow-hidden lg:rounded-2xl lg:border lg:border-border lg:bg-card">
            <span className={`flex items-center justify-between border-b border-border pb-1 text-label lg:px-4 lg:py-3 ${late ? "text-attention lg:bg-attention-soft" : "text-muted-foreground"}`}>
              {TITLES[s]}
              {desktop && (
                <span className={`grid h-[22px] min-w-[22px] place-items-center rounded-full px-1.5 tabular-nums ${late ? "bg-card" : "bg-secondary text-secondary-foreground"}`}>{list.length}</span>
              )}
            </span>
            <div className="flex flex-col lg:px-4 lg:[&>*:last-child]:border-b-0">
              {list.map((i) => "notice" in i
                ? <NoticeItem key={i.notice.key} n={i.notice} today={box.today} lang={lang} split={desktop} />
                : <ActivityItem key={`a${i.activity.id}`} a={i.activity} today={box.today} />)}
              {list.length === 0 && <span className="py-4 text-caption text-muted-foreground">Nada por aquí.</span>}
            </div>
          </section>
        );
      })}
      </div>

      {!desktop && writeButton}
      <ActivitySheet open={adding} onClose={() => setAdding(false)} />

      {box.snoozed.length > 0 && (
        <section aria-label="Pospuestos" className="mt-5 flex flex-col lg:rounded-2xl lg:border lg:border-border lg:bg-card lg:px-4">
          <button type="button" aria-expanded={showSnoozed} onClick={() => setShowSnoozed(!showSnoozed)}
            className="flex min-h-12 items-center justify-between border-b border-border font-semibold">
            Pospuestos ({box.snoozed.length})
            <Icon name={showSnoozed ? "expand_less" : "expand_more"} className="text-[22px] text-muted-foreground" />
          </button>
          {showSnoozed && box.snoozed.map((n) => (
            <div key={n.key} className="flex min-h-[60px] items-center gap-3 border-b border-border">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold">{noticeView(n, box.today, lang).name}</span>
                  <NoticeAmounts amounts={noticeView(n, box.today, lang).amounts} />
                </span>
                <span className="text-caption text-muted-foreground">Vuelve el {shortDate(n.snooze_until!)}</span>
              </span>
              <button type="button" disabled={snooze.isPending} onClick={() => snooze.mutate({ key: n.key, until: null })}
                className="h-9 rounded-full border border-border px-3 text-[14px] font-semibold">Traer ahora</button>
            </div>
          ))}
        </section>
      )}

      {!desktop && (
        <div className="mt-6 flex min-h-14 items-center justify-between gap-3 border-t border-border pt-3">
          <span className="flex flex-col">
            <span id="dias" className="font-semibold">{daysLabel(days)}</span>
            <span className="text-caption text-muted-foreground">Del pago de tarjeta y de lo que vence</span>
          </span>
          <DaysStepper days={days} onChange={setDays} />
        </div>
      )}
      {(update.error ?? snooze.error) && <div className="mt-2"><ErrorAlert>{(update.error ?? snooze.error)!.message}</ErrorAlert></div>}
    </main>
  );
}

const daysLabel = (days: number) => `Avisarme ${days === 0 ? "el mismo día" : `${days === 1 ? "1 día" : `${days} días`} antes`}`;

/** Con cuántos días de anticipación avisa: − el número +. */
function DaysStepper({ days, onChange, small }: { days: number; onChange: (d: number) => void; small?: boolean }) {
  const btn = `grid place-items-center rounded-full border border-border disabled:opacity-40 ${small ? "size-7" : "size-9"}`;
  return (
    <span role="group" aria-labelledby="dias" className="flex items-center gap-2">
      <button type="button" aria-label="Un día menos" disabled={days <= 0} onClick={() => onChange(days - 1)} className={btn}>
        <Icon name="remove" className={small ? "text-[18px]" : undefined} />
      </button>
      {!small && <span className="w-6 text-center font-semibold tabular-nums">{days}</span>}
      <button type="button" aria-label="Un día más" disabled={days >= 60} onClick={() => onChange(days + 1)} className={btn}>
        <Icon name="add" className={small ? "text-[18px]" : undefined} />
      </button>
    </span>
  );
}
