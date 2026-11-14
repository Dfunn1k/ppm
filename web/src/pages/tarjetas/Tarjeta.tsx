// C3 · Detalle de tarjeta: lo que toca pagar y para cuándo (la fecha se copia del estado de cuenta;
// si falta, la pide), lo que se factura en el próximo corte, la línea disponible (la del último
// estado de cuenta importado más lo de después), las cuotas por venir y los movimientos agrupados
// por ciclo, como en el estado de cuenta. El menú ⋮ renombra, edita corte y línea, cambia
// la fecha de pago o archiva.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { type CardDetail, useAddBankCharge, useArchiveAccount, useCard, useCardDueDate, useCardRate, useMe, useUpdateCard } from "@/api/hooks";
import { Activities, ActivitySheet } from "@/components/Pending";
import { Segmented, Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon, LineField, PrimaryButton } from "@/components/ui";
import { ImportStatement } from "@/pages/tarjetas/Conciliar";
import { DateField } from "@/components/DateSheet";
import { daysUntil } from "@/lib/cards";
import { monthName } from "@/lib/months";
import { shortDate, todayISO } from "@/lib/dates";
import { formatAmount, formatNumber, isNegative, isZero, parseAmount, symbolOf } from "@/lib/money";
import { DetailSkeleton } from "@/components/Skeleton";

type Menu = null | "open" | "rename" | "edit" | "due" | "archive" | "charge" | "rate" | "reminder";
type Item = CardDetail["cycles"][number]["items"][number];

export function Tarjeta() {
  const id = Number(useParams().id);
  const me = useMe().data;
  const card = useCard(id);
  const [menu, setMenu] = useState<Menu>(null);
  const [picked, setPicked] = useState<string | null>(null);
  if (!me?.currency || card.isPending) return <DetailSkeleton back="/cuentas" />;
  if (card.isError) {
    return (
      <main className="mx-auto max-w-md px-6 pt-8">
        <ErrorAlert>{card.error.message}</ErrorAlert>
        <Link to="/cuentas" className="mt-4 block text-primary-strong underline">Volver a cuentas</Link>
      </main>
    );
  }
  const d = card.data;
  const lang = me.lang ?? "es-PE";
  const base = me.currency;
  const money = (v: string, cur: string) => formatAmount(v, symbolOf(cur), lang);
  // Un ciclo a la vez, como el estado de cuenta: por defecto el que está abierto.
  const found = d.cycles.findIndex((c) => c.closing_date === picked);
  const open = d.cycles.findLastIndex((c) => c.state === "current");
  const at = found >= 0 ? found : Math.max(0, open);
  const cycle = d.cycles[at];
  const close = () => setMenu(null);

  const owed = d.status.filter((s) => Number(s.to_pay) > 0);
  const main = d.status.find((s) => s.currency === base) ?? d.status[0]!;
  const others = owed.filter((s) => s.currency !== main.currency);
  const favor = d.status.filter((s) => isNegative(s.to_pay));
  const noDue = owed.length > 0 && !d.date_due;
  const anyDebt = d.status.some((s) => Number(s.total_debt) > 0);
  const when = owed.length === 0
    ? favor.length ? "Tienes saldo a favor" : "Nada por pagar ahora"
    : d.date_due
      ? `A pagar antes del ${shortDate(d.date_due)}${dueIn(d.date_due)}`
      : `A pagar · ciclo que cerró el ${shortDate(d.last_closing)}`;
  const hero = owed.length === 0 && favor.length ? favor[0]!.to_pay.replace("-", "") : Number(main.to_pay) > 0 ? main.to_pay : "0.00";
  const heroCur = owed.length === 0 && favor.length ? favor[0]!.currency : main.currency;
  const nextOthers = d.status.filter((s) => s.currency !== main.currency && Number(s.next_bill) > 0);
  // El tipo de cambio del ciclo abierto, solo de las monedas en que debes
  const foreignRates = d.rates.filter((r) => r.currency !== d.limit_currency
    && d.status.some((s) => s.currency === r.currency && Number(s.total_debt) !== 0));
  const pct = Number(d.credit_limit) > 0 ? Math.min(100, Math.max(0, Math.round((Number(d.used) / Number(d.credit_limit)) * 100))) : 0;
  const label = [d.account.subtitle, `Corte el ${d.closing_day}`].filter(Boolean).join(" · ");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/cuentas" aria-label="Volver a cuentas" className="grid size-11 place-items-center rounded-full">
          <Icon name="arrow_back" className="text-[24px]" />
        </Link>
        <button type="button" aria-label="Más opciones de la tarjeta" aria-haspopup="dialog" onClick={() => setMenu("open")}
          className="grid size-11 place-items-center rounded-full">
          <Icon name="more_vert" className="text-[24px]" />
        </button>
      </div>
      <span className="mt-2 text-label text-muted-foreground">{label}</span>
      <h1 className="mt-1.5 text-title-hero">{d.account.name}</h1>

      <span className="mt-4 text-caption text-muted-foreground">{when}</span>
      <span className="text-amount-hero">{money(hero, heroCur)}</span>
      {others.map((s) => (
        <span key={s.currency} className="text-[17px] leading-6 font-semibold tabular-nums">y {money(s.to_pay, s.currency)}</span>
      ))}

      {noDue && (
        <div className="mt-3 flex items-start gap-2 rounded-md bg-attention-soft p-3 text-caption text-attention">
          <Icon name="event_busy" />
          <span><b>Falta la fecha de pago.</b> Escribe el último día de pago que dice tu estado de cuenta.</span>
        </div>
      )}
      <div className="mt-4 flex flex-col gap-2">
        {noDue && (
          <button type="button" onClick={() => setMenu("due")}
            className="flex h-14 items-center justify-between rounded-xl bg-primary px-5 font-semibold text-primary-foreground">
            <span>Escribir fecha de pago</span><Icon name="event" className="text-[22px]" />
          </button>
        )}
        {anyDebt && (
          <Link to={`/tarjetas/${id}/pagar`}
            className={`flex h-14 items-center justify-between rounded-xl px-5 font-semibold ${noDue ? "border border-input-line" : "bg-primary text-primary-foreground"}`}>
            <span>Pagar tarjeta</span><Icon name="arrow_forward" className="text-[22px]" />
          </Link>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-2">
        <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card p-3">
          <span className="text-caption text-muted-foreground">Por facturar · cierra {shortDate(d.next_closing)}</span>
          <span className="text-[18px] leading-6 font-semibold tabular-nums">{money(main.next_bill, main.currency)}</span>
          {nextOthers.map((s) => (
            <span key={s.currency} className="text-caption text-muted-foreground tabular-nums">y {money(s.next_bill, s.currency)}</span>
          ))}
        </div>
        <div className="flex flex-col gap-0.5 rounded-lg border border-border bg-card p-3">
          <span className="text-caption text-muted-foreground">Línea disponible</span>
          <span className="text-[18px] leading-6 font-semibold tabular-nums">{money(d.available, d.limit_currency)}</span>
          <span className="text-caption text-muted-foreground tabular-nums">de {money(d.credit_limit, d.limit_currency)}</span>
          <span className={`mt-1 self-start rounded-full px-2 py-0.5 text-[12px] font-semibold ${d.line_matched ? "bg-secondary text-secondary-foreground" : "bg-muted text-muted-foreground"}`}>
            {d.line_matched ? "Cuadrada con banco" : "Estimada"}
          </span>
        </div>
      </div>
      <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted" role="meter" aria-label="Línea usada"
        aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
        <span className="block h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      <span className="mt-1.5 text-caption text-muted-foreground">
        {pct === 0 ? "Todavía no usas tu línea. " : `Usas el ${pct}% de tu línea. `}
        {d.line_from
          ? d.line_matched
            ? `Es la del estado de cuenta del ${shortDate(d.line_from)}.`
            : `Parte del estado de cuenta del ${shortDate(d.line_from)} y suma lo de después: una compra en cuotas ocupa su precio${foreignRates.length ? "; los dólares, al tipo de venta" : ""}.`
          : "Sin estado de cuenta, PPM la estima con todo lo que debes. Importa el último para cuadrarla."}
      </span>
      <ImportStatement cardId={id} />

      {foreignRates.map((r) => (
        <button key={r.currency} type="button" onClick={() => setMenu("rate")}
          className="mt-1 flex min-h-10 items-center gap-1.5 self-start text-caption text-muted-foreground tabular-nums">
          <Icon name="currency_exchange" className="text-[16px]" />
          {symbolOf(r.currency)} al tipo de venta {Number(r.rate).toFixed(3)} · {r.edited ? `escrito el ${shortDate(r.rate_date)}` : `del ${shortDate(r.rate_date)}`}
          <span className="font-semibold text-primary-strong">Cambiar</span>
        </button>
      ))}

      <section aria-label="Cuotas por venir" className="mt-6 flex flex-col">
        <div className="flex justify-between border-b border-border pb-1 text-label text-muted-foreground tabular-nums">
          <span>Cuotas por venir</span>
          <span>{plansTotal(d, lang)}</span>
        </div>
        {d.plans.map((p) => (
          <Link key={p.id} to={`/movimientos/${p.move_id}`} className="flex min-h-[60px] items-center gap-3 border-b border-border">
            <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground">
              <Icon name="calendar_month" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">{p.name}</span>
              <span className="text-caption text-muted-foreground tabular-nums">
                {p.opening ? "De antes de PPM" : `Facturada ${p.billed} de ${p.n_installments}`}
                {" · "}quedan {p.n_installments - p.billed}{p.next_installment ? ` de ${money(p.next_installment, p.currency)}` : ""}
              </span>
            </span>
            <span className="text-amount">{money(p.remaining, p.currency)}</span>
          </Link>
        ))}
        {d.plans.length === 0 && (
          <span className="pt-3 pb-1 text-caption text-muted-foreground">Cuando compres en cuotas, aquí ves cuánto falta de cada compra.</span>
        )}
        <Link to={`/tarjetas/${id}/cuotas-antes`} className="flex min-h-12 items-center gap-1.5 font-semibold">
          <Icon name="add" />Cuotas de antes de PPM
        </Link>
      </section>

      <section aria-label="Cargos del banco" className="mt-6 flex flex-col">
        <span className="border-b border-border pb-1 text-label text-muted-foreground">Cargos del banco</span>
        {d.charges.map((c) => (
          <Link key={c.id} to={`/mas/recurrentes/${c.id}`} className="flex min-h-[60px] items-center gap-3 border-b border-border">
            <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground">
              <Icon name={c.yearly ? "workspace_premium" : "shield"} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">{c.name}</span>
              <span className="text-caption text-muted-foreground">
                {c.yearly ? "Cada año" : "Cada corte"} · {c.next_date ? `el próximo, ${shortDate(c.next_date)}` : "terminado"}
              </span>
              {c.drafts > 0 && (
                <span className="mt-1 self-start rounded-full bg-attention-soft px-2 py-0.5 text-[12px] font-semibold text-attention">
                  {c.drafts === 1 ? "1 por confirmar" : `${c.drafts} por confirmar`}
                </span>
              )}
            </span>
            <span className="text-amount">{money(c.amount, d.limit_currency)}</span>
          </Link>
        ))}
        {d.charges.length === 0 && (
          <span className="pt-3 pb-1 text-caption text-muted-foreground">
            El seguro de desgravamen de cada corte o la membresía anual: PPM los crea por confirmar y no cuentan hasta que los confirmas.
          </span>
        )}
        <button type="button" onClick={() => setMenu("charge")} className="flex min-h-12 items-center gap-1.5 font-semibold">
          <Icon name="add" />Agregar cargo del banco
        </button>
      </section>

      <Activities target={{ account_id: id }} hideEmpty />

      <div className="mt-3 flex flex-col gap-4">
        {cycle && (
          <section aria-label={cycleLabel(cycle)} className="flex flex-col">
            <div className="flex items-center justify-between gap-2">
              <button type="button" aria-label="Ciclo anterior" disabled={at >= d.cycles.length - 1}
                onClick={() => setPicked(d.cycles[at + 1]!.closing_date)}
                className="grid size-10 flex-none place-items-center rounded-full border border-border bg-card disabled:opacity-40">
                <Icon name="chevron_left" />
              </button>
              <span className="flex min-w-0 flex-col items-center text-center">
                <span className="font-semibold">{cycleTitle(cycle, at === open)}</span>
                <span className="text-caption text-muted-foreground tabular-nums">{cycleLabel(cycle)}</span>
              </span>
              <button type="button" aria-label="Ciclo siguiente" disabled={at <= 0}
                onClick={() => setPicked(d.cycles[at - 1]!.closing_date)}
                className="grid size-10 flex-none place-items-center rounded-full border border-border bg-card disabled:opacity-40">
                <Icon name="chevron_right" />
              </button>
            </div>
            <div className="mt-3 flex justify-between gap-3 border-b border-border pb-1 text-label text-muted-foreground tabular-nums">
              <span>{cycle.items.length} {cycle.items.length === 1 ? "movimiento" : "movimientos"}</span>
              <span className="text-right">{cycle.charges.map((x) => money(x.amount, x.currency)).join(" · ")}</span>
            </div>
            {cycle.statement && (
              <Link to={`/tarjetas/${id}/estado/${cycle.closing_date}`}
                className="flex min-h-11 items-center gap-1.5 border-b border-border text-caption font-semibold text-primary-strong">
                <Icon name="fact_check" className="text-[18px]" />Ver su estado de cuenta
              </Link>
            )}
            {cycle.items.map((i, n) => <ItemRow key={`${i.move_id}-${i.sequence ?? n}`} item={i} base={base} lang={lang} />)}
          </section>
        )}
        {d.cycles.length === 0 && (
          <span className="text-caption text-muted-foreground">
            Lo que compres con la tarjeta aparece aquí, agrupado por ciclo como en tu estado de cuenta.
          </span>
        )}
        <Link to={`/registrar?cuenta=${id}`}
          className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-dashed border-input-line font-semibold">
          <Icon name="percent" />Intereses o comisiones del banco
        </Link>
      </div>

      <Sheet title="Opciones de la tarjeta" open={menu === "open"} onClose={close}>
        <div className="flex flex-col">
          <MenuItem icon="edit" onClick={() => setMenu("rename")}>Renombrar</MenuItem>
          <MenuItem icon="notification_add" onClick={() => setMenu("reminder")}>Agregar recordatorio</MenuItem>
          <MenuItem icon="tune" onClick={() => setMenu("edit")}>Editar corte, línea y datos</MenuItem>
          <MenuItem icon="event" onClick={() => setMenu("due")}>Cambiar fecha de pago</MenuItem>
          <MenuItem icon="archive" danger onClick={() => setMenu("archive")}>Archivar tarjeta</MenuItem>
        </div>
      </Sheet>
      <ActivitySheet open={menu === "reminder"} onClose={close} target={{ account_id: id }} />
      <RenameSheet key={`r${menu}`} open={menu === "rename"} onClose={close} card={d} />
      <EditSheet key={`e${menu}`} open={menu === "edit"} onClose={close} card={d} lang={lang} />
      <DueSheet key={`d${menu}`} open={menu === "due"} onClose={close} card={d} />
      <ArchiveSheet open={menu === "archive"} onClose={close} card={d} />
      <ChargeSheet key={`c${menu}`} open={menu === "charge"} onClose={close} card={d} lang={lang} />
      {foreignRates[0] && <RateSheet key={`t${menu}`} open={menu === "rate"} onClose={close} card={d} rate={foreignRates[0]} />}
    </main>
  );
}

/** El tipo de cambio del ciclo abierto: el de venta del día o uno escrito a mano (como el del banco). */
function RateSheet({ open, onClose, card, rate }: {
  open: boolean; onClose: () => void; card: CardDetail; rate: CardDetail["rates"][number];
}) {
  const save = useCardRate(card.account.id);
  const [value, setValue] = useState(Number(rate.rate).toFixed(3));
  const parsed = value.trim().replace(",", ".");
  const ok = /^\d+(\.\d{1,6})?$/.test(parsed) && Number(parsed) > 0;
  return (
    <Sheet title={`Tipo de cambio de ${symbolOf(rate.currency)}`} open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 px-3">
        <p className="text-caption text-muted-foreground">
          Con este tipo cuentan en la línea tus compras en {symbolOf(rate.currency)} de después del último corte, hasta el próximo. Lo de antes viene del estado de cuenta.
        </p>
        <LineField label="Tipo de venta" inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} />
        {save.error && <ErrorAlert>{save.error.message}</ErrorAlert>}
        <PrimaryButton type="button" disabled={!ok} pending={save.isPending}
          onClick={() => save.mutate({ currency: rate.currency, rate: parsed }, { onSuccess: onClose })}>Guardar</PrimaryButton>
        {rate.edited && (
          <button type="button" onClick={() => save.mutate({ currency: rate.currency, rate: null }, { onSuccess: onClose })}
            className="h-11 font-semibold">Volver al tipo del día</button>
        )}
      </div>
    </Sheet>
  );
}

const CHARGES = {
  insurance: { label: "Desgravamen", hint: "Se crea el día de cada corte, por confirmar" },
  membership: { label: "Membresía", hint: "Una vez al año, en su fecha, por confirmar" },
  other: { label: "Otro", hint: "Se crea el día de cada corte, por confirmar" },
} as const;

/** Agregar un cargo del banco que se repite. El monto es el último que te cobraron: cada vez se
 *  sugiere el del último que confirmaste. */
function ChargeSheet({ open, onClose, card, lang }: { open: boolean; onClose: () => void; card: CardDetail; lang: string }) {
  const create = useAddBankCharge(card.account.id);
  const [kind, setKind] = useState<keyof typeof CHARGES>("insurance");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const save = () => {
    setProblem(null);
    const value = parseAmount(amount, lang);
    if (!value || Number(value) <= 0) return setProblem("Escribe el monto del último cargo, como 2.41");
    if (kind === "membership" && !date) return setProblem("Elige cuándo te la cobran");
    if (kind === "other" && !name.trim()) return setProblem("Escribe cómo se llama el cargo");
    create.mutate({ kind, amount: value, date: kind === "membership" ? date : null, name: kind === "other" ? name.trim() : null },
      { onSuccess: onClose });
  };
  return (
    <Sheet title="Cargo del banco" open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 px-3">
        <Segmented label="¿Qué cargo es?" size="sm" value={kind} onChange={(v) => setKind(v as keyof typeof CHARGES)}
          options={Object.entries(CHARGES).map(([value, c]) => ({ value, label: c.label }))} />
        <span className="text-caption text-muted-foreground">{CHARGES[kind].hint}. No cuenta en lo que debes ni en tu línea hasta que lo confirmes.</span>
        {kind === "other" && <LineField label="¿Cómo se llama?" placeholder="Comisión por envío de estado" maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />}
        <LineField label="¿Cuánto fue el último?" inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)} />
        {kind === "membership" && <DateField label="¿Cuándo te la cobran?" value={date} onChange={setDate} min={todayISO()} />}
        {(problem ?? create.error?.message) && <ErrorAlert>{problem ?? create.error?.message}</ErrorAlert>}
        <PrimaryButton type="button" onClick={save} pending={create.isPending}>Agregar cargo</PrimaryButton>
      </div>
    </Sheet>
  );
}

function dueIn(due: string) {
  const n = daysUntil(due, todayISO());
  if (n < 0) return " · ya pasó";
  if (n === 0) return " · es hoy";
  return ` · faltan ${n} ${n === 1 ? "día" : "días"}`;
}

function cycleTitle(c: CardDetail["cycles"][number], open: boolean) {
  if (open) return "Ciclo actual";
  if (c.state === "billed") return "Último estado de cuenta";
  return `Ciclo de ${monthName(c.closing_date.slice(0, 7)).toLowerCase()}`;
}

function cycleLabel(c: CardDetail["cycles"][number]) {
  if (c.state === "current") return `Cierra ${shortDate(c.closing_date)}`;
  if (c.state === "billed") {
    return c.date_due ? `Cerró ${shortDate(c.closing_date)} · pagar antes del ${shortDate(c.date_due)}`
      : `Cerró ${shortDate(c.closing_date)} · sin fecha de pago`;
  }
  return `Cerró ${shortDate(c.closing_date)}`;
}

function plansTotal(d: CardDetail, lang: string) {
  const by = new Map<string, number>();
  for (const p of d.plans) by.set(p.currency, (by.get(p.currency) ?? 0) + Math.round(Number(p.remaining) * 100));
  return [...by].map(([cur, cents]) => formatAmount((cents / 100).toFixed(2), symbolOf(cur), lang)).join(" · ");
}

function ItemRow({ item: i, base, lang }: { item: Item; base: string; lang: string }) {
  const up = Number(i.amount) > 0;   // sube la deuda: una compra, una cuota, un cargo
  const chip = i.kind === "payment"
    ? { bg: "var(--secondary)", fg: "var(--secondary-foreground)", icon: "credit_card" }
    : i.kind === "opening"
      ? { bg: "var(--secondary)", fg: "var(--secondary-foreground)", icon: "flag" }
      : { bg: `var(--cat-${i.counterpart_color ?? 0})`, fg: "var(--on-category)", icon: i.counterpart_icon ?? "category" };
  const hint = i.kind === "installment"
    ? `Cuota ${i.sequence} de ${i.n_installments}${Number(i.interest ?? 0) > 0 ? ` · incluye ${formatNumber(i.interest!, lang)} de interés` : ` · compra del ${shortDate(i.date)}`}`
    : i.kind === "opening"
      ? i.sequence ? `Cuota ${i.sequence} de ${i.n_installments} · de antes de PPM` : "Lo que tocaba pagar al empezar"
      : i.kind === "payment"
        ? `${shortDate(i.date)} · desde ${i.counterpart ?? "varias cuentas"}`
        : `${shortDate(i.date)} · ${i.counterpart ?? "Varias categorías"}`;
  const value = (i.currency === base ? "" : `${symbolOf(i.currency)} `) + formatNumber(i.amount.replace("-", ""), lang);
  return (
    <Link to={`/movimientos/${i.move_id}`} className="flex min-h-[58px] items-center gap-3 border-b border-border">
      <span className="grid size-9 flex-none place-items-center rounded-full" style={{ background: chip.bg, color: chip.fg }}>
        <Icon name={chip.icon} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="flex items-center gap-1.5">
          <span className="truncate font-semibold">{i.kind === "opening" && !i.sequence ? "Saldo inicial" : i.ref}</span>
          {!i.posted && <span className="flex-none rounded-full bg-attention-soft px-2 py-0.5 text-[12px] font-semibold text-attention">Por confirmar</span>}
        </span>
        <span className="text-caption text-muted-foreground">{hint}{i.posted ? "" : " · no cuenta todavía"}</span>
      </span>
      <span className={`flex items-center gap-0.5 text-amount ${up ? "text-expense" : "text-income"}`}>
        <Icon name={up ? "north_east" : "south_west"} className="text-[16px]" />
        {value}
      </span>
    </Link>
  );
}

function MenuItem({ icon, children, onClick, danger }: { icon: string; children: React.ReactNode; onClick: () => void; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} className={`flex min-h-12 items-center gap-2.5 rounded-md px-3 text-left ${danger ? "text-destructive" : ""}`}>
      <Icon name={icon} />{children}
    </button>
  );
}

function RenameSheet({ open, onClose, card }: { open: boolean; onClose: () => void; card: CardDetail }) {
  const update = useUpdateCard(card.account.id);
  const [name, setName] = useState(card.account.name);
  return (
    <Sheet title="Renombrar" open={open} onClose={onClose}>
      <form className="flex flex-col gap-4 px-3"
        onSubmit={(e) => { e.preventDefault(); update.mutate({ name: name.trim(), clear: [] }, { onSuccess: onClose }); }}>
        <LineField label="Nombre" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        {update.error && <ErrorAlert>{update.error.message}</ErrorAlert>}
        <PrimaryButton pending={update.isPending} disabled={!name.trim()}>Guardar</PrimaryButton>
      </form>
    </Sheet>
  );
}

function EditSheet({ open, onClose, card, lang }: { open: boolean; onClose: () => void; card: CardDetail; lang: string }) {
  const update = useUpdateCard(card.account.id);
  const [day, setDay] = useState(String(card.closing_day));
  const [limit, setLimit] = useState(formatNumber(card.credit_limit, lang));
  const [last4, setLast4] = useState(card.last4 ?? "");
  const [brand, setBrand] = useState<string>(card.brand ?? "Visa");
  const [problem, setProblem] = useState<string | null>(null);
  return (
    <Sheet title="Corte, línea y datos" open={open} onClose={onClose}>
      <form className="flex flex-col gap-4 px-3"
        onSubmit={(e) => {
          e.preventDefault();
          const n = Number(day);
          const credit = parseAmount(limit, lang);
          if (!Number.isInteger(n) || n < 1 || n > 31) return setProblem("El día de corte va del 1 al 31");
          if (credit === null) return setProblem("Escribe la línea como 5,000.00");
          if (last4 && !/^\d{4}$/.test(last4)) return setProblem("Los últimos 4 son cuatro dígitos");
          setProblem(null);
          update.mutate({ closing_day: n, credit_limit: credit, brand: brand as CardDetail["brand"], last4: last4 || null,
            clear: last4 ? [] : ["last4"] }, { onSuccess: onClose });
        }}>
        <div className="grid grid-cols-[112px_1fr] gap-4">
          <LineField label="Día de corte" inputMode="numeric" maxLength={2} value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, ""))} />
          <LineField label={`Línea (${symbolOf(card.limit_currency)})`} inputMode="decimal" value={limit} onChange={(e) => setLimit(e.target.value)} />
        </div>
        <Segmented label="Marca" size="sm" value={brand} onChange={setBrand}
          options={["Visa", "Mastercard", "Amex", "Diners"].map((b) => ({ value: b, label: b }))} />
        <LineField label="Últimos 4 (opcional)" inputMode="numeric" maxLength={4} value={last4} onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} />
        {(problem || update.error) && <ErrorAlert>{problem ?? update.error?.message}</ErrorAlert>}
        <PrimaryButton pending={update.isPending}>Guardar</PrimaryButton>
      </form>
    </Sheet>
  );
}

function DueSheet({ open, onClose, card }: { open: boolean; onClose: () => void; card: CardDetail }) {
  const set = useCardDueDate(card.account.id);
  const [due, setDue] = useState(card.date_due ?? "");
  return (
    <Sheet title="¿Hasta cuándo pagas?" open={open} onClose={onClose}>
      <form className="flex flex-col gap-4 px-3"
        onSubmit={(e) => { e.preventDefault(); set.mutate({ closing_date: card.last_closing, date_due: due || null }, { onSuccess: onClose }); }}>
        <p className="text-muted-foreground">
          El ciclo que cerró el {shortDate(card.last_closing)}. En tu estado de cuenta aparece como «Último día de pago».
        </p>
        <DateField label="Último día de pago" min={card.last_closing} value={due || null} onChange={setDue} />
        {set.error && <ErrorAlert>{set.error.message}</ErrorAlert>}
        <PrimaryButton pending={set.isPending} disabled={!due && !card.date_due}>Guardar fecha</PrimaryButton>
      </form>
    </Sheet>
  );
}

function ArchiveSheet({ open, onClose, card }: { open: boolean; onClose: () => void; card: CardDetail }) {
  const navigate = useNavigate();
  const archive = useArchiveAccount(card.account.id);
  const owes = card.status.some((s) => !isZero(s.total_debt));
  return (
    <Sheet title={`¿Archivar «${card.account.name}»?`} open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 px-3">
        <p className="text-muted-foreground">
          {owes
            ? "Para archivarla no tienes que deberle nada: una tarjeta archivada no suma en lo que debes."
            : "Deja de aparecer en tus cuentas. Sus movimientos se quedan en tu historial."}
        </p>
        {archive.error && <ErrorAlert>{archive.error.message}</ErrorAlert>}
        <button type="button" disabled={owes || archive.isPending}
          onClick={() => archive.mutate(undefined, { onSuccess: () => navigate("/cuentas", { replace: true }) })}
          className="flex h-14 items-center justify-center gap-2 rounded-xl bg-destructive font-semibold text-destructive-foreground disabled:opacity-50">
          <Icon name="archive" />Archivar tarjeta
        </button>
        <button type="button" onClick={onClose} className="h-11 text-caption font-semibold text-primary-strong underline">Cancelar</button>
      </div>
    </Sheet>
  );
}
