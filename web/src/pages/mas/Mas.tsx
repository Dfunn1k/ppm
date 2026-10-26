// X0 · Más (mínimo): Mi cuenta y Apariencia; lo demás llega con su rebanada.
import { Link } from "react-router";

import { useMe } from "@/api/hooks";
import { Icon } from "@/components/ui";

const SOON = [
  ["event_repeat", "Recurrentes", "Netflix, el alquiler, la cuota del préstamo"],
  ["bar_chart", "Reportes", "En qué se va la plata, mes a mes"],
  ["category", "Categorías", "Crear, mover, archivar y fusionar"],
  ["lock_clock", "Cierre de periodo", "Que los meses revisados no cambien"],
  ["tune", "Monedas, idioma y formato", "Agregar monedas y cambiar cómo se ven"],
] as const;

export function Mas() {
  const me = useMe().data;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-8 pb-28">
      <h1 className="text-label text-muted-foreground">Más</h1>
      <Link to="/mas/cuenta" className="mt-4 flex items-center gap-3.5 border-b border-border py-3.5">
        <span className="grid size-14 flex-none place-items-center rounded-full bg-secondary font-display text-[24px] font-bold text-secondary-foreground">
          {me?.name[0]?.toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-display text-[22px] leading-7 font-bold">{me?.name}</span>
          <span className="truncate text-caption text-muted-foreground">{me?.email} · Mi cuenta</span>
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
      </Link>
      <Link to="/mas/apariencia" className="flex min-h-16 items-center gap-3.5 border-b border-border">
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="palette" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Apariencia</span>
          <span className="text-caption text-muted-foreground">Tema y color de acento</span>
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
      </Link>

      <span className="mt-6 border-b border-border pb-1 text-label text-muted-foreground">Muy pronto</span>
      <ul>
        {SOON.map(([icon, name, hint]) => (
          <li key={name} aria-disabled="true" className="flex min-h-14 items-center gap-3.5 border-b border-border text-muted-foreground">
            <span className="grid size-10 flex-none place-items-center rounded-full border-[1.5px] border-dashed border-border"><Icon name={icon} /></span>
            <span className="flex flex-col">
              <span className="font-semibold">{name}</span>
              <span className="text-caption">{hint}</span>
            </span>
          </li>
        ))}
      </ul>
    </main>
  );
}
