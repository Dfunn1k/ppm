// Qué cuentas entran al presupuesto (sección 6 del boceto, D6 y D10): el interruptor de cada cuenta,
// la hoja que pregunta desde cuándo y de qué sobre de ahorro sale lo que le pasas, y la lista de todas.
import { useState } from "react";
import { Link } from "react-router";

import { type BudgetScope, useBudget, useBudgetScopes, useSetScope } from "@/api/hooks";
import { Sheet, SheetSelect } from "@/components/Sheet";
import { ListSkeleton } from "@/components/Skeleton";
import { ErrorAlert, Icon } from "@/components/ui";
import { longDate, shortDate, todayISO } from "@/lib/dates";

/** El interruptor, igual que en Más › Inicio. */
export function Switch({ on, label, onClick }: { on: boolean; label: string; onClick: () => void }) {
  return (
    <button type="button" role="switch" aria-checked={on} aria-label={label} onClick={onClick}
      className={`hit-area h-6.5 w-11 flex-none rounded-full transition-colors ${on ? "bg-primary" : "bg-input-line/50"}`}>
      <span className={`absolute top-0.75 size-5 rounded-full bg-card shadow-sm transition-[left] ${on ? "left-5.25" : "left-0.75"}`} />
    </button>
  );
}

/** Lo que dice la fila de una cuenta: desde cuándo y, si está fuera, de qué sobre sale. */
export function scopeText(s: BudgetScope, savingName: (id: number | null) => string) {
  const since = s.since ? (s.on_budget ? `Dentro desde el ${shortDate(s.since)}.` : `Fuera desde el ${shortDate(s.since)}.`) : "";
  if (s.on_budget) return since || "Su plata se reparte en tus sobres.";
  return `${since ? `${since} ` : ""}Lo que pasas aquí sale de ${savingName(s.post_id)}.`;
}

export function useSavingName() {
  const b = useBudget().data;
  const saving = (b?.posts ?? []).filter((p) => p.kind === "saving");
  return (id: number | null) =>
    (id === null ? saving.find((p) => p.role === "patrimony") : saving.find((p) => p.id === id))?.name ?? "Construir patrimonio";
}

/** Meter o sacar una cuenta del presupuesto. */
export function ScopeSheet({ scope, onClose }: { scope: BudgetScope | null; onClose: () => void }) {
  return (
    <Sheet title={scope ? (scope.on_budget ? "Sacar del presupuesto" : "Meter al presupuesto") : ""} open={scope !== null} onClose={onClose}>
      {scope && <ScopeForm key={scope.account_id} scope={scope} onDone={onClose} />}
    </Sheet>
  );
}

function ScopeForm({ scope: s, onDone }: { scope: BudgetScope; onDone: () => void }) {
  const b = useBudget().data;
  const set = useSetScope();
  const today = todayISO();
  const start = b?.start && b.start < today ? b.start : null;
  const [since, setSince] = useState<string>(today);
  const saving = (b?.posts ?? []).filter((p) => p.kind === "saving" && p.active);
  const [post, setPost] = useState(String(s.post_id ?? saving.find((p) => p.role === "patrimony")?.id ?? ""));
  const leaving = s.on_budget;
  const save = () => {
    const chosen = saving.find((p) => String(p.id) === post);
    set.mutate({ accountId: s.account_id, on_budget: !leaving, since,
      post_id: leaving && chosen && chosen.role !== "patrimony" ? chosen.id : null }, { onSuccess: onDone });
  };
  const options = [
    { value: today, label: "Desde hoy", hint: "Los meses pasados quedan como estaban" },
    ...(start ? [{ value: start, label: "Desde que empezó el presupuesto", hint: `${longDate(start)}. Recalcula esos meses` }] : []),
  ];
  return (
    <div className="mt-2 flex flex-col">
      <p className="text-caption text-muted-foreground">
        {leaving
          ? `El saldo de ${s.name} deja de ser plata para repartir. Lo que le pases después cuenta como ahorro.`
          : `El saldo de ${s.name} pasa a ser plata para repartir: entra a Por asignar.`}
      </p>
      <div className="mt-4 border-b border-border pb-1 text-label text-muted-foreground">Desde cuándo</div>
      <div role="radiogroup" aria-label="Desde cuándo" className="flex flex-col">
        {options.map((o) => (
          <button key={o.value} type="button" role="radio" aria-checked={since === o.value} onClick={() => setSince(o.value)}
            className="flex min-h-14 items-center gap-3 border-b border-border text-left">
            <span className={`size-5 flex-none rounded-full border-2 ${since === o.value ? "border-[6px] border-primary" : "border-input-line"}`} />
            <span className="flex flex-col"><span className="font-semibold">{o.label}</span><span className="text-caption text-muted-foreground">{o.hint}</span></span>
          </button>
        ))}
      </div>
      {leaving && saving.length > 0 && (
        <div className="mt-4">
          <SheetSelect label="Lo que pasas aquí sale de" sheetTitle="¿De qué sobre de ahorro?" value={post} onChange={setPost}
            options={saving.map((p) => ({ value: String(p.id), label: p.name }))} />
        </div>
      )}
      {set.isError && <div className="mt-3"><ErrorAlert>{set.error.message}</ErrorAlert></div>}
      <button type="button" onClick={save} disabled={set.isPending}
        className="mt-5 flex h-12 items-center justify-center gap-1.5 rounded-full bg-primary font-semibold text-primary-foreground disabled:opacity-60">
        {set.isPending && <Icon name="progress_activity" className="animate-spin text-[20px]" />}{leaving ? "Sacar del presupuesto" : "Meter al presupuesto"}
      </button>
    </div>
  );
}

/** La fila con el interruptor, en la ficha de una cuenta. No aparece si la cuenta no tiene interruptor. */
export function ScopeRow({ accountId }: { accountId: number }) {
  const scopes = useBudgetScopes();
  const started = useBudget().data?.started;
  const name = useSavingName();
  const [editing, setEditing] = useState<BudgetScope | null>(null);
  const s = scopes.data?.find((x) => x.account_id === accountId);
  if (!s || !started) return null;
  return (
    <>
      <div className="mt-4 flex items-center gap-3 rounded-md border border-border bg-card px-3.5 py-3">
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold">En el presupuesto</span>
          <span className="text-caption text-muted-foreground">{scopeText(s, name)}</span>
        </span>
        <Switch on={s.on_budget} label={`${s.name} en el presupuesto`} onClick={() => setEditing(s)} />
      </div>
      <ScopeSheet scope={editing} onClose={() => setEditing(null)} />
    </>
  );
}

/** Todas las cuentas, dentro y fuera, desde el menú del presupuesto. */
export function CuentasPresupuesto() {
  const scopes = useBudgetScopes();
  const name = useSavingName();
  const [editing, setEditing] = useState<BudgetScope | null>(null);
  if (scopes.isPending) return <ListSkeleton back="/presupuesto" title="Cuentas del presupuesto" />;
  if (scopes.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{scopes.error.message}</ErrorAlert></main>;
  const rows = (on: boolean) => scopes.data.filter((s) => s.on_budget === on).map((s) => (
    <div key={s.account_id} className="flex min-h-16 items-center gap-3 border-b border-border py-2">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{s.name}</span>
        <span className="text-caption text-muted-foreground">{scopeText(s, name)}</span>
      </span>
      <Switch on={s.on_budget} label={`${s.name} en el presupuesto`} onClick={() => setEditing(s)} />
    </div>
  ));
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-10 lg:max-w-[640px] lg:pt-10">
      <div className="-mx-2.5 flex items-center gap-1">
        <Link to="/presupuesto" aria-label="Volver al presupuesto" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
        <h1 className="text-title-2">Cuentas del presupuesto</h1>
      </div>
      <span className="mt-2 text-caption text-muted-foreground">Dentro: su plata se reparte en sobres. Fuera: no cuenta hasta que la traes.</span>
      <div className="mt-5 border-b border-border pb-1 text-label text-muted-foreground">Dentro</div>
      {rows(true)}
      <div className="mt-6 border-b border-border pb-1 text-label text-muted-foreground">Fuera</div>
      {rows(false)}
      <span className="mt-3 text-caption text-muted-foreground">
        Siempre dentro: Por pagar, Plata que guardo de otros y Cuotas por venir. Siempre fuera: Por cobrar y los pagos por adelantado.
      </span>
      <ScopeSheet scope={editing} onClose={() => setEditing(null)} />
    </main>
  );
}
