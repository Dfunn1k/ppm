// El encabezado de una sección, «LO QUE TENGO ───» (design-system/components/SectionHeading): un <h2>
// de verdad, para que el lector de pantalla pueda saltar de sección en sección, con una acción
// opcional a la derecha que se toca en 44 px aunque se vea chica.
import type { ReactNode } from "react";
import { Link, type LinkProps } from "react-router";

import { cn } from "@/lib/utils";

export function SectionHeading({ children, action, line = true, as: Tag = "h2", className }: {
  children: ReactNode; action?: ReactNode; line?: boolean; as?: "h2" | "h3"; className?: string;
}) {
  return (
    <div className={cn("flex items-end justify-between gap-3 pb-1", line && "border-b border-border", className)}>
      <Tag className="text-label text-muted-foreground">{children}</Tag>
      {action}
    </div>
  );
}

/** «Ver todo», «Elegir cuáles»: la acción de un encabezado. */
export function SectionAction({ className, ...props }: LinkProps) {
  return <Link className={cn("hit-area text-label text-primary-strong", className)} {...props} />;
}
