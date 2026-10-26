import { useNavigate } from "react-router";

import { useCatalog, useRates } from "@/api/hooks";
import { Icon, PrimaryButton, Screen } from "@/components/ui";
import { CURRENCY_SYMBOL, rateText } from "@/lib/money";

import { BASE_CURRENCY, Done, StepHeader, useWizard } from "./wizard";

const CAPTION: Record<string, string> = { USD: "La más usada en Perú" };

export function Paso2() {
  const navigate = useNavigate();
  const catalog = useCatalog().data;
  const rates = useRates().data ?? [];
  const { choices, update } = useWizard();
  const base = BASE_CURRENCY[choices.country] ?? BASE_CURRENCY.PE!;
  const country = catalog?.countries.find((c) => c.code === choices.country)?.name ?? choices.country;
  const others = catalog?.currencies.filter((c) => c.code !== base.code) ?? [];
  const toggle = (code: string) =>
    update({
      currencies: choices.currencies.includes(code)
        ? choices.currencies.filter((c) => c !== code)
        : [...choices.currencies, code],
    });

  return (
    <Screen>
      <StepHeader
        step={2}
        back="/bienvenida/1"
        summary={
          <Done>
            {country} · {base.name} ({base.symbol})
          </Done>
        }
      />
      <h1 className="mt-10 text-title-hero">¿Usas otras monedas?</h1>
      <p className="mt-4 text-muted-foreground">Marca las que tengas en alguna cuenta o tarjeta. Puedes agregar más después.</p>

      <section aria-label="Tipo de cambio" className="mt-6 flex flex-col gap-2.5 rounded-lg border border-border bg-card p-4 shadow-sm">
        <span className="flex items-center gap-1.5 text-label text-muted-foreground">
          <Icon name="currency_exchange" className="text-[16px]" />
          Cambio de cada día · SUNAT
        </span>
        {choices.currencies.length === 0 ? (
          <span className="text-muted-foreground">Solo soles: todo lo verás en {base.symbol}.</span>
        ) : (
          <span>
            Lo que tengas en {choices.currencies.map((c) => CURRENCY_SYMBOL[c] ?? c).join(" y ")} también lo ves en{" "}
            {base.name}, al cambio del día.
          </span>
        )}
        {rates.filter((r) => choices.currencies.includes(r.currency)).map((r) => (
          <span key={r.currency} className="font-semibold tabular-nums">
            {CURRENCY_SYMBOL[r.currency] ?? r.currency} 1 = {base.symbol} {rateText(r.buy)} compra · {rateText(r.sell)} venta
          </span>
        ))}
        <span className="text-caption text-muted-foreground">PPM lo trae cada día de SUNAT; no tienes que anotarlo.</span>
      </section>

      <div className="min-h-6 flex-1" />
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          navigate("/bienvenida/3");
        }}
      >
        <fieldset className="flex flex-col">
          <legend className="sr-only">Otras monedas</legend>
          {others.map((c) => (
            <label key={c.code} className="flex min-h-16 cursor-pointer items-center gap-3.5 border-b border-border">
              <input
                type="checkbox"
                checked={choices.currencies.includes(c.code)}
                onChange={() => toggle(c.code)}
                className="size-[22px] flex-none accent-primary"
              />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[17px] leading-6 font-semibold">{c.name}</span>
                {CAPTION[c.code] && <span className="text-caption text-muted-foreground">{CAPTION[c.code]}</span>}
              </span>
              <span className="font-display text-[22px] leading-[26px] font-bold">{CURRENCY_SYMBOL[c.code] ?? c.code}</span>
            </label>
          ))}
        </fieldset>
        <PrimaryButton disabled={!catalog}>
          {choices.currencies.length ? "Siguiente" : `Seguir solo con ${base.name}`}
        </PrimaryButton>
      </form>
    </Screen>
  );
}
