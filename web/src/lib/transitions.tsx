// Transiciones entre pantallas con la API View Transitions del navegador: entrar a un detalle desliza
// desde la derecha (y lo de atrás se corre un poco), volver hace lo contrario y cambiar de pestaña es
// un fundido corto. La barra de abajo no se mueve. Con «reducir movimiento», o en un navegador sin la
// API, se navega sin animar.
//
// Cada clic en un enlace interno se navega aquí, dentro de la transición: así el navegador fotografía
// la pantalla de antes y la de después. Los «Volver» que regresan en el historial usan useBack().
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

import { isRail } from "./desktop";

/** Las pestañas de la barra: entre ellas, fundido. */
const TABS = ["/inicio", "/movimientos", "/cuentas", "/mas"];

/** Qué tan adentro está una pantalla: las pestañas en 0, lo demás por sus tramos. */
function depth(path: string) {
  return TABS.includes(path) ? 0 : path.split("/").filter(Boolean).length;
}

export function direction(from: string, to: string): "forward" | "back" | "tab" {
  const a = depth(from), b = depth(to);
  return b > a ? "forward" : b < a ? "back" : "tab";
}

type Run = (to: string, go: () => void) => void;
let run: Run | null = null;   // lo registra <ViewTransitions /> al montarse

/** Navegar hacia atrás en el historial con la transición de «volver». */
export function useBack() {
  const navigate = useNavigate();
  return useCallback(() => {
    const go = () => navigate(-1);
    if (run) run("", go);
    else go();
  }, [navigate]);
}

/** Se monta una vez, dentro del router: intercepta los enlaces internos y anima la navegación. */
export function ViewTransitions() {
  const navigate = useNavigate();
  const location = useLocation();
  const pending = useRef<(() => void) | null>(null);

  // La pantalla nueva ya está en el DOM: la transición puede fotografiarla
  useLayoutEffect(() => {
    pending.current?.();
    pending.current = null;
  }, [location.key]);

  useEffect(() => {
    if (!("startViewTransition" in document)) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const root = document.documentElement;
    run = (to, go) => {
      // En escritorio lo elegido se abre al lado de la lista: nada se desliza
      if (reduce.matches || isRail()) return go();
      root.dataset.nav = to ? direction(window.location.pathname, to) : "back";
      const t = document.startViewTransition(() => new Promise<void>((resolve) => {
        pending.current = resolve;
        go();
        setTimeout(resolve, 500);   // por si la navegación no cambia de pantalla
      }));
      t.finished.finally(() => { delete root.dataset.nav; });
    };
    const onClick = (e: MouseEvent) => {
      // En escritorio el enlace navega solo (y conserva su estado, como el + que abre el panel)
      if (isRail() || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || !a.getAttribute("href") || a.target || a.hasAttribute("download")) return;
      const url = new URL(a.href);
      if (url.origin !== window.location.origin || url.pathname.startsWith("/api/")) return;
      const to = url.pathname + url.search + url.hash;
      if (to === window.location.pathname + window.location.search + window.location.hash) return;
      e.preventDefault();   // el Link ya no navega (su onClick sí corre); navegamos aquí, dentro de la transición
      // El estado del enlace no llega por aquí: «data-from» lo lleva (adónde volver al registrar) y al
      // reemplazar (cambiar de tipo en Registrar) se conserva el de la pantalla actual
      const replace = a.dataset.replace === "true";
      const state = a.dataset.from ? { from: a.dataset.from }
        : replace ? (window.history.state as { usr?: unknown } | null)?.usr : undefined;
      run!(url.pathname, () => navigate(to, { replace, state }));
    };
    document.addEventListener("click", onClick, true);
    return () => {
      document.removeEventListener("click", onClick, true);
      run = null;
    };
  }, [navigate]);

  return null;
}
