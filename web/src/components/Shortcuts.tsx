// Atajos de teclado de escritorio (decisión «Escritorio»): N registra, / busca, ↑ ↓ recorren la lista,
// E edita el movimiento abierto, ? muestra los atajos, Esc cierra y Ctrl + Enter guarda. Las teclas de
// una letra son las que la persona eligió (lib/shortcuts.ts). No hacen nada mientras escribes
// en un campo (salvo Ctrl + Enter), con una hoja o un visor abiertos, ni en el celular.
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

import { useMe } from "@/api/hooks";
import { isRail } from "@/lib/desktop";
import { matches, openShortcutsHelp, useShortcuts } from "@/lib/shortcuts";

import { registerLink } from "./AppNav";

/** Lo que se abre al lado de cada lista; Cuentas abre cuentas, tarjetas y préstamos. */
const DETAIL = /^\/(movimientos|cuentas|tarjetas|prestamos|personas)\/\d+$|^\/mas\/(reportes\/[a-z]+|recurrentes\/\d+|[a-z-]+)$/;
const GROUP: Record<string, string> = { cuentas: "cuentas", tarjetas: "cuentas", prestamos: "cuentas", movimientos: "movimientos", personas: "personas" };
const LIST: Record<string, string> = { cuentas: "/cuentas", movimientos: "/movimientos", personas: "/personas", recurrentes: "/mas/recurrentes" };

/** Qué lista de la izquierda manda: en /mas/… son tres (Reportes, Recurrentes y los ajustes de Más). */
function groupOf(path: string) {
  const [, first = "", second = ""] = path.split("/");
  if (first !== "mas") return GROUP[first];
  return second === "reportes" || second === "recurrentes" ? second : "ajustes";
}

function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function Shortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const home = useMe().data?.home_account_id;
  const { keys } = useShortcuts();
  const now = useRef({ location, home, keys });
  now.current = { location, home, keys };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isRail() || e.defaultPrevented || e.isComposing) return;
      const { location: loc, home: homeAccount, keys: k } = now.current;
      const path = loc.pathname;
      // Una hoja, el visor de adjuntos o el panel de registrar abiertos: ellos escuchan el teclado
      const dialogOpen = !!document.querySelector('[role="dialog"][aria-modal="true"]');

      // Ctrl + Enter: guarda el formulario en el que estás (o el del panel de registrar)
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        const active = document.activeElement as HTMLElement | null;
        const form = active?.closest("form") ?? document.querySelector<HTMLFormElement>(".register-panel form");
        if (form) { e.preventDefault(); form.requestSubmit(); }
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || dialogOpen) return;

      if (matches(e, k.help)) {
        e.preventDefault();
        openShortcutsHelp();
      } else if (matches(e, k.register)) {
        if (path.startsWith("/registrar")) return;
        e.preventDefault();
        navigate(registerLink(path, homeAccount), { state: { background: loc } });
      } else if (matches(e, k.search)) {
        const search = document.querySelector<HTMLInputElement>("input[aria-label^='Buscar']");
        if (search) { e.preventDefault(); search.focus(); }
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        const group = groupOf(path);
        const rows = [...document.querySelectorAll<HTMLAnchorElement>(".pane-list a[href]")]
          .filter((a) => { const p = new URL(a.href).pathname; return DETAIL.test(p) && groupOf(p) === group; });
        if (rows.length === 0) return;
        e.preventDefault();
        const at = rows.findIndex((a) => new URL(a.href).pathname === path);
        const next = rows[at < 0 ? 0 : Math.min(rows.length - 1, Math.max(0, at + (e.key === "ArrowDown" ? 1 : -1)))]!;
        const url = new URL(next.href);
        navigate(url.pathname + url.search);
        next.scrollIntoView({ block: "nearest" });
      } else if (matches(e, k.edit)) {
        const id = /^\/movimientos\/(\d+)$/.exec(path)?.[1];
        if (id) { e.preventDefault(); navigate(`/movimientos/${id}/editar`); }
      } else if (e.key === "Escape") {
        // Cierra lo abierto a la derecha y deja la lista
        const list = DETAIL.test(path) ? LIST[groupOf(path) ?? ""] ?? LIST[path.split("/")[1] ?? ""] : undefined;
        if (list && document.querySelector(".pane-detail")) { e.preventDefault(); navigate(list + loc.search); }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [navigate]);

  return null;
}
