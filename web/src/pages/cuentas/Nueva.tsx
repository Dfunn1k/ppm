// C5 · Nueva cuenta: primero el tipo, luego solo sus datos.
import { Link, useNavigate } from "react-router";

import { ApiError, type BankIn, type CashIn, useCatalog, useCreateBank, useCreateCash, useMe } from "@/api/hooks";
import { Icon, Screen } from "@/components/ui";

import { CuentaForm } from "./CuentaForm";

function Header({ back, label, icon = "arrow_back" }: { back: string; label: string; icon?: string }) {
  return (
    <div className="-mx-2.5 flex items-center justify-between">
      <Link to={back} aria-label={icon === "close" ? "Cerrar y volver a cuentas" : "Volver"} className="grid size-11 place-items-center rounded-full">
        <Icon name={icon} className="text-[24px]" />
      </Link>
      <span className="pr-2.5 text-label text-muted-foreground">{label}</span>
    </div>
  );
}
export { Header as FormHeader };

const TYPES = [
  { to: "/cuentas/nueva/banco", icon: "account_balance", name: "Cuenta de banco", hint: "Ahorros o corriente, con su CCI" },
  { to: "/cuentas/nueva/efectivo", icon: "payments", name: "Efectivo o billetera", hint: "Billetera, alcancía, sobre de dólares" },
  { to: "/cuentas/nueva/guardo", icon: "volunteer_activism", name: "Plata que guardo de otros", hint: "Te la dieron para guardar; no es tuya" },
  { to: "/cuentas/nueva/tarjeta", icon: "credit_card", name: "Tarjeta de crédito", hint: "Con su corte, su línea y sus cuotas" },
  { to: "/cuentas/nueva/prestamo", icon: "real_estate_agent", name: "Préstamo de banco", hint: "Lo que debes y su cuota de cada mes" },
];

export function NuevaCuenta() {
  return (
    <Screen className="pt-4">
      <Header back="/cuentas" label="Nueva cuenta" icon="close" />
      <h1 className="mt-10 text-title-hero">¿Qué vas a agregar?</h1>
      <p className="mt-4 text-muted-foreground">Elige el tipo. Solo te pedimos lo que corresponde a cada uno.</p>
      <div className="min-h-6 flex-1" />
      <ul className="flex flex-col">
        {TYPES.map((t) => (
          <li key={t.to}>
            <Link to={t.to} className="flex min-h-[72px] items-center gap-3.5 border-b border-border">
              <span className="grid size-11 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground">
                <Icon name={t.icon} className="text-[22px]" />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="text-[17px] leading-6 font-semibold">{t.name}</span>
                <span className="text-caption text-muted-foreground">{t.hint}</span>
              </span>
              <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
            </Link>
          </li>
        ))}
      </ul>
    </Screen>
  );
}

/** Nueva cuenta de banco o de efectivo, ya dentro de la app. */
export function NuevaCuentaForm({ kind }: { kind: "bank" | "cash" }) {
  const navigate = useNavigate();
  const me = useMe().data;
  const banks = useCatalog().data?.banks ?? [];
  const bank = useCreateBank();
  const cash = useCreateCash();
  const mutation = kind === "bank" ? bank : cash;
  if (!me?.currency) return null;

  const done = (d: { account: { id: number } }) => navigate(`/cuentas/${d.account.id}`, { replace: true });
  return (
    <Screen className="pt-4">
      <Header back="/cuentas/nueva" label={kind === "bank" ? "Cuenta de banco" : "Efectivo o billetera"} />
      <div className="mt-2 flex flex-1 flex-col">
        <CuentaForm
          kind={kind}
          base={me.currency}
          currencies={me.currencies}
          banks={banks}
          lang={me.lang ?? "es-PE"}
          submitLabel="Crear cuenta"
          pending={mutation.isPending}
          error={mutation.error instanceof ApiError ? mutation.error.message : mutation.error ? "No se pudo crear" : null}
          onSubmit={(body) =>
            kind === "bank"
              ? bank.mutate(body as BankIn, { onSuccess: done })
              : cash.mutate(body as CashIn, { onSuccess: done })
          }
        />
      </div>
    </Screen>
  );
}
