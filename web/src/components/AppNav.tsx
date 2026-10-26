// La barra de abajo del diseño final. Funcionan Inicio (provisional), Movimientos, el + y Cuentas;
// «Más» llega con su rebanada y se ve, pero no se puede tocar.
import { Link, NavLink } from "react-router";

import { Icon } from "./ui";

type Item = { to?: string; label: string; icon: string };

const ITEMS: Item[] = [
  { to: "/inicio", label: "Inicio", icon: "home" },
  { to: "/movimientos", label: "Movimientos", icon: "receipt_long" },
  { label: "Cuentas", to: "/cuentas", icon: "account_balance_wallet" },
  { label: "Más", icon: "menu" },
];

function Tab({ item }: { item: Item }) {
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
    <NavLink to={item.to} className="flex flex-col items-center gap-0.5 text-[12px] leading-4 text-muted-foreground aria-[current=page]:font-semibold aria-[current=page]:text-foreground">
      {({ isActive }) => (
        <>
          <span className={`grid h-[30px] place-items-center ${isActive ? "w-14 rounded-full bg-secondary text-secondary-foreground" : ""}`}>
            <Icon name={item.icon} fill={isActive} className="text-[22px]" />
          </span>
          {item.label}
        </>
      )}
    </NavLink>
  );
}

export function AppNav() {
  return (
    <nav aria-label="Navegación principal" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card">
      <div className="mx-auto grid h-[76px] max-w-md grid-cols-5 items-center px-2 pb-2">
        <Tab item={ITEMS[0]!} />
        <Tab item={ITEMS[1]!} />
        <Link to="/registrar" aria-label="Registrar un movimiento"
          className="-mt-7 grid size-14 place-items-center justify-self-center rounded-full bg-primary text-primary-foreground shadow-lg">
          <Icon name="add" className="text-[28px]" />
        </Link>
        <Tab item={ITEMS[2]!} />
        <Tab item={ITEMS[3]!} />
      </div>
    </nav>
  );
}
