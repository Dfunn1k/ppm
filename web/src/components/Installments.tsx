// En cuotas, igual al gastar con la tarjeta y al prestarla: cuántas, de cuánto cada una (la del
// cronograma del banco) y en qué cortes llegan. Lo que pasa del precio son intereses.
import { installmentClosings } from "@/lib/cards";
import { shortDate } from "@/lib/dates";
import { formatAmount, parseAmount, symbolOf } from "@/lib/money";

import { Icon } from "./ui";

/** En cuotas: cuántas, de cuánto cada una (la del cronograma del banco) y en qué cortes llegan. El
 *  gasto cuenta completo el día de la compra; lo que pasa del precio son intereses y cuentan ese día. */
export function Installments({ n, setN, cuota, setCuota, total, currency, date, closingDay, category, lang, who }: {
  n: number; setN: (n: number) => void; cuota: string; setCuota: (v: string) => void; total: string | null;
  currency: string; date: string; closingDay: number | null; category: string | null; lang: string; who?: string;
}) {
  const step = "grid size-9 place-items-center rounded-full border border-border";
  const cents = total ? Math.round(Number(total) * 100) : 0;
  const plain = Math.round(cents / n);
  const typed = cuota.trim() ? Math.round(Number(parseAmount(cuota, lang) ?? "NaN") * 100) : null;
  const each = typed && typed > 0 ? typed : plain;
  const debt = typed && typed > 0 ? typed * n : cents;
  const interest = debt - cents;
  const last = typed ? each : cents - plain * (n - 1);
  const money = (c: number) => formatAmount((c / 100).toFixed(2), symbolOf(currency), lang);
  const closings = closingDay ? installmentClosings(date, n, closingDay) : null;
  const when = closings ? `La primera llega en el corte del ${shortDate(closings[0]!)}; la última, el ${shortDate(closings.at(-1)!)}.` : "";
  return (
    <div className="flex flex-col gap-2.5 border-b border-border pt-1 pb-3.5">
      <div className="grid grid-cols-2 items-end gap-4">
        <div className="flex flex-col gap-1.5">
          <span id="cuantas" className="text-caption font-semibold">¿Cuántas cuotas?</span>
          <div role="group" aria-labelledby="cuantas" className="flex h-11 items-center justify-between border-b-2 border-input-line">
            <button type="button" aria-label="Una cuota menos" onClick={() => setN(Math.max(2, n - 1))} className={step}><Icon name="remove" /></button>
            <span className="text-[20px] leading-7 font-semibold tabular-nums">{n}</span>
            <button type="button" aria-label="Una cuota más" onClick={() => setN(Math.min(60, n + 1))} className={step}><Icon name="add" /></button>
          </div>
        </div>
        <label className="flex flex-col gap-1.5 text-caption font-semibold">
          ¿De cuánto cada una?
          <span className="flex h-11 items-baseline gap-1.5 border-b-2 border-input-line pt-2">
            <span className="text-muted-foreground">{symbolOf(currency)}</span>
            <input inputMode="decimal" placeholder={cents ? (plain / 100).toFixed(2) : "0.00"} value={cuota} onChange={(e) => setCuota(e.target.value)}
              className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[20px] leading-7 font-semibold tabular-nums" />
          </span>
        </label>
      </div>
      <span className="text-caption text-muted-foreground">Cópiala del cronograma del banco. Sin intereses es {money(plain)}.</span>
      {cents > 0 && (
        <div role="status" className="flex flex-col gap-1 rounded-md bg-muted p-3 tabular-nums">
          {interest > 0 ? (
            <>
              <span className="font-semibold">{who ? `${who} te deberá` : "Le deberás"} {money(debt)}{who ? "" : " al banco"} · {n} cuotas de {money(each)}</span>
              <span className="grid grid-cols-[1fr_auto] text-caption text-muted-foreground">
                <span>{category ?? "Lo que costó"}</span><span>{money(cents)}</span>
                <span>Intereses · cuentan hoy</span><span>{money(interest)}</span>
              </span>
            </>
          ) : interest < 0 ? (
            <span className="font-semibold text-attention">{n} cuotas de {money(each)} no llegan a lo que costó: revisa la cuota.</span>
          ) : (
            <span className="font-semibold">{n} cuotas de {money(each)}{last !== each ? ` (la última, ${money(last)})` : ""}</span>
          )}
          <span className="text-caption text-muted-foreground">
            {when}{who ? "" : ` El gasto cuenta completo hoy${category ? ` en ${category}` : ""}.`}
          </span>
        </div>
      )}
    </div>
  );
}

