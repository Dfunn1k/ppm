// C6 · «Ya me debía» o «Ya le debía»: lo que había con una persona antes de empezar a usar PPM.
// Es la foto del cuaderno de fiados el día que lo abriste: no mueve tus cuentas (esa plata ya había
// salido o entrado) y queda como una deuda abierta desde su fecha, que se cancela con los pagos.
// Desde una persona ya viene elegida; desde «Más» en Registrar, se elige (o se crea) aquí.
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { useMe, usePartner, usePartnerOpening } from "@/api/hooks";
import { PersonPicker } from "@/components/PersonPicker";
import { RateField, useRateInput } from "@/components/RateField";
import { Segmented } from "@/components/Sheet";
import { ErrorAlert, Icon, LineField, PrimaryButton, Screen, Spinner } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { CURRENCY_NAME, parseAmount, symbolOf } from "@/lib/money";
import { AmountField } from "@/pages/cuentas/CuentaForm";

type Side = "owes_me" | "i_owe";

export function YaDebia() {
  const fixed = Number(useParams().id) || 0;
  const [chosen, setChosen] = useState<number | null>(null);
  const id = fixed || chosen || 0;
  const navigate = useNavigate();
  const [search] = useSearchParams();
  const me = useMe().data;
  const person = usePartner(id);
  const save = usePartnerOpening(id);
  const [side, setSide] = useState<Side>(search.get("lado") === "i_owe" ? "i_owe" : "owes_me");
  const [currency, setCurrency] = useState(me?.currency ?? "PEN");
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(todayISO());
  const [note, setNote] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const rate = useRateInput(currency, me?.currency ?? "PEN", date, side === "owes_me" ? "buy" : "sell");
  if (!me?.currency || (fixed && person.isPending)) return <Spinner />;
  if (person.isError) return <Screen><ErrorAlert>{person.error.message}</ErrorAlert></Screen>;

  const first = person.data?.partner.name.split(" ")[0];
  const foreign = currency !== me.currency;
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const value = parseAmount(amount, me.lang ?? "es-PE");
    if (!id) return setProblem("Elige con quién");
    if (!value || Number(value) <= 0) return setProblem("Escribe un monto mayor que cero");
    if (date > todayISO()) return setProblem("Un saldo inicial es de hoy o de antes: elige otra fecha");
    if (foreign && !(Number(rate.value) > 0)) return setProblem("Escribe el tipo de cambio, como 3.443");
    save.mutate({ side, currency, amount: value, date, rate: foreign ? rate.value.trim() : null, ref: note.trim() || null },
      { onSuccess: () => navigate(`/personas/${id}`, { replace: true }) });
  };

  return (
    <Screen className="pt-4">
      <div className="-mx-2.5 flex items-center justify-between">
        <button type="button" aria-label="Volver" onClick={() => navigate(-1)} className="grid size-11 place-items-center rounded-full">
          <Icon name="arrow_back" className="text-[24px]" />
        </button>
        <span className="pr-2.5 text-label text-muted-foreground">Saldo inicial</span>
      </div>
      <form noValidate onSubmit={submit} className="flex flex-1 flex-col">
        <h1 className="mt-4 text-title-hero">De antes de PPM</h1>
        <p className="mt-4 text-muted-foreground">
          Lo que ya había con {first ?? "una persona"} cuando empezaste. No mueve tus cuentas: esa plata ya había salido o entrado.
          Queda como una deuda abierta desde la fecha que elijas.
        </p>

        <div className="mt-6 flex flex-col gap-5">
          {!fixed && <PersonPicker label="¿Con quién?" value={chosen} onChange={setChosen} />}
          <Segmented label="¿Quién le debía a quién?" value={side} onChange={(v) => setSide(v as Side)}
            options={[{ value: "owes_me", label: first ? `${first} me debía` : "Me debía" }, { value: "i_owe", label: `Yo le debía` }]} />
          {me.currencies.length > 1 && (
            <Segmented label="Moneda" size="sm" value={currency} onChange={setCurrency}
              options={me.currencies.map((c) => ({ value: c, label: `${(CURRENCY_NAME[c] ?? c).replace(/^./, (x) => x.toUpperCase())} · ${symbolOf(c)}` }))} />
          )}
          <AmountField label={side === "owes_me" ? "¿Cuánto te debía?" : "¿Cuánto le debías?"} symbol={symbolOf(currency)}
            value={amount} onChange={(e) => setAmount(e.target.value)} />
          <LineField label="¿Desde cuándo?" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value || todayISO())}
            hint="La fecha de la deuda: con ella se ve cuánto tiempo tiene." />
          {foreign && <RateField input={rate} currency={currency} side={side === "owes_me" ? "buy" : "sell"} />}
          <LineField label="Nota (opcional)" placeholder="Lo del celular" maxLength={120} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>

        <div className="min-h-6 flex-1" />
        <div className="flex flex-col gap-3">
          {(problem || save.error) && <ErrorAlert>{problem ?? save.error?.message}</ErrorAlert>}
          <PrimaryButton pending={save.isPending}>{side === "owes_me" ? "Anotar lo que me debía" : "Anotar lo que le debía"}</PrimaryButton>
        </div>
      </form>
    </Screen>
  );
}
