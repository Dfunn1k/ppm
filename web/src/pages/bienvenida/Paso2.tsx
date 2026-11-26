// Paso 2 · ¿Usas otras monedas? Las ~150 del catálogo van en una tarjeta con buscador que se desliza
// sola: el título y «Siguiente» quedan siempre a la vista. Las marcadas suben primero (decisión «Listas largas»).
import { useState } from "react";
import { useNavigate } from "react-router";

import { useCatalog } from "@/api/hooks";
import { Icon, PrimaryButton, Screen } from "@/components/ui";
import { CURRENCY_SYMBOL } from "@/lib/money";

import { BASE_CURRENCY, Done, StepHeader, useWizard } from "./wizard";

const CAPTION: Record<string, string> = { USD: "La más usada en Perú, con el cambio de SUNAT" };

const plain = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function Paso2() {
  const navigate = useNavigate();
  const catalog = useCatalog().data;
  const { choices, update } = useWizard();
  const [query, setQuery] = useState("");
  const base = BASE_CURRENCY[choices.country] ?? BASE_CURRENCY.PE!;
  const country = catalog?.countries.find((c) => c.code === choices.country)?.name ?? choices.country;
  const others = catalog?.currencies.filter((c) => c.code !== base.code) ?? [];
  const q = plain(query.trim());
  const marked = others.filter((c) => choices.currencies.includes(c.code));
  const shown = [...marked, ...others.filter((c) => !choices.currencies.includes(c.code))]
    .filter((c) => !q || plain(c.name).includes(q) || c.code.toLowerCase().includes(q));
  const toggle = (code: string) =>
    update({
      currencies: choices.currencies.includes(code)
        ? choices.currencies.filter((c) => c !== code)
        : [...choices.currencies, code],
    });

  return (
    <Screen className="h-dvh">
      <StepHeader
        step={2}
        back="/bienvenida/1"
        summary={
          <Done>
            {country}, en {base.name} ({base.symbol})
          </Done>
        }
      />
      <h1 className="mt-7 text-title-hero">¿Usas otras monedas?</h1>
      <p className="mt-3 text-muted-foreground">Marca las que tengas en alguna cuenta o tarjeta. Puedes agregar más después.</p>

      <form
        className="mt-5 flex min-h-0 flex-1 flex-col"
        onSubmit={(e) => {
          e.preventDefault();
          navigate("/bienvenida/3");
        }}
      >
        <section aria-label="Otras monedas" className="flex min-h-40 flex-1 flex-col overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <div className="border-b border-border p-3">
            <label className="flex h-11 items-center gap-2 rounded-md bg-muted px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
              <Icon name="search" className="text-muted-foreground" />
              <input type="search" aria-label="Buscar moneda" placeholder="Buscar por nombre o código (EUR)" value={query}
                autoComplete="off" onChange={(e) => setQuery(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent focus:outline-none" />
            </label>
            {marked.length > 0 && (
              <span className="mt-2 block text-caption text-muted-foreground">
                Marcadas: <b className="text-foreground">{marked.map((c) => c.name).join(", ")}</b>
              </span>
            )}
          </div>
          <fieldset className="min-h-0 flex-1 overflow-y-auto">
            <legend className="sr-only">Otras monedas</legend>
            {shown.map((c) => (
              <label key={c.code} className="flex min-h-14 cursor-pointer items-center gap-3.5 border-b border-border px-3.5">
                <input
                  type="checkbox"
                  checked={choices.currencies.includes(c.code)}
                  onChange={() => toggle(c.code)}
                  className="size-6 flex-none accent-primary"
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="text-body-strong">{c.name}</span>
                  {CAPTION[c.code] && <span className="text-caption text-muted-foreground">{CAPTION[c.code]}</span>}
                  {c.decimals === 0 && <span className="text-caption text-muted-foreground">Sin decimales</span>}
                </span>
                <span className="font-display text-title-2 font-bold">{CURRENCY_SYMBOL[c.code] ?? c.code}</span>
              </label>
            ))}
            {catalog && shown.length === 0 && (
              <span className="block px-3.5 py-4 text-caption text-muted-foreground">Ninguna moneda se llama así.</span>
            )}
          </fieldset>
        </section>
        <p className="mt-3 mb-4 text-caption text-muted-foreground">El dólar lo trae SUNAT cada día; el cambio de las demás lo anotas tú.</p>
        <PrimaryButton disabled={!catalog}>
          {choices.currencies.length ? "Siguiente" : `Seguir solo con ${base.name}`}
        </PrimaryButton>
      </form>
    </Screen>
  );
}
