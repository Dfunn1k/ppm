// Lista y detalle lado a lado en escritorio, como una bandeja de correo: la lista queda fija a la
// izquierda (no se recarga ni pierde su lugar al elegir) y lo elegido se abre a la derecha. En el
// celular cada una sigue siendo su propia pantalla, sin ningún cambio.
import { createContext, type ReactNode, useContext } from "react";
import { Navigate, useLocation, useOutlet } from "react-router";

import { useDesktop } from "@/lib/desktop";

import { EmptyState } from "./EmptyState";

const ListContext = createContext<ReactNode>(null);

/** Ruta-marco: en escritorio, `list` a la izquierda y la ruta hija a la derecha. */
export function Split({ list }: { list: ReactNode }) {
  const desktop = useDesktop();
  const outlet = useOutlet();
  // El detalle queda en el mismo lugar del árbol en los dos anchos: si la ventana cruza los 1024 px,
  // no se vuelve a montar (no se pierde, por ejemplo, el visor de adjuntos abierto)
  return (
    <ListContext.Provider value={list}>
      <div className={desktop ? "flex h-dvh" : "contents"}>
        {desktop && <div className="pane pane-list w-80 flex-none overflow-y-auto border-r border-border xl:w-100 2xl:w-110">{list}</div>}
        <div className={desktop ? "pane pane-detail min-w-0 flex-1 overflow-y-auto" : "contents"}>{outlet}</div>
      </div>
    </ListContext.Provider>
  );
}

/** La dirección de la lista sola (/cuentas): en el celular es la lista; en escritorio, a la derecha,
 *  la invitación a elegir algo, o se abre directamente `to`. */
export function SplitIndex({ icon, title, children, to }: { icon?: string; title?: string; children?: ReactNode; to?: string }) {
  const desktop = useDesktop();
  const list = useContext(ListContext);
  const search = useLocation().search;    // el mes elegido (?mes=) viaja con lo que se abre al lado
  if (!desktop) return list;
  if (to) return <Navigate to={to + search} replace />;
  return (
    <div className="grid h-full place-items-center px-10">
      <div className="max-w-sm"><EmptyState icon={icon ?? "left_click"} title={title ?? ""}>{children}</EmptyState></div>
    </div>
  );
}
