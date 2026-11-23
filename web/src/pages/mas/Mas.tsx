// X0 · Más: Mi cuenta, Pendientes (con su número), Inicio, Apariencia, Reportes (X2), Recurrentes (X1),
// Categorías (X3), Cierre de periodo (X4), Monedas y formato (X5) y, para el administrador, Tipo de cambio
// (Z1). Aparte, «En este equipo»: instalar PPM. En la computadora es el índice de la izquierda (como los
// Ajustes del sistema): el ajuste elegido se abre al lado y no se repite lo que ya está en el riel.
import { useState } from "react";
import { Link, NavLink } from "react-router";

import { useMe, usePending } from "@/api/hooks";
import { INSTALL_HINT, InstallSheet, Logo } from "@/components/InstallSheet";
import { useRailSpill } from "@/components/Rail";
import { Icon } from "@/components/ui";
import { useDesktop } from "@/lib/desktop";
import { useInstall } from "@/lib/install";
import { shortDate } from "@/lib/dates";
import { CURRENCY_NAME, formatNumber } from "@/lib/money";
import { capitalize, listText } from "@/lib/utils";

const CURRENT = "lg:-mx-3 lg:rounded-lg lg:border-0 lg:px-3 lg:aria-[current=page]:bg-muted lg:aria-[current=page]:shadow-[inset_3px_0_0_var(--foreground)]";
const ROW = `flex min-h-16 items-center gap-3.5 border-b border-border lg:min-h-14 ${CURRENT}`;

export function Mas() {
  const me = useMe().data;
  const box = usePending().data;
  const count = box ? box.notices.length + box.activities.length : 0;
  const install = useInstall();
  const [installing, setInstalling] = useState(false);
  const desktop = useDesktop();   // los atajos de teclado son de la computadora
  // En escritorio, Pendientes y Reportes están en el riel; si la ventana es baja y no caben, vuelven aquí
  const spill = useRailSpill();
  const inRail = (to: string) => desktop && !spill.includes(to);
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-8 pb-28">
      <h1 className="text-label text-muted-foreground uppercase lg:font-display lg:text-[36px] lg:leading-10 lg:font-extrabold lg:tracking-[-0.03em] lg:text-foreground lg:normal-case">Más</h1>
      <NavLink to="/mas/cuenta" className={`mt-4 flex items-center gap-3.5 border-b border-border py-3.5 ${CURRENT}`}>
        <span className="grid size-14 flex-none place-items-center rounded-full bg-secondary font-display text-[24px] font-bold text-secondary-foreground">
          {me?.name[0]?.toUpperCase()}
        </span>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate font-display text-[22px] leading-7 font-bold">{me?.name}</span>
          <span className="truncate text-caption text-muted-foreground">{me?.email}</span>
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground lg:hidden" />
      </NavLink>
      {!inRail("/pendientes") && (
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
          <Icon name="chevron_right" className="text-[22px] text-muted-foreground lg:hidden" />
        </Link>
      )}
      <Link to="/presupuesto" className={ROW}>
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="savings" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Presupuesto</span>
          <span className="text-caption text-muted-foreground">Tus sobres: a qué va cada sol</span>
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground lg:hidden" />
      </Link>
      <NavLink to="/mas/inicio" className={ROW}>
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="home" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Inicio</span>
          <span className="text-caption text-muted-foreground">Qué cuentas se ven y con cuál registras</span>
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground lg:hidden" />
      </NavLink>
      <NavLink to="/mas/apariencia" className={ROW}>
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="palette" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Apariencia</span>
          <span className="text-caption text-muted-foreground">Tema y color de acento</span>
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground lg:hidden" />
      </NavLink>
      {!inRail("/mas/reportes") && (
        <Link to="/mas/reportes" className="flex min-h-16 items-center gap-3.5 border-b border-border">
          <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="bar_chart" className="text-[22px]" /></span>
          <span className="flex flex-1 flex-col">
            <span className="font-semibold">Reportes</span>
            <span className="text-caption text-muted-foreground">En qué se va la plata, flujo, patrimonio y personas</span>
          </span>
          <Icon name="chevron_right" className="text-[22px] text-muted-foreground lg:hidden" />
        </Link>
      )}
      {!desktop && (
        <Link to="/mas/recurrentes" className="flex min-h-16 items-center gap-3.5 border-b border-border">
          <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="event_repeat" className="text-[22px]" /></span>
          <span className="flex flex-1 flex-col">
            <span className="font-semibold">Recurrentes</span>
            <span className="text-caption text-muted-foreground">Netflix, el alquiler, la cuota del préstamo</span>
          </span>
          <Icon name="chevron_right" className="text-[22px] text-muted-foreground lg:hidden" />
        </Link>
      )}
      <NavLink to="/mas/categorias" className={ROW}>
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="category" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Categorías</span>
          <span className="text-caption text-muted-foreground">Las de gasto y de ingreso, y crea las tuyas</span>
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground lg:hidden" />
      </NavLink>
      <NavLink to="/mas/etiquetas" className={ROW}>
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="sell" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Etiquetas</span>
          <span className="text-caption text-muted-foreground">Viaje a Cusco, la boda, la mudanza</span>
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground lg:hidden" />
      </NavLink>
      {desktop && (
        <NavLink to="/mas/atajos" className={ROW}>
          <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="keyboard" className="text-[22px]" /></span>
          <span className="flex flex-1 flex-col">
            <span className="font-semibold">Atajos de teclado</span>
            <span className="text-caption text-muted-foreground">Ver, cambiar las teclas y las pistas</span>
          </span>
          <Icon name="chevron_right" className="text-[22px] text-muted-foreground lg:hidden" />
        </NavLink>
      )}
      <NavLink to="/mas/cierre" className={ROW}>
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="lock_clock" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Cierre de periodo</span>
          <span className="text-caption text-muted-foreground">
            {me?.lock_date ? `Cerrado hasta el ${shortDate(me.lock_date)}` : "Que los meses revisados no cambien"}
          </span>
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground lg:hidden" />
      </NavLink>
      <NavLink to="/mas/monedas" className={ROW}>
        <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="currency_exchange" className="text-[22px]" /></span>
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Monedas y formato</span>
          {me ? (
            <span className="flex flex-col text-caption text-muted-foreground tabular-nums">
              <span>{capitalize(listText(me.currencies.map((c) => CURRENCY_NAME[c] ?? c)))}</span>
              <span>Así: {formatNumber("1284.90", me.lang ?? "es-PE")}</span>
            </span>
          ) : <span className="text-caption text-muted-foreground">Tus monedas y cómo se escriben</span>}
        </span>
        <Icon name="chevron_right" className="text-[22px] text-muted-foreground lg:hidden" />
      </NavLink>
      {me?.is_admin && (
        <NavLink to="/mas/tipo-de-cambio" className={ROW}>
          <span className="grid size-10 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="currency_exchange" className="text-[22px]" /></span>
          <span className="flex flex-1 flex-col">
            <span className="flex justify-between gap-2"><span className="font-semibold">Tipo de cambio</span><span className="flex-none text-[12px] leading-[22px] font-semibold text-muted-foreground">Solo administrador</span></span>
            <span className="text-caption text-muted-foreground">De SUNAT o a mano</span>
          </span>
          <Icon name="chevron_right" className="text-[22px] text-muted-foreground lg:hidden" />
        </NavLink>
      )}

      {/* No es una opción más de la lista: es sobre este equipo, en su propia sección; en la
          computadora baja al pie del índice */}
      <div className="flex flex-col lg:mt-auto">
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
      {/* Al pie: Privacidad, la versión y que PPM está en beta (decisión «Versiones de PPM») */}
      <div className="mt-6 flex flex-col items-center gap-1 text-center text-caption text-muted-foreground">
        <Link to="/privacidad" className="underline">Privacidad</Link>
        <span className="mt-1 tabular-nums">v{__PPM_VERSION__}</span>
        {__PPM_VERSION__.startsWith("0.") && (
          <span className="inline-flex h-5 items-center rounded-full border border-border bg-muted px-2 text-[11px] leading-[14px] font-semibold tracking-[0.06em]">
            BETA
          </span>
        )}
      </div>
      </div>
    </main>
  );
}
