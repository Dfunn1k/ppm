// X0 · Más (mínimo): Mi cuenta, Pendientes (con su número), Inicio, Reportes (X2), Apariencia, Recurrentes (X1), Categorías (X3), Cierre de periodo (X4) y, para el
// administrador, Tipo de cambio (Z1);
// lo demás llega con su rebanada.
import { Link } from "react-router";

import { useMe, usePending } from "@/api/hooks";
import { Icon } from "@/components/ui";
import { shortDate } from "@/lib/dates";

const SOON = [
  ["tune", "Monedas, idioma y formato", "Agregar monedas y cambiar cómo se ven"],
] as const;

export function Mas() {
  const me = useMe().data;
  const box = usePending().data;
  const count = box ? box.notices.length + box.activities.length : 0;
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
      <Link to="/pendientes" className="flex min-h-16 items-center gap-3.5 border-b border-border">
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="notifications" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Pendientes</span>
          <span className="text-caption text-muted-foreground">Avisos de PPM y tus recordatorios</span>
        </span>
        {count > 0 && (
          <span aria-label={`${count} pendientes`} className={`grid h-6 min-w-6 place-items-center rounded-full px-1.5 text-[13px] font-semibold tabular-nums ${box!.late > 0 ? "bg-attention-soft text-attention" : "bg-secondary text-secondary-foreground"}`}>
            {count}
          </span>
        )}
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
      </Link>
      <Link to="/mas/inicio" className="flex min-h-16 items-center gap-3.5 border-b border-border">
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="home" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Inicio</span>
          <span className="text-caption text-muted-foreground">Qué cuentas se ven y con cuál registras</span>
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
      <Link to="/mas/reportes" className="flex min-h-16 items-center gap-3.5 border-b border-border">
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="bar_chart" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Reportes</span>
          <span className="text-caption text-muted-foreground">En qué se va la plata, flujo, patrimonio y personas</span>
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
      </Link>
      <Link to="/mas/recurrentes" className="flex min-h-16 items-center gap-3.5 border-b border-border">
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="event_repeat" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Recurrentes</span>
          <span className="text-caption text-muted-foreground">Netflix, el alquiler, la cuota del préstamo</span>
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
      </Link>
      <Link to="/mas/categorias" className="flex min-h-16 items-center gap-3.5 border-b border-border">
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="category" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Categorías</span>
          <span className="text-caption text-muted-foreground">Las de gasto y de ingreso · crear nuevas</span>
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
      </Link>
      <Link to="/mas/cierre" className="flex min-h-16 items-center gap-3.5 border-b border-border">
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="lock_clock" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Cierre de periodo</span>
          <span className="text-caption text-muted-foreground">
            {me?.lock_date ? `Cerrado hasta el ${shortDate(me.lock_date)}` : "Que los meses revisados no cambien"}
          </span>
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
      </Link>
      {me?.is_admin && (
        <Link to="/mas/tipo-de-cambio" className="flex min-h-16 items-center gap-3.5 border-b border-border">
          <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="currency_exchange" className="text-[22px]" /></span>
          <span className="flex flex-1 flex-col">
            <span className="font-semibold">Tipo de cambio</span>
            <span className="text-caption text-muted-foreground">Solo administrador · SUNAT y a mano</span>
          </span>
          <Icon name="chevron_right" className="text-[22px] text-muted-foreground" />
        </Link>
      )}

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
