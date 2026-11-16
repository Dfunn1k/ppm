// Los atajos de teclado de escritorio en un solo lugar: la hoja de ayuda («?»), las pistas en la
// pantalla y Más › Atajos leen esta lista, así muestran siempre las teclas que la persona eligió.
// Las de una tecla se cambian (y se guardan en la cuenta); Esc, Ctrl + Enter y las flechas son fijas.
import { useMe } from "@/api/hooks";

import { useDesktop } from "./desktop";

export type Action = "register" | "search" | "edit" | "help";

export const DEFAULT_KEYS: Record<Action, string> = { register: "n", search: "/", edit: "e", help: "?" };

export type Row = { action: Action; label: string } | { fixed: string[]; label: string };

export const SHORTCUT_GROUPS: { title: string; rows: Row[] }[] = [
  { title: "General", rows: [
    { action: "register", label: "Registrar un movimiento" },
    { action: "search", label: "Buscar en la lista" },
    { action: "help", label: "Ver estos atajos" },
    { fixed: ["Esc"], label: "Cerrar lo abierto a la derecha, una hoja o el panel" },
    { fixed: ["Ctrl", "Enter"], label: "Guardar el formulario en el que estás" },
  ] },
  { title: "En una lista", rows: [
    { fixed: ["↑", "↓"], label: "Pasar al de arriba o al de abajo" },
    { action: "edit", label: "Editar el movimiento abierto" },
  ] },
  { title: "Al ver un adjunto", rows: [
    { fixed: ["←", "→"], label: "Anterior o siguiente" },
    { fixed: ["+", "−"], label: "Acercar o alejar" },
  ] },
];

/** Cómo se escribe una tecla en la pantalla: las letras en mayúscula. */
export const keyLabel = (k: string) => (/^[a-zñ]$/.test(k) ? k.toUpperCase() : k);

/** Las teclas de la persona y si se ven las pistas (solo en escritorio). */
export function useShortcuts() {
  const me = useMe().data;
  const desktop = useDesktop();
  const keys = { ...DEFAULT_KEYS, ...(me?.shortcuts ?? {}) } as Record<Action, string>;
  return { keys, hints: desktop && (me?.shortcut_hints ?? true) };
}

/** ¿Esta tecla dispara el atajo? Sin distinguir mayúsculas. */
export const matches = (e: KeyboardEvent, key: string) => e.key.toLowerCase() === key;

/** Abrir la hoja de los atajos desde cualquier lado (el riel, la tecla «?»). */
export const openShortcutsHelp = () => window.dispatchEvent(new Event("ppm:atajos"));
