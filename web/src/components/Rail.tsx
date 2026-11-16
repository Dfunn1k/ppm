// El riel de escritorio (decisión «Escritorio»): a la izquierda, siempre visible, como el índice de
// un libro abierto. Arriba el logo y el + de registrar; debajo cada lugar de la app con su ícono y su
// nombre; abajo, tu inicial para ir a Mi cuenta. Solo desde 1024 px; en el celular sigue la barra.
import { Link, useLocation } from "react-router";

import { useMe, usePending } from "@/api/hooks";
import { movesLink, rememberMoves } from "@/lib/movesFilter";

import { registerLink } from "./AppNav";
import { Logo } from "./InstallSheet";
import { Icon } from "./ui";

type Item = { to: string; label: string; icon: string; also?: string[] };

const ITEMS: Item[] = [
  { to: "/inicio", label: "Inicio", icon: "home" },
  { to: "/movimientos", label: "Movimientos", icon: "receipt_long", also: ["/por-clasificar"] },
  { to: "/cuentas", label: "Cuentas", icon: "account_balance_wallet", also: ["/tarjetas", "/prestamos", "/extractos"] },
  { to: "/personas", label: "Personas", icon: "group" },
  { to: "/mas/reportes", label: "Reportes", icon: "bar_chart" },
  { to: "/mas/recurrentes", label: "Recurrentes", icon: "event_repeat" },
  { to: "/pendientes", label: "Pendientes", icon: "notifications" },
  { to: "/mas", label: "Más", icon: "menu" },
];

/** El lugar marcado: el que empieza igual que la dirección, el más largo (Reportes antes que Más). */
export function railItem(path: string) {
  let best: Item | undefined, len = 0;
  for (const i of ITEMS) {
    for (const p of [i.to, ...(i.also ?? [])]) {
      if ((path === p || path.startsWith(`${p}/`)) && p.length > len) { best = i; len = p.length; }
    }
  }
  return best?.to;
}

export function Rail() {
  const location = useLocation();
  const me = useMe().data;
  const box = usePending().data;
  const pending = box ? box.notices.length + box.activities.length : 0;
  const here = railItem(location.pathname);
  rememberMoves(me?.id, location.pathname, location.search);
  return (
    <nav aria-label="Navegación principal"
      className="fixed inset-y-0 left-0 z-40 hidden w-[88px] flex-col items-center gap-1 overflow-y-auto border-r border-border bg-card py-4 lg:flex">
      <Link to="/inicio" aria-label="PPM · Inicio" className="mb-3"><Logo size={36} /></Link>
      <Link to={registerLink(location.pathname, me?.home_account_id)} state={{ background: location }}
        aria-label="Registrar un movimiento" title="Registrar (N)" aria-keyshortcuts="N"
        className="mb-4 grid size-[52px] place-items-center rounded-2xl bg-primary text-primary-foreground shadow-md">
        <Icon name="add" className="text-[26px]" />
      </Link>
      {ITEMS.map((i) => {
        const on = here === i.to;
        return (
          <Link key={i.to} to={i.to === "/movimientos" ? movesLink(me?.id) : i.to} aria-current={on ? "page" : undefined}
            className={`relative flex w-[72px] flex-col items-center gap-0.5 rounded-xl py-2 text-[12px] leading-4 ${on ? "bg-secondary font-semibold text-secondary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
            <Icon name={i.icon} fill={on} className="text-[22px]" />
            {i.label}
            {i.to === "/pendientes" && pending > 0 && (
              <span className="absolute top-1 right-3.5 grid h-4 min-w-4 place-items-center rounded-full bg-attention px-1 text-[10px] leading-none font-semibold text-background tabular-nums">
                {pending > 99 ? "99+" : pending}
              </span>
            )}
          </Link>
        );
      })}
      {me && (
        <Link to="/mas/cuenta" aria-label={`Mi cuenta: ${me.name}`} title={me.name}
          className="mt-auto grid size-10 flex-none place-items-center rounded-full bg-secondary font-semibold text-secondary-foreground">
          {me.name[0]?.toUpperCase()}
        </Link>
      )}
    </nav>
  );
}
