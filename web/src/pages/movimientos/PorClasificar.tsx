// M3 · Por clasificar: la bandeja de lo que trajiste del banco y falta decir en qué fue. Hasta
// entonces no cuenta como gasto ni ingreso. Uno por uno («¿En qué fue?») o varios a la vez.
import { SectionHeading } from "@/components/SectionHeading";
import { PageHeader } from "@/components/PageHeader";
import { Button } from "@/components/Button";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { type Unclassified, useMe, useUnclassified } from "@/api/hooks";
import { ClassifyForm, ClassifySheet, type ToClassify } from "@/components/ClassifySheet";
import { Kbd } from "@/components/ShortcutsHelp";
import { ErrorAlert, Icon, Spinner } from "@/components/ui";
import { shortDate, todayISO } from "@/lib/dates";
import { formatAmount, formatNumber, isNegative, symbolOf } from "@/lib/money";
import { monthOnly } from "@/lib/months";
import { useDesktop } from "@/lib/desktop";
import { cn } from "@/lib/utils";

const DAYS = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

function dayDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${DAYS[new Date(y!, m! - 1, d!).getDay()]} ${shortDate(iso)}`;
}

/** El encabezado de cada día (caso 9, opción C): como en Movimientos, pero con el mes, porque la bandeja
 *  junta varios meses. «VIERNES 12 DE NOVIEMBRE». */
const LONG_DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
function dayHeader(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${iso === todayISO() ? "Hoy, " : ""}${LONG_DAYS[new Date(y!, m! - 1, d!).getDay()]} ${d} de ${monthOnly(iso.slice(0, 7)).toLowerCase()}`;
}

export function toClassify(u: Unclassified): ToClassify {
  return {
    move_id: u.move_id,
    title: u.payment_ref ?? u.ref,
    date: dayDate(u.date),
    account: u.account,
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
  // En la computadora (decisión del 26-nov, opción A): lista y panel. El elegido se clasifica al lado
  // y, al terminar, queda elegido el que ocupaba su lugar: el siguiente.
  const desktop = useDesktop();
  const [currentId, setCurrentId] = useState<number | null>(null);
  const lastIndex = useRef(0);
  // ↑ y ↓ cambian de movimiento desde cualquier lugar de la pantalla, menos al escribir o al elegir varios
  const arrows = useRef<((e: KeyboardEvent) => void) | null>(null);
  useEffect(() => {
    const on = (e: KeyboardEvent) => arrows.current?.(e);
    document.addEventListener("keydown", on);
    return () => document.removeEventListener("keydown", on);
  }, []);
  if (!me || list.isPending) return <Spinner />;
  const lang = me.lang ?? "es-PE";
  const items = list.data ?? [];
  const chosen = items.filter((x) => picked.includes(x.move_id));
  const oneCurrency = new Set(chosen.map((x) => x.currency)).size === 1;
  const total = chosen.reduce((sum, x) => sum + Number(x.amount), 0);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const done = () => { setPicked([]); setSelecting(false); };
  const money = (u: Unclassified) => {
    const out = isNegative(u.amount);
    const v = u.currency === me.currency ? formatNumber(u.amount.replace("-", ""), lang) : formatAmount(u.amount.replace("-", ""), symbolOf(u.currency), lang);
    return <span className={`font-medium tabular-nums ${out ? "text-expense" : "text-income"}`}>{out ? "− " : "+ "}{v}</span>;
  };
  const header = (
    <PageHeader back={{ to: "/movimientos", label: "Volver a movimientos" }} eyebrow="Movimientos" title="Por clasificar"
      actions={items.length > 1 && (
        <button type="button" aria-pressed={selecting} onClick={() => (selecting ? done() : setSelecting(true))}
          className="min-h-control rounded-full px-3.5 text-body-sm font-semibold hover:bg-muted">
          {selecting ? "Listo" : "Elegir varios"}
        </button>
      )} />
  );
  const intro = (
    <p className="mt-3 text-caption text-muted-foreground">
      {items.length === 1 ? "1 movimiento que trajiste" : `${items.length} movimientos que trajiste`} del banco. Hasta que digas en qué
      fueron, no cuentan como gasto ni ingreso.
    </p>
  );
  const empty = (
    <div className="mt-16 flex flex-col items-center gap-3 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-secondary text-secondary-foreground">
        <Icon name="inbox" size="lg" />
      </span>
      <span className="text-title-2">Bandeja vacía</span>
      <span className="max-w-70 text-caption text-muted-foreground">
        Todo lo que trajiste del banco ya tiene su lugar. Cuando importes otro extracto, lo nuevo llega aquí.
      </span>
    </div>
  );

  if (desktop && items.length > 0) {
    const at = items.findIndex((x) => x.move_id === currentId);
    const index = at >= 0 ? at : Math.min(lastIndex.current, items.length - 1);
    const current = items[index];
    const pick = (i: number) => {
      const x = items[i];
      if (!x) return;
      lastIndex.current = i;
      setCurrentId(x.move_id);
      document.getElementById(`pc-${x.move_id}`)?.focus();
    };
    arrows.current = (e) => {
      if ((e.key !== "ArrowDown" && e.key !== "ArrowUp") || (e.target as HTMLElement).tagName === "INPUT" || selecting
        || document.querySelector("[role=dialog]")) return;
      e.preventDefault();
      pick(Math.max(0, Math.min(items.length - 1, index + (e.key === "ArrowDown" ? 1 : -1))));
    };
    const forms = selecting ? chosen.map(toClassify) : current ? [toClassify(current)] : [];
    return (
      <div className="flex h-dvh">
        <div className="flex w-80 flex-none flex-col overflow-y-auto border-r border-border px-6 pt-4 pb-10 xl:w-100 2xl:w-110">
          {header}
          {list.isError && <div className="mt-4"><ErrorAlert>{list.error.message}</ErrorAlert></div>}
          {items.length === 0 ? empty : (
            <>
              {intro}
              <ul className="mt-3 flex flex-col">
                {items.map((u, k) => {
                  const on = picked.includes(u.move_id);
                  const isCurrent = !selecting && k === index;
                  const newDay = k === 0 || items[k - 1]!.date !== u.date;
                  return (
                    <li key={u.move_id} className="flex flex-col">
                      {newDay && <SectionHeading className="mt-4">{dayHeader(u.date)}</SectionHeading>}
                      <button id={`pc-${u.move_id}`} type="button"
                        {...(selecting ? { role: "checkbox", "aria-checked": on } : { "aria-current": isCurrent ? ("true" as const) : undefined })}
                        onClick={() => (selecting ? toggle(u.move_id) : pick(k))}
                        className={cn("-mx-3 flex min-h-row items-center gap-3 border-b border-border px-3 py-2 text-left hover:bg-muted",
                          isCurrent && "bg-muted mark-selected")}>
                        {selecting && <Icon name={on ? "check_box" : "check_box_outline_blank"} fill={on} size="md" />}
                        <span className="flex min-w-0 flex-1 flex-col">
                          <span className="truncate text-body-sm font-semibold">{u.payment_ref ?? u.ref}</span>
                          <span className="truncate text-caption text-muted-foreground">{u.account}</span>
                        </span>
                        {money(u)}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </div>
        {/* scroll-pb: que el botón fijo de abajo no tape lo que tiene el foco */}
        <div className="min-w-0 flex-1 overflow-y-auto scroll-pb-32">
          <div className="mx-auto flex max-w-180 flex-col px-10 pt-8 pb-10">
            {forms.length === 0 ? (
              items.length > 0 && (
                <p className="mt-16 text-center text-muted-foreground">Marca en la lista los que van al mismo lugar.</p>
              )
            ) : (
              <>
                <span className="mx-3 flex items-center justify-between gap-3">
                  <span className="text-label text-muted-foreground">
                    {selecting ? (chosen.length === 1 ? "1 elegido" : `${chosen.length} elegidos`) : `${index + 1} de ${items.length}`}
                  </span>
                  {!selecting && current && (
                    <Link to={`/movimientos/${current.move_id}`} className="hit-area text-label text-primary-strong underline">Ver el movimiento</Link>
                  )}
                </span>
                <div className="mt-2 flex flex-col">
                  <ClassifyForm key={forms.map((x) => x.move_id).join(",")} items={forms} inline
                    onDone={selecting ? done : undefined} onClose={() => setCurrentId(null)}
                    footer={!selecting && (
                      <span className="flex flex-wrap items-center gap-x-5 gap-y-2 px-2 text-caption text-muted-foreground">
                        <span className="flex items-center gap-1.5"><Kbd>↑</Kbd><Kbd>↓</Kbd>Otro movimiento</span>
                        <span className="flex items-center gap-1.5"><Kbd>Enter</Kbd>En la opción elegida, clasifica y pasa al siguiente</span>
                      </span>
                    )} />
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    );
  }

  arrows.current = null;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28 md:max-w-160">
      {header}
      {list.isError && <div className="mt-4"><ErrorAlert>{list.error.message}</ErrorAlert></div>}

      {items.length === 0 ? empty : (
        <>
          {intro}
          <ul className="mt-3 flex flex-col">
            {items.map((u, k) => {
              const out = isNegative(u.amount);
              const on = picked.includes(u.move_id);
              const newDay = k === 0 || items[k - 1]!.date !== u.date;
              return (
                <li key={u.move_id} className="flex flex-col">
                {newDay && <SectionHeading className="mt-4">{dayHeader(u.date)}</SectionHeading>}
                <div className="flex min-h-19 items-center gap-3 border-b border-border">
                  {selecting && (
                    <button type="button" role="checkbox" aria-checked={on} aria-label={`Elegir ${u.payment_ref ?? u.ref}`}
                      onClick={() => toggle(u.move_id)} className="-ml-2.5 grid size-control flex-none place-items-center">
                      <Icon name={on ? "check_box" : "check_box_outline_blank"} fill={on} size="md" />
                    </button>
                  )}
                  <span className="flex min-w-0 flex-1 flex-col gap-1">
                    <span className="flex items-baseline gap-2">
                      <Link to={`/movimientos/${u.move_id}`} className="hit-area min-w-0 flex-1 font-semibold"><span className="block truncate">{u.payment_ref ?? u.ref}</span></Link>
                      <span className={`font-medium tabular-nums ${out ? "text-expense" : "text-income"}`}>
                        {out ? "− " : "+ "}{u.currency === me.currency ? formatNumber(u.amount.replace("-", ""), lang) : formatAmount(u.amount.replace("-", ""), symbolOf(u.currency), lang)}
                      </span>
                    </span>
                    <span className="flex items-center justify-between gap-2">
                      <span className="truncate text-caption text-muted-foreground">
                        {u.account}{u.operation_number ? `, op. ${u.operation_number}` : ""}
                      </span>
                      {!selecting && (
                        <button type="button" onClick={() => setSheet([toClassify(u)])}
                          className="hit-area flex h-8 flex-none items-center gap-0.5 rounded-full border border-border bg-card pr-1.5 pl-3 text-caption font-semibold hover:bg-muted">
                          ¿En qué fue?<Icon name="expand_more" />
                        </button>
                      )}
                    </span>
                  </span>
                </div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {selecting && (
        <div className="fixed inset-x-0 bottom-0 z-panel md:left-rail border-t border-border bg-card">
          <div className="mx-auto flex max-w-md items-center gap-3 px-4 pt-3 pb-5">
            <span className="flex flex-1 flex-col">
              <b>{chosen.length === 1 ? "1 elegido" : `${chosen.length} elegidos`}</b>
              <span className="text-caption text-muted-foreground tabular-nums">
                {!chosen.length ? "Toca los que van al mismo lugar"
                  : oneCurrency ? `${total < 0 ? "Salieron" : "Entraron"} ${formatAmount(Math.abs(total), symbolOf(chosen[0]!.currency), lang)}`
                    : "En varias monedas"}
              </span>
            </span>
            <Button size="sm" disabled={chosen.length === 0} onClick={() => setSheet(chosen.map(toClassify))} className="w-auto flex-none gap-1.5 px-4">
              ¿En qué fueron?
            </Button>
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
