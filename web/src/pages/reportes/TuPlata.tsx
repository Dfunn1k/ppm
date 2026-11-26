// Flujo › Tu plata: el puente de caja. Con cuánto empezaste en efectivo y bancos, lo que entró y salió
// (según con qué se movió: pagar la tarjeta, un préstamo, prestar…) y con cuánto terminaste. Cada línea
// abre su hoja con sus movimientos. Debajo, «¿Por qué no subió lo mismo?»: una cascada que va de lo que
// subió tu plata a lo que creció tu patrimonio, con cada diferencia tocable para ver su detalle.
import { useState } from "react";
import { Link } from "react-router";

import { type CashLine, type FlowReport, useFlowMoves } from "@/api/hooks";
import { Sheet } from "@/components/Sheet";
import { SectionHeading } from "@/components/SectionHeading";
import { ErrorAlert, Icon } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { isNegative, isZero, subtract } from "@/lib/money";
import { monthName, monthOnly } from "@/lib/months";
import { cn } from "@/lib/utils";

import { useMoney } from "./common";

type Cash = FlowReport["cash"];
type Diff = Cash["diffs"][number];
type Kind = CashLine["kind"];

const LINES: Record<Kind, { in: string; out: string; icon: string }> = {
  income: { in: "Ingresos que entraron", out: "Devolviste ingresos", icon: "payments" },
  expense: { in: "Te devolvieron gastos", out: "Gastos pagados con tu plata", icon: "shopping_bag" },
  card: { in: "Sacaste plata de tarjetas", out: "Pagaste tarjetas", icon: "credit_card" },
  loan: { in: "Te desembolsaron préstamos", out: "Pagaste préstamos", icon: "account_balance" },
  receivable: { in: "Te pagaron lo que te debían", out: "Le prestaste a alguien", icon: "handshake" },
  payable: { in: "Te prestaron", out: "Pagaste lo que debías", icon: "handshake" },
  custody: { in: "Te dieron plata para guardar", out: "Devolviste plata que guardabas", icon: "savings" },
  prepaid: { in: "Te devolvieron un adelanto", out: "Pagaste por adelantado", icon: "hourglass_top" },
  unearned: { in: "Te pagaron por adelantado", out: "Devolviste un cobro adelantado", icon: "hourglass_bottom" },
  suspense: { in: "Entró sin clasificar", out: "Salió sin clasificar", icon: "help" },
  opening: { in: "Saldos de antes de PPM", out: "Saldos de antes de PPM", icon: "history" },
  other: { in: "Entró de otras cuentas", out: "Salió a otras cuentas", icon: "swap_horiz" },
  fx: { in: "Subió el tipo de cambio", out: "Bajó el tipo de cambio", icon: "currency_exchange" },
};

/** La fila de la diferencia: [si suma a tu patrimonio, si resta]. */
const DIFFS: Record<Kind, [string, string]> = {
  income: ["Ingresos", "Ingresos"],
  expense: ["Gastos", "Gastos"],
  card: ["Debes menos en tarjetas", "Debes más en tarjetas"],
  loan: ["Debes menos en préstamos", "Debes más en préstamos"],
  receivable: ["Te deben más", "Te deben menos"],
  payable: ["Debes menos a personas", "Debes más a personas"],
  custody: ["Guardas menos plata de otros", "Guardas más plata de otros"],
  prepaid: ["Pagado por adelantado", "Se usó lo pagado por adelantado"],
  unearned: ["Ya ganaste lo cobrado por adelantado", "Cobrado por adelantado"],
  suspense: ["Por clasificar", "Por clasificar"],
  opening: ["Saldos de antes de PPM", "Saldos de antes de PPM"],
  other: ["Otras cuentas", "Otras cuentas"],
  // fx resta cuando tu plata en otra moneda subió: subió tu plata, pero no tu patrimonio de este periodo
  fx: ["Bajó el tipo de cambio", "Subió el tipo de cambio"],
};

const lineLabel = (l: Pick<CashLine, "kind" | "direction">) => LINES[l.kind][l.direction];

/** «2026-11-01» → «1 de noviembre». */
function dayWords(iso: string) {
  return `${Number(iso.slice(8, 10))} de ${monthOnly(iso.slice(0, 7)).toLowerCase()}`;
}

function nextDay(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}

export function TuPlata({ cash, period, year, today }: { cash: Cash; period: string; year: boolean; today: string }) {
  const money = useMoney();
  const [open, setOpen] = useState<CashLine | null>(null);
  const signed = (v: string) => `${Number(v) > 0 ? "+" : "−"} ${money(v.replace("-", ""))}`;
  const rose = subtract(cash.end, cash.start);
  const note = (l: CashLine) => {
    if (l.kind === "expense" && l.other && Number(l.other) > 0)
      return `Otros ${money(l.other)} se pagaron con tarjeta u otras cuentas: salen de tu plata cuando los pagas`;
    if (l.kind === "loan" && l.direction === "out") return "Solo el capital: el interés ya va en gastos";
    if (l.kind === "fx") return "Lo que tienes en otra moneda, al tipo del día";
    return null;
  };

  return (
    <>
      <section id="tu-plata" aria-label="Tu plata" className="mt-6 flex scroll-mt-4 flex-col">
        <SectionHeading action={<span className="text-label text-muted-foreground">Efectivo y bancos</span>}>
          Tu plata en {year ? period : monthOnly(period).toLowerCase()}
        </SectionHeading>
        <div className="flex items-baseline justify-between gap-3 py-2.5">
          <span>Empezaste el {dayWords(nextDay(cash.start_date))} con</span>
          <span className="font-semibold tabular-nums">{money(cash.start)}</span>
        </div>
        {cash.lines.map((l) => {
          const sub = note(l);
          const body = (
            <>
              <Icon name={l.kind === "receivable" && l.direction === "out" ? "person_add" : LINES[l.kind].icon} size="md" className="text-muted-foreground" />
              <span className="min-w-0">{lineLabel(l)}</span>
              <span className={cn("font-medium tabular-nums", Number(l.amount) > 0 && "text-income")}>{signed(l.amount)}</span>
              {l.kind === "fx" ? <span /> : <Icon name="chevron_right" size="sm" className="text-muted-foreground" />}
              {sub && <span className="col-start-2 col-end-4 -mt-0.5 text-caption text-muted-foreground">{sub}</span>}
            </>
          );
          const cls = "row-bleed grid min-h-row-sm grid-cols-cash-line items-center gap-x-2.5 rounded-xl border-b border-border py-1.5 text-left";
          return l.kind === "fx"
            ? <div key={`${l.kind}-${l.direction}`} className={cls}>{body}</div>
            : <button key={`${l.kind}-${l.direction}`} type="button" onClick={() => setOpen(l)} className={cn(cls, "hover:bg-muted/60")}>{body}</button>;
        })}
        <div className="flex items-baseline justify-between gap-3 border-b-2 border-foreground py-2.5">
          <span className="font-semibold">{cash.end_date === today ? `Hoy, ${dayWords(cash.end_date)}, tienes` : `Terminaste el ${dayWords(cash.end_date)} con`}</span>
          <span className="font-display text-amount-xl font-extrabold tabular-nums">{money(cash.end)}</span>
        </div>
        <span className="mt-1.5 text-caption text-muted-foreground">
          {isZero(rose) ? "Quedó igual." : `${isNegative(rose) ? "Bajó" : "Subió"} ${money(rose.replace("-", ""))}.`} Es lo que suman tus cuentas de efectivo y bancos, igual que en el Inicio.
          {cash.lines.some((l) => l.kind !== "fx") && " Toca una línea para ver sus movimientos."}
        </span>
      </section>

      <Why cash={cash} />

      <Sheet title={open ? lineLabel(open) : ""} open={open !== null} onClose={() => setOpen(null)}>
        {open && <LineMoves period={period} line={open} />}
      </Sheet>
    </>
  );
}

function LineMoves({ period, line }: { period: string; line: CashLine }) {
  const money = useMoney();
  const moves = useFlowMoves(period, line);
  const year = period.length === 4;
  if (moves.isError) return <ErrorAlert>{moves.error.message}</ErrorAlert>;
  if (!moves.data) return <p className="py-6 text-center text-caption text-muted-foreground">Cargando…</p>;
  const n = moves.data.reduce((a, m) => a + m.count, 0);
  return (
    <div className="flex flex-col">
      <span className="text-caption text-muted-foreground">{n === 1 ? "1 movimiento" : `${n} movimientos`}{year && ", mes por mes"}</span>
      <ul className="mt-1 flex flex-col">
        {moves.data.map((m) => {
          const amount = money(m.amount.replace("-", ""));
          return m.move_id === null ? (
            <li key={m.ref} className="flex min-h-row-sm items-center justify-between gap-3 border-b border-border">
              <span className="flex flex-col"><span className="font-semibold">{monthName(m.ref)}</span>
                <span className="text-caption text-muted-foreground">{m.count === 1 ? "1 movimiento" : `${m.count} movimientos`}</span></span>
              <span className="font-medium tabular-nums">{amount}</span>
            </li>
          ) : (
            <li key={m.move_id} className="relative flex min-h-row-option items-center gap-3 border-b border-border">
              <span className="flex min-w-0 flex-1 flex-col">
                <Link to={`/movimientos/${m.move_id}`} className="truncate font-semibold after:absolute after:inset-0">{m.ref}</Link>
                <span className="text-caption text-muted-foreground">{shortDate(m.date)}{m.accounts && `, ${m.accounts}`}</span>
              </span>
              <span className="font-medium tabular-nums">{amount}</span>
            </li>
          );
        })}
      </ul>
      <div className="flex items-baseline justify-between py-3">
        <span className="font-semibold">Total</span>
        <span className="font-semibold tabular-nums">{money(Math.abs(moves.data.reduce((a, m) => a + Number(m.amount), 0)))}</span>
      </div>
    </div>
  );
}

/** La cascada: de lo que subió tu plata, fila por fila, a lo que creció tu patrimonio. */
function Why({ cash }: { cash: Cash }) {
  const money = useMoney();
  const [sel, setSel] = useState<number | null>(null);
  if (cash.diffs.length === 0) return null;
  const abs = (v: number) => money(Math.abs(v));
  const plata = Number(cash.end) - Number(cash.start);
  const pat = Number(cash.patrimony);
  let cum = plata;
  const spans: [number, number][] = [[0, plata]];
  for (const d of cash.diffs) { spans.push([cum, cum + Number(d.amount)]); cum += Number(d.amount); }
  spans.push([0, pat]);
  const lo = Math.min(0, ...spans.flat()), hi = Math.max(...spans.flat());
  const scale = hi - lo || 1;
  const bar = ([a, b]: [number, number]) => ({
    marginLeft: `${((Math.min(a, b) - lo) / scale) * 100}%`,
    width: `${Math.max((Math.abs(b - a) / scale) * 100, 0.6)}%`,
  });
  const sub = (d: Diff) => {
    const paid = Number(d.paid ?? 0), other = Number(d.other ?? 0);
    if (d.kind === "card" && paid > 0) return other > 0 ? `Pagaste ${money(d.paid!)} y compraste ${money(d.other!)}` : `Pagaste ${money(d.paid!)}`;
    if (d.kind === "receivable" && (paid > 0 || other > 0)) {
      if (paid > 0 && other > 0) return `Prestaste ${money(d.other!)} y te pagaron ${money(d.paid!)}`;
      return paid > 0 ? `Te pagaron ${money(d.paid!)}` : `Prestaste ${money(d.other!)}`;
    }
    if (d.kind === "fx") return "Lo que tienes en otra moneda cambió de valor; no es ingreso ni gasto";
    return null;
  };
  const detail = (d: Diff, v: number) => {
    const x = abs(v), up = v > 0;
    switch (d.kind) {
      case "card": case "loan": return up ? `Debes ${x} menos` : `Debes ${x} más`;
      case "receivable": return up ? `Te debe ${x} más` : `Te debe ${x} menos`;
      case "payable": return up ? `Le debes ${x} menos` : `Le debes ${x} más`;
      case "custody": return up ? `Le guardas ${x} menos` : `Le guardas ${x} más`;
      default: return `${up ? "+" : "−"} ${x}`;
    }
  };
  const diff = pat - plata;
  const rows = [
    { label: plata >= 0 ? "Tu plata en cuentas subió" : "Tu plata en cuentas bajó", amount: abs(plata), sub: "Efectivo y bancos", color: "bg-cat-8", tone: "", details: [] as { name: string; text: string }[], strong: false },
    ...cash.diffs.map((d) => {
      const v = Number(d.amount);
      return {
        label: DIFFS[d.kind][v > 0 ? 0 : 1], amount: `${v > 0 ? "+" : "−"} ${abs(v)}`, sub: sub(d),
        color: v > 0 ? "bg-income" : "bg-expense", tone: v > 0 ? "text-income" : "text-expense",
        details: d.details.map((x) => ({ name: x.name, text: detail(d, Number(x.amount)) })), strong: false,
      };
    }),
    { label: pat >= 0 ? "Creció tu patrimonio" : "Bajó tu patrimonio", amount: abs(pat), sub: "Lo que entró menos lo que gastaste", color: "bg-foreground", tone: "", details: [], strong: true },
  ];

  return (
    <section aria-label="Por qué no subió lo mismo" className="mt-6 flex flex-col">
      <SectionHeading>¿Por qué no subió lo mismo?</SectionHeading>
      <p className="mt-2.5 mb-1 text-body-sm text-muted-foreground">
        {diff >= 0
          ? `La diferencia, ${abs(diff)}, no se perdió: es tuya, solo que no está en tus cuentas.`
          : `Tu plata subió ${abs(diff)} más que tu patrimonio: parte es plata que todavía debes.`}
        {rows.some((r) => r.details.length > 0) && " Toca una fila para ver de dónde sale."}
      </p>
      <ul className="flex flex-col">
        {rows.map((r, i) => {
          const opened = sel === i && r.details.length > 0;
          const inner = (
            <>
              <span className="flex items-baseline justify-between gap-3">
                <span className={cn(r.strong && "font-bold")}>{r.label}</span>
                <span className={cn("font-semibold tabular-nums", r.tone)}>{r.amount}</span>
              </span>
              <span className="block h-2.5 overflow-hidden rounded-xs bg-muted" aria-hidden="true">
                <span className={cn("block h-2.5 rounded-xs", r.color)} style={bar(spans[i]!)} />
              </span>
              {r.sub && <span className="text-caption text-muted-foreground">{r.sub}</span>}
            </>
          );
          const cls = cn("row-bleed flex flex-col gap-1 rounded-xl border-b border-border py-2.5 text-left",
            sel !== null && sel !== i && "opacity-45", sel === i && "bg-muted");
          return (
            <li key={i}>
              {r.details.length > 0
                ? <button type="button" aria-expanded={opened} onClick={() => setSel(sel === i ? null : i)} className={cls}>{inner}</button>
                : <div className={cls}>{inner}</div>}
              {opened && (
                <ul className="my-1 mb-2 flex flex-col gap-2 rounded-lg border border-border bg-card px-3 py-2.5">
                  {r.details.map((x) => (
                    <li key={x.name} className="flex flex-col"><span className="text-body-sm font-semibold">{x.name}</span>
                      <span className="text-caption text-muted-foreground">{x.text}</span></li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
