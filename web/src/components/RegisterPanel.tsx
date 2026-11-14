// Registrar en escritorio: un panel que entra por la derecha sobre la pantalla en la que estabas,
// como una ficha que se apoya encima del cuaderno sin cerrarlo. Al guardar o cerrar, vuelves ahí.
import { type ReactNode, useEffect, useRef } from "react";

import { useBack } from "@/lib/transitions";

export function RegisterPanel({ children }: { children: ReactNode }) {
  const back = useBack();
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(back);
  close.current = back;

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      // Una hoja abierta dentro del panel se cierra primero (ella misma escucha Esc)
      if (e.key === "Escape" && !document.querySelector(".sheet-panel")) { e.preventDefault(); close.current(); }
    };
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("keydown", onKey); before?.focus(); };
  }, []);

  return (
    <div className="fixed inset-0 z-[45]">
      <button type="button" aria-label="Cerrar" tabIndex={-1} onClick={() => close.current()} className="sheet-backdrop absolute inset-0 bg-black/30" />
      <div ref={panel} role="dialog" aria-modal="true" aria-label="Registrar" tabIndex={-1}
        className="register-panel pane absolute inset-y-0 right-0 w-[480px] max-w-full overflow-y-auto border-l border-border bg-background shadow-lg focus:outline-none">
        {children}
      </div>
    </div>
  );
}
