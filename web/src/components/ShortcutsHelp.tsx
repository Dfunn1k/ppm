// La hoja con todos los atajos (opción A): se abre con «?» o con el botón de teclado del riel.
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { keyLabel, SHORTCUT_GROUPS, useShortcuts } from "@/lib/shortcuts";

import { Sheet } from "./Sheet";

export function Kbd({ children, dark }: { children: React.ReactNode; dark?: boolean }) {
  return (
    <kbd className={`inline-grid min-w-6 place-items-center rounded-md border px-1.5 font-mono text-[12px] leading-[18px] font-medium ${
      dark ? "border-transparent bg-white/20 text-current" : "border-border border-b-2 bg-card text-foreground"}`}>
      {children}
    </kbd>
  );
}

/** La tabla de atajos, con las teclas de la persona. `action` pone algo al costado (Cambiar, en Más). */
export function ShortcutTable({ action }: { action?: (a: "register" | "search" | "edit" | "help") => React.ReactNode }) {
  const { keys } = useShortcuts();
  return (
    <div className="flex flex-col">
      {SHORTCUT_GROUPS.map((g) => (
        <section key={g.title} aria-label={g.title} className="flex flex-col">
          <span className="mt-4 text-label text-muted-foreground uppercase">{g.title}</span>
          {g.rows.map((r) => (
            <div key={r.label} className="flex min-h-11 items-center gap-4 border-b border-border">
              <span className="flex-1 text-[14px] leading-5">{r.label}</span>
              <span className="flex items-center gap-1">
                {"action" in r ? <Kbd>{keyLabel(keys[r.action])}</Kbd>
                  : r.fixed.map((k, i) => <span key={k} className="flex items-center gap-1">{i > 0 && r.fixed[0] === "Ctrl" && <span className="text-caption text-muted-foreground">+</span>}<Kbd>{k}</Kbd></span>)}
              </span>
              {action && <span className="w-24 text-right">{"action" in r ? action(r.action) : <span className="text-caption text-muted-foreground">Fija</span>}</span>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

export function ShortcutsHelp() {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener("ppm:atajos", show);
    return () => window.removeEventListener("ppm:atajos", show);
  }, []);
  return (
    <Sheet title="Atajos de teclado" open={open} onClose={() => setOpen(false)}>
      <div className="flex flex-col px-2 pb-2">
        <ShortcutTable />
        <p className="mt-3 text-caption text-muted-foreground">
          Solo en la computadora. Mientras escribes en un campo no hacen nada, salvo Ctrl + Enter.
        </p>
        <Link to="/mas/atajos" onClick={() => setOpen(false)} className="mt-2 flex min-h-11 items-center text-[14px] font-semibold underline">
          Cambiar teclas o apagar las pistas
        </Link>
      </div>
    </Sheet>
  );
}
