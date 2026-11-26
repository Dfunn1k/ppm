// La fila de una lista (design-system/components/Row): algo a la izquierda, título y subtítulo, y algo a
// la derecha. Es un enlace si lleva a otra pantalla, un botón si abre o elige algo, o una fila quieta.
// Toda la fila es lo que se toca; nada que se toque va dentro de ella.
import { cva, type VariantProps } from "class-variance-authority";
import type { ReactNode } from "react";
import { Link } from "react-router";

import { cn } from "@/lib/utils";

export const rowVariants = cva("flex w-full min-w-0 items-center gap-3 text-left", {
  variants: {
    size: { sm: "min-h-row-sm py-2", md: "min-h-row py-2.5", option: "min-h-row-option py-2" },
    interactive: { true: "row-bleed rounded-md hover:bg-muted active:bg-muted", false: "" },
    selected: { true: "bg-selected text-selected-foreground hover:bg-selected", false: "" },
  },
  defaultVariants: { size: "md", interactive: false, selected: false },
});

type Common = VariantProps<typeof rowVariants> & {
  leading?: ReactNode; title: ReactNode; subtitle?: ReactNode; trailing?: ReactNode; className?: string;
};

function Body({ leading, title, subtitle, trailing }: Common) {
  return (
    <>
      {leading}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-body-strong">{title}</span>
        {subtitle && <span className="truncate text-caption text-muted-foreground">{subtitle}</span>}
      </span>
      {trailing && <span className="flex flex-none items-center gap-1 text-right">{trailing}</span>}
    </>
  );
}

/** Una fila. Con `to` es un enlace; con `onClick`, un botón; sin ninguno, una fila quieta. En la lista
 * del escritorio, `current` la marca como la elegida (la raya de la izquierda y aria-current). */
export function Row(props: Common & { to?: string; state?: unknown; onClick?: () => void; current?: boolean; pressed?: boolean }) {
  const { to, state, onClick, current, pressed, size, selected, className } = props;
  const interactive = Boolean(to || onClick);
  const cls = cn(rowVariants({ size, interactive, selected }), current && "mark-selected", className);
  if (to) return <Link to={to} state={state} aria-current={current ? "page" : undefined} className={cls}><Body {...props} /></Link>;
  if (onClick) return <button type="button" onClick={onClick} aria-pressed={pressed} className={cls}><Body {...props} /></button>;
  return <div className={cls}><Body {...props} /></div>;
}
