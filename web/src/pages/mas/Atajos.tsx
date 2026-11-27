// Más › Atajos de teclado (opción C): la lista de todos, cambiar las teclas de una letra (se guardan en
// la cuenta y valen en cualquier computadora), prender o apagar las pistas en la pantalla y volver a
// las de fábrica. Cómo se editan (opción A, 17-nov): la tecla misma es el botón, como una tecla de
// verdad que tocas para reasignarla; al tocarla espera la nueva. Esc, Ctrl + Enter y las flechas son
// fijas (las respeta todo programa): van aparte, más tenues y con candado.
import { useEffect, useState } from "react";

import { useMe, useUpdateMe } from "@/api/hooks";
import { Kbd } from "@/components/ShortcutsHelp";
import { BackLink } from "@/components/PageHeader";
import { ErrorAlert, Icon, SwitchRow } from "@/components/ui";
import { type Action, DEFAULT_KEYS, keyLabel, SHORTCUT_GROUPS, useShortcuts } from "@/lib/shortcuts";
import { Button } from "@/components/Button";

const NAMES: Record<Action, string> = { register: "Registrar", search: "Buscar", edit: "Editar", help: "Ver los atajos" };

const ROWS = SHORTCUT_GROUPS.flatMap((g) => g.rows);
const EDITABLE = ROWS.flatMap((r) => ("action" in r ? [r] : []));
const FIXED = ROWS.flatMap((r) => ("fixed" in r ? [{ ...r, label: g(r.label) }] : []));
/** Las del adjunto dicen de dónde son, ya que aquí no van bajo su título. */
function g(label: string) {
  const group = SHORTCUT_GROUPS.find((x) => x.rows.some((r) => r.label === label))!;
  return group.title === "Al ver un adjunto" ? `Adjunto: ${label.toLowerCase()}` : label;
}

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
      <div className="-mx-2.5 flex min-h-control items-center">
        <BackLink to="/mas" label="Volver a Más" />
      </div>
      <h1 className="mt-1 text-title-hero">Atajos de teclado</h1>
      <p className="mt-1 text-caption text-muted-foreground">
        En la computadora, para no soltar el teclado. Mientras escribes en un campo no hacen nada, salvo Ctrl + Enter.
      </p>

      <SwitchRow className="mt-4 min-h-14 border-y border-border" leading={<Icon name="tooltip" className="text-muted-foreground" />}
        title="Mostrar las pistas" hint="Las teclas junto al +, el buscador, Editar y abajo del detalle"
        checked={showHints} onChange={(on) => { setHintsOn(on); save.mutate({ shortcut_hints: on }); }} />

      <section aria-label="Los que puedes cambiar" className="mt-5 flex flex-col">
        <span className="text-label text-muted-foreground uppercase">Toca una tecla para cambiarla</span>
        {EDITABLE.map((r) => {
          const on = waiting === r.action;
          return (
            <div key={r.action} className={`flex min-h-13 items-center gap-4 border-b border-border ${on ? "-mx-3 rounded-md bg-muted px-3" : ""}`}>
              <span className="flex flex-1 flex-col">
                <span className="text-body-sm">{r.label}</span>
                {on && (
                  <span role="status" className="flex flex-col text-caption text-muted-foreground">
                    <span className="flex flex-wrap items-center gap-1"><Kbd>Esc</Kbd> para dejarla en <Kbd>{keyLabel(keys[r.action])}</Kbd></span>
                    <span>Sirve una letra, un número o un símbolo</span>
                  </span>
                )}
              </span>
              <button type="button" onClick={() => { save.reset(); setWaiting(on ? null : r.action); }}
                aria-label={`Cambiar la tecla de ${NAMES[r.action]}`} aria-pressed={on} title={on ? undefined : "Cambiar"}
                className={on
                  ? "hit-area flex h-9 min-w-38 items-center justify-center gap-1.5 rounded-md border-2 border-dashed border-foreground bg-card px-3 text-caption font-semibold"
                  : "hit-area flex h-9 min-w-11 items-center gap-1.5 rounded-md border border-b-3 border-input-line bg-card pr-1.5 pl-3 font-mono text-body-sm font-semibold hover:ring-3 hover:ring-muted focus-visible:ring-3 focus-visible:ring-muted"}>
                {on ? <><Icon name="keyboard" size="sm" />Aprieta una tecla…</>
                  : <>{keyLabel(keys[r.action])}<Icon name="edit" size="sm" className="text-muted-foreground" /></>}
              </button>
            </div>
          );
        })}
      </section>

      <section aria-label="Fijas" className="mt-6 flex flex-col">
        <span className="flex flex-col"><span className="text-label text-muted-foreground uppercase">Fijas</span><span className="text-caption text-muted-foreground">Las respeta todo programa</span></span>
        {FIXED.map((r) => (
          <div key={r.label} className="flex min-h-control items-center gap-4 border-b border-border">
            <span className="flex-1 text-body-sm text-muted-foreground">{r.label}</span>
            <span className="flex items-center gap-1 opacity-75">
              {r.fixed.map((k, i) => (
                <span key={k} className="flex items-center gap-1">
                  {i > 0 && r.fixed[0] === "Ctrl" && <span className="text-caption text-muted-foreground">+</span>}<Kbd>{k}</Kbd>
                </span>
              ))}
            </span>
            <span title="Fija" className="grid"><Icon name="lock" size="sm" className="text-muted-foreground" /><span className="sr-only">Fija</span></span>
          </div>
        ))}
      </section>

      {save.error && <div className="mt-3"><ErrorAlert>{save.error.message}</ErrorAlert></div>}

      {changed && (
        <Button variant="secondary" size="sm" start="restart_alt" pending={save.isPending} onClick={() => save.mutate({ shortcuts: {} })}
          className="mt-5 self-start">
          Volver a los de fábrica ({(Object.keys(DEFAULT_KEYS) as Action[]).map((a) => keyLabel(DEFAULT_KEYS[a])).join(" ")})
        </Button>
      )}
    </main>
  );
}
