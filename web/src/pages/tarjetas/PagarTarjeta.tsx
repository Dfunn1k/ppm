// C3 · Pagar tarjeta: un bolsillo a la vez (soles o dólares) y solo desde cuentas de esa moneda. La
// deuda en dólares se paga con dólares: sin dólares, lleva a comprarlos primero. Es una transferencia
// de tu cuenta a la tarjeta; no es un gasto (el gasto se registró al comprar).
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { useAccounts, useCard, useMe, useSaveMove } from "@/api/hooks";
import { SheetSelect } from "@/components/Sheet";
import { ErrorAlert, Icon, PrimaryButton, Screen, Spinner } from "@/components/ui";
import { DateSheet, dateLabel } from "@/components/DateSheet";
import { shortDate, todayISO } from "@/lib/dates";
import { CURRENCY_NAME, formatAmount, formatNumber, parseAmount, symbolOf } from "@/lib/money";
import { useBack } from "@/lib/transitions";

export function PagarTarjeta() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const back = useBack();
  const me = useMe().data;
  const card = useCard(id);
  const overview = useAccounts().data;
  const save = useSaveMove();
  const [search] = useSearchParams();
  const [side, setSide] = useState<string | null>(search.get("moneda"));
  const [amount, setAmount] = useState<string | null>(null);
  const [accountId, setAccountId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [dateOpen, setDateOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!me?.currency || card.isPending || !overview) return <Spinner />;
  if (card.isError) return <Screen><ErrorAlert>{card.error.message}</ErrorAlert></Screen>;

  const d = card.data;
  const lang = me.lang ?? "es-PE";
  const money = (v: string, cur: string) => formatAmount(v, symbolOf(cur), lang);
  const sides = d.status.filter((s) => s.currency === me.currency || Number(s.total_debt) > 0);
  const current = sides.find((s) => s.currency === side) ?? sides.find((s) => Number(s.to_pay) > 0) ?? sides[0]!;
  const cur = current.currency;
  const name = CURRENCY_NAME[cur] ?? cur;
  const dueNow = Number(current.to_pay) > 0 ? current.to_pay : null;
  const typed = amount ?? formatNumber(dueNow ?? current.total_debt, lang);
  const value = parseAmount(typed || "", lang);
  // Primero los bancos: una tarjeta se paga casi siempre desde el banco
  const sources = [...overview.have].filter((a) => ["cash", "bank"].includes(a.kind) && a.currency === cur)
    .sort((x, y) => Number(x.kind !== "bank") - Number(y.kind !== "bank"));
  const funded = sources.filter((a) => Number(a.balances[0]?.amount ?? "0") > 0);
  const source = sources.find((a) => String(a.id) === accountId) ?? funded[0] ?? sources[0];
  const noMoney = funded.length === 0;

  const pick = (v: string) => setAmount(formatNumber(v, lang));
  const chips = [
    ...(dueNow ? [{ label: `Lo del mes · ${money(dueNow, cur)}`, value: dueNow }] : []),
    { label: `Toda la deuda · ${money(current.total_debt, cur)}`, value: current.total_debt },
  ];
  const hint = value === current.total_debt
    ? "Incluye lo que falta facturar y las cuotas que vienen. La línea queda libre."
    : dueNow
      ? `Cubre el estado de cuenta del ${shortDate(d.last_closing)}. Si pagas menos, lo que falte sigue en «a pagar».`
      : "Lo que pagues baja lo que debes en la tarjeta.";

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!source) return setProblem(`Elige de qué cuenta en ${name} sale`);
    if (!value || Number(value) <= 0) return setProblem("Escribe un monto mayor que cero");
    save.mutate(
      { kind: "transfer", account_id: source.id, to_account_id: id, amount: value, date, currency: cur, ref: null, pending: false,
        lines: [], splits: [], later: false },
      { onSuccess: () => navigate(`/tarjetas/${id}`, { replace: true }) },
    );
  };

  return (
    <Screen className="pt-4">
      <div className="-mx-2.5 flex items-center justify-between">
        <button type="button" aria-label="Cerrar sin pagar" onClick={back} className="grid size-11 place-items-center rounded-full">
          <Icon name="close" className="text-[24px]" />
        </button>
        <span className="pr-2.5 text-label text-muted-foreground">Pagar tarjeta</span>
      </div>
      <form noValidate onSubmit={submit} className="flex flex-1 flex-col">
        <h1 className="mt-2 text-title-hero">{d.account.name}</h1>
        <span className="mt-1 text-caption text-muted-foreground">
          Ciclo que cerró el {shortDate(d.last_closing)}{d.date_due ? ` · pagar antes del ${shortDate(d.date_due)}` : ""}
        </span>

        {sides.length > 1 && (
          <div role="radiogroup" aria-label="Qué parte pagas" className="mt-5 grid gap-1 rounded-md bg-muted p-[3px]"
            style={{ gridTemplateColumns: `repeat(${sides.length}, minmax(0, 1fr))` }}>
            {sides.map((s) => (
              <button key={s.currency} type="button" role="radio" aria-checked={s.currency === cur}
                onClick={() => { setSide(s.currency); setAmount(null); setAccountId(""); }}
                className={`flex h-[52px] flex-col items-center justify-center rounded-[8px] ${s.currency === cur ? "bg-card shadow-sm" : ""}`}>
                <span className="text-[14px] font-semibold">{(CURRENCY_NAME[s.currency] ?? s.currency).replace(/^./, (c) => c.toUpperCase())}</span>
                <span className="text-caption text-muted-foreground tabular-nums">Toca {money(Number(s.to_pay) > 0 ? s.to_pay : "0.00", s.currency)}</span>
              </button>
            ))}
          </div>
        )}

        {noMoney ? (
          <div role="alert" className="mt-5 flex flex-col gap-3 rounded-[12px] bg-attention-soft p-3.5 text-attention">
            <span className="flex gap-2 text-caption">
              <Icon name="currency_exchange" />
              <span><b>No tienes una cuenta en {name} con plata.</b> La deuda en {name} se paga con {name}: cómpralos primero y vuelve a pagar.</span>
            </span>
            <Link to="/registrar?tipo=transfer" className="flex h-11 items-center justify-center rounded-xl border border-current font-semibold">
              Comprar {name}
            </Link>
          </div>
        ) : (
          <>
            <label className="mt-5 flex flex-col gap-0.5 text-caption font-semibold">
              ¿Cuánto pagas?
              <span className="flex items-baseline gap-2 border-b-2 border-input-line">
                <span aria-hidden="true" className="text-[26px] leading-8 font-semibold text-muted-foreground">{symbolOf(cur)}</span>
                <input inputMode="decimal" placeholder="0.00" value={typed} onChange={(e) => setAmount(e.target.value)}
                  className="h-16 min-w-0 flex-1 border-0 bg-transparent p-0 text-[44px] leading-[52px] font-semibold tracking-[-0.02em] tabular-nums" />
              </span>
            </label>
            <div className="mt-3 flex flex-wrap gap-2">
              {chips.map((c) => {
                const on = value === c.value;
                return (
                  <button key={c.label} type="button" aria-pressed={on} onClick={() => pick(c.value)}
                    className={`flex h-9 items-center rounded-full border px-3 text-caption font-semibold tabular-nums ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                    {c.label}
                  </button>
                );
              })}
            </div>
            <span className="mt-2 text-caption text-muted-foreground">{hint}</span>

            <div className="mt-4">
              <SheetSelect label={`Sale de · solo cuentas en ${name}`} sheetTitle="¿De qué cuenta sale?"
                value={source ? String(source.id) : ""} onChange={setAccountId}
                options={sources.map((a) => ({ value: String(a.id), label: a.name,
                  hint: formatAmount(a.balances[0]?.amount ?? "0.00", symbolOf(cur), lang) }))} />
            </div>
            <div className="mt-3 flex">
              <button type="button" aria-expanded={dateOpen} onClick={() => setDateOpen(!dateOpen)}
                className="flex h-9 items-center gap-1 rounded-full border border-border px-3 text-caption font-semibold">
                <Icon name="event" className="text-[18px]" />{dateLabel(date)}
              </button>
            </div>
            <DateSheet open={dateOpen} onClose={() => setDateOpen(false)} title="¿Cuándo pagaste?" value={date} onChange={setDate} max={todayISO()} />
          </>
        )}

        <div className="min-h-6 flex-1" />
        <div className="flex flex-col gap-3">
          {(problem || save.error) && <ErrorAlert>{problem ?? save.error?.message}</ErrorAlert>}
          <PrimaryButton pending={save.isPending} disabled={noMoney}>
            {noMoney || !value ? "Registrar pago" : `Pagar ${money(value, cur)}`}
          </PrimaryButton>
        </div>
      </form>
    </Screen>
  );
}
