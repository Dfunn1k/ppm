// Atajos de teclado de escritorio (decisión «Escritorio»): N registra, / busca, ↑ ↓ recorren la lista,
// E edita el movimiento abierto, Esc cierra y Ctrl + Enter guarda. No hacen nada mientras escribes
// en un campo (salvo Ctrl + Enter), con una hoja abierta o en el celular.
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router";

import { useMe } from "@/api/hooks";
import { isDesktop } from "@/lib/desktop";

import { registerLink } from "./AppNav";

/** Lo que se abre al lado de cada lista; Cuentas abre cuentas, tarjetas y préstamos. */
const DETAIL = /^\/(movimientos|cuentas|tarjetas|prestamos|personas)\/\d+$|^\/mas\/reportes\/[a-z]+$/;
const GROUP: Record<string, string> = { cuentas: "cuentas", tarjetas: "cuentas", prestamos: "cuentas", movimientos: "movimientos", personas: "personas", mas: "reportes" };
const LIST: Record<string, string> = { cuentas: "/cuentas", movimientos: "/movimientos", personas: "/personas" };

const groupOf = (path: string) => GROUP[path.split("/")[1] ?? ""];

function typing(t: EventTarget | null) {
  const el = t as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
}

export function Shortcuts() {
  const navigate = useNavigate();
  const location = useLocation();
  const home = useMe().data?.home_account_id;
  const now = useRef({ location, home });
  now.current = { location, home };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!isDesktop() || e.defaultPrevented || e.isComposing) return;
      const { location: loc, home: homeAccount } = now.current;
      const path = loc.pathname;
      const sheetOpen = !!document.querySelector(".sheet-panel");

      // Ctrl + Enter: guarda el formulario en el que estás (o el del panel de registrar)
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        const active = document.activeElement as HTMLElement | null;
        const form = active?.closest("form") ?? document.querySelector<HTMLFormElement>(".register-panel form");
        if (form) { e.preventDefault(); form.requestSubmit(); }
        return;
      }
      // Con el panel de registrar abierto, solo él escucha (Esc lo cierra)
      if (e.ctrlKey || e.metaKey || e.altKey || typing(e.target) || sheetOpen || document.querySelector(".register-panel")) return;

      if (e.key === "n" || e.key === "N") {
        if (path.startsWith("/registrar")) return;
        e.preventDefault();
        navigate(registerLink(path, homeAccount), { state: { background: loc } });
      } else if (e.key === "/") {
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
      } else if (e.key === "e" || e.key === "E") {
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
