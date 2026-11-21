// Lo que va debajo del nombre de una cuenta: su tipo y, si el nombre no lo dice ya, el banco en
// pastilla (caso 10, opción C): «[BCP] Ahorros en soles».
import type { ReactNode } from "react";

import { Pill } from "./Pill";

type Sub = { subtitle?: string | null; bank?: string | null };

export function AccountSub({ a }: { a: Sub }) {
  if (!a.bank) return a.subtitle ? <>{a.subtitle}</> : null;
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Pill>{a.bank}</Pill>{a.subtitle}
    </span>
  );
}

/** Para una opción de una hoja: el texto para buscar (`hint`) y lo que se ve (`detail`). */
export function accountOption(a: Sub): { hint?: string; detail?: ReactNode } {
  const hint = [a.bank, a.subtitle].filter(Boolean).join(" ") || undefined;
  return a.bank ? { hint, detail: <span className="text-caption text-muted-foreground"><AccountSub a={a} /></span> } : { hint };
}
