// C3 · Pagar tarjeta: un bolsillo a la vez (soles o dólares) y solo desde cuentas de esa moneda. La
// deuda en dólares se paga con dólares: sin dólares, lleva a comprarlos primero. Es una transferencia
// de tu cuenta a la tarjeta; no es un gasto (el gasto se registró al comprar).
import { IconButton } from "@/components/Button";
import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";

import { useAccounts, useCard, useMe, useSaveMove } from "@/api/hooks";
import { SheetSelect, SEGMENTS, segment } from "@/components/Sheet";
import { ErrorAlert, Facts, Icon, PrimaryButton, Screen, Spinner } from "@/components/ui";
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
  // Como en la app del banco: «Total del mes» u «Otro monto». Sin estado de cuenta por pagar, solo «Otro monto».
  const [mode, setMode] = useState<"month" | "other" | null>(null);
  const [amount, setAmount] = useState("");
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
  const chosen = dueNow ? mode ?? "month" : "other";
  const value = chosen === "month" ? dueNow : parseAmount(amount, lang);
  // Primero los bancos: una tarjeta se paga casi siempre desde el banco
  const sources = [...overview.have].filter((a) => ["cash", "bank"].includes(a.kind) && a.currency === cur)
    .sort((x, y) => Number(x.kind !== "bank") - Number(y.kind !== "bank"));
  const funded = sources.filter((a) => Number(a.balances[0]?.amount ?? "0") > 0);
  const source = sources.find((a) => String(a.id) === accountId) ?? funded[0] ?? sources[0];
  const noMoney = funded.length === 0;

  const hint = chosen === "month"
    ? `Cubre el estado de cuenta del ${shortDate(d.last_closing)}.`
    : value === current.total_debt
      ? "Incluye lo que falta facturar y las cuotas que vienen. La línea queda libre."
      : dueNow
        ? "Si pagas menos que el total del mes, lo que falte sigue por pagar."
        : "Lo que pagues baja lo que debes en la tarjeta.";
  const options = [
    { key: "month" as const, label: "Total del mes", help: dueNow ? null : "No hay estado de cuenta por pagar", disabled: !dueNow },
    { key: "other" as const, label: "Otro monto", help: null, disabled: false },
  ];

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
        <IconButton icon="close" label="Cerrar sin pagar" onClick={back} />
        <span className="pr-2.5 text-label text-muted-foreground">Pagar tarjeta</span>
      </div>
      <form noValidate onSubmit={submit} className="flex flex-1 flex-col">
        <h1 className="mt-2 text-title-hero">{d.account.name}</h1>
        <Facts className="mt-1" items={[["Ciclo", `Cerró el ${shortDate(d.last_closing)}`], d.date_due && ["Pagar antes del", shortDate(d.date_due)]]} />

        {sides.length > 1 && (
          <div role="radiogroup" aria-label="Qué parte pagas" className={`mt-5 ${SEGMENTS}`}
            style={{ gridTemplateColumns: `repeat(${sides.length}, minmax(0, 1fr))` }}>
            {sides.map((s) => (
              <button key={s.currency} type="button" role="radio" aria-checked={s.currency === cur}
                onClick={() => { setSide(s.currency); setMode(null); setAmount(""); setAccountId(""); }}
                className={`${segment(s.currency === cur)} min-h-row-sm content-center gap-0`}>
                <span className="text-body-sm font-semibold">{(CURRENCY_NAME[s.currency] ?? s.currency).replace(/^./, (c) => c.toUpperCase())}</span>
                <span className="text-caption text-muted-foreground tabular-nums">Toca {money(Number(s.to_pay) > 0 ? s.to_pay : "0.00", s.currency)}</span>
              </button>
            ))}
          </div>
        )}

        {noMoney ? (
          <div role="alert" className="mt-5 flex flex-col gap-3 rounded-lg bg-attention-soft p-4 text-attention">
            <span className="flex gap-2 text-caption">
              <Icon name="currency_exchange" />
              <span><b>No tienes una cuenta en {name} con plata.</b> La deuda en {name} se paga con {name}: cómpralos primero y vuelve a pagar.</span>
            </span>
            <Link to="/registrar?tipo=transfer" className="flex min-h-control items-center justify-center rounded-lg border border-current font-semibold">
              Comprar {name}
            </Link>
          </div>
        ) : (
          <>
            <span id="cuanto" className="mt-5 text-caption font-semibold">¿Cuánto pagas?</span>
            <div role="radiogroup" aria-labelledby="cuanto" className="mt-2 flex flex-col overflow-hidden rounded-lg border border-border bg-card">
              {options.map((o, i) => {
                const on = chosen === o.key;
                return (
                  <button key={o.key} type="button" role="radio" aria-checked={on} disabled={o.disabled} onClick={() => setMode(o.key)}
                    className={`flex min-h-row-option items-center gap-3 px-4 py-2 text-left disabled:opacity-50 ${i > 0 ? "border-t border-border" : ""} ${on ? "bg-muted" : "enabled:hover:bg-muted"}`}>
                    <Icon name={on ? "radio_button_checked" : "radio_button_unchecked"} fill={on} size="md" className={on ? "" : "text-muted-foreground"} />
                    <span className="flex flex-1 flex-col">
                      <span className="font-semibold">{o.label}</span>
                      {o.help && <span className="text-caption text-muted-foreground">{o.help}</span>}
                    </span>
                  </button>
                );
              })}
            </div>
            {chosen === "month" ? (
              <span className="mt-3 text-amount-input">{money(dueNow!, cur)}</span>
            ) : (
              <label className="mt-3 flex items-baseline gap-2 border-b-2 border-input-line">
                <span aria-hidden="true" className="text-amount-input-symbol font-semibold text-muted-foreground">{symbolOf(cur)}</span>
                <input inputMode="decimal" placeholder="0.00" aria-label="Otro monto" value={amount} onChange={(e) => setAmount(e.target.value)}
                  autoFocus={mode === "other"}
                  className="h-16 min-w-0 flex-1 border-0 bg-transparent p-0 text-amount-input" />
              </label>
            )}
            <span className="mt-2 text-caption text-muted-foreground">{hint}</span>
            {chosen === "other" && Number(current.total_debt) > 0 && (
              <button type="button" onClick={() => setAmount(formatNumber(current.total_debt, lang))}
                className="mt-1.5 flex min-h-control items-center gap-1 self-start text-body-sm font-semibold">
                <Icon name="done_all" />Pagar toda la deuda
              </button>
            )}

            <div className="mt-4">
              <SheetSelect label="Sale de" hint={`Solo cuentas en ${name}`} sheetTitle="¿De qué cuenta sale?"
                value={source ? String(source.id) : ""} onChange={setAccountId}
                options={sources.map((a) => ({ value: String(a.id), label: a.name,
                  hint: formatAmount(a.balances[0]?.amount ?? "0.00", symbolOf(cur), lang) }))} />
            </div>
            <div className="mt-3 flex">
              <button type="button" aria-expanded={dateOpen} onClick={() => setDateOpen(!dateOpen)}
                className="hit-area flex h-9 items-center gap-1 rounded-full border border-border px-3 text-caption font-semibold hover:bg-muted">
                <Icon name="event" />{dateLabel(date)}
              </button>
            </div>
            <DateSheet open={dateOpen} onClose={() => setDateOpen(false)} title="¿Cuándo pagaste?" value={date} onChange={setDate} max={todayISO()} booked />
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
