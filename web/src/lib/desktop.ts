// Cortes de pantalla (docs/frontend/SISTEMA.md 2.1): desde 768 px (tablet) la barra de abajo pasa a ser
// el riel de la izquierda, Registrar se abre como panel y las hojas como ventana; desde 1024 px
// (escritorio) lo elegido se abre además al lado de su lista. En el celular nada cambia.
import { useCallback, useRef, useSyncExternalStore } from "react";

export const RAIL = "(min-width: 768px)";
export const DESKTOP = "(min-width: 1024px)";

function query(q = DESKTOP) {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(q) : null;
}

function useQuery(q: string) {
  return useSyncExternalStore(
    (cb) => {
      const m = query(q);
      m?.addEventListener("change", cb);
      return () => m?.removeEventListener("change", cb);
    },
    () => query(q)?.matches ?? false,
    () => false,
  );
}

/** ¿Hay riel? Desde 768 px: tablet y computadora. */
export function useRail() {
  return useQuery(RAIL);
}

/** Lo mismo, fuera de React. */
export function isRail() {
  return query(RAIL)?.matches ?? false;
}

/** ¿La ventana es de escritorio? Se vuelve a pintar si cambia de ancho. */
export function useDesktop() {
  return useQuery(DESKTOP);
}

/** Lo mismo, fuera de React (al navegar, en los atajos). */
export function isDesktop() {
  return query()?.matches ?? false;
}

/** En la computadora, el campo empieza con el foco (el monto al registrar): un ref que se pone en el
 *  input y lo enfoca la primera vez que aparece, aunque la pantalla pinte antes un «cargando». */
export function useDesktopFocus<T extends HTMLElement>() {
  const done = useRef(false);
  return useCallback((el: T | null) => {
    if (!el || done.current || !isDesktop()) return;
    done.current = true;
    el.focus({ preventScroll: true });
  }, []);
}
