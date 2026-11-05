// La hoja que sube desde abajo (y baja al cerrarse, con el fondo que se aclara), y el campo que la
// abre para elegir de una lista.
// Regla del sistema de diseño: nunca el selector del navegador, sin logos ni iniciales de marcas.
import { type ReactNode, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { Icon } from "./ui";

export function Sheet({ title, open, onClose, children }: {
  title: string;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const titleId = useId();
  // Al cerrarse sigue montada un momento, mientras baja
  const [leaving, setLeaving] = useState(false);
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    setLeaving(!open);
  }
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => setLeaving(false), 200);
    return () => clearTimeout(t);
  }, [leaving]);

  useEffect(() => {
    if (!open) return;
    const before = document.activeElement as HTMLElement | null;
    // El foco va a la opción elegida o a la hoja: nunca a la búsqueda (en el celular abriría el teclado)
    const selected = panel.current?.querySelector<HTMLElement>("[aria-checked='true']");
    (selected ?? panel.current)?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close.current();
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [open]);

  if (!open && !leaving) return null;
  // Fuera del árbol de la pantalla: una hoja con su propio formulario no queda dentro de otro
  return createPortal(
    <div className={`fixed inset-0 z-50 ${leaving ? "sheet-leaving pointer-events-none" : ""}`}
      aria-hidden={leaving || undefined} inert={leaving || undefined}>
      <button type="button" aria-label="Cerrar" onClick={onClose} className="sheet-backdrop absolute inset-0 bg-black/40" />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        tabIndex={-1}
        aria-labelledby={titleId}
        className="sheet-panel absolute inset-x-0 bottom-0 mx-auto flex max-h-[85dvh] max-w-md flex-col overflow-y-auto rounded-t-lg bg-card px-4 pt-2 pb-6 shadow-lg focus:outline-none"
      >
        <span aria-hidden="true" className="h-1 w-9 self-center rounded-full bg-border" />
        <h2 id={titleId} className="mx-3 mt-4 mb-2 text-title-2">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  );
}

export type Option = { value: string; label: string; hint?: string };

/** Las opciones de una hoja: nombre, ayuda corta debajo y check en la elegida. */
export function OptionList({ options, value, onPick }: { options: Option[]; value: string; onPick: (v: string) => void }) {
  return (
    <div role="radiogroup" className="flex flex-col">
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onPick(o.value)}
            className={`flex min-h-14 items-center gap-3 rounded-md px-3 text-left text-[17px] leading-6 ${selected ? "bg-muted" : ""}`}
          >
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">{o.label}</span>
              {o.hint && <span className="text-caption text-muted-foreground">{o.hint}</span>}
            </span>
            {selected && <Icon name="check_circle" fill className="text-[22px]" />}
          </button>
        );
      })}
    </div>
  );
}

/** Campo de una línea que muestra lo elegido y abre la hoja con las opciones. */
export function SheetSelect({ label, sheetTitle, options, value, onChange, error }: {
  label: string;
  sheetTitle?: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  error?: string;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const current = options.find((o) => o.value === value);
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-caption font-semibold">
        {label}
      </span>
      <button
        type="button"
        aria-labelledby={`${id}-label ${id}-value`}
        aria-haspopup="dialog"
        aria-invalid={error ? true : undefined}
        onClick={() => setOpen(true)}
        className="flex h-11 items-center gap-2 border-b-2 border-input-line text-left text-[17px] leading-6 aria-invalid:border-destructive"
      >
        <span id={`${id}-value`} className="min-w-0 flex-1 truncate">
          {current?.label ?? "Elige una opción"}
        </span>
        <Icon name="expand_more" className="text-[22px] text-muted-foreground" />
      </button>
      {error && (
        <span className="flex items-center gap-1 text-caption text-destructive">
          <Icon name="error" className="text-[18px]" />
          {error}
        </span>
      )}
      <Sheet title={sheetTitle ?? label} open={open} onClose={() => setOpen(false)}>
        <OptionList
          options={options}
          value={value}
          onPick={(v) => {
            onChange(v);
            setOpen(false);
          }}
        />
      </Sheet>
    </div>
  );
}

/** Dos o tres opciones a la vista: Ahorros / Corriente, Soles / Dólares. */
export function Segmented({ label, options, value, onChange, size = "md" }: {
  label: string;
  options: Option[];
  value: string;
  onChange: (v: string) => void;
  size?: "sm" | "md";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-caption font-semibold">{label}</span>
      <div
        role="radiogroup"
        aria-label={label}
        className="grid gap-1 rounded-md bg-muted p-[3px]"
        style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
      >
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            onClick={() => onChange(o.value)}
            className={`rounded-[8px] font-semibold ${size === "sm" ? "h-9 text-caption" : "h-10"} ${o.value === value ? "bg-card shadow-sm" : ""}`}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
