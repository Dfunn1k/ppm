// C3 · Cuotas de antes de PPM: una compra en cuotas que ya venías pagando. Se anotan solo las cuotas
// que todavía no te facturan (la del último estado de cuenta ya está en lo que toca pagar). No es un
// gasto de este mes: queda como lo que debes desde antes y se factura desde el próximo corte.
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { useCard, useCardInstallments, useMe } from "@/api/hooks";
import { RateField, useRateInput } from "@/components/RateField";
import { Segmented } from "@/components/Sheet";
import { ErrorAlert, Icon, LineField, PrimaryButton, Screen, Spinner } from "@/components/ui";
import { installmentClosings } from "@/lib/cards";
import { shortDate, todayISO } from "@/lib/dates";
import { CURRENCY_NAME, formatAmount, multiply, parseAmount, symbolOf } from "@/lib/money";
import { FormHeader } from "@/pages/cuentas/Nueva";

export function CuotasAntes() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const me = useMe().data;
  const card = useCard(id);
  const add = useCardInstallments(id);
  const [what, setWhat] = useState("");
  const [currency, setCurrency] = useState(me?.currency ?? "PEN");
  const [each, setEach] = useState("");
  const [n, setN] = useState(4);
  const [problem, setProblem] = useState<string | null>(null);
  const base = me?.currency ?? "PEN";
  const rate = useRateInput(currency, base, todayISO(), "sell");
  if (!me?.currency || card.isPending) return <Spinner />;
  if (card.isError) return <Screen><ErrorAlert>{card.error.message}</ErrorAlert></Screen>;

  const d = card.data;
  const lang = me.lang ?? "es-PE";
  const foreign = currency !== base;
  const value = parseAmount(each || "", lang);
  const closings = installmentClosings(d.next_closing, n, d.closing_day);
  const total = value ? multiply(value, String(n)) : null;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!what.trim()) return setProblem("Escribe qué compraste, como Laptop");
    if (!value || Number(value) <= 0) return setProblem("Escribe el capital de cada cuota");
    if (foreign && !(Number(rate.value) > 0)) return setProblem("Escribe el tipo de cambio, como 3.762");
    add.mutate({ currency, each: value, n, ref: what.trim(), rate: foreign ? rate.value.trim() : null },
      { onSuccess: () => navigate(`/tarjetas/${id}`, { replace: true }) });
  };

  const step = "grid size-9 place-items-center rounded-full border border-border";
  return (
    <Screen className="pt-4">
      <FormHeader back={`/tarjetas/${id}`} label={d.account.name} />
      <form noValidate onSubmit={submit} className="flex flex-1 flex-col">
        <h1 className="mt-2 text-title-hero">Cuotas de antes de PPM</h1>
        <p className="mt-3 text-muted-foreground">
          Una compra en cuotas que ya venías pagando. Anota solo las cuotas que todavía no te facturan: la de tu último
          estado de cuenta ya está en lo que toca pagar.
        </p>

        <div className="mt-5 flex flex-col gap-5">
          <LineField label="¿Qué compraste?" placeholder="Laptop" maxLength={120} value={what} onChange={(e) => setWhat(e.target.value)} />
          {me.currencies.length > 1 && (
            <Segmented label="Moneda" size="sm" value={currency} onChange={setCurrency}
              options={me.currencies.map((c) => ({ value: c, label: `${(CURRENCY_NAME[c] ?? c).replace(/^./, (x) => x.toUpperCase())} · ${symbolOf(c)}` }))} />
          )}
          <div className="grid grid-cols-[1fr_140px] items-end gap-4">
            <LineField label="¿Cuánto es el capital de cada cuota?" inputMode="decimal" placeholder="0.00" value={each} onChange={(e) => setEach(e.target.value)}
              className="text-[22px] font-semibold tabular-nums" />
            <div className="flex flex-col gap-1.5">
              <span id="faltan" className="text-caption font-semibold">¿Cuántas faltan?</span>
              <div role="group" aria-labelledby="faltan" className="flex h-11 items-center justify-between border-b-2 border-input-line">
                <button type="button" aria-label="Una menos" onClick={() => setN(Math.max(1, n - 1))} className={step}><Icon name="remove" /></button>
                <span className="text-[22px] font-semibold tabular-nums">{n}</span>
                <button type="button" aria-label="Una más" onClick={() => setN(Math.min(59, n + 1))} className={step}><Icon name="add" /></button>
              </div>
            </div>
          </div>
          {foreign && <RateField input={rate} currency={currency} side="sell" />}
        </div>

        {total && (
          <div role="status" className="mt-5 flex flex-col gap-1 rounded-[12px] bg-muted p-3.5 tabular-nums">
            <span className="font-semibold">Le debes {formatAmount(total, symbolOf(currency), lang)} al banco{what.trim() ? ` por ${what.trim().toLowerCase()}` : ""}</span>
            <span className="text-caption text-muted-foreground">
              {n === 1 ? `Una cuota de ${formatAmount(value!, symbolOf(currency), lang)}, en el corte del ${shortDate(closings[0]!)}.`
                : `${n} cuotas de ${formatAmount(value!, symbolOf(currency), lang)}: la primera llega en el corte del ${shortDate(closings[0]!)} y la última el ${shortDate(closings.at(-1)!)}.`}
            </span>
          </div>
        )}
        <span className="mt-2.5 text-caption text-muted-foreground">Solo el capital, sin intereses: es lo que ocupa tu línea. No cuenta como gasto de este mes: la compra fue antes de PPM. Tus cuentas no se mueven.</span>

        <div className="min-h-6 flex-1" />
        <div className="flex flex-col gap-3">
          {(problem || add.error) && <ErrorAlert>{problem ?? add.error?.message}</ErrorAlert>}
          <PrimaryButton pending={add.isPending}>{n === 1 ? "Agregar 1 cuota" : `Agregar ${n} cuotas`}</PrimaryButton>
        </div>
      </form>
    </Screen>
  );
}
