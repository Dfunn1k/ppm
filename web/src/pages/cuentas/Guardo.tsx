// C5 · Plata que guardo de otros: de quién es, en qué moneda y cuánto.
import { useState } from "react";
import { useNavigate } from "react-router";

import { ApiError, useAddCustody, useCreatePartner, useMe, usePartners } from "@/api/hooks";
import { RateField, useRateInput } from "@/components/RateField";
import { Segmented } from "@/components/Sheet";
import { ErrorAlert, Icon, LineField, PrimaryButton, Screen } from "@/components/ui";
import { DateField } from "@/components/DateSheet";
import { todayISO } from "@/lib/dates";
import { CURRENCY_NAME, parseAmount, symbolOf } from "@/lib/money";

import { AmountField } from "./CuentaForm";
import { FormHeader } from "./Nueva";

export function NuevaGuardo() {
  const navigate = useNavigate();
  const me = useMe().data;
  const partners = usePartners().data ?? [];
  const createPartner = useCreatePartner();
  const addCustody = useAddCustody();

  const [who, setWho] = useState<number | "new" | null>(null);
  const [newName, setNewName] = useState("");
  const [currency, setCurrency] = useState(me?.currency ?? "PEN");
  const [amount, setAmount] = useState("");
  const [dateOpen, setDateOpen] = useState(false);
  const [date, setDate] = useState(todayISO());
  const rate = useRateInput(currency, me?.currency ?? "PEN", dateOpen ? date : todayISO());
  const [problem, setProblem] = useState<string | null>(null);

  if (!me?.currency) return null;
  const chosen = who ?? (partners.length ? partners[0]!.id : "new");
  const foreign = currency !== me.currency;
  const pending = createPartner.isPending || addCustody.isPending;
  const failure = createPartner.error ?? addCustody.error;

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const value = parseAmount(amount, me.lang ?? "es-PE");
    if (chosen === "new" && !newName.trim()) return setProblem("Escribe cómo se llama");
    if (!value || Number(value) <= 0) return setProblem("Escribe cuánto te dio para guardar");
    if (foreign && !(Number(rate.value) > 0)) return setProblem("Escribe el tipo de cambio, como 3.443");
    try {
      const partnerId = chosen === "new" ? (await createPartner.mutateAsync(newName)).id : chosen;
      await addCustody.mutateAsync({
        partner_id: partnerId,
        currency,
        amount: value,
        date: dateOpen ? date : null,
        rate: foreign ? rate.value.trim() : null,
      });
      navigate("/cuentas", { replace: true });
    } catch {
      // el mensaje sale de la mutación que falló
    }
  };

  const pill = "flex h-10 items-center gap-2 rounded-full border text-[15px] leading-[22px] font-semibold";
  return (
    <Screen className="pt-4">
      <FormHeader back="/cuentas/nueva" label="Guardo de otros" />
      <form noValidate onSubmit={save} className="flex flex-1 flex-col">
        <h1 className="mt-6 text-title-hero">¿De quién es la plata?</h1>
        <p className="mt-4 text-muted-foreground">
          La tienes tú, pero no es tuya: no suma a lo que realmente tienes hasta que la devuelvas.
        </p>

        <div role="radiogroup" aria-label="Persona" className="mt-6 flex flex-wrap gap-2">
          {partners.map((p) => (
            <button key={p.id} type="button" role="radio" aria-checked={chosen === p.id} onClick={() => setWho(p.id)}
              className={`${pill} px-4 ${chosen === p.id ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
              {p.name}
            </button>
          ))}
          <button type="button" role="radio" aria-checked={chosen === "new"} onClick={() => setWho("new")}
            className={`${pill} border-dashed px-3.5 ${chosen === "new" ? "border-primary" : "border-input-line"}`}>
            <Icon name="person_add" />
            Nueva persona
          </button>
        </div>
        {chosen === "new" && (
          <div className="mt-4">
            <LineField label="¿Cómo se llama?" autoComplete="off" value={newName} onChange={(e) => setNewName(e.target.value)} />
          </div>
        )}

        <div className="min-h-6 flex-1" />
        <div className="flex flex-col gap-4">
          {me.currencies.length > 1 && (
            <Segmented label="Moneda" value={currency} onChange={setCurrency}
              options={me.currencies.map((c) => ({ value: c, label: `${(CURRENCY_NAME[c] ?? c).replace(/^./, (x) => x.toUpperCase())} · ${symbolOf(c)}` }))} />
          )}
          <AmountField label="¿Cuánto te dio para guardar?" symbol={symbolOf(currency)} value={amount}
            onChange={(e) => setAmount(e.target.value)} />
          {foreign && (
            <RateField input={rate} currency={currency} />
          )}
          <button type="button" aria-expanded={dateOpen} onClick={() => setDateOpen(!dateOpen)}
            className="flex h-9 items-center gap-1 self-start rounded-full border border-border px-3 text-caption font-semibold">
            <Icon name="event" className="text-[18px]" />
            {dateOpen ? `Al ${date.split("-").reverse().join("/")}` : "Hoy · otra fecha"}
          </button>
          {dateOpen && <DateField label="Te la dio el" max={todayISO()} value={date} onChange={setDate} booked />}
          {(problem || failure) && (
            <ErrorAlert>{problem ?? (failure instanceof ApiError ? failure.message : "No se pudo guardar")}</ErrorAlert>
          )}
          <PrimaryButton pending={pending}>Guardar</PrimaryButton>
        </div>
      </form>
    </Screen>
  );
}
