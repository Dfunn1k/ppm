// C6 · Una persona: lo que queda entre ustedes, cada deuda abierta con su antigüedad y lo ya pagado,
// lo que guardas suyo, y las acciones: registrar un pago, compensar, devolver y dar por perdido.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { type OpenItem, type PartnerRow, useMe, usePartner, usePartnerAction } from "@/api/hooks";
import { MaturitySheet, maturityText } from "@/components/MaturitySheet";
import { Activities } from "@/components/Pending";
import { Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon, Spinner } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { formatAmount, isNegative, isZero, subtract, symbolOf } from "@/lib/money";

import { PersonaSheet } from "./PersonaForm";
import { joinMoney } from "./Personas";

type Hoja = null | "pago" | "compensar" | "perdido" | "editar";

function ago(days: number) {
  return days <= 0 ? "Hoy" : days === 1 ? "Ayer" : `Hace ${days} días`;
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
  const navigate = useNavigate();
  const me = useMe().data;
  const detail = usePartner(id);
  const offset = usePartnerAction(id, "offset");
  const writeOff = usePartnerAction(id, "write-off");
  const [hoja, setHoja] = useState<Hoja>(null);
  if (!me?.currency || detail.isPending) return <Spinner />;
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
      <div className="-mx-2.5 flex items-center justify-between">
        <button type="button" aria-label="Volver" onClick={() => navigate(-1)} className="grid size-11 place-items-center rounded-full">
          <Icon name="arrow_back" className="text-[24px]" />
        </button>
        <button type="button" aria-label="Editar persona" onClick={() => setHoja("editar")} className="grid size-11 place-items-center rounded-full">
          <Icon name="edit" className="text-[22px]" />
        </button>
      </div>
      <h1 className="mt-2 font-display text-[40px] leading-[42px] font-extrabold tracking-[-0.03em]">{p.name}</h1>
      {(owes || owe) ? (
        <>
          <span className="mt-3 text-caption text-muted-foreground">{isZero(p.net) ? "Están a mano" : isNegative(p.net) ? "Le debes" : "Te debe"}</span>
          <span className="text-amount-hero">{base(p.net.replace("-", ""))}</span>
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
        <span className="mt-2 flex h-8 items-center gap-1.5 self-start rounded-full bg-attention-soft px-3 text-caption font-semibold text-attention tabular-nums">
          <Icon name="schedule" className="text-[18px]" />
          {Object.entries(late.reduce<Record<string, number>>((t, i) => ({ ...t, [i.currency]: (t[i.currency] ?? 0) + Number(i.open) }), {}))
            .map(([c, v]) => formatAmount(v.toFixed(2), symbolOf(c), lang)).join(" + ")} vencidos
        </span>
      )}
      {(p.phone || p.email) && (
        <span className="mt-2 text-caption text-muted-foreground">{[p.phone, p.email].filter(Boolean).join(" · ")}</span>
      )}

      <div className="mt-4 flex flex-col gap-4">
        <Items label="Te debe" header={twoSides || keep} items={d.owes_me} paid="te pagó" lang={lang} ask={`¿Hasta cuándo te paga ${first}?`} />
        <Items label="Le debes" header={twoSides || keep} items={d.i_owe} paid="le pagaste" lang={lang} ask={`¿Hasta cuándo le pagas a ${first}?`} />
        {keep && (
          <section aria-label="Guardas suyo" className="flex flex-col">
            <div className="flex justify-between border-b border-border pb-1 text-label text-muted-foreground tabular-nums">
              <span>Guardas suyo</span><span>{joinMoney(p.keep, lang)}</span>
            </div>
            <div className="flex min-h-14 items-center gap-3 border-b border-border">
              <span className="flex flex-1 flex-col">
                <span className="font-semibold">Te la dio para guardar</span>
                {d.keep_since && <span className="text-caption text-muted-foreground">Desde el {shortDate(d.keep_since)}</span>}
              </span>
              <span className="text-amount">{joinMoney(p.keep, lang)}</span>
            </div>
          </section>
        )}
      </div>

      <div className="min-h-3 flex-1" />
      <div className="flex flex-col gap-2">
        {failure && <ErrorAlert>{failure}</ErrorAlert>}
        {options.length > 0 && (
          <button type="button" onClick={() => setHoja("pago")}
            className="flex h-14 items-center justify-between rounded-xl bg-primary px-5 font-semibold text-primary-foreground">
            <span>{options.length === 1 && owes ? "Registrar que me pagó" : "Registrar un pago"}</span>
            <Icon name="arrow_forward" className="text-[22px]" />
          </button>
        )}
        {(both || keep) && (
          <div className="grid grid-cols-2 gap-2">
            {both && (
              <button type="button" onClick={() => setHoja("compensar")}
                className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-input-line font-semibold">
                <Icon name="compare_arrows" />Compensar
              </button>
            )}
            {keep && (
              <Link to={to("custody_out")} className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-input-line font-semibold">
                <Icon name="undo" />Devolver
              </Link>
            )}
          </div>
        )}
        {owes && (
          <button type="button" onClick={() => setHoja("perdido")}
            className="flex h-11 items-center justify-center gap-1.5 text-[14px] font-semibold text-destructive">
            <Icon name="money_off" />Dar por perdido lo que te debe
          </button>
        )}
        <div className="flex items-center justify-center gap-6">
          <Link to={to("lend")} className="flex h-11 items-center gap-1.5 text-caption font-semibold text-primary-strong">
            <Icon name="volunteer_activism" className="text-[20px]" />Prestarle
          </Link>
          <Link to={`/personas/${p.id}/ya-debia`} className="flex h-11 items-center gap-1.5 text-caption font-semibold text-primary-strong">
            <Icon name="history" className="text-[20px]" />De antes de PPM
          </Link>
        </div>
      </div>

      <Activities target={{ partner_id: p.id }} />

      <Sheet title="¿Qué pasó?" open={hoja === "pago"} onClose={() => setHoja(null)}>
        <div className="flex flex-col gap-2 px-1">
          {options.map((o) => (
            <Link key={o.kind} to={to(o.kind)} className="flex min-h-14 items-center gap-3 rounded-md bg-muted px-3">
              <Icon name={o.icon} className="text-[22px]" />
              <span className="flex flex-1 flex-col">
                <span className="font-semibold">{o.name}</span>
                <span className="text-caption text-muted-foreground">{o.hint}</span>
              </span>
              <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
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

/** «3 cuotas · 1 por cobrar · 2 por facturar · 1 cobrada»: las que faltan, por estado, y las ya cobradas. */
function cuotaCounts(g: OpenItem[]): string {
  const parts = g[0]!.parts!;
  const billed = g.filter((i) => i.billed !== false).length;
  const paid = parts - g.length;
  return [`${parts} cuotas`, billed && `${billed} por cobrar`, g.length - billed && `${g.length - billed} por facturar`,
    paid && `${paid} ${paid === 1 ? "cobrada" : "cobradas"}`].filter(Boolean).join(" · ");
}

/** Las deudas abiertas de un lado. Las partes de una compra en cuotas van juntas, bajo su compra. Sin
 *  encabezado cuando es el único lado: el monto grande ya dice «Te debe» y cuánto. */
function Items({ label, header, items, paid, lang, ask }: {
  label: string; header: boolean; items: OpenItem[]; paid: string; lang: string; ask: string;
}) {
  const [editing, setEditing] = useState<OpenItem | null>(null);
  if (items.length === 0) return null;
  const total = items.reduce<Record<string, number>>((t, i) => ({ ...t, [i.currency]: (t[i.currency] ?? 0) + Number(i.open) }), {});
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
        <div className="flex justify-between border-b border-border pb-1 text-label text-muted-foreground tabular-nums">
          <span>{label}</span>
          <span>{Object.entries(total).map(([c, v]) => formatAmount(v.toFixed(2), symbolOf(c), lang)).join(" + ")}</span>
        </div>
      )}
      {groups.map((g) => g[0]!.parts ? (
        <div key={`m${g[0]!.move_id}`} className="flex flex-col border-b border-border py-2">
          <Link to={`/movimientos/${g[0]!.move_id}`} className="flex items-center gap-3">
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">{g[0]!.ref}</span>
              <span className="text-caption text-muted-foreground">
                {cuotaCounts(g)}
              </span>
            </span>
            <span className="text-amount">{formatAmount(g.reduce((t, i) => t + Number(i.open), 0).toFixed(2), symbolOf(g[0]!.currency), lang)}</span>
          </Link>
          {g.map((i) => {
            const m = maturityText(i);
            return (
              <button key={i.line_id} type="button" onClick={() => setEditing(i)} aria-label={`Parte ${i.part} de ${i.parts}: ${m?.text ?? "sin fecha"}. Cambiar la fecha`}
                className="flex min-h-10 items-center gap-2.5 text-left">
                <span className="grid size-6 flex-none place-items-center rounded-full bg-muted text-[12px] font-semibold">{i.part}</span>
                <span className={`flex flex-1 flex-col text-caption ${m?.late ? "font-semibold text-attention" : "text-muted-foreground"}`}>
                  <span>{[i.billed === false ? "Por facturar" : !m?.late && "Por cobrar", m?.text].filter(Boolean).join(" · ")}</span>
                  {i.interest && <span className="tabular-nums">Incluye {formatAmount(i.interest, symbolOf(i.currency), lang)} de interés</span>}
                </span>
                <span className="text-[14px] tabular-nums">{formatAmount(i.open, symbolOf(i.currency), lang)}</span>
              </button>
            );
          })}
        </div>
      ) : (() => {
        const i = g[0]!;
        const partial = i.open !== i.amount;
        const m = maturityText(i);
        return (
          <div key={i.line_id} className="flex flex-col border-b border-border py-2">
            <Link to={`/movimientos/${i.move_id}`} className="flex items-center gap-3">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{i.ref}</span>
                <span className="text-caption text-muted-foreground tabular-nums">
                  {shortDate(i.date)} · {ago(i.days).toLowerCase()}
                  {partial && ` · era ${formatAmount(i.amount, symbolOf(i.currency), lang)}, ${paid} ${formatAmount(subtract(i.amount, i.open), symbolOf(i.currency), lang)}`}
                </span>
              </span>
              <span className="text-amount">{formatAmount(i.open, symbolOf(i.currency), lang)}</span>
            </Link>
            {/* Sin vencimiento no se muestra nada: se pone desde el detalle del movimiento */}
            {m && (
              <button type="button" onClick={() => setEditing(i)}
                className={`mt-0.5 flex h-8 items-center gap-1 self-start text-caption ${m.late ? "font-semibold text-attention" : "text-muted-foreground"}`}>
                <Icon name={m.late ? "schedule" : "event"} className="text-[16px]" />
                {m.text}
              </button>
            )}
          </div>
        );
      })())}
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
        <button type="button" disabled={pending} onClick={onConfirm}
          className={`flex h-14 items-center justify-between rounded-xl px-5 font-semibold disabled:opacity-60 ${destructive ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}>
          <span>{action}</span><Icon name={pending ? "progress_activity" : icon} className={pending ? "animate-spin" : ""} />
        </button>
        <button type="button" onClick={onClose} className="h-11 font-semibold">Cancelar</button>
      </div>
    </Sheet>
  );
}
