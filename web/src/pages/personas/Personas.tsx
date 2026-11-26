// C6 · Personas: quién me debe, a quién debo y de quién guardo plata. Cada persona con lo que queda
// entre ustedes; las que están al día, abajo. El cuaderno de fiados de la bodega.
// Los tres totales de arriba filtran (?ver=me-deben|debo|guardo): «Me deben» y «Debo a personas» de
// Cuentas abren ya filtrado.
import { useState } from "react";
import { NavLink, useNavigate, useSearchParams } from "react-router";

import { type PartnerRow, useMe, usePartnersOverview } from "@/api/hooks";
import { Avatar } from "@/components/MoveBits";
import { buttonVariants, IconButton } from "@/components/Button";
import { PageHeader } from "@/components/PageHeader";
import { SectionHeading } from "@/components/SectionHeading";
import { Amounts, ErrorAlert, type Fact, Facts, Icon } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { cn } from "@/lib/utils";
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
      <PageHeader back={{ to: "/cuentas", label: "Volver a cuentas" }} title="Personas"
        actions={<IconButton icon="person_add" label="Agregar persona" onClick={() => setAdding(true)}
          className="bg-secondary text-secondary-foreground hover:bg-secondary/80" />} />

      {o.people.length === 0 ? (
        <div className="mt-6 flex flex-col gap-4">
          <p className="text-muted-foreground">
            Aquí verás a quién le prestaste, quién te prestó, con quién dividiste una cuenta y de quién guardas plata.
          </p>
          <button type="button" onClick={() => setAdding(true)}
            className={cn(buttonVariants({ variant: "secondary" }), "gap-1.5 border-input-line text-body")}>
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
                  className={`flex min-w-0 flex-col gap-0.5 px-2.5 py-3 text-left ${i > 0 ? "border-l border-border" : ""} ${on ? "bg-secondary mark-selected-below" : ""}`}>
                  <span className="text-caption text-muted-foreground">{SIDE[v].label}</span>
                  <span className={`${small ? "text-body-sm" : "text-body"} leading-6 font-semibold whitespace-nowrap tabular-nums`}>{money(total)}</span>
                </button>
              );
            })}
          </div>

          {side && (
            <section aria-label={side.title} className="mt-6 flex flex-col">
              <SectionHeading>{side.title}</SectionHeading>
              {shown.length === 0 && <span className="py-3 text-caption text-muted-foreground">Nadie por ahora.</span>}
              {shown.map((p) => (
                <NavLink key={p.id} to={`/personas/${p.id}`} className="flex min-h-row items-center gap-3 border-b border-border py-2 lg:-mx-3 lg:px-3 lg:aria-[current=page]:bg-muted lg:aria-[current=page]:mark-selected">
                  <Avatar name={p.name} />
                  <span className="min-w-0 flex-1 truncate font-semibold">{p.name}</span>
                  <Amounts values={moneyList(side.of(p), lang)} className="text-amount" />
                </NavLink>
              ))}
              <button type="button" onClick={() => setParams({}, { replace: true })} className="flex min-h-control items-center font-semibold">
                Ver a todas las personas
              </button>
            </section>
          )}

          {!side && pending.length > 0 && (
            <section aria-label="Con pendientes" className="mt-6 flex flex-col">
              <SectionHeading>Con pendientes</SectionHeading>
              {pending.map((p) => {
                const net = isZero(p.net) ? null : isNegative(p.net) ? "Le debes" : "Te debe";
                return (
                  <NavLink key={p.id} to={`/personas/${p.id}`} className="flex min-h-row items-center gap-3 border-b border-border py-2.5 lg:-mx-3 lg:px-3 lg:aria-[current=page]:bg-muted lg:aria-[current=page]:mark-selected">
                    <Avatar name={p.name} />
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
              <SectionHeading>Al día</SectionHeading>
              {settled.map((p) => (
                <NavLink key={p.id} to={`/personas/${p.id}`} className="flex min-h-row items-center gap-3 border-b border-border py-2 lg:-mx-3 lg:px-3 lg:aria-[current=page]:bg-muted lg:aria-[current=page]:mark-selected">
                  <Avatar name={p.name} />
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
