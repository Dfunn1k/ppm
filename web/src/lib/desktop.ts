// Escritorio: desde 1024 px de ancho la app cambia la barra de abajo por el riel de la izquierda y
// abre lo elegido al lado de su lista. En el celular nada cambia.
import { useCallback, useRef, useSyncExternalStore } from "react";

export const DESKTOP = "(min-width: 1024px)";

function query() {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" ? window.matchMedia(DESKTOP) : null;
}

/** ¿La ventana es de escritorio? Se vuelve a pintar si cambia de ancho. */
export function useDesktop() {
  return useSyncExternalStore(
    (cb) => {
      const q = query();
      q?.addEventListener("change", cb);
      return () => q?.removeEventListener("change", cb);
    },
    () => query()?.matches ?? false,
    () => false,
  );
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
