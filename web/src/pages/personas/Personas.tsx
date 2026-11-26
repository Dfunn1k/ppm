// C6 · Personas: quién me debe, a quién debo y de quién guardo plata. Cada persona con lo que queda
// entre ustedes; las que están al día, abajo. El cuaderno de fiados de la bodega.
// Los tres totales de arriba filtran (?ver=me-deben|debo|guardo): «Me deben» y «Debo a personas» de
// Cuentas abren ya filtrado.
import { useState } from "react";
import { Link, NavLink, useNavigate, useSearchParams } from "react-router";

import { type PartnerRow, useMe, usePartnersOverview } from "@/api/hooks";
import { Avatar } from "@/components/MoveBits";
import { Amounts, ErrorAlert, type Fact, Facts, Icon } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { formatAmount, isNegative, isZero, symbolOf } from "@/lib/money";

import { PersonaSheet } from "./PersonaForm";
import { ListSkeleton } from "@/components/Skeleton";

type Money = PartnerRow["owes_me"][number];

/** Un monto por moneda, para mostrarlos uno debajo del otro con Amounts. */
export function moneyList(list: Money[], lang: string): string[] {
  return list.map((m) => formatAmount(m.amount, symbolOf(m.currency), lang));
}

/** Los mismos montos dentro de una frase: «Te debe S/ 39.00 + US$ 10.00». */
export function joinMoney(list: Money[], lang: string) {
  return moneyList(list, lang).join(" + ");
}

/** Te debe, le debes y guardas, como etiqueta y valor (caso 7). Con `net`, sin el lado de la deuda
 *  cuando es el único: ese ya va a la derecha con su monto. */
export function personDetail(p: PartnerRow, lang: string, net = false): Fact[] {
  const single = net && (p.owes_me.length > 0) !== (p.i_owe.length > 0);
  const facts: Fact[] = [
    p.owes_me.length > 0 && !single && ["Te debe", joinMoney(p.owes_me, lang)],
    p.i_owe.length > 0 && !single && ["Le debes", joinMoney(p.i_owe, lang)],
    p.keep.length > 0 && ["Guardas", joinMoney(p.keep, lang)],
  ];
  return facts.filter(Boolean);
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
  if (!me?.currency || overview.isPending) return <ListSkeleton back="/cuentas" title="Personas" />;
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
            className="flex h-12 items-center justify-center gap-1.5 rounded-lg border border-input-line font-semibold">
            <Icon name="person_add" />Agregar persona
          </button>
        </div>
      ) : (
        <>
          {/* Una sola barra con los tres: los montos no se parten; si alguno es largo, los tres bajan un punto */}
          <div role="group" aria-label="Ver solo" className="mt-5 grid grid-cols-3 overflow-hidden rounded-xl border border-border bg-card">
            {totals.map(([v, total], i) => {
              const on = view === v;
              const small = totals.some(([, t]) => money(t).length > 11);
              return (
                <button key={v} type="button" aria-pressed={on} onClick={() => setParams(on ? {} : { ver: v }, { replace: true })}
                  className={`flex min-w-0 flex-col gap-0.5 px-2.5 py-3 text-left ${i > 0 ? "border-l border-border" : ""} ${on ? "bg-secondary shadow-[inset_0_-3px_0_var(--foreground)]" : ""}`}>
                  <span className="text-caption text-muted-foreground">{SIDE[v].label}</span>
                  <span className={`${small ? "text-[14px]" : "text-[16px]"} leading-6 font-semibold whitespace-nowrap tabular-nums`}>{money(total)}</span>
                </button>
              );
            })}
          </div>

          {side && (
            <section aria-label={side.title} className="mt-6 flex flex-col">
              <span className="border-b border-border pb-1 text-label text-muted-foreground">{side.title}</span>
              {shown.length === 0 && <span className="py-3 text-caption text-muted-foreground">Nadie por ahora.</span>}
              {shown.map((p) => (
                <NavLink key={p.id} to={`/personas/${p.id}`} className="flex min-h-[60px] items-center gap-3 border-b border-border lg:-mx-3 lg:px-3 lg:aria-[current=page]:bg-muted lg:aria-[current=page]:shadow-[inset_3px_0_0_var(--foreground)]">
                  <Avatar name={p.name} size={40} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <Amounts values={moneyList(side.of(p), lang)} className="text-amount" />
                </NavLink>
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
                  <NavLink key={p.id} to={`/personas/${p.id}`} className="flex min-h-[68px] items-center gap-3 border-b border-border lg:-mx-3 lg:px-3 lg:aria-[current=page]:bg-muted lg:aria-[current=page]:shadow-[inset_3px_0_0_var(--foreground)]">
                    <Avatar name={p.name} size={40} />
                    <span className="flex min-w-0 flex-1 flex-col">
                      <span className="font-semibold">{p.name}</span>
                      {personDetail(p, lang, true).length > 0 && <Facts items={personDetail(p, lang, true)} className="mt-0.5" />}
                    </span>
                    {net && (
                      <span className="flex flex-col items-end">
                        <span className="text-caption text-muted-foreground">{net}</span>
                        <span className="text-amount">{money(p.net.replace("-", ""))}</span>
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </section>
          )}

          {!side && settled.length > 0 && (
            <section aria-label="Al día" className="mt-5 flex flex-col">
              <span className="border-b border-border pb-1 text-label text-muted-foreground">Al día</span>
              {settled.map((p) => (
                <NavLink key={p.id} to={`/personas/${p.id}`} className="flex min-h-[60px] items-center gap-3 border-b border-border lg:-mx-3 lg:px-3 lg:aria-[current=page]:bg-muted lg:aria-[current=page]:shadow-[inset_3px_0_0_var(--foreground)]">
                  <Avatar name={p.name} size={40} />
                  <span className="flex min-w-0 flex-1 flex-col">
                    <span className="font-semibold">{p.name}</span>
                    <span className="text-caption text-muted-foreground">
                      {p.last_date ? `Quedaron a mano el ${shortDate(p.last_date)}` : "Todavía sin movimientos"}
                    </span>
                  </span>
                  <span className="text-caption text-muted-foreground">Sin pendientes</span>
                </NavLink>
              ))}
            </section>
          )}
        </>
      )}

      <PersonaSheet key={String(adding)} open={adding} onClose={() => setAdding(false)} onCreated={(id) => navigate(`/personas/${id}`)} />
    </main>
  );
}
