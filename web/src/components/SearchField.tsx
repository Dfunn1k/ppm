// El buscador: fondo muted, ícono search y el anillo de foco en la caja entera (nunca solo un cambio
// de color, AUDITORIA d11).
import type { ComponentProps, ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";

/** `children` va a la derecha del campo: la tecla del atajo o el botón de borrar. */
export function SearchField({ label, className, children, ...props }: Omit<ComponentProps<"input">, "children"> & { label: string; children?: ReactNode }) {
  return (
    <label className={cn("flex min-h-control items-center gap-2 rounded-md bg-muted px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring", className)}>
      <Icon name="search" className="text-muted-foreground" />
      <input type="search" aria-label={label} placeholder={label} autoComplete="off"
        className="peer min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground" {...props} />
      {children}
    </label>
  );
}
