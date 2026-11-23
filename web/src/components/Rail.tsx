// El riel de escritorio (decisión «Escritorio»): a la izquierda, siempre visible, como el índice de
// un libro abierto. Arriba el logo y el + de registrar; debajo cada lugar de la app con su ícono y su
// nombre; abajo, tu inicial para ir a Mi cuenta. Solo desde 1024 px; en el celular sigue la barra.
import { useSyncExternalStore } from "react";
import { Link, useLocation } from "react-router";

import { useMe, usePending } from "@/api/hooks";
import { movesLink, rememberMoves } from "@/lib/movesFilter";
import { keyLabel, openShortcutsHelp, useShortcuts } from "@/lib/shortcuts";

import { registerLink } from "./AppNav";
import { Logo } from "./InstallSheet";
import { Kbd } from "./ShortcutsHelp";
import { Icon } from "./ui";

type Item = { to: string; label: string; icon: string; also?: string[] };

const ITEMS: Item[] = [
  { to: "/inicio", label: "Inicio", icon: "home" },
  { to: "/movimientos", label: "Movimientos", icon: "receipt_long", also: ["/por-clasificar"] },
  { to: "/cuentas", label: "Cuentas", icon: "account_balance_wallet", also: ["/tarjetas", "/prestamos", "/extractos"] },
  { to: "/presupuesto", label: "Presupuesto", icon: "savings" },
  { to: "/personas", label: "Personas", icon: "group" },
  { to: "/mas/reportes", label: "Reportes", icon: "bar_chart" },
  { to: "/mas/recurrentes", label: "Recurrentes", icon: "event_repeat" },
  { to: "/pendientes", label: "Pendientes", icon: "notifications" },
  { to: "/mas", label: "Más", icon: "menu" },
];

// Cuando la ventana es baja, lo que no cabe se guarda en Más, de a uno y en este orden (decisión «El
// riel cuando la ventana es baja»). El +, el logo y la inicial nunca se van ni se encogen.
const SPILL = ["/mas/reportes", "/presupuesto", "/pendientes"];
// Lo que ocupa el riel sin sus lugares: relleno (32), logo y su margen (48), + y su margen (68),
// teclado y su margen (52), la inicial (40) y los 4 px entre los cinco. Cada lugar suma 56 + 4.
const FIXED = 32 + 48 + 68 + 52 + 40 + 3 * 4;
const PER_ITEM = 60;

// Se guarda el k-ésimo cuando ya no caben todos: con menos de FIXED + PER_ITEM × (lugares − k + 1) px
// de alto (792, 732 y 672 con los nueve de hoy). Una consulta de medios por umbral avisa al cambiar.
const QUERIES = SPILL.map((_, k) => `(max-height: ${FIXED + PER_ITEM * (ITEMS.length - k) - 1}px)`);

function spillCount() {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return 0;
  return QUERIES.filter((q) => window.matchMedia(q).matches).length;
}

/** Los lugares que hoy no caben en el riel y van en Más. Se recalcula al cambiar el alto de la ventana. */
export function useRailSpill(): string[] {
  const n = useSyncExternalStore(
    (cb) => {
      const qs = typeof window.matchMedia === "function" ? QUERIES.map((q) => window.matchMedia(q)) : [];
      qs.forEach((q) => q.addEventListener("change", cb));
      return () => qs.forEach((q) => q.removeEventListener("change", cb));
    },
    spillCount, () => 0);
  return SPILL.slice(0, n);
}

/** El lugar marcado: el que empieza igual que la dirección, el más largo (Reportes antes que Más). Lo
 *  que se guardó en Más marca Más. */
export function railItem(path: string, spill: string[] = []) {
  let best: Item | undefined, len = 0;
  for (const i of shown(spill)) {
    for (const p of [i.to, ...(i.also ?? [])]) {
      if ((path === p || path.startsWith(`${p}/`)) && p.length > len) { best = i; len = p.length; }
    }
  }
  return best?.to;
}

function shown(spill: string[]): Item[] {
  return ITEMS.filter((i) => !spill.includes(i.to))
    .map((i) => (i.to === "/mas" ? { ...i, also: [...(i.also ?? []), ...spill] } : i));
}

export function Rail() {
  const location = useLocation();
  const me = useMe().data;
  const box = usePending().data;
  const pending = box ? box.notices.length + box.activities.length : 0;
  const spill = useRailSpill();
  const here = railItem(location.pathname, spill);
  const { keys, hints } = useShortcuts();
  rememberMoves(me?.id, location.pathname, location.search);
  return (
    <nav aria-label="Navegación principal"
      className="fixed inset-y-0 left-0 z-40 hidden w-[88px] flex-col items-center gap-1 overflow-y-auto border-r border-border bg-card py-4 lg:flex">
      <Link to="/inicio" aria-label="Inicio de PPM" className="mb-3 flex-none"><Logo size={36} /></Link>
      <Link to={registerLink(location.pathname, me?.home_account_id)} state={{ background: location }}
        aria-label="Registrar un movimiento" aria-keyshortcuts={keyLabel(keys.register)}
        className="group relative mb-4 grid size-[52px] flex-none place-items-center rounded-2xl bg-primary text-primary-foreground shadow-md">
        <Icon name="add" className="text-[26px]" />
        {hints && (
          <span role="tooltip" className="pointer-events-none fixed top-[94px] left-[96px] z-50 hidden -translate-y-1/2 items-center gap-2 rounded-lg bg-foreground px-2.5 py-1.5 text-[13px] leading-[18px] whitespace-nowrap text-background shadow-lg group-hover:flex group-focus-visible:flex">
            Registrar <Kbd dark>{keyLabel(keys.register)}</Kbd>
          </span>
        )}
      </Link>
      {shown(spill).map((i) => {
        const on = here === i.to;
        return (
          <Link key={i.to} to={i.to === "/movimientos" ? movesLink(me?.id) : i.to} aria-current={on ? "page" : undefined}
            className={`relative flex w-[72px] flex-none flex-col items-center gap-0.5 rounded-xl py-2 text-[12px] leading-4 ${on ? "bg-secondary font-semibold text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            <Icon name={i.icon} fill={on} className="text-[22px]" />
            {i.label}
            {i.to === (spill.includes("/pendientes") ? "/mas" : "/pendientes") && pending > 0 && (
              <span className="absolute top-1 right-3.5 grid h-4 min-w-4 place-items-center rounded-full bg-attention px-1 text-[10px] leading-none font-semibold text-background tabular-nums">
                {pending > 99 ? "99+" : pending}
              </span>
            )}
          </Link>
        );
      })}
      <button type="button" onClick={openShortcutsHelp} aria-label={`Atajos de teclado (tecla ${keyLabel(keys.help)})`}
        className="group mt-auto mb-2 grid size-11 flex-none place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-foreground">
        <Icon name="keyboard" className="text-[24px]" />
        {/* El mismo globo de «Registrar». Va fijo porque el riel recorta lo que sale de él; abajo
            quedan el botón (44), su margen (8), la inicial (40) y el relleno del riel (16). */}
        <span role="tooltip" className={`pointer-events-none fixed ${me ? "bottom-[86px]" : "bottom-[46px]"} left-[96px] z-50 hidden translate-y-1/2 items-center gap-2 rounded-lg bg-foreground px-2.5 py-1.5 text-[13px] leading-[18px] whitespace-nowrap text-background shadow-lg group-hover:flex group-focus-visible:flex`}>
          Atajos de teclado <Kbd dark>{keyLabel(keys.help)}</Kbd>
        </span>
      </button>
      {me && (
        <Link to="/mas/cuenta" aria-label={`Mi cuenta: ${me.name}`} title={me.name}
          className="grid size-10 flex-none place-items-center rounded-full bg-secondary font-semibold text-secondary-foreground">
          {me.name[0]?.toUpperCase()}
        </Link>
      )}
    </nav>
  );
}
