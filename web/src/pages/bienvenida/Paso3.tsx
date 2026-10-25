import { useNavigate } from "react-router";

import { useSetup } from "@/api/hooks";
import { ErrorAlert, Icon, PrimaryButton, Screen } from "@/components/ui";

import { BASE_CURRENCY, Done, forgetWizard, StepHeader, useWizard } from "./wizard";

const NAMES: Record<string, string> = { PEN: "soles", USD: "dólares", EUR: "euros" };

// Decisión del 2026-10-25: en la rebanada 1 la configuración crea las cuentas sin saldo.
// El saldo de hoy se podrá anotar cuando la API tenga movimientos (asiento contra «Saldos iniciales»).
export function Paso3() {
  const navigate = useNavigate();
  const setup = useSetup();
  const { choices } = useWizard();
  const base = BASE_CURRENCY[choices.country] ?? BASE_CURRENCY.PE!;
  const used = [base.code, ...choices.currencies].map((c) => NAMES[c] ?? c);
  const summary = used.length === 1 ? `Solo ${used[0]}` : `${used.slice(0, -1).join(", ")} y ${used.at(-1)}`;

  const start = () =>
    setup.mutate(
      { country: choices.country, other_currencies: choices.currencies, lang: choices.lang, tz: choices.tz },
      {
        onSuccess: () => {
          forgetWizard();
          navigate("/inicio", { replace: true });
        },
      },
    );

  return (
    <Screen>
      <StepHeader step={3} back="/bienvenida/2" summary={<Done>{summary}</Done>} />
      <h1 className="mt-10 text-title-hero">¿Dónde tienes tu plata hoy?</h1>
      <p className="mt-4 text-muted-foreground">
        Empiezas con tu efectivo. Tus bancos y tarjetas, con lo que tienen hoy, los agregas en cuanto llegue Cuentas.
      </p>

      <div className="min-h-6 flex-1" />
      <div className="flex flex-col gap-4">
        {setup.error && <ErrorAlert>{setup.error.message}</ErrorAlert>}
        <ul className="flex flex-col">
          <li className="flex min-h-16 items-center gap-3 border-b border-border">
            <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground">
              <Icon name="payments" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">Efectivo</span>
              <span className="text-caption text-muted-foreground">En {base.name} · se crea ahora</span>
            </span>
          </li>
          <li aria-disabled="true" className="flex min-h-14 items-center gap-3 text-muted-foreground">
            <span className="grid size-9 flex-none place-items-center rounded-full border-[1.5px] border-dashed border-input-line">
              <Icon name="add" />
            </span>
            <span className="flex flex-col">
              <span className="font-semibold">Agregar banco, tarjeta o préstamo</span>
              <span className="text-caption">Muy pronto</span>
            </span>
          </li>
        </ul>
        <p className="text-caption text-muted-foreground">
          Tus categorías de ingresos y gastos ya están listas. Las ves y cambias en Más › Categorías.
        </p>
        <PrimaryButton type="button" onClick={start} pending={setup.isPending}>
          Guardar y empezar
        </PrimaryButton>
      </div>
    </Screen>
  );
}
