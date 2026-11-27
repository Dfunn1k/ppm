import type { ReactNode } from "react";
import { Link } from "react-router";
import { usePanel } from "@/components/AppNav";
import { Icon } from "@/components/ui";

/** Una pantalla o sección sin datos, con la forma de Recurrentes: ícono, qué es, cómo empezar y, si hay
 *  algo que hacer, un botón. */
export function EmptyState({ icon, title, children, action }: {
  icon: string; title: string; children: ReactNode; action?: { to: string; label: string };
}) {
  const panel = usePanel();
  return (
    <div className="mt-8 flex flex-col items-center gap-3 text-center">
      <span className="grid size-16 place-items-center rounded-full bg-muted"><Icon name={icon} size="lg" /></span>
      <span className="text-title-2 font-bold">{title}</span>
      <p className="text-muted-foreground">{children}</p>
      {action && (
        <Link to={action.to} state={action.to.startsWith("/registrar") ? panel : undefined} className="mt-1 flex h-12 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-input-line font-semibold">
          <Icon name="add" />{action.label}
        </Link>
      )}
    </div>
  );
}
