// M2 · Detalle de un movimiento: los datos, lo dividido, editar, confirmar o pasar a por confirmar, y borrar.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { useDeleteMove, useMe, useMove, useSetMoveState } from "@/api/hooks";
import { CategoryChip } from "@/components/CategorySheet";
import { Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon, Spinner } from "@/components/ui";
import { formatAmount, symbolOf } from "@/lib/money";

const KIND = { expense: "Gasto", income: "Ingreso", transfer: "Transferencia", other: "Movimiento" } as const;
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];
const DAYS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

function fullDate(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${DAYS[new Date(y!, m! - 1, d!).getDay()]} ${d} de ${MONTHS[m! - 1]} de ${y}`;
}

export function DetalleMovimiento() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const me = useMe().data;
  const move = useMove(id);
  const state = useSetMoveState(id);
  const remove = useDeleteMove(id);
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (move.isPending || !me) return <Spinner />;
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
  const sign = s.kind === "income" ? "+ " : s.kind === "expense" ? "− " : "";
  const tone = s.kind === "income" ? "text-income" : s.kind === "expense" ? "text-expense" : "";
  const [from, to] = transfer ? s.account.split(" → ") : [s.account, null];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28">
      <div className="-mx-2.5 flex items-center justify-between">
        <button type="button" aria-label="Volver" onClick={() => navigate(-1)} className="grid size-11 place-items-center rounded-full">
          <Icon name="arrow_back" className="text-[24px]" />
        </button>
        <span className="pr-2.5 text-label text-muted-foreground">{KIND[s.kind]}</span>
      </div>

      {!s.posted && (
        <div role="status" className="mt-2 flex items-start gap-2 rounded-md bg-attention-soft p-3 text-caption text-attention">
          <Icon name="schedule" /><span><b>Por confirmar.</b> No cuenta en tus saldos hasta que lo confirmes.</span>
        </div>
      )}
      <h1 className="mt-4 text-title-hero">{s.ref}</h1>
      <span className={`mt-3 flex items-center gap-1 text-amount-hero ${tone}`}>
        {!transfer && <Icon name={s.kind === "income" ? "south_west" : "north_east"} className="text-[30px]" />}
        {sign}{formatAmount(s.amount, symbolOf(s.currency), lang)}
      </span>
      {s.currency !== me.currency && !transfer && (
        <span className="text-caption text-muted-foreground tabular-nums">
          Son {formatAmount(s.base, symbolOf(me.currency), lang)}{d.rate ? ` al ${Number(d.rate).toFixed(3)}` : ""}
        </span>
      )}

      <div className="mt-5 flex flex-col">
        <Field icon={transfer || s.kind === "expense" ? "north_east" : "south_west"} label={s.kind === "income" ? "Entró a" : "Salió de"} value={from!} />
        {transfer && (
          <Field icon="south_west" label="Entró a"
            value={`${to}${s.to_amount && s.to_currency !== s.currency ? ` · ${formatAmount(s.to_amount, symbolOf(s.to_currency), lang)}` : ""}`} />
        )}
        {d.splits.length > 0 && (
          <div className="flex flex-col border-b border-border py-2">
            <span className="text-caption text-muted-foreground">{s.kind === "income" ? "De qué" : "En qué"}</span>
            {d.splits.map((x) => (
              <div key={x.category.id} className="flex min-h-12 items-center gap-3">
                <CategoryChip category={x.category} size={32} />
                <span className="flex-1 font-semibold">{x.category.name}</span>
                {d.splits.length > 1 && <span className="tabular-nums">{formatAmount(x.amount, symbolOf(s.currency), lang)}</span>}
              </div>
            ))}
          </div>
        )}
        <div className="flex min-h-[52px] items-center gap-3 border-b border-border">
          <Icon name="event" className="w-9 text-center text-muted-foreground" />
          <span>{fullDate(s.date)}</span>
        </div>
      </div>

      <div className="min-h-6 flex-1" />
      <div className="flex flex-col gap-2">
        {(state.error || remove.error) && <ErrorAlert>{(state.error ?? remove.error)?.message}</ErrorAlert>}
        {s.kind !== "other" && (
          <Link to={`/movimientos/${s.id}/editar`}
            className="flex h-14 items-center justify-between rounded-xl bg-primary px-5 font-semibold text-primary-foreground">
            <span>Editar</span><Icon name="edit" className="text-[22px]" />
          </Link>
        )}
        <button type="button" disabled={state.isPending} onClick={() => state.mutate(s.posted)}
          className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-input-line font-semibold">
          <Icon name={s.posted ? "schedule" : "check"} />
          {s.posted ? "Pasar a por confirmar" : "Confirmar"}
        </button>
        <button type="button" onClick={() => setConfirmDelete(true)}
          className="flex h-11 items-center justify-center gap-1.5 text-[14px] font-semibold text-destructive">
          <Icon name="delete" />Borrar movimiento
        </button>
      </div>

      <Sheet title="¿Borrar este movimiento?" open={confirmDelete} onClose={() => setConfirmDelete(false)}>
        <div className="flex flex-col gap-4 px-3">
          <p className="text-muted-foreground">
            «{s.ref}» desaparece de tus movimientos y sus montos vuelven a las cuentas. No se puede deshacer.
          </p>
          <button type="button" disabled={remove.isPending}
            onClick={() => remove.mutate(undefined, { onSuccess: () => navigate("/movimientos", { replace: true }) })}
            className="flex h-14 items-center justify-center gap-2 rounded-xl bg-destructive font-semibold text-destructive-foreground">
            <Icon name="delete" />Borrar movimiento
          </button>
          <button type="button" onClick={() => setConfirmDelete(false)} className="h-11 text-caption font-semibold text-primary-strong underline">
            Cancelar
          </button>
        </div>
      </Sheet>
    </main>
  );
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
