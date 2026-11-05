// La barra de abajo del diseño final: Inicio, Movimientos, el + para registrar (con la cuenta que estás
// mirando), Cuentas y Más.
import { Link, NavLink, useLocation } from "react-router";

import { useMe } from "@/api/hooks";

import { Icon } from "./ui";

type Item = { to?: string; label: string; icon: string };

const ITEMS: Item[] = [
  { to: "/inicio", label: "Inicio", icon: "home" },
  { to: "/movimientos", label: "Movimientos", icon: "receipt_long" },
  { label: "Cuentas", to: "/cuentas", icon: "account_balance_wallet" },
  { to: "/mas", label: "Más", icon: "menu" },
];

/** Personas y las tarjetas viven dentro de Cuentas, Por clasificar dentro de Movimientos y Pendientes se
 *  abre desde el Inicio: ahí también se marcan. */
const ALSO: Record<string, string[]> = {
  "/inicio": ["/pendientes"], "/cuentas": ["/personas", "/tarjetas"], "/movimientos": ["/por-clasificar"],
};

function Tab({ item }: { item: Item }) {
  const path = useLocation().pathname;
  const also = !!item.to && (ALSO[item.to]?.some((p) => path.startsWith(p)) ?? false);
  if (!item.to) {
    return (
      <span aria-disabled="true" title="Muy pronto" className="flex flex-col items-center gap-0.5 text-[12px] leading-4 text-muted-foreground opacity-60">
        <span className="grid h-[30px] place-items-center">
          <Icon name={item.icon} className="text-[22px]" />
        </span>
        {item.label}
      </span>
    );
  }
  return (
    <NavLink to={item.to} aria-current={also ? "page" : undefined}
      className="flex flex-col items-center gap-0.5 text-[12px] leading-4 text-muted-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground">
      {({ isActive: exact }) => { const isActive = exact || also; return (
        <>
          <span className={`grid h-[30px] place-items-center ${isActive ? "w-14 rounded-full bg-secondary text-secondary-foreground" : ""}`}>
            <Icon name={item.icon} fill={isActive} className="text-[22px]" />
          </span>
          {item.label}
        </>
      ); }}
    </NavLink>
  );
}

/** El + registra con la cuenta o tarjeta que estás mirando; en el Inicio, con la elegida en Más › Inicio;
 *  en otra pantalla, sin cuenta elegida. */
function registerLink(path: string, homeAccount: number | null | undefined) {
  const id = /^\/(?:cuentas|tarjetas)\/(\d+)/.exec(path)?.[1] ?? (path === "/inicio" && homeAccount ? String(homeAccount) : null);
  return id ? `/registrar?cuenta=${id}` : "/registrar";
}

export function AppNav() {
  const path = useLocation().pathname;
  const homeAccount = useMe().data?.home_account_id;
  return (
    <nav aria-label="Navegación principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card">
      <div className="mx-auto grid h-[76px] max-w-md grid-cols-5 items-center px-2 pb-2">
        <Tab item={ITEMS[0]!} />
        <Tab item={ITEMS[1]!} />
        <Link to={registerLink(path, homeAccount)} aria-label="Registrar un movimiento"
          className="-mt-7 grid size-14 place-items-center justify-self-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <Icon name="add" className="text-[28px]" />
        </Link>
        <Tab item={ITEMS[2]!} />
        <Tab item={ITEMS[3]!} />
      </div>
    </nav>
  );
}
