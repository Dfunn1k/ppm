// I1 · Inicio: lo que realmente tengo hoy (los dólares al tipo de hoy), lo más urgente de Pendientes,
// «para mayo» del mes (en trigo, el sello de PPM), en qué se va la plata, mis cuentas (las elegidas en
// Más › Inicio, en su orden) y los últimos movimientos. El ojo esconde todos los montos (modo privado).
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";

import { useHome, useMe, usePending, useUpdateMe } from "@/api/hooks";
import { CategoryChip } from "@/components/CategorySheet";
import { MoveAmount, MoveIcon, MoveLine, moveBits } from "@/components/MoveBits";
import { activityCaption, noticeView, sectionOf } from "@/components/Pending";
import { OptionList, Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon } from "@/components/ui";
import { shortDate, todayISO } from "@/lib/dates";
import { CURRENCY_NAME, formatAmount, isNegative, isZero, rateText, symbolOf } from "@/lib/money";
import { monthName, monthOptions } from "@/lib/months";
import { Pill } from "@/components/Pill";
import { HomeSkeleton } from "@/components/Skeleton";

const ONE: Record<string, string> = { USD: "dólar", EUR: "euro" };

/** En escritorio cada columna de abajo es una tarjeta. */
const DESK_CARD = "lg:mt-0 lg:self-start lg:rounded-lg lg:border lg:border-border lg:bg-card lg:p-5";

function Heading({ label, to, link }: { label: string; to: string; link: string }) {
  return (
    <div className="flex justify-between border-b border-border pb-1 text-label text-muted-foreground">
      <span>{label}</span>
      <Link to={to} className="text-primary-strong underline">{link}</Link>
    </div>
  );
}

export function Inicio() {
  const me = useMe().data;
  const [params, setParams] = useSearchParams();
  const month = params.get("mes") ?? todayISO().slice(0, 7);
  const home = useHome(month);
  const update = useUpdateMe();
  const [picking, setPicking] = useState(false);
  const notice = (useLocation().state as { notice?: string } | null)?.notice;

  if (!me?.currency || home.isPending) return <HomeSkeleton />;
  if (home.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{home.error.message}</ErrorAlert></main>;
  const h = home.data;
  const lang = me.lang ?? "es-PE";
  const hidden = me.ui_private;
  const amount = (v: string, cur: string) => (hidden ? `${symbolOf(cur)} ••••` : formatAmount(v, symbolOf(cur), lang));
  const money = (v: string) => amount(v, h.currency);
  const percent = h.saved_percent ?? 0;
  const negative = isNegative(h.saved);
  const today = hidden ? "Montos escondidos · toca el ojo para verlos" : [
    `Tienes ${money(h.have_total)}`,
    !isZero(h.custody_total) && `guardas ${money(h.custody_total)}`,
    isZero(h.owe_total) ? "no debes nada" : `debes ${money(h.owe_total)}`,
  ].filter(Boolean).join(" · ");
  const cards = h.accounts;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-7 pb-28 lg:grid lg:max-w-[1280px] lg:grid-cols-3 lg:content-start lg:gap-5 lg:px-10 lg:pt-10 lg:pb-10">
      {/* En escritorio el saldo va a la izquierda y el mes con el ojo a la derecha; abajo, dos filas de tarjetas */}
      <div className="flex flex-col lg:col-span-3 lg:flex-row-reverse lg:items-end lg:gap-6">
      <div className="flex items-center gap-2 lg:flex-none">
        <button type="button" aria-haspopup="dialog" onClick={() => setPicking(true)} className="flex flex-1 items-center gap-0.5 text-title-2 lg:h-11 lg:flex-none lg:rounded-xl lg:border lg:border-border lg:px-4 lg:text-body lg:font-semibold">
          {monthName(month)}<Icon name="expand_more" className="text-[22px] text-muted-foreground" />
        </button>
        <button type="button" aria-pressed={hidden} aria-label={hidden ? "Mostrar los montos" : "Esconder los montos"}
          onClick={() => update.mutate({ ui_private: !hidden })}
          className={`grid size-10 place-items-center rounded-full ${hidden ? "bg-secondary text-secondary-foreground" : ""}`}>
          <Icon name={hidden ? "visibility_off" : "visibility"} className="text-[22px]" />
        </button>
        <Link to="/mas/cuenta" aria-label={`Mi cuenta: ${me.name}`}
          className="grid size-10 place-items-center rounded-full bg-secondary font-semibold text-secondary-foreground lg:hidden">
          {me.name[0]?.toUpperCase()}
        </Link>
      </div>
      <div className="flex flex-col lg:min-w-0 lg:flex-1">
      {notice && <div className="mt-4 lg:mt-0 lg:mb-4"><ErrorAlert>{notice}</ErrorAlert></div>}

      <span className="mt-5 text-caption text-muted-foreground lg:mt-0">Lo que realmente tengo hoy</span>
      <h1 className="font-display text-[48px] leading-[50px] font-extrabold tracking-[-0.03em] tabular-nums">{money(h.real_total)}</h1>
      <span className="mt-1 text-caption text-muted-foreground tabular-nums">{today}</span>
      {h.foreign.map((f) => (
        <span key={f.currency} className="text-caption text-muted-foreground tabular-nums">
          {amount(f.amount, f.currency)} = {money((Number(f.amount) * Number(f.rate)).toFixed(2))} · {ONE[f.currency] ?? f.currency} a {rateText(f.rate)}
          {f.rate_date === todayISO() ? " de hoy" : ` del ${shortDate(f.rate_date)}`}
        </span>
      ))}
      {h.foreign.filter((f) => f.stale).map((f) => (
        <div key={f.currency} role="status" className="mt-4 flex items-start gap-2.5 rounded-md bg-attention-soft p-3 text-caption text-attention">
          <Icon name="currency_exchange" />
          <span>
            <b>El tipo de cambio del {ONE[f.currency] ?? f.currency} es del {shortDate(f.rate_date)}.</b>{" "}
            SUNAT no publica uno nuevo desde hace {daysSince(f.rate_date)} días; tus {CURRENCY_NAME[f.currency] ?? f.currency} se cuentan con ese mientras tanto.
          </span>
        </div>
      ))}
      </div>
      </div>

      <PendingCard lang={lang} hidden={hidden} />

      <section aria-label="Para mayo" className="mt-5 flex flex-col gap-2.5 rounded-lg border border-border bg-card p-4 lg:col-span-2 lg:col-start-1 lg:row-start-2 lg:mt-0 lg:p-5">
        <div className="flex items-baseline justify-between">
          <span className="text-label text-muted-foreground">Para mayo</span>
          <span className="text-caption text-muted-foreground tabular-nums">{h.saved_percent === null ? "" : `${hidden ? "••" : percent} % de lo que entró`}</span>
        </div>
        <div role="img" aria-label={hidden ? "Barra de ahorro del mes" : negative || percent === 0 ? "Este mes no hubo ahorro" : `Guardaste el ${percent} % de lo que entró`}
          className="h-3.5 overflow-hidden rounded-full bg-muted">
          <div className="h-3.5 rounded-full bg-trigo" style={{ width: `${Math.min(percent, 100)}%` }} />
        </div>
        <span className="font-semibold tabular-nums">
          {negative
            ? `Este mes salió ${money(h.saved.replace("-", ""))} más de lo que entró.`
            : isZero(h.income_total) && isZero(h.expense_total)
              ? "Todavía no hay movimientos este mes."
              : `Guardaste ${money(h.saved)} este mes.`}
        </span>
        <div className="grid grid-cols-2 gap-3 border-t border-border pt-2.5 tabular-nums">
          <span className="flex flex-col">
            <span className="text-caption text-muted-foreground">Entró</span>
            <span className="flex items-center gap-0.5 font-semibold text-income"><Icon name="south_west" className="text-[18px]" />+ {money(h.income_total)}</span>
          </span>
          <span className="flex flex-col">
            <span className="text-caption text-muted-foreground">Salió</span>
            <span className="flex items-center gap-0.5 font-semibold text-expense"><Icon name="north_east" className="text-[18px]" />− {money(h.expense_total)}</span>
          </span>
        </div>
      </section>

      {h.top.length > 0 && (
        <section aria-label="En qué se va la plata" className={`mt-6 flex flex-col lg:col-start-2 lg:row-start-3 ${DESK_CARD}`}>
          <Heading label="En qué se va la plata" to={`/movimientos?mes=${month}&tipo=expense`} link="Ver todo" />
          {h.top.map((t) => (
            <Link key={t.id} to={`/movimientos?mes=${month}&categoria=${t.id}&categoria_nombre=${encodeURIComponent(t.name)}`}
              className="flex min-h-[60px] items-center gap-3 border-b border-border">
              <CategoryChip category={t} />
              <span className="flex min-w-0 flex-1 flex-col gap-1.5">
                <span className="flex justify-between gap-2">
                  <span className="font-semibold">{t.name}</span>
                  <span className="text-amount">{money(t.amount)}</span>
                </span>
                <span aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-1.5 rounded-full" style={{ width: `${t.share}%`, background: `var(--cat-${t.color ?? 0})` }} />
                </span>
              </span>
            </Link>
          ))}
        </section>
      )}

      {cards.length > 0 && (
        <section aria-label="Mis cuentas" className={`mt-6 flex flex-col gap-2 lg:col-start-1 lg:row-start-3 lg:gap-0 ${DESK_CARD}`}>
          <Heading label="Mis cuentas" to="/mas/inicio" link="Elegir cuáles" />
          <div className="-mr-6 flex gap-2 overflow-x-auto pr-6 pb-1 lg:mr-0 lg:flex-col lg:gap-0 lg:overflow-visible lg:pr-0 lg:pb-0">
            {cards.map((a) => (
              <Link key={a.id} to={`/cuentas/${a.id}`} className="flex w-[150px] flex-none flex-col gap-2 rounded-lg border border-border bg-card p-3 lg:min-h-[60px] lg:w-full lg:flex-row lg:items-center lg:gap-3 lg:rounded-none lg:border-0 lg:border-b lg:bg-transparent lg:px-0 lg:py-2">
                <span className="grid size-8 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground lg:size-9"><Icon name={a.icon ?? "payments"} className="text-[18px]" /></span>
                <span className="truncate text-caption text-muted-foreground lg:flex-1 lg:text-body lg:font-semibold lg:text-foreground">{a.name}</span>
                <span className="flex flex-col lg:items-end">
                  <span className="font-semibold tabular-nums">{amount(a.amount, a.currency)}</span>
                  {a.currency !== h.currency && (
                    <span className="text-caption text-muted-foreground tabular-nums">{money(a.base)} hoy</span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Últimos movimientos" className={`mt-6 flex flex-col lg:col-start-3 lg:row-start-3 ${DESK_CARD}`}>
        <Heading label="Últimos movimientos" to="/movimientos" link="Ver todos" />
        {h.recent.length === 0 && <span className="py-3 text-caption text-muted-foreground">Todavía no registras nada. Toca + para empezar.</span>}
        {h.recent.map((x) => (
          <Link key={x.id} to={`/movimientos/${x.id}`} className="flex min-h-[60px] items-center gap-3 border-b border-border py-2">
            <MoveIcon move={x} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">{x.ref}</span>
              <MoveLine bits={moveBits(x, h.currency, lang, x.date === todayISO() ? "Hoy" : shortDate(x.date))} tags={x.tags} />
            </span>
            {hidden ? <span className="text-amount text-muted-foreground">••••</span> : <MoveAmount move={x} base={h.currency} lang={lang} />}
          </Link>
        ))}
      </section>

      <Sheet title="Elige el mes" open={picking} onClose={() => setPicking(false)}>
        <OptionList search={false} value={month} options={monthOptions().map((v) => ({ value: v, label: monthName(v) }))}
          onPick={(v) => {
            setParams(v === todayISO().slice(0, 7) ? {} : { mes: v }, { replace: true });
            setPicking(false);
          }} />
      </Sheet>
    </main>
  );
}

const ORDER = { late: 0, today: 1, soon: 2 } as const;

/** Pendientes en el Inicio: cuántos hay, cuántos vencidos y los 3 más urgentes. Sin nada, no aparece. */
/** En modo privado, «S/ 50.00» → «S/ ••••» en los textos de los avisos. */
const AMOUNT = /(S\/|US\$|€)\s?[\d.,]+/g;

function PendingCard({ lang, hidden }: { lang: string; hidden: boolean }) {
  const box = usePending().data;
  if (!box) return null;
  const items = [
    ...box.notices.map((n) => {
      const v = noticeView(n, box.today, lang);
      return { key: n.key, to: v.to, title: hidden ? v.title.replace(AMOUNT, "$1 ••••") : v.title, caption: v.caption, late: n.late, date: n.date, section: sectionOf(n, box.today) };
    }),
    ...box.activities.map((a) => ({
      key: `a${a.id}`, to: "/pendientes", title: a.summary, caption: activityCaption(a, box.today), late: a.late, date: a.date,
      section: sectionOf(a, box.today),
    })),
  ].sort((x, y) => ORDER[x.section] - ORDER[y.section] || x.date.localeCompare(y.date));
  if (items.length === 0) return null;
  return (
    <section aria-label="Pendientes" className="mt-5 flex flex-col rounded-lg border border-border bg-card px-4 pt-3 pb-1 lg:col-start-3 lg:row-start-2 lg:mt-0 lg:px-5">
      <span className="flex items-center gap-1.5 text-label text-muted-foreground">
        Pendientes<Pill>{items.length}</Pill>{box.late > 0 && <Pill attention>{box.late === 1 ? "1 vencido" : `${box.late} vencidos`}</Pill>}
      </span>
      {items.slice(0, 3).map((i) => (
        <Link key={i.key} to={i.to} className="flex min-h-[52px] items-center gap-2.5 border-b border-border">
          <span aria-hidden="true" className={`size-2 flex-none rounded-full ${i.late ? "bg-attention" : "bg-muted-foreground"}`} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="truncate font-semibold">{i.title}</span>
            <span className={`truncate text-caption ${i.late ? "text-attention" : "text-muted-foreground"}`}>{i.caption}</span>
          </span>
        </Link>
      ))}
      <Link to="/pendientes" className="flex min-h-12 items-center justify-between font-semibold">
        Ver todo<Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
      </Link>
    </section>
  );
}

/** Cuántos días pasaron desde esa fecha hasta hoy. */
function daysSince(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = todayISO().split("-").map(Number);
  return Math.round((Date.UTC(ty!, tm! - 1, td!) - Date.UTC(y!, m! - 1, d!)) / 86_400_000);
}
