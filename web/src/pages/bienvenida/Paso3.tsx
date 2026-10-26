import { Link, useNavigate } from "react-router";

import { useCatalog, useFinishSetup } from "@/api/hooks";
import { ErrorAlert, Icon, PrimaryButton, Screen } from "@/components/ui";
import { formatAmount, parseAmount, symbolOf } from "@/lib/money";
import { CuentaForm } from "@/pages/cuentas/CuentaForm";
import { FormHeader } from "@/pages/cuentas/Nueva";

import { BASE_CURRENCY, Done, forgetWizard, StepHeader, useWizard } from "./wizard";

const NAMES: Record<string, string> = { PEN: "soles", USD: "dólares", EUR: "euros" };

// Nada se crea hasta «Guardar y empezar»: así «Atrás» sigue funcionando sin dejar cosas a medias.
export function Paso3() {
  const navigate = useNavigate();
  const finish = useFinishSetup();
  const { choices, update } = useWizard();
  const base = BASE_CURRENCY[choices.country] ?? BASE_CURRENCY.PE!;
  const used = [base.code, ...choices.currencies].map((c) => NAMES[c] ?? c);
  const summary = used.length === 1 ? `Solo ${used[0]}` : `${used.slice(0, -1).join(", ")} y ${used.at(-1)}`;
  const cash = choices.cash.trim() ? parseAmount(choices.cash, choices.lang) : "0.00";

  const start = () => {
    if (cash === null) return;
    finish.mutate(
      {
        setup: { country: choices.country, other_currencies: choices.currencies, lang: choices.lang, tz: choices.tz },
        cash: Number(cash) !== 0 ? cash : null,
        banks: choices.banks,
      },
      {
        onSuccess: ({ problems }) => {
          forgetWizard();
          navigate("/cuentas", { replace: true, state: problems.length ? { notice: problems.join(" ") } : null });
        },
      },
    );
  };

  return (
    <Screen>
      <StepHeader step={3} back="/bienvenida/2" summary={<Done>{summary}</Done>} />
      <h1 className="mt-10 text-title-hero">¿Dónde tienes tu plata hoy?</h1>
      <p className="mt-4 text-muted-foreground">Anota lo que tiene cada cuenta hoy. Puedes cambiarlo o agregar más después.</p>

      <div className="min-h-6 flex-1" />
      <div className="flex flex-col gap-4">
        <ul className="flex flex-col">
          <li className="flex min-h-16 items-center gap-3 border-b border-border">
            <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground">
              <Icon name="payments" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">Efectivo</span>
              <span className="text-caption text-muted-foreground">Ya viene creada</span>
            </span>
            <label className="flex w-32 items-baseline gap-1 border-b-2 border-input-line aria-invalid:border-destructive" aria-invalid={cash === null}>
              <span className="text-muted-foreground">{base.symbol}</span>
              <input
                inputMode="decimal"
                placeholder="0.00"
                aria-label="Lo que hay hoy en Efectivo"
                value={choices.cash}
                onChange={(e) => update({ cash: e.target.value })}
                className="h-9 min-w-0 flex-1 border-0 bg-transparent p-0 text-right text-[17px] leading-6 font-medium tabular-nums"
              />
            </label>
          </li>
          {choices.banks.map((b, i) => (
            <li key={`${b.name}-${i}`} className="flex min-h-16 items-center gap-3 border-b border-border">
              <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground">
                <Icon name="account_balance" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{b.name}</span>
                <span className="text-caption text-muted-foreground">Banco · se crea al empezar</span>
              </span>
              <span className="text-amount">{formatAmount(b.opening?.amount ?? "0", symbolOf(b.currency), choices.lang)}</span>
              <button type="button" aria-label={`Quitar ${b.name}`} onClick={() => update({ banks: choices.banks.filter((_, j) => j !== i) })}
                className="grid size-9 place-items-center rounded-full text-muted-foreground">
                <Icon name="close" />
              </button>
            </li>
          ))}
          <li>
            <Link to="/bienvenida/3/banco" className="flex min-h-14 items-center gap-3 font-semibold text-primary-strong">
              <span className="grid size-9 flex-none place-items-center rounded-full border-[1.5px] border-dashed border-input-line">
                <Icon name="add" />
              </span>
              Agregar cuenta de banco
            </Link>
          </li>
        </ul>
        <p className="text-caption text-muted-foreground">
          Tus categorías de ingresos y gastos ya están listas. Tarjetas y préstamos llegan muy pronto.
        </p>
        {cash === null && <ErrorAlert>Escribe el efectivo como 1,234.50</ErrorAlert>}
        {finish.error && <ErrorAlert>{finish.error.message}</ErrorAlert>}
        <PrimaryButton type="button" onClick={start} pending={finish.isPending} disabled={cash === null}>
          Guardar y empezar
        </PrimaryButton>
      </div>
    </Screen>
  );
}

/** «Agregar cuenta de banco» dentro del paso 3: el mismo formulario de C5; se crea al final. */
export function Paso3Banco() {
  const navigate = useNavigate();
  const banks = useCatalog().data?.banks ?? [];
  const { choices, update } = useWizard();
  const base = BASE_CURRENCY[choices.country] ?? BASE_CURRENCY.PE!;
  return (
    <Screen className="pt-4">
      <FormHeader back="/bienvenida/3" label="Cuenta de banco" />
      <div className="mt-2 flex flex-1 flex-col">
        <CuentaForm
          kind="bank"
          base={base.code}
          currencies={[base.code, ...choices.currencies]}
          banks={banks}
          lang={choices.lang}
          submitLabel="Agregar"
          onSubmit={(body) => {
            update({ banks: [...choices.banks, body as (typeof choices.banks)[number]] });
            navigate("/bienvenida/3");
          }}
        />
      </div>
    </Screen>
  );
}
