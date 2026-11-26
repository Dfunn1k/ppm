// Lo que la persona va eligiendo en los 3 pasos. Se guarda en esta pestaña (sessionStorage) para
// que «volver» y recargar no lo borren, y se manda a la API una sola vez, en el paso 3.
import { createContext, type ReactNode, useContext, useEffect, useState } from "react";
import { Link } from "react-router";

import type { BankIn } from "@/api/hooks";
import { Icon } from "@/components/ui";

/** Lo elegido en los 3 pasos; en el 3, el saldo del efectivo y los bancos que se agregaron. */
export type Choices = {
  country: string;
  lang: string;
  tz: string;
  currencies: string[];
  cash: string;          // lo que escribió la persona: «320.00»
  banks: BankIn[];       // se crean al final, con «Guardar y empezar»
};

const KEY = "ppm.bienvenida";
const DEFAULTS: Choices = { country: "PE", lang: "es-PE", tz: "America/Lima", currencies: ["USD"], cash: "", banks: [] };

function load(): Choices {
  try {
    const saved = sessionStorage.getItem(KEY);
    return saved ? { ...DEFAULTS, ...(JSON.parse(saved) as Partial<Choices>) } : DEFAULTS;
  } catch {
    return DEFAULTS;
  }
}

const Ctx = createContext<{ choices: Choices; update: (c: Partial<Choices>) => void } | null>(null);

export function WizardProvider({ children }: { children: ReactNode }) {
  const [choices, setChoices] = useState(load);
  useEffect(() => {
    try {
      sessionStorage.setItem(KEY, JSON.stringify(choices));
    } catch {
      // sin almacenamiento (ventana privada): solo se pierde al recargar
    }
  }, [choices]);
  return <Ctx value={{ choices, update: (c) => setChoices((prev) => ({ ...prev, ...c })) }}>{children}</Ctx>;
}

export function useWizard() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWizard va dentro de WizardProvider");
  return ctx;
}

export function forgetWizard() {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // nada que borrar
  }
}

/** Moneda base de cada país: es la del país y no se cambia (res_country.currency_id). */
export const BASE_CURRENCY: Record<string, { code: string; symbol: string; name: string }> = {
  PE: { code: "PEN", symbol: "S/", name: "soles" },
};

/** Arriba de cada paso: volver (desde el 2), lo ya elegido, «n / 3» y la barra de avance. */
export function StepHeader({ step, summary, back }: { step: 1 | 2 | 3; summary: ReactNode; back?: string }) {
  return (
    <>
      <div className={back ? "-my-3 -ml-3 flex items-center gap-1" : "flex items-center"}>
        {back && (
          <Link to={back} aria-label={`Volver al paso ${step - 1}`} className="grid size-11 flex-none place-items-center rounded-full">
            <Icon name="arrow_back" size="md" />
          </Link>
        )}
        <span className="flex flex-1 items-center gap-1 text-label text-muted-foreground">{summary}</span>
        <span className="text-label text-muted-foreground tabular-nums">{step} / 3</span>
      </div>
      <div
        role="progressbar"
        aria-label="Configuración inicial"
        aria-valuemin={1}
        aria-valuemax={3}
        aria-valuenow={step}
        className="mt-3 grid grid-cols-3 gap-1.5"
      >
        {[1, 2, 3].map((n) => (
          <span key={n} className={n <= step ? "h-1 rounded-full bg-primary" : "h-1 rounded-full bg-border"} />
        ))}
      </div>
    </>
  );
}

export function Done({ children }: { children: ReactNode }) {
  return (
    <>
      <Icon name="check_circle" fill size="sm" className="text-income" />
      {children}
    </>
  );
}
