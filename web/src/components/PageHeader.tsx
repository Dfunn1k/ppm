// La cabecera de una pantalla a la que entras (design-system/components/PageHeader): la flecha para
// volver, la etiqueta opcional, el título en title-hero y las acciones a la derecha. En un panel de
// escritorio la flecha no se ve, porque la lista está al lado (styles.css, .pane).
import type { ReactNode } from "react";
import { Link } from "react-router";

import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";

export function BackLink({ to, label, className }: { to: string; label: string; className?: string }) {
  return (
    <Link to={to} aria-label={label} className={cn("grid size-control flex-none place-items-center rounded-full hover:bg-muted active:bg-muted", className)}>
      <Icon name="arrow_back" size="md" />
    </Link>
  );
}

export function PageHeader({ back, eyebrow, title, actions, children, className }: {
  /** A dónde vuelves y cómo se llama la flecha: «Volver a cuentas». */
  back?: { to: string; label: string };
  eyebrow?: ReactNode;
  title: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <header className={cn("flex flex-col", className)}>
      {(back || actions) && (
        <div className="-mx-2.5 flex min-h-control items-center justify-between">
          {back ? <BackLink {...back} /> : <span />}
          {actions && <div className="flex items-center gap-1">{actions}</div>}
        </div>
      )}
      {eyebrow && <p className="mt-4 text-label text-muted-foreground">{eyebrow}</p>}
      <h1 className={cn("text-title-hero break-words", eyebrow ? "mt-1" : "mt-4")}>{title}</h1>
      {children}
    </header>
  );
}
