// X4 · Cierre de periodo: cerrar hasta una fecha (por defecto, el fin del mes pasado) congela todo lo
// anterior. Solo se cierra si no queda nada por confirmar ni por clasificar hasta esa fecha; cada
// pendiente lleva a donde se resuelve. Reabrir mueve la fecha atrás o la quita.
import { useState } from "react";
import { Link } from "react-router";

import { useClosing, useSetLock } from "@/api/hooks";
import { addDays, DateSheet } from "@/components/DateSheet";
import { ErrorAlert, Icon, PrimaryButton, Spinner } from "@/components/ui";
import { shortDate } from "@/lib/dates";

export function Cierre() {
  const [date, setDate] = useState<string | null>(null);
  const [picking, setPicking] = useState<"close" | "move" | null>(null);
  const closing = useClosing(date ?? undefined);
  const setLock = useSetLock();
  if (closing.isPending) return <Spinner />;
  if (closing.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{closing.error.message}</ErrorAlert></main>;
  const c = closing.data;
  const when = c.date;
  const yesterday = addDays(-1);
  const custom = date !== null && date !== c.suggested;
  // Ya cerrado hasta el fin del mes pasado: solo queda reabrir (o mover el cierre)
  const showClose = !c.lock_date || custom || c.suggested > c.lock_date;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/mas" aria-label="Volver a Más" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
      </div>
      <h1 className="mt-2 text-title-hero">Cierre de periodo</h1>
      <p className="mt-2 text-muted-foreground">
        Cerrar protege los meses que ya revisaste: nada con fecha hasta ese día se crea, cambia ni borra. Puedes reabrir cuando quieras.
      </p>

      <div className="mt-4 flex min-h-14 items-center gap-3 rounded-lg bg-muted px-3.5">
        <Icon name={c.lock_date ? "lock" : "lock_open"} className="text-[22px]" />
        <span className="flex flex-1 flex-col">
          <span className="text-caption text-muted-foreground">Ahora</span>
          <span className="font-semibold">{c.lock_date ? `Cerrado hasta el ${shortDate(c.lock_date)} ${c.lock_date.slice(0, 4)}` : "Nada cerrado"}</span>
        </span>
      </div>

      {showClose && <>
      <span className="mt-5 border-b border-border pb-1 text-label text-muted-foreground">Cerrar hasta</span>
      <div role="radiogroup" aria-label="Cerrar hasta" className="mt-2.5 flex flex-wrap gap-2">
        <button type="button" role="radio" aria-checked={!custom} onClick={() => setDate(null)}
          className={`flex h-9 items-center rounded-full border px-3 text-caption font-semibold ${!custom ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
          Fin del mes pasado, {shortDate(c.suggested)}
        </button>
        <button type="button" role="radio" aria-checked={custom} onClick={() => setPicking("close")}
          className={`flex h-9 items-center rounded-full border px-3 text-caption font-semibold ${custom ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
          {custom ? shortDate(when) : "Otra fecha"}
        </button>
      </div>

      <section aria-label="Antes de cerrar" className="mt-5 flex flex-col">
        <span className="border-b border-border pb-1 text-label text-muted-foreground">Antes de cerrar</span>
        <Check ok={c.drafts === 0} text={c.drafts === 0 ? `Nada por confirmar hasta el ${shortDate(when)}`
          : `${c.drafts === 1 ? "1 movimiento" : `${c.drafts} movimientos`} por confirmar hasta el ${shortDate(when)}`}
          link={{ to: "/pendientes", label: "Revisar" }} />
        <Check ok={c.unclassified === 0} text={c.unclassified === 0 ? `Nada por clasificar hasta el ${shortDate(when)}`
          : `${c.unclassified} por clasificar hasta el ${shortDate(when)}`}
          link={{ to: "/por-clasificar", label: "Clasificar" }} />
        {c.lock_date && when <= c.lock_date && (
          <p className="mt-2 text-caption text-muted-foreground">Ya está cerrado hasta el {shortDate(c.lock_date)}: elige una fecha posterior.</p>
        )}
      </section>
      </>}

      {c.lock_date && (
        <section aria-label="Reabrir" className="mt-6 flex flex-col gap-2">
          <span className="border-b border-border pb-1 text-label text-muted-foreground">Reabrir</span>
          <p className="text-[14px] leading-5 text-muted-foreground">Si necesitas corregir algo de esos meses, reabre, corrígelo y vuelve a cerrar.</p>
          <button type="button" onClick={() => setPicking("move")} disabled={setLock.isPending}
            className="h-12 rounded-lg border border-input-line font-semibold">Mover el cierre a otra fecha</button>
          <button type="button" onClick={() => setLock.mutate(null)} disabled={setLock.isPending}
            className="h-12 rounded-lg border border-input-line font-semibold">Reabrir todo</button>
        </section>
      )}

      <div className="min-h-6 flex-1" />
      {setLock.error && <ErrorAlert>{setLock.error.message}</ErrorAlert>}
      {showClose && <>
        <div className="mt-3" />
        <PrimaryButton type="button" disabled={!c.can_close} pending={setLock.isPending}
          onClick={() => setLock.mutate(when, { onSuccess: () => setDate(null) })}>
          Cerrar hasta el {shortDate(when)}
        </PrimaryButton>
      </>}

      <DateSheet open={picking !== null} onClose={() => setPicking(null)} max={yesterday} shortcuts={[]}
        title={picking === "move" ? "¿Hasta cuándo queda cerrado?" : "¿Hasta qué día cierras?"}
        value={picking === "move" ? c.lock_date : when}
        onChange={(v) => {
          if (picking === "move") setLock.mutate(v);
          else setDate(v);
          setPicking(null);
        }} />
    </main>
  );
}

function Check({ ok, text, link }: { ok: boolean; text: string; link: { to: string; label: string } }) {
  return (
    <div className="flex min-h-[52px] items-center gap-3 border-b border-border">
      <Icon name={ok ? "check_circle" : "error"} className={`text-[22px] ${ok ? "text-income" : "text-attention"}`} />
      <span className="flex-1">{text}</span>
      {!ok && <Link to={link.to} className="flex min-h-11 items-center text-[14px] font-semibold underline">{link.label}</Link>}
    </div>
  );
}
