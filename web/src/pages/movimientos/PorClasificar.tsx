// M3 · Por clasificar: la bandeja de lo que trajiste del banco y falta decir en qué fue. Hasta
// entonces no cuenta como gasto ni ingreso. Uno por uno («¿En qué fue?») o varios a la vez.
import { useState } from "react";
import { Link, useSearchParams } from "react-router";

import { type Unclassified, useMe, useUnclassified } from "@/api/hooks";
import { ClassifySheet, type ToClassify } from "@/components/ClassifySheet";
import { ErrorAlert, Icon, Spinner } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { formatAmount, formatNumber, isNegative, symbolOf } from "@/lib/money";

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function dayDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${DAYS[new Date(y!, m! - 1, d!).getDay()]} ${shortDate(iso)}`;
}

export function toClassify(u: Unclassified): ToClassify {
  return {
    move_id: u.move_id,
    title: u.payment_ref ?? u.ref,
    caption: `${dayDate(u.date)} · ${u.account}`,
    account_id: u.account_id,
    currency: u.currency,
    amount: u.amount,
  };
}

export function PorClasificar() {
  const me = useMe().data;
  const [params] = useSearchParams();
  const accountId = params.get("cuenta") ? Number(params.get("cuenta")) : undefined;
  const list = useUnclassified(accountId);
  const [selecting, setSelecting] = useState(false);
  const [picked, setPicked] = useState<number[]>([]);
  const [sheet, setSheet] = useState<ToClassify[] | null>(null);
  if (!me || list.isPending) return <Spinner />;
  const lang = me.lang ?? "es-PE";
  const items = list.data ?? [];
  const chosen = items.filter((x) => picked.includes(x.move_id));
  const oneCurrency = new Set(chosen.map((x) => x.currency)).size === 1;
  const total = chosen.reduce((sum, x) => sum + Number(x.amount), 0);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const done = () => { setPicked([]); setSelecting(false); };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/movimientos" aria-label="Volver a movimientos" className="grid size-11 place-items-center rounded-full">
          <Icon name="arrow_back" className="text-[24px]" />
        </Link>
        {items.length > 1 && (
          <button type="button" aria-pressed={selecting} onClick={() => (selecting ? done() : setSelecting(true))}
            className="h-10 rounded-full px-3.5 text-[14px] font-semibold">
            {selecting ? "Listo" : "Elegir varios"}
          </button>
        )}
      </div>
      <span className="mt-2 text-label text-muted-foreground">Movimientos</span>
      <h1 className="mt-1.5 text-title-hero">Por clasificar</h1>
      {list.isError && <div className="mt-4"><ErrorAlert>{list.error.message}</ErrorAlert></div>}

      {items.length === 0 ? (
        <div className="mt-16 flex flex-col items-center gap-2.5 text-center">
          <span className="grid size-16 place-items-center rounded-full bg-secondary text-secondary-foreground">
            <Icon name="inbox" className="text-[32px]" />
          </span>
          <span className="text-title-2">Bandeja vacía</span>
          <span className="max-w-[280px] text-caption text-muted-foreground">
            Todo lo que trajiste del banco ya tiene su lugar. Cuando importes otro extracto, lo nuevo llega aquí.
          </span>
        </div>
      ) : (
        <>
          <p className="mt-2.5 text-caption text-muted-foreground">
            {items.length === 1 ? "1 movimiento que trajiste" : `${items.length} movimientos que trajiste`} del banco. Hasta que digas en qué
            fueron, no cuentan como gasto ni ingreso.
          </p>
          <ul className="mt-3 flex flex-col">
            {items.map((u) => {
              const out = isNegative(u.amount);
              const on = picked.includes(u.move_id);
              return (
                <li key={u.move_id} className="flex min-h-[76px] items-center gap-3 border-b border-border">
                  {selecting && (
                    <button type="button" role="checkbox" aria-checked={on} aria-label={`Elegir ${u.payment_ref ?? u.ref}`}
                      onClick={() => toggle(u.move_id)} className="-ml-2.5 grid size-11 flex-none place-items-center">
                      <Icon name={on ? "check_box" : "check_box_outline_blank"} fill={on} className="text-[24px]" />
                    </button>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-baseline gap-2">
                      <Link to={`/movimientos/${u.move_id}`} className="min-w-0 flex-1 truncate font-semibold">{u.payment_ref ?? u.ref}</Link>
                      <span className={`font-medium tabular-nums ${out ? "text-expense" : "text-income"}`}>
                        {out ? "− " : "+ "}{u.currency === me.currency ? formatNumber(u.amount.replace("-", ""), lang) : formatAmount(u.amount.replace("-", ""), symbolOf(u.currency), lang)}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-caption text-muted-foreground">
                        {dayDate(u.date)} · {u.account}{u.operation_number ? ` · op. ${u.operation_number}` : ""}
                      </span>
                      {!selecting && (
                        <button type="button" onClick={() => setSheet([toClassify(u)])}
                          className="flex h-8 flex-none items-center gap-0.5 rounded-full border border-border bg-card pr-1.5 pl-3 text-caption font-semibold">
                          ¿En qué fue?<Icon name="expand_more" className="text-[18px]" />
                        </button>
                      )}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {selecting && (
        <div className="fixed inset-x-0 bottom-0 z-[45] border-t border-border bg-card">
          <div className="mx-auto flex max-w-md items-center gap-3 px-4 pt-3 pb-5">
            <span className="flex flex-1 flex-col">
              <b>{chosen.length === 1 ? "1 elegido" : `${chosen.length} elegidos`}</b>
              <span className="text-caption text-muted-foreground tabular-nums">
                {!chosen.length ? "Toca los que van al mismo lugar"
                  : oneCurrency ? `${total < 0 ? "Salieron" : "Entraron"} ${formatAmount(Math.abs(total), symbolOf(chosen[0]!.currency), lang)}`
                    : "En varias monedas"}
              </span>
            </span>
            <button type="button" disabled={chosen.length === 0} onClick={() => setSheet(chosen.map(toClassify))}
              className="flex h-12 items-center gap-1.5 rounded-xl bg-primary px-4 font-semibold text-primary-foreground disabled:opacity-50">
              ¿En qué fueron?<Icon name="arrow_forward" className="text-[20px]" />
            </button>
          </div>
        </div>
      )}

      {sheet && (
        <ClassifySheet key={sheet.map((x) => x.move_id).join(",")} open onClose={() => setSheet(null)} items={sheet}
          onDone={selecting ? done : undefined} />
      )}
    </main>
  );
}
