// Las hojas del presupuesto (sección 4 del boceto): asignar o mover (la misma hoja, cambia el «Desde»
// o el «A») y cubrir un sobre en rojo. Por asignar puede quedar en rojo; un sobre no da más de lo que tiene.
import { type FormEvent, useState } from "react";

import { type BudgetMonth, type BudgetPost, useAssign, useBudget } from "@/api/hooks";
import { Button } from "@/components/Button";
import { Sheet, SheetSelect } from "@/components/Sheet";
import { ErrorAlert, LineField } from "@/components/ui";
import { add, isNegative, isZero, parseAmount, subtract } from "@/lib/money";
import { monthOnly } from "@/lib/months";

import { abs, addMonth, useMoney } from "./common";

const POR_ASIGNAR = "";

/** Lo que tiene cada lado: Por asignar o lo disponible del sobre. */
function have(b: BudgetMonth, id: string) {
  if (id === POR_ASIGNAR) return b.to_assign;
  return b.posts.find((p) => String(p.id) === id)?.available ?? "0.00";
}

function nameOf(b: BudgetMonth, id: string) {
  return id === POR_ASIGNAR ? "Por asignar" : b.posts.find((p) => String(p.id) === id)?.name ?? "";
}

export type AssignTarget = { from: number | null; to: number | null; fixed: "from" | "to" };

/** Asignar (a un sobre), mover (de un sobre a otro) o usar un sobre de ahorro (devolverlo a Por asignar). */
export function AssignSheet({ budget: b, month, target, onClose }: {
  budget: BudgetMonth; month: string; target: AssignTarget | null; onClose: () => void;
}) {
  return (
    <Sheet title={target ? title(b, target) : ""} open={target !== null} onClose={onClose}>
      {target && <AssignForm key={`${target.from}-${target.to}-${target.fixed}`} budget={b} month={month} target={target} onDone={onClose} />}
    </Sheet>
  );
}

function title(b: BudgetMonth, t: AssignTarget) {
  if (t.fixed === "to") return t.to === null ? "Devolver a Por asignar" : `Asignar a ${nameOf(b, String(t.to))}`;
  if (t.from === null) return "Asignar";
  const p = b.posts.find((x) => x.id === t.from);
  return p?.kind === "saving" ? `Usar ${p.name}` : `Mover de ${p?.name ?? ""}`;
}

function AssignForm({ budget: b, month, target, onDone }: { budget: BudgetMonth; month: string; target: AssignTarget; onDone: () => void }) {
  const { lang, money } = useMoney();
  const assign = useAssign();
  const usable = b.posts.filter((p) => p.active);
  const firstOther = (not: number | null) => {
    const p = usable.find((x) => x.id !== not && x.kind === "expense");
    return p ? String(p.id) : POR_ASIGNAR;
  };
  const [from, setFrom] = useState(target.fixed === "from" ? String(target.from ?? POR_ASIGNAR) : POR_ASIGNAR);
  const [to, setTo] = useState(target.fixed === "to" ? String(target.to ?? POR_ASIGNAR)
    : target.from === null ? firstOther(null)
      : b.posts.find((p) => p.id === target.from)?.kind === "saving" ? POR_ASIGNAR : firstOther(target.from));
  const [text, setText] = useState("");
  const [error, setError] = useState<string>();
  const amount = parseAmount(text, lang);
  const toPost = b.posts.find((p) => String(p.id) === to);
  const previous = useBudget(addMonth(month, -1)).data;
  const lastMonth = previous?.posts.find((p) => String(p.id) === to)?.assigned;

  const options = (exclude: string, withRoom: boolean) => [
    { value: POR_ASIGNAR, label: "Por asignar", hint: money(b.to_assign) },
    ...usable.filter((p) => String(p.id) !== exclude && (!withRoom || Number(p.available) > 0))
      .map((p) => ({ value: String(p.id), label: p.name, hint: `Tiene ${money(p.available)}` })),
  ].filter((o) => o.value !== exclude);

  const source = have(b, from);
  const chips = [
    toPost && Number(toPost.average) > 0 && { label: `Promedio ${money(toPost.average)}`, value: toPost.average },
    toPost && lastMonth && !isZero(lastMonth) && { label: `Como ${monthOnly(addMonth(month, -1)).toLowerCase()} ${money(lastMonth)}`, value: lastMonth },
    Number(source) > 0 && { label: "Todo lo que queda", value: source },
  ].filter(Boolean) as { label: string; value: string }[];

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!amount || Number(amount) <= 0) return setError("Escribe un monto mayor que cero");
    if (from === to) return setError("Elige de dónde sale y a dónde va");
    setError(undefined);
    assign.mutate([{ month, amount, from_post_id: from === POR_ASIGNAR ? null : Number(from), to_post_id: to === POR_ASIGNAR ? null : Number(to), source: "manual" }],
      { onSuccess: onDone, onError: (e) => setError(e.message) });
  };
  const after = amount ? add(have(b, to), amount) : null;

  return (
    <form onSubmit={submit} noValidate className="mt-4 flex flex-col gap-4">
      {target.fixed === "to"
        ? <SheetSelect label="Desde" sheetTitle="¿De dónde sale?" value={from} onChange={setFrom} options={options(to, true)} />
        : <SheetSelect label="A" sheetTitle="¿A dónde va?" value={to} onChange={setTo} options={options(from, false)} />}
      <span className="-mt-2 text-caption text-muted-foreground tabular-nums">
        {target.fixed === "to" ? `${nameOf(b, from)} tiene ${money(source)}` : `Sale de ${nameOf(b, from)}, que tiene ${money(source)}`}
      </span>
      <LineField label="Monto" inputMode="decimal" autoComplete="off" value={text} onChange={(e) => setText(e.target.value)}
        className="text-amount-xl tabular-nums" />
      {chips.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {chips.map((c) => (
            <button key={c.label} type="button" onClick={() => setText(c.value)}
              className="hit-area h-8 rounded-full bg-secondary px-3 text-caption font-semibold text-secondary-foreground tabular-nums hover:bg-secondary/80">{c.label}</button>
          ))}
        </div>
      )}
      {after && (
        <span className="text-caption text-muted-foreground tabular-nums">
          {nameOf(b, to)} quedará con {money(after)}.
          {from === POR_ASIGNAR && isNegative(subtract(b.to_assign, amount ?? "0")) && " Por asignar quedará en rojo: estás asignando plata que no tienes."}
        </span>
      )}
      {error && <ErrorAlert>{error}</ErrorAlert>}
      <Button type="submit" pending={assign.isPending}>{target.fixed === "to" || target.from === null ? "Asignar" : "Mover"}</Button>
    </form>
  );
}

/** Cubrir un sobre en rojo (D3): de dónde sale para que vuelva a cero. Si no se hace nada, al empezar
 *  el mes lo absorbe Por asignar. */
export function CoverSheet({ budget: b, month, post, onClose }: {
  budget: BudgetMonth; month: string; post: BudgetPost | null; onClose: () => void;
}) {
  const { money } = useMoney();
  return (
    <Sheet title={post ? `${post.name} se pasó ${money(abs(post.available))}` : ""} open={post !== null} onClose={onClose}>
      {post && <CoverForm budget={b} month={month} post={post} onDone={onClose} />}
    </Sheet>
  );
}

function CoverForm({ budget: b, month, post, onDone }: { budget: BudgetMonth; month: string; post: BudgetPost; onDone: () => void }) {
  const { money } = useMoney();
  const assign = useAssign();
  const need = abs(post.available);
  const sources = [
    { id: POR_ASIGNAR, name: "Por asignar", have: b.to_assign },
    ...b.posts.filter((p) => p.id !== post.id && p.active && Number(p.available) >= Number(need))
      .map((p) => ({ id: String(p.id), name: p.name, have: p.available })),
  ];
  const [pick, setPick] = useState(POR_ASIGNAR);
  const [error, setError] = useState<string>();
  const cover = () => assign.mutate(
    [{ month, amount: need, from_post_id: pick === POR_ASIGNAR ? null : Number(pick), to_post_id: post.id, source: "cover" }],
    { onSuccess: onDone, onError: (e) => setError(e.message) });
  return (
    <div className="mt-2 flex flex-col">
      <p className="text-caption text-muted-foreground">
        Ya lo gastaste. Elige de dónde sale para que el sobre vuelva a cero; si no eliges, sale de Por asignar al empezar el mes que viene.
      </p>
      <div role="radiogroup" aria-label="¿De dónde sale?" className="mt-2 flex flex-col">
        {sources.map((s) => (
          <button key={s.id} type="button" role="radio" aria-checked={pick === s.id} onClick={() => setPick(s.id)}
            className="flex min-h-row-option items-center gap-3 border-b border-border py-2 text-left">
            <span className={`size-5 flex-none rounded-full border-2 ${pick === s.id ? "border-6 border-primary" : "border-input-line"}`} />
            <span className="flex flex-col">
              <span className="font-semibold">{s.name}</span>
              <span className="text-caption text-muted-foreground tabular-nums">Tiene {money(s.have)}</span>
            </span>
          </button>
        ))}
      </div>
      {error && <div className="mt-3"><ErrorAlert>{error}</ErrorAlert></div>}
      <Button onClick={cover} pending={assign.isPending} className="mt-4">Cubrir {money(need)}</Button>
    </div>
  );
}
