// X0 · Más: Mi cuenta, Pendientes (con su número), Inicio, Apariencia, Reportes (X2), Recurrentes (X1),
// Categorías (X3), Cierre de periodo (X4), Monedas y formato (X5) y, para el administrador, Tipo de cambio
// (Z1). Aparte, «En este equipo»: instalar PPM.
import { useState } from "react";
import { Link } from "react-router";

import { useMe, usePending } from "@/api/hooks";
import { INSTALL_HINT, InstallSheet, Logo } from "@/components/InstallSheet";
import { Icon } from "@/components/ui";
import { useInstall } from "@/lib/install";
import { shortDate } from "@/lib/dates";
import { formatNumber, symbolOf } from "@/lib/money";

export function Mas() {
  const me = useMe().data;
  const box = usePending().data;
  const count = box ? box.notices.length + box.activities.length : 0;
  const install = useInstall();
  const [installing, setInstalling] = useState(false);
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
      <Link to="/mas/monedas" className="flex min-h-16 items-center gap-3.5 border-b border-border">
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="currency_exchange" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Monedas y formato</span>
          <span className="text-caption text-muted-foreground tabular-nums">
            {me ? `${me.currencies.map((c) => symbolOf(c)).join(" · ")} · ${formatNumber("1284.90", me.lang ?? "es-PE")}` : "Tus monedas y cómo se escriben"}
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

      {/* No es una opción más de la lista: es sobre este equipo, en su propia sección */}
      <section aria-label="En este equipo" className="mt-6 flex flex-col gap-2">
        <span className="border-b border-border pb-1 text-label text-muted-foreground">En este equipo</span>
        <div className="flex items-center gap-3.5 rounded-lg bg-muted p-3.5">
          <Logo size={44} />
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="font-semibold">{install.state === "installed" ? "PPM está instalada" : "Instalar PPM"}</span>
            <span className="text-caption text-muted-foreground">{INSTALL_HINT[install.state]}</span>
          </span>
          {install.state !== "installed" && (
            <button type="button" onClick={() => setInstalling(true)} aria-label="Instalar PPM"
              className="flex h-10 flex-none items-center gap-1.5 rounded-full bg-primary px-4 text-[14px] font-semibold text-primary-foreground">
              <Icon name="install_desktop" className="text-[20px]" />Instalar
            </button>
          )}
        </div>
        <InstallSheet open={installing} onClose={() => setInstalling(false)} />
      </section>

    </main>
  );
}
