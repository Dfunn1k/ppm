// Más › Atajos de teclado (opción C): la lista de todos, cambiar las teclas de una letra (se guardan en
// la cuenta y valen en cualquier computadora), prender o apagar las pistas en la pantalla y volver a
// las de fábrica. Esc, Ctrl + Enter y las flechas son fijas: las respeta todo programa.
import { useEffect, useState } from "react";
import { Link } from "react-router";

import { useMe, useUpdateMe } from "@/api/hooks";
import { Kbd, ShortcutTable } from "@/components/ShortcutsHelp";
import { ErrorAlert, Icon } from "@/components/ui";
import { type Action, DEFAULT_KEYS, keyLabel, useShortcuts } from "@/lib/shortcuts";

const NAMES: Record<Action, string> = { register: "Registrar", search: "Buscar", edit: "Editar", help: "Ver los atajos" };

export function Atajos() {
  const me = useMe().data;
  const save = useUpdateMe();
  const { keys } = useShortcuts();
  const [waiting, setWaiting] = useState<Action | null>(null);
  const [hintsOn, setHintsOn] = useState<boolean | null>(null);   // se mueve al tocarlo, sin esperar a la API
  const showHints = hintsOn ?? me?.shortcut_hints ?? true;
  const changed = (Object.keys(DEFAULT_KEYS) as Action[]).some((a) => keys[a] !== DEFAULT_KEYS[a]);

  // Esperando la tecla nueva: la próxima que aprietes (Esc cancela). Se escucha antes que los atajos.
  useEffect(() => {
    if (!waiting) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || ["Shift", "CapsLock", "Tab"].includes(e.key)) return;
      e.preventDefault();
      e.stopPropagation();
      if (e.key !== "Escape") save.mutate({ shortcuts: { [waiting]: e.key } });
      setWaiting(null);
    };
    document.addEventListener("keydown", onKey, { capture: true });
    return () => document.removeEventListener("keydown", onKey, { capture: true });
  }, [waiting, save]);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col px-6 pt-4 pb-28">
      <div className="-mx-2.5 flex items-center">
        <Link to="/mas" aria-label="Volver a Más" className="grid size-11 place-items-center rounded-full">
          <Icon name="arrow_back" className="text-[24px]" />
        </Link>
      </div>
      <h1 className="mt-1 text-title-hero">Atajos de teclado</h1>
      <p className="mt-1 text-caption text-muted-foreground">
        En la computadora, para no soltar el teclado. Mientras escribes en un campo no hacen nada, salvo Ctrl + Enter.
      </p>

      <label className="mt-4 flex min-h-14 cursor-pointer items-center gap-3 border-y border-border">
        <Icon name="tooltip" className="text-muted-foreground" />
        <span className="flex flex-1 flex-col">
          <span>Mostrar las pistas</span>
          <span className="text-caption text-muted-foreground">Las teclas junto al +, el buscador, Editar y abajo del detalle</span>
        </span>
        <input type="checkbox" role="switch" checked={showHints}
          onChange={(e) => { setHintsOn(e.target.checked); save.mutate({ shortcut_hints: e.target.checked }); }}
          className="size-[22px] accent-primary" />
      </label>

      <ShortcutTable action={(a) => (
        <button type="button" onClick={() => { save.reset(); setWaiting(waiting === a ? null : a); }}
          aria-label={`Cambiar la tecla de ${NAMES[a]}`}
          className={`min-h-9 rounded-full px-3 text-caption font-semibold ${waiting === a ? "bg-primary text-primary-foreground" : "border border-border"}`}>
          {waiting === a ? "Aprieta…" : "Cambiar"}
        </button>
      )} />

      {waiting && (
        <p role="status" className="mt-3 flex flex-wrap items-center gap-1.5 rounded-md bg-muted p-3 text-caption">
          Aprieta la tecla nueva para «{NAMES[waiting]}»: una letra, un número o un símbolo. <Kbd>Esc</Kbd> para dejarla como está.
        </p>
      )}
      {save.error && <div className="mt-3"><ErrorAlert>{save.error.message}</ErrorAlert></div>}

      {changed && (
        <button type="button" disabled={save.isPending} onClick={() => save.mutate({ shortcuts: {} })}
          className="mt-5 flex h-11 items-center justify-center gap-1.5 self-start rounded-xl border border-border px-4 font-semibold">
          <Icon name="restart_alt" />Volver a los de fábrica ({(Object.keys(DEFAULT_KEYS) as Action[]).map((a) => keyLabel(DEFAULT_KEYS[a])).join(" ")})
        </button>
      )}
    </main>
  );
}
