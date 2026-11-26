// R1 · «Compartido» (opción B, como Splitwise): quién pagó, entre quiénes y cómo se reparte. Por
// dentro es lo de siempre: si pagaste tú, tu parte va a la categoría y la de cada persona queda como
// algo que te debe; si pagó otro, de tus cuentas no sale nada, tu parte es tu gasto y se la debes.
// En un ingreso es el espejo: si cobraste tú, la parte de cada persona se la debes; si cobró otro, de
// tus cuentas no entra nada y te debe tu parte. También en una recurrente: cada vez que se registra.
import { useState } from "react";

import { usePartners } from "@/api/hooks";
import { fromCents } from "@/lib/money";
import { PersonaSheet } from "@/pages/personas/PersonaForm";

import { Avatar } from "./MoveBits";
import { PersonPicker } from "./PersonPicker";
import { Segmented, Sheet } from "./Sheet";
import { Icon } from "./ui";
import { FilterChip } from "./Chip";

export type SharedPerson = { id: number; amount: string };
export type SharedState = { on: boolean; payer: number | "me"; people: SharedPerson[]; mode: "equal" | "amounts"; mine: string };
export const NO_SHARED: SharedState = { on: false, payer: "me", people: [], mode: "equal", mine: "" };

const cents = (v: string | null | undefined) => Math.round(Number(v || "0") * 100);
const money2 = (c: number) => fromCents(c);

/** Las partes en céntimos: la tuya y la de cada persona. En partes iguales, el céntimo que sobra es tuyo. */
export function shares(s: SharedState, total: string | null, parse: (v: string) => string | null): { mine: number; theirs: number[] } {
  const t = cents(total);
  if (s.mode === "equal") {
    const each = Math.floor(t / (s.people.length + 1));
    return { mine: t - each * s.people.length, theirs: s.people.map(() => each) };
  }
  const theirs = s.people.map((p) => cents(parse(p.amount || "0")));
  return { mine: s.payer === "me" ? t - theirs.reduce((a, b) => a + b, 0) : cents(parse(s.mine || "0")), theirs };
}

export function SharedBlock({ value: s, onChange, total, category, account, format, parse, income = false, repeating = false }: {
  value: SharedState;
  income?: boolean;              // un ingreso: quién cobró y cuánto es de cada uno
  repeating?: boolean;           // una recurrente: «cada vez»
  onChange: (s: SharedState) => void;
  total: string | null;          // lo que costó en total
  category: string | null;       // tu categoría, para decir dónde va tu parte
  account: string | null;        // de dónde salió, si pagaste tú
  format: (v: string) => string; // S/ 30.00
  parse: (v: string) => string | null;
}) {
  const partners = usePartners().data ?? [];
  const [picking, setPicking] = useState<"add" | "payer" | null>(null);
  const [adding, setAdding] = useState<"add" | "payer" | null>(null);
  const name = (id: number) => partners.find((p) => p.id === id)?.name ?? "…";
  const first = (id: number) => name(id).split(" ")[0]!;
  const set = (patch: Partial<SharedState>) => onChange({ ...s, ...patch });
  const add = (id: number, asPayer: boolean) => {
    const people = s.people.some((p) => p.id === id) ? s.people : [...s.people, { id, amount: "" }];
    onChange({ ...s, people, payer: asPayer ? id : s.payer });
    setPicking(null);
  };
  const { mine, theirs } = shares(s, total, parse);
  const mePaid = s.payer === "me";
  const where = category ? `en ${category}` : "de tu categoría";
  const what = income ? "ingreso" : "gasto";
  const each = repeating ? "Cada vez" : "";

  let result = "Agrega a con quién lo compartiste.";
  if (s.people.length > 0 && cents(total) > 0) {
    if (mePaid) {
      const owe = s.people.map((p, i) => income ? `le debes ${format(money2(theirs[i]!))} a ${first(p.id)}` : `${first(p.id)} te debe ${format(money2(theirs[i]!))}`);
      const flow = income ? `entra ${format(money2(cents(total)))}${account ? ` a ${account}` : ""}` : `sale ${format(money2(cents(total)))}${account ? ` de ${account}` : ""}`;
      result = `${each ? `${each} ${flow}` : flow.replace(/^./, (c) => c.toUpperCase())}. ${format(money2(mine))} son ${what} tuyo ${where}; ${owe.join(", ")}.`;
    } else {
      const none = income ? "no entra nada a tus cuentas" : "no sale nada de tus cuentas";
      result = `${each ? `${each} ${none}` : none.replace(/^./, (c) => c.toUpperCase())}. Tu parte, ${format(money2(mine))}, es ${what} ${where} y ${income ? `${first(s.payer as number)} te la debe` : `se la debes a ${first(s.payer as number)}`}.`;
    }
  }

  return (
    <section aria-label="Compartido" className={`my-2 flex flex-col gap-3 rounded-lg border bg-card p-3.5 ${s.on ? "border-foreground" : "border-border"}`}>
      <label className="flex cursor-pointer items-center gap-3">
        <Icon name="group" size="md" />
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Compartido</span>
          <span className="text-caption text-muted-foreground">{income ? "Con una o varias personas: quién cobró y cuánto es de cada uno" : "Con una o varias personas: quién pagó y cuánto pone cada uno"}</span>
        </span>
        <input type="checkbox" role="switch" checked={s.on} onChange={() => set({ on: !s.on })} className="size-6 accent-primary" />
      </label>
      {s.on && (
        <>
          <div role="radiogroup" aria-label={income ? "¿Quién cobró?" : "¿Quién pagó?"} className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold">{income ? "¿Quién cobró?" : "¿Quién pagó?"}</span>
            <div className="flex flex-wrap gap-1.5">
              {[{ id: "me" as const, label: "Yo" }, ...s.people.map((p) => ({ id: p.id, label: first(p.id) }))].map((o) => (
                <FilterChip key={String(o.id)} radio pressed={s.payer === o.id} onClick={() => set({ payer: o.id })}>{o.label}</FilterChip>
              ))}
              <button type="button" onClick={() => setPicking("payer")} className="h-8 rounded-full border border-dashed border-input-line px-3 text-caption font-semibold">
                Otra persona…
              </button>
            </div>
          </div>

          <div className="flex flex-col">
            <span className="text-caption font-semibold">¿Entre quiénes?</span>
            <div className="flex min-h-12 items-center gap-2.5 border-b border-border">
              <span className="grid size-8 flex-none place-items-center rounded-full bg-secondary text-caption-sm font-semibold">Tú</span>
              <span className="flex flex-1 flex-col">
                <span className="font-semibold">Tú</span>
                <span className="text-caption text-muted-foreground">Tu parte es {what} {where}</span>
              </span>
              {s.mode === "amounts" && !mePaid ? (
                <input inputMode="decimal" aria-label="Tu parte" placeholder="0.00" value={s.mine} onChange={(e) => set({ mine: e.target.value })}
                  className="h-9 w-24 border-0 border-b-2 border-input-line bg-transparent p-0 text-right font-semibold tabular-nums" />
              ) : <span className="font-semibold tabular-nums">{format(money2(mine))}</span>}
            </div>
            {s.people.map((p, i) => {
              const isPayer = s.payer === p.id;
              return (
                <div key={p.id} className="flex min-h-12 items-center gap-2.5 border-b border-border">
                  <Avatar name={name(p.id)} size={32} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-semibold">{name(p.id)}</span>
                    <span className={`text-caption ${mePaid ? (income ? "text-expense" : "text-income") : "text-muted-foreground"}`}>
                      {mePaid ? (income ? "Le debes" : "Te debe") : isPayer ? (income ? "Cobró todo" : "Pagó todo")
                        : income ? `${first(s.payer as number)} le debe` : `Le debe a ${first(s.payer as number)}`}
                    </span>
                  </span>
                  {mePaid && s.mode === "amounts" ? (
                    <input inputMode="decimal" aria-label={`Parte de ${name(p.id)}`} placeholder="0.00" value={p.amount}
                      onChange={(e) => set({ people: s.people.map((x) => (x.id === p.id ? { ...x, amount: e.target.value } : x)) })}
                      className="h-9 w-24 border-0 border-b-2 border-input-line bg-transparent p-0 text-right font-semibold tabular-nums" />
                  ) : mePaid || s.mode === "equal" ? <span className="font-semibold tabular-nums">{format(money2(theirs[i]!))}</span> : null}
                  <button type="button" aria-label={`Quitar a ${name(p.id)}`}
                    onClick={() => onChange({ ...s, payer: isPayer ? "me" : s.payer, people: s.people.filter((x) => x.id !== p.id) })}
                    className="grid size-8 place-items-center text-muted-foreground"><Icon name="close" size="sm" /></button>
                </div>
              );
            })}
            <button type="button" onClick={() => setPicking("add")} className="flex min-h-11 items-center gap-1.5 text-body-sm font-semibold">
              <Icon name="person_add" />Agregar a alguien
            </button>
          </div>

          <Segmented label="Cómo se reparte" size="sm" value={s.mode} onChange={(v) => set({ mode: v as SharedState["mode"] })}
            options={[{ value: "equal", label: "Partes iguales" }, { value: "amounts", label: "Por montos" }]} />
          <p role="status" className="rounded-md bg-muted px-3 py-2.5 text-body-sm">{result}</p>
        </>
      )}

      <Sheet title={picking === "payer" ? (income ? "¿Quién cobró?" : "¿Quién pagó?") : "¿Con quién lo compartiste?"} open={picking !== null} onClose={() => setPicking(null)}>
        <div className="flex flex-col gap-3 px-3 pb-2">
          <PersonPicker label="Busca por nombre" value={null} canAdd={false}
            only={partners.filter((p) => !s.people.some((x) => x.id === p.id) || picking === "payer").map((p) => p.id)}
            onChange={(id) => add(id, picking === "payer")} />
          <button type="button" onClick={() => { setAdding(picking); setPicking(null); }}
            className="flex h-12 items-center justify-center gap-1.5 rounded-lg border border-dashed border-input-line font-semibold">
            <Icon name="person_add" />Nueva persona
          </button>
        </div>
      </Sheet>
      {/* Está dentro del formulario de Registrar: su envío no debe subir y guardar el gasto */}
      <div onSubmit={(e) => e.stopPropagation()}>
        <PersonaSheet key={String(adding)} open={adding !== null} onClose={() => setAdding(null)}
          onCreated={(id) => add(id, adding === "payer")} />
      </div>
    </section>
  );
}
