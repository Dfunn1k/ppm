// C6 · Personas: quién me debe, a quién debo y de quién guardo plata. Cada persona con lo que queda
// entre ustedes; las que están al día, abajo. El cuaderno de fiados de la bodega.
// Los tres totales de arriba filtran (?ver=me-deben|debo|guardo): «Me deben» y «Debo a personas» de
// Cuentas abren ya filtrado.
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { type PartnerRow, useMe, usePartnersOverview } from "@/api/hooks";
import { Avatar } from "@/components/MoveBits";
import { ErrorAlert, Icon, Spinner } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { formatAmount, isNegative, isZero, symbolOf } from "@/lib/money";

import { PersonaSheet } from "./PersonaForm";

type Money = PartnerRow["owes_me"][number];

export function joinMoney(list: Money[], lang: string) {
  return list.map((m) => formatAmount(m.amount, symbolOf(m.currency), lang)).join(" + ");
}

/** «Te debe S/ 39.00 · le debes S/ 50.00 · guardas S/ 200.00». Con `net`, sin el lado de la deuda
 *  cuando es el único: ese ya va a la derecha con su monto. */
export function personDetail(p: PartnerRow, lang: string, net = false) {
  const single = net && (p.owes_me.length > 0) !== (p.i_owe.length > 0);
  return [
    p.owes_me.length && !single ? `te debe ${joinMoney(p.owes_me, lang)}` : null,
    p.i_owe.length && !single ? `le debes ${joinMoney(p.i_owe, lang)}` : null,
    p.keep.length ? `guardas ${joinMoney(p.keep, lang)}` : null,
  ].filter(Boolean).join(" · ").replace(/^./, (c) => c.toUpperCase());
}

type View = "me-deben" | "debo" | "guardo";
const SIDE: Record<View, { label: string; title: string; of: (p: PartnerRow) => Money[] }> = {
  "me-deben": { label: "Me deben", title: "Me deben", of: (p) => p.owes_me },
  debo: { label: "Debo", title: "Les debo", of: (p) => p.i_owe },
  guardo: { label: "Guardo", title: "Guardo suyo", of: (p) => p.keep },
};

export function Personas() {
  const me = useMe().data;
  const [params, setParams] = useSearchParams();
  const view = (params.get("ver") as View | null) ?? null;
  const overview = usePartnersOverview();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  if (!me?.currency || overview.isPending) return <Spinner />;
  if (overview.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{overview.error.message}</ErrorAlert></main>;

  const o = overview.data;
  const lang = me.lang ?? "es-PE";
  const money = (v: string) => formatAmount(v, symbolOf(o.currency), lang);
  const pending = o.people.filter((p) => p.owes_me.length || p.i_owe.length || p.keep.length);
  const settled = o.people.filter((p) => !pending.includes(p));
  const side = view ? SIDE[view] : null;
  const shown = side ? pending.filter((p) => side.of(p).length > 0) : pending;
  const totals: [View, string][] = [["me-deben", o.owes_me_total], ["debo", o.i_owe_total], ["guardo", o.keep_total]];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/cuentas" aria-label="Volver a cuentas" className="grid size-11 place-items-center rounded-full">
          <Icon name="arrow_back" className="text-[24px]" />
        </Link>
        <button type="button" aria-label="Agregar persona" onClick={() => setAdding(true)}
          className="grid size-11 place-items-center rounded-full bg-secondary text-secondary-foreground">
          <Icon name="person_add" className="text-[24px]" />
        </button>
      </div>
      <h1 className="mt-3 text-title-hero">Personas</h1>

      {o.people.length === 0 ? (
        <div className="mt-6 flex flex-col gap-4">
          <p className="text-muted-foreground">
            Aquí verás a quién le prestaste, quién te prestó, con quién dividiste una cuenta y de quién guardas plata.
          </p>
          <button type="button" onClick={() => setAdding(true)}
            className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-input-line font-semibold">
            <Icon name="person_add" />Agregar persona
          </button>
        </div>
      ) : (
        <>
          <div role="group" aria-label="Ver solo" className="mt-5 grid grid-cols-3 gap-2">
            {totals.map(([v, total]) => {
              const on = view === v;
              return (
                <button key={v} type="button" aria-pressed={on} onClick={() => setParams(on ? {} : { ver: v }, { replace: true })}
                  className={`flex flex-col gap-0.5 rounded-lg border p-3 text-left ${on ? "border-primary bg-secondary" : "border-border bg-card"}`}>
                  <span className="text-caption text-muted-foreground">{SIDE[v].label}</span>
                  <span className="text-[18px] leading-6 font-semibold tabular-nums">{money(total)}</span>
                </button>
              );
            })}
          </div>

          {side && (
            <section aria-label={side.title} className="mt-6 flex flex-col">
              <span className="border-b border-border pb-1 text-label text-muted-foreground">{side.title}</span>
              {shown.length === 0 && <span className="py-3 text-caption text-muted-foreground">Nadie por ahora.</span>}
              {shown.map((p) => (
                <Link key={p.id} to={`/personas/${p.id}`} className="flex min-h-[60px] items-center gap-3 border-b border-border">
                  <Avatar name={p.name} size={40} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <span className="text-amount">{joinMoney(side.of(p), lang)}</span>
                </Link>
              ))}
              <button type="button" onClick={() => setParams({}, { replace: true })} className="flex min-h-12 items-center font-semibold">
                Ver a todas las personas
              </button>
            </section>
          )}

          {!side && pending.length > 0 && (
            <section aria-label="Con pendientes" className="mt-6 flex flex-col">
              <span className="border-b border-border pb-1 text-label text-muted-foreground">Con pendientes</span>
              {pending.map((p) => {
                const net = isZero(p.net) ? null : isNegative(p.net) ? "Le debes" : "Te debe";
                return (
                  <Link key={p.id} to={`/personas/${p.id}`} className="flex min-h-[68px] items-center gap-3 border-b border-border">
                    <Avatar name={p.name} size={40} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold">{p.name}</span>
                      {personDetail(p, lang, true) && <span className="text-caption text-muted-foreground tabular-nums">{personDetail(p, lang, true)}</span>}
                    </span>
                    {net && (
                      <span className="flex flex-col items-end">
                        <span className="text-caption text-muted-foreground">{net}</span>
                        <span className="text-amount">{money(p.net.replace("-", ""))}</span>
                      </span>
                    )}
                  </Link>
                );
              })}
            </section>
          )}

          {!side && settled.length > 0 && (
            <section aria-label="Al día" className="mt-5 flex flex-col">
              <span className="border-b border-border pb-1 text-label text-muted-foreground">Al día</span>
              {settled.map((p) => (
                <Link key={p.id} to={`/personas/${p.id}`} className="flex min-h-[60px] items-center gap-3 border-b border-border">
                  <Avatar name={p.name} size={40} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-caption text-muted-foreground">
                      {p.last_date ? `Quedaron a mano el ${shortDate(p.last_date)}` : "Todavía sin movimientos"}
                    </span>
                  </span>
                  <span className="text-caption text-muted-foreground">Sin pendientes</span>
                </Link>
              ))}
            </section>
          )}
        </>
      )}

      <PersonaSheet key={String(adding)} open={adding} onClose={() => setAdding(false)} onCreated={(id) => navigate(`/personas/${id}`)} />
    </main>
  );
}
