// El buscador: fondo muted, ícono search y el anillo de foco en la caja entera (nunca solo un cambio
// de color, AUDITORIA d11).
import type { ComponentProps } from "react";

import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";

export function SearchField({ label, className, ...props }: Omit<ComponentProps<"input">, "type"> & { label: string }) {
  return (
    <label className={cn("flex min-h-control items-center gap-2 rounded-md bg-muted px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring", className)}>
      <Icon name="search" className="text-muted-foreground" />
      <input type="search" aria-label={label} placeholder={label} autoComplete="off"
        className="min-w-0 flex-1 bg-transparent text-body outline-none placeholder:text-muted-foreground" {...props} />
    </label>
  );
}
