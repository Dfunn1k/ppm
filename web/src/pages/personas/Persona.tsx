// C6 · Una persona: lo que queda entre ustedes, cada deuda abierta con su antigüedad y lo ya pagado,
// lo que guardas suyo, y las acciones: registrar un pago, compensar, devolver y dar por perdido.
import { useState } from "react";
import { Link, useParams } from "react-router";

import { type OpenItem, type PartnerRow, useMe, usePartner, usePartnerAction, useRecurringList } from "@/api/hooks";
import { usePanel } from "@/components/AppNav";
import { DebtCard, DueChip } from "@/components/DebtCard";
import { MaturitySheet, maturityText } from "@/components/MaturitySheet";
import { Activities } from "@/components/Pending";
import { Sheet } from "@/components/Sheet";
import { Button, buttonVariants, IconButton } from "@/components/Button";
import { Chip } from "@/components/Chip";
import { SectionHeading } from "@/components/SectionHeading";
import { Amounts, ErrorAlert, Icon, Status } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { add, formatAmount, isNegative, isZero, subtract, symbolOf } from "@/lib/money";
import { useBack } from "@/lib/transitions";
import { capitalize, cn, listText } from "@/lib/utils";

import { PersonaSheet } from "./PersonaForm";
import { joinMoney, moneyList } from "./Personas";
import { DetailSkeleton } from "@/components/Skeleton";

type Hoja = null | "pago" | "compensar" | "perdido" | "editar";

const CONTACT = "hit-area flex h-8 items-center gap-1.5 rounded-full border border-border bg-card px-3 text-caption font-semibold hover:bg-muted";
const SECONDARY = cn(buttonVariants({ variant: "secondary" }), "gap-1.5 border-input-line text-body");

/** Lo abierto de varias deudas, sumado por moneda y escrito: «S/ 120.00 + US$ 10.00». */
function openTotals(items: OpenItem[], lang: string): string[] {
  const t = items.reduce<Record<string, string>>((t, i) => ({ ...t, [i.currency]: add(t[i.currency] ?? "0", i.open) }), {});
  return Object.entries(t).map(([c, v]) => formatAmount(v, symbolOf(c), lang));
}

/** Lo que se puede compensar: lo menor de cada lado, en la moneda que tienen en común. */
function offsetOf(p: PartnerRow) {
  for (const m of p.owes_me) {
    const other = p.i_owe.find((x) => x.currency === m.currency);
    if (other) return { currency: m.currency, amount: Number(m.amount) <= Number(other.amount) ? m.amount : other.amount };
  }
  return null;
}

export function Persona() {
  const id = Number(useParams().id);
  const panel = usePanel();
  const back = useBack();
  const me = useMe().data;
  const detail = usePartner(id);
  const offset = usePartnerAction(id, "offset");
  const writeOff = usePartnerAction(id, "write-off");
  const [hoja, setHoja] = useState<Hoja>(null);
  if (!me?.currency || detail.isPending) return <DetailSkeleton back="/personas" />;
  if (detail.isError) {
    return (
      <main className="mx-auto max-w-md px-6 pt-8">
        <ErrorAlert>{detail.error.message}</ErrorAlert>
        <Link to="/personas" className="mt-4 block text-primary-strong underline">Volver a personas</Link>
      </main>
    );
  }

  const d = detail.data;
  const p = d.partner;
  const lang = me.lang ?? "es-PE";
  const base = (v: string) => formatAmount(v, symbolOf(me.currency), lang);
  const first = p.name.split(" ")[0];
  const owes = p.owes_me.length > 0;
  const owe = p.i_owe.length > 0;
  const keep = p.keep.length > 0;
  const both = offsetOf(p);
  const left = both && subtract(p.net, "0");
  const to = (kind: string) => `/registrar/persona/${kind}?persona=${p.id}`;
  const options = [
    owes && { kind: "collect", icon: "south_west", name: "Me pagó", hint: "Entra a tu cuenta y baja lo que te debe" },
    owe && { kind: "repay", icon: "north_east", name: "Le pagué", hint: "Sale de tu cuenta y baja lo que le debes" },
    keep && { kind: "custody_out", icon: "undo", name: "Le devolví o usé su plata", hint: "Sale de tu cuenta y baja lo que guardas" },
  ].filter(Boolean) as { kind: string; icon: string; name: string; hint: string }[];
  const failure = (offset.error ?? writeOff.error)?.message;
  const late = [...d.owes_me, ...d.i_owe].filter((i) => maturityText(i)?.late);

  const twoSides = owes && owe;
  const why = [
    owes ? `Te debe ${joinMoney(p.owes_me, lang)}` : null,
    owe ? `le debes ${joinMoney(p.i_owe, lang)}` : null,
  ].filter(Boolean).join(" y ");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-6">
      <div className="-mx-2.5 flex min-h-control items-center justify-between">
        <IconButton icon="arrow_back" label="Volver" onClick={back} />
        <IconButton icon="edit" label="Editar persona" onClick={() => setHoja("editar")} />
      </div>
      <h1 className="mt-2 text-title-hero break-words">{p.name}</h1>
      {(owes || owe) ? (
        <>
          <span className="mt-3 text-caption text-muted-foreground">{isZero(p.net) ? "Están a mano" : isNegative(p.net) ? "Le debes" : "Te debe"}</span>
          <span className="text-amount-display tabular-nums">{base(p.net.replace("-", ""))}</span>
          {/* El desglose solo cuando hay deuda de los dos lados: con uno, repetiría el monto grande */}
          {(twoSides || keep) && (
            <span className="mt-0.5 text-caption text-muted-foreground tabular-nums">
              {twoSides ? `${why}.` : ""}{keep ? `${twoSides ? " Aparte, g" : "G"}uardas ${joinMoney(p.keep, lang)} suyos.` : ""}
            </span>
          )}
        </>
      ) : (
        <span className="mt-3 text-muted-foreground">
          {keep ? `Guardas ${joinMoney(p.keep, lang)} suyos.` : "Están a mano: no hay nada pendiente."}
        </span>
      )}
      {late.length > 0 && (
        <Chip tone="attention" size="md" icon="schedule" className="mt-2 gap-1.5 self-start">
          {openTotals(late, lang).join(" + ")} vencidos
        </Chip>
      )}
      {(p.phone || p.email) && (
        // Cada dato en su pastilla con ícono: tocarla llama o abre el correo (caso 9, opción C)
        <span className="mt-2 flex flex-wrap gap-2">
          {p.phone && <a href={`tel:${p.phone.replace(/[^\d+]/g, "")}`} className={CONTACT}><Icon name="call" size="sm" />{p.phone}</a>}
          {p.email && <a href={`mailto:${p.email}`} className={CONTACT}><Icon name="mail" size="sm" />{p.email}</a>}
        </span>
      )}

      <div className="mt-4 flex flex-col gap-4">
        <Items label="Te debe" header={twoSides || keep} items={d.owes_me} paid="te pagó" lang={lang} ask={`¿Hasta cuándo te paga ${first}?`} />
        <Items label="Le debes" header={twoSides || keep} items={d.i_owe} paid="le pagaste" lang={lang} ask={`¿Hasta cuándo le pagas a ${first}?`} />
        {keep && (
          <section aria-label="Guardas suyo" className="flex flex-col">
            <SectionHeading action={<Amounts values={moneyList(p.keep, lang)} className="text-label text-muted-foreground tabular-nums" />}>Guardas suyo</SectionHeading>
            <div className="flex min-h-row-option items-center gap-3 border-b border-border py-2">
              <span className="flex flex-1 flex-col">
                <span className="font-semibold">Te la dio para guardar</span>
                {d.keep_since && <span className="text-caption text-muted-foreground">Desde el {shortDate(d.keep_since)}</span>}
              </span>
              <Amounts values={moneyList(p.keep, lang)} className="text-amount" />
            </div>
          </section>
        )}
      </div>

      <div className="min-h-3 flex-1" />
      <div className="flex flex-col gap-2">
        {failure && <ErrorAlert>{failure}</ErrorAlert>}
        {options.length > 0 && (
          <Button onClick={() => setHoja("pago")}>
            {options.length === 1 && owes ? "Registrar que me pagó" : "Registrar un pago"}
          </Button>
        )}
        {(both || keep) && (
          <div className="grid grid-cols-2 gap-2">
            {both && (
              <button type="button" onClick={() => setHoja("compensar")} className={SECONDARY}>
                <Icon name="compare_arrows" />Compensar
              </button>
            )}
            {keep && (
              <Link to={to("custody_out")} state={panel} className={SECONDARY}>
                <Icon name="undo" />Devolver
              </Link>
            )}
          </div>
        )}
        {owes && (
          <button type="button" onClick={() => setHoja("perdido")}
            className="flex min-h-control items-center justify-center gap-1.5 text-body-sm font-semibold text-destructive">
            <Icon name="money_off" />Dar por perdido lo que te debe
          </button>
        )}
        <div className="flex items-center justify-center gap-6">
          <Link to={to("lend")} state={panel} className="flex min-h-control items-center gap-1.5 text-caption font-semibold text-primary-strong">
            <Icon name="volunteer_activism" />Prestarle
          </Link>
          <Link to={`/personas/${p.id}/ya-debia`} className="flex min-h-control items-center gap-1.5 text-caption font-semibold text-primary-strong">
            <Icon name="history" />De antes de PPM
          </Link>
        </div>
      </div>

      <Repeats partnerId={p.id} first={first ?? p.name} lang={lang} />
      <Activities target={{ partner_id: p.id }} />

      <Sheet title="¿Qué pasó?" open={hoja === "pago"} onClose={() => setHoja(null)}>
        <div className="flex flex-col gap-2 px-1">
          {options.map((o) => (
            <Link key={o.kind} to={to(o.kind)} state={panel} className="flex min-h-row-option items-center gap-3 rounded-md bg-muted px-3 py-2 hover:bg-border">
              <Icon name={o.icon} size="md" />
              <span className="flex flex-1 flex-col">
                <span className="font-semibold">{o.name}</span>
                <span className="text-caption text-muted-foreground">{o.hint}</span>
              </span>
              <Icon name="chevron_right" size="md" className="text-muted-foreground" />
            </Link>
          ))}
        </div>
      </Sheet>

      {both && (
        <Confirm open={hoja === "compensar"} onClose={() => setHoja(null)} title={`Compensar con ${first}`}
          text={`${why}. Se cancelan ${formatAmount(both.amount, symbolOf(both.currency), lang)} de cada lado y ${left && !isZero(left)
            ? `solo queda que ${isNegative(left) ? "le debes" : "te debe"} ${base(left.replace("-", ""))}`
            : "quedan a mano"}. No se mueve plata de tus cuentas.`}
          action={`Compensar ${formatAmount(both.amount, symbolOf(both.currency), lang)}`} icon="compare_arrows"
          pending={offset.isPending} onConfirm={() => offset.mutate(undefined, { onSuccess: () => setHoja(null) })} />
      )}
      <Confirm open={hoja === "perdido"} onClose={() => setHoja(null)} title="Dar por perdido" destructive
        text={`Los ${joinMoney(p.owes_me, lang)} que te debe pasan a Deudas incobrables: cuentan como un gasto de este mes y dejan de aparecer en «me deben».`}
        action={`Dar por perdido ${joinMoney(p.owes_me, lang)}`} icon="money_off"
        pending={writeOff.isPending} onConfirm={() => writeOff.mutate(undefined, { onSuccess: () => setHoja(null) })} />
      <PersonaSheet key={`${hoja}-${p.name}`} open={hoja === "editar"} onClose={() => setHoja(null)} editing={p} />
    </main>
  );
}

/** «Vence el 20 dic» → «vence el 20 dic», cuando va después de su estado. */
const lower = (t: string) => t.charAt(0).toLowerCase() + t.slice(1);

/** «3 cuotas: 1 por cobrar, 1 por facturar y 1 cobrada»: las que faltan, por estado, y las ya cobradas. */
function cuotaCounts(g: OpenItem[]): string {
  const parts = g[0]!.parts!;
  const billed = g.filter((i) => i.billed !== false).length;
  const paid = parts - g.length;
  return `${parts} cuotas: ${listText([billed && `${billed} por cobrar`, g.length - billed && `${g.length - billed} por facturar`,
    paid && `${paid} ${paid === 1 ? "cobrada" : "cobradas"}`])}`;
}

/** Las deudas abiertas de un lado. Las partes de una compra en cuotas van juntas, bajo su compra. Sin
 *  encabezado cuando es el único lado: el monto grande ya dice «Te debe» y cuánto. */
function Items({ label, header, items, paid, lang, ask }: {
  label: string; header: boolean; items: OpenItem[]; paid: string; lang: string; ask: string;
}) {
  const [editing, setEditing] = useState<OpenItem | null>(null);
  if (items.length === 0) return null;
  // Una compra en cuotas, una sola vez, donde aparece su primera parte
  const groups: OpenItem[][] = [];
  for (const i of items) {
    const g = i.parts ? groups.find((x) => x[0]!.move_id === i.move_id && x[0]!.parts) : undefined;
    if (g) g.push(i);
    else groups.push([i]);
  }
  return (
    <section aria-label={label} className="flex flex-col">
      {header && (
        <SectionHeading action={<Amounts values={openTotals(items, lang)} className="text-label text-muted-foreground tabular-nums" />}>{label}</SectionHeading>
      )}
      <ul className="mt-2 flex flex-col gap-3">
        {groups.map((g) => {
          const i = g[0]!;
          // Toda la tarjeta abre el movimiento; las fechas son botones encima, para cambiarlas
          const link = <Link to={`/movimientos/${i.move_id}`} className="after:absolute after:inset-0 after:rounded-xl">{i.ref}</Link>;
          return <li key={i.parts ? `m${i.move_id}` : i.line_id}>{i.parts ? (
            <DebtCard item={i} lang={lang} paid={capitalize(paid)} title={link} due={false}
              amount={openTotals(g, lang)[0]}
              detail={<span className="text-muted-foreground">{cuotaCounts(g)}</span>}>
              <span className="relative z-raised mt-1 flex flex-col">
                {g.map((x) => {
                  const m = maturityText(x);
                  return (
                    <button key={x.line_id} type="button" onClick={() => setEditing(x)} aria-label={`Parte ${x.part} de ${x.parts}: ${m?.text ?? "sin fecha"}. Cambiar la fecha`}
                      className="flex min-h-control items-center gap-2.5 text-left">
                      <span className="grid size-6 flex-none place-items-center rounded-full bg-muted text-caption-sm font-semibold">{x.part}</span>
                      <span className={`flex flex-1 flex-col text-caption ${m?.late ? "font-semibold text-attention" : "text-muted-foreground"}`}>
                        <span className="flex flex-wrap items-center gap-x-2.5">
                          {x.billed === false ? <Status icon="receipt_long">Por facturar</Status> : !m?.late && <Status icon="schedule">Por cobrar</Status>}
                          {m && <span>{x.billed === false || !m.late ? lower(m.text) : m.text}</span>}
                        </span>
                        {x.interest && <span className="tabular-nums">Incluye {formatAmount(x.interest, symbolOf(x.currency), lang)} de interés</span>}
                      </span>
                      <span className="text-body-sm tabular-nums">{formatAmount(x.open, symbolOf(x.currency), lang)}</span>
                    </button>
                  );
                })}
              </span>
            </DebtCard>
          ) : (
            <DebtCard item={i} lang={lang} paid={capitalize(paid)} title={link} due={false}>
              {/* Sin vencimiento no se muestra nada: se pone desde el detalle del movimiento */}
              <DueChip item={i} onClick={() => setEditing(i)} />
            </DebtCard>
          )}</li>;
        })}
      </ul>
      {editing && <MaturitySheet key={editing.line_id} open onClose={() => setEditing(null)} item={editing} title={ask} />}
    </section>
  );
}

function Confirm({ open, onClose, title, text, action, icon, destructive, pending, onConfirm }: {
  open: boolean; onClose: () => void; title: string; text: string; action: string; icon: string;
  destructive?: boolean; pending: boolean; onConfirm: () => void;
}) {
  return (
    <Sheet title={title} open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 px-3">
        <p className="text-muted-foreground tabular-nums">{text}</p>
        <Button variant={destructive ? "destructive" : "primary"} pending={pending} icon={icon} onClick={onConfirm}>{action}</Button>
<Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
      </div>
    </Sheet>
  );
}


/** Las recurrentes que compartes con esta persona: qué toca cada vez y quién le debe a quién. */
function Repeats({ partnerId, first, lang }: { partnerId: number; first: string; lang: string }) {
  const rows = (useRecurringList().data?.rows ?? []).filter((r) => r.state !== "done" && r.shares.some((x) => x.partner_id === partnerId));
  if (rows.length === 0) return null;
  return (
    <section aria-label={`Se repite con ${first}`} className="mt-6 flex flex-col">
      <SectionHeading>Se repite con {first}</SectionHeading>
      {rows.map((r) => {
        const x = r.shares.find((s) => s.partner_id === partnerId)!;
        const who = r.paid_by_partner_id === partnerId ? `${r.kind === "income" ? "cobra" : "paga"} ${first}, ` : "";
        return (
          <Link key={r.id} to={`/mas/recurrentes/${r.id}`} className="flex min-h-row items-center gap-3 border-b border-border py-2">
            <Icon name="event_repeat" size="md" className="text-muted-foreground" />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">{r.name}</span>
              <span className={`text-caption ${x.owes_me ? "text-income" : "text-expense"}`}>
                {r.state === "paused" ? "Pausada" : r.next ? `El ${shortDate(r.next.date)}` : "Sin próximas fechas"}; {who}{x.owes_me ? "te debe" : "le debes"}
              </span>
            </span>
            <span className="font-semibold tabular-nums">{formatAmount(x.amount, symbolOf(r.currency), lang)}</span>
            <Icon name="chevron_right" className="text-muted-foreground" />
          </Link>
        );
      })}
    </section>
  );
}
