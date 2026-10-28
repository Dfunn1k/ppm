// I1 · Inicio: lo que realmente tengo hoy (los dólares al tipo de hoy), «para mayo» del mes (en trigo,
// el sello de PPM), en qué se va la plata, mis cuentas y los últimos movimientos.
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";

import { useAccounts, useHome, useMe } from "@/api/hooks";
import { CategoryChip } from "@/components/CategorySheet";
import { MoveAmount, MoveIcon, moveCaption } from "@/components/MoveBits";
import { OptionList, Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon, Spinner } from "@/components/ui";
import { shortDate, todayISO } from "@/lib/dates";
import { CURRENCY_NAME, formatAmount, isNegative, isZero, rateText, symbolOf } from "@/lib/money";
import { monthName, monthOnly, monthOptions } from "@/lib/months";

const ONE: Record<string, string> = { USD: "dólar", EUR: "euro" };

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
  const accounts = useAccounts().data;
  const [picking, setPicking] = useState(false);
  const notice = (useLocation().state as { notice?: string } | null)?.notice;

  if (!me?.currency || home.isPending) return <Spinner />;
  if (home.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{home.error.message}</ErrorAlert></main>;
  const h = home.data;
  const lang = me.lang ?? "es-PE";
  const money = (v: string) => formatAmount(v, symbolOf(h.currency), lang);
  const percent = h.saved_percent ?? 0;
  const negative = isNegative(h.saved);
  const today = [
    `Tienes ${money(h.have_total)}`,
    !isZero(h.custody_total) && `guardas ${money(h.custody_total)}`,
    isZero(h.owe_total) ? "no debes nada" : `debes ${money(h.owe_total)}`,
  ].filter(Boolean).join(" · ");
  const cards = (accounts?.have ?? []).filter((a) => a.kind === "cash" || a.kind === "bank");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-7 pb-28">
      <div className="flex items-center justify-between">
        <button type="button" aria-haspopup="dialog" onClick={() => setPicking(true)} className="flex items-center gap-0.5 text-title-2">
          {monthName(month)}<Icon name="expand_more" className="text-[22px] text-muted-foreground" />
        </button>
        <Link to="/mas/cuenta" aria-label={`Mi cuenta: ${me.name}`}
          className="grid size-10 place-items-center rounded-full bg-secondary font-semibold text-secondary-foreground">
          {me.name[0]?.toUpperCase()}
        </Link>
      </div>
      {notice && <div className="mt-4"><ErrorAlert>{notice}</ErrorAlert></div>}

      <span className="mt-5 text-caption text-muted-foreground">Lo que realmente tengo · hoy</span>
      <h1 className="font-display text-[48px] leading-[50px] font-extrabold tracking-[-0.03em] tabular-nums">{money(h.real_total)}</h1>
      <span className="mt-1 text-caption text-muted-foreground tabular-nums">{today}</span>
      {h.foreign.map((f) => (
        <span key={f.currency} className="text-caption text-muted-foreground tabular-nums">
          Tus {formatAmount(f.amount, symbolOf(f.currency), lang)} cuentan a {rateText(f.rate)}
          {f.rate_date === todayISO() ? ", el tipo de compra de hoy." : `, el último que hay (${shortDate(f.rate_date)}).`}
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

      {h.unclassified > 0 && (
        <Link to="/por-clasificar" className="mt-4 flex min-h-12 items-center gap-2.5 rounded-md bg-attention-soft px-3 font-semibold text-attention">
          <Icon name="inbox" />
          <span className="flex-1">
            {h.unclassified === 1 ? "1 movimiento del banco por clasificar" : `${h.unclassified} movimientos del banco por clasificar`}
          </span>
          <Icon name="chevron_right" />
        </Link>
      )}

      {h.overdue_pending > 0 && (
        <Link to="/movimientos?pendientes=1" className="mt-4 flex min-h-12 items-center gap-2.5 rounded-md bg-attention-soft px-3 font-semibold text-attention">
          <Icon name="schedule" />
          <span className="flex-1">
            {h.overdue_pending === 1 ? "1 movimiento por confirmar ya llegó a su día" : `${h.overdue_pending} movimientos por confirmar ya llegaron a su día`}
          </span>
          <Icon name="chevron_right" />
        </Link>
      )}

      <section aria-label="Para mayo" className="mt-5 flex flex-col gap-2.5 rounded-lg border border-border bg-card p-4">
        <div className="flex items-baseline justify-between">
          <span className="text-label text-muted-foreground">Para mayo · {monthOnly(month)}</span>
          <span className="text-caption text-muted-foreground tabular-nums">{h.saved_percent === null ? "" : `${percent} % de lo que entró`}</span>
        </div>
        <div role="img" aria-label={negative || percent === 0 ? "Este mes no hubo ahorro" : `Guardaste el ${percent} % de lo que entró`}
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
        <section aria-label="En qué se va la plata" className="mt-6 flex flex-col">
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
        <section aria-label="Mis cuentas" className="mt-6 flex flex-col gap-2">
          <Heading label="Mis cuentas" to="/cuentas" link="Ver todas" />
          <div className="-mr-6 flex gap-2 overflow-x-auto pr-6 pb-1">
            {cards.map((a) => (
              <Link key={a.id} to={`/cuentas/${a.id}`} className="flex w-[150px] flex-none flex-col gap-2 rounded-lg border border-border bg-card p-3">
                <span className="grid size-8 place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name={a.icon ?? "payments"} className="text-[18px]" /></span>
                <span className="truncate text-caption text-muted-foreground">{a.name}</span>
                <span className="flex flex-col">
                  <span className="font-semibold tabular-nums">{formatAmount(a.balances[0]?.amount ?? "0.00", symbolOf(a.currency ?? h.currency), lang)}</span>
                  {a.currency && a.currency !== h.currency && a.balances[0] && (
                    <span className="text-caption text-muted-foreground tabular-nums">{money(a.balances[0].base)} hoy</span>
                  )}
                </span>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section aria-label="Últimos movimientos" className="mt-6 flex flex-col">
        <Heading label="Últimos movimientos" to="/movimientos" link="Ver todos" />
        {h.recent.length === 0 && <span className="py-3 text-caption text-muted-foreground">Todavía no registras nada. Toca + para empezar.</span>}
        {h.recent.map((x) => (
          <Link key={x.id} to={`/movimientos/${x.id}`} className="flex min-h-[60px] items-center gap-3 border-b border-border">
            <MoveIcon move={x} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">{x.ref}</span>
              <span className="truncate text-caption text-muted-foreground">
                {x.date === todayISO() ? "Hoy" : shortDate(x.date)} · {moveCaption(x, lang)}
              </span>
            </span>
            <MoveAmount move={x} base={h.currency} lang={lang} />
          </Link>
        ))}
      </section>

      <Sheet title="Elige el mes" open={picking} onClose={() => setPicking(false)}>
        <OptionList value={month} options={monthOptions().map((v) => ({ value: v, label: monthName(v) }))}
          onPick={(v) => {
            setParams(v === todayISO().slice(0, 7) ? {} : { mes: v }, { replace: true });
            setPicking(false);
          }} />
      </Sheet>
    </main>
  );
}

/** Cuántos días pasaron desde esa fecha hasta hoy. */
function daysSince(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const [ty, tm, td] = todayISO().split("-").map(Number);
  return Math.round((Date.UTC(ty!, tm! - 1, td!) - Date.UTC(y!, m! - 1, d!)) / 86_400_000);
}
