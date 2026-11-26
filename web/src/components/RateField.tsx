// El tipo de cambio en los formularios: viene escrito con el de SUNAT del día (compra para lo que
// tienes, venta para lo que debes) y siempre se puede cambiar.
import { useState } from "react";

import { useRates } from "@/api/hooks";
import { LineField } from "@/components/ui";
import { shortDate, todayISO } from "@/lib/dates";
import { rateText, symbolOf } from "@/lib/money";

export type Side = "buy" | "sell";

/** El tipo de SUNAT (o el cargado a mano) que vale para ese día, como texto de 3 decimales. */
export function useSuggestedRate(currency: string, base: string, date: string, side: Side = "buy") {
  const rates = useRates(date === todayISO() ? undefined : date);
  const r = currency === base ? undefined : rates.data?.find((x) => x.currency === currency);
  return {
    value: r ? rateText(side === "buy" ? r.buy : r.sell) : null,
    date: r?.date ?? null,
    loading: rates.isPending,
  };
}

/** Lo que la persona escribió o, mientras no toque el campo, la sugerencia del día. */
export function useRateInput(currency: string, base: string, date: string, side: Side = "buy", initial?: string | null) {
  const suggestion = useSuggestedRate(currency, base, date, side);
  const [typed, setTyped] = useState<string | null>(initial ?? null);
  return { value: typed ?? suggestion.value ?? "", setValue: setTyped, suggestion };
}

/** «Compra de SUNAT de hoy. Cámbialo si tu banco usó otro.» */
export function rateHint(side: Side, rateDate: string | null, currency: string) {
  if (!rateDate) return `Soles por cada ${symbolOf(currency)} 1. Todavía no hay uno de SUNAT: escríbelo.`;
  const which = side === "buy" ? "Compra" : "Venta";
  const when = rateDate === todayISO() ? "de hoy" : `del ${shortDate(rateDate)}`;
  return `${which} de SUNAT ${when}. Cámbialo si tu banco usó otro.`;
}

export function RateField({ input, currency, side = "buy", error, aside }: {
  input: ReturnType<typeof useRateInput>;
  currency: string;
  side?: Side;
  error?: string;
  aside?: React.ReactNode;     // al costado: «Son S/ 68.86»
}) {
  return (
    <div className="grid grid-cols-title-amount items-start gap-4">
      <LineField label="Tipo de cambio" inputMode="decimal" value={input.value} error={error}
        onChange={(e) => input.setValue(e.target.value)} hint={rateHint(side, input.suggestion.date, currency)} />
      {aside && <span className="flex flex-col items-end pt-6 tabular-nums">{aside}</span>}
    </div>
  );
}
