// La barra de abajo del diseño final: Inicio, Movimientos, el + para registrar (con la cuenta que estás
// mirando), Cuentas y Más.
import { Link, NavLink, useLocation } from "react-router";

import { useMe } from "@/api/hooks";
import { movesLink, rememberMoves } from "@/lib/movesFilter";

import { Icon } from "./ui";

type Item = { to?: string; label: string; icon: string };

const ITEMS: Item[] = [
  { to: "/inicio", label: "Inicio", icon: "home" },
  { to: "/movimientos", label: "Movimientos", icon: "receipt_long" },
  { label: "Cuentas", to: "/cuentas", icon: "account_balance_wallet" },
  { to: "/mas", label: "Más", icon: "menu" },
];

/** Personas y las tarjetas viven dentro de Cuentas y Por clasificar dentro de Movimientos: ahí también se
 *  marcan. Pendientes se abre desde el Inicio o desde Más: se marca la pestaña desde la que llegaste. */
const ALSO: Record<string, string[]> = {
  "/cuentas": ["/personas", "/tarjetas", "/prestamos"], "/movimientos": ["/por-clasificar"], "/mas": ["/presupuesto"],
};
const FROM_WHERE_YOU_CAME = ["/pendientes"];
let lastTab = "/inicio";

function tabOf(path: string) {
  return ITEMS.find((i) => i.to && (path.startsWith(i.to) || ALSO[i.to]?.some((p) => path.startsWith(p))))?.to;
}

function Tab({ item, to }: { item: Item; to?: string }) {
  const path = useLocation().pathname;
  const also = !!item.to && (FROM_WHERE_YOU_CAME.some((p) => path.startsWith(p))
    ? lastTab === item.to
    : (ALSO[item.to]?.some((p) => path.startsWith(p)) ?? false));
  if (!item.to) {
    return (
      <span aria-disabled="true" title="Muy pronto" className="flex flex-col items-center gap-0.5 text-caption-sm text-muted-foreground opacity-60">
        <span className="grid h-8 place-items-center">
          <Icon name={item.icon} size="md" />
        </span>
        {item.label}
      </span>
    );
  }
  return (
    <NavLink to={to ?? item.to} aria-current={also ? "page" : undefined}
      className="flex flex-col items-center gap-0.5 text-caption-sm text-muted-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground">
      {({ isActive: exact }) => { const isActive = exact || also; return (
        <>
          <span className={`grid h-8 place-items-center ${isActive ? "w-14 rounded-full bg-secondary text-secondary-foreground" : ""}`}>
            <Icon name={item.icon} fill={isActive} size="md" />
          </span>
          {item.label}
        </>
      ); }}
    </NavLink>
  );
}

/** El + registra con la cuenta o tarjeta que estás mirando; en cualquier otra pantalla, con la elegida
 *  en Más › Inicio (si no hay, Registrar arranca con la primera de tus cuentas). */
export function registerLink(path: string, homeAccount: number | null | undefined) {
  const id = /^\/(?:cuentas|tarjetas)\/(\d+)/.exec(path)?.[1] ?? (homeAccount ? String(homeAccount) : null);
  return id ? `/registrar?cuenta=${id}` : "/registrar";
}

export function AppNav() {
  const { pathname: path, search } = useLocation();
  const here = tabOf(path);
  if (here && !FROM_WHERE_YOU_CAME.some((p) => path.startsWith(p))) lastTab = here;
  const me = useMe().data;
  const homeAccount = me?.home_account_id;
  rememberMoves(me?.id, path, search);
  return (
    <nav aria-label="Navegación principal" className="app-nav fixed inset-x-0 bottom-0 z-nav border-t border-border bg-card md:hidden">
      <div className="mx-auto grid h-19 max-w-md grid-cols-5 items-center px-2 pb-2">
        <Tab item={ITEMS[0]!} />
        <Tab item={ITEMS[1]!} to={movesLink(me?.id)} />
        <Link to={registerLink(path, homeAccount)} state={{ from: path }} data-from={path} aria-label="Registrar un movimiento"
          className="-mt-7 grid size-14 place-items-center justify-self-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <Icon name="add" size="lg" />
        </Link>
        <Tab item={ITEMS[2]!} />
        <Tab item={ITEMS[3]!} />
      </div>
    </nav>
  );
}
