// Instalar PPM como app. Chrome y Edge avisan con «beforeinstallprompt» que se puede instalar: se
// guarda ese aviso desde que arranca la app para abrir el instalador cuando la persona toque
// «Instalar». Safari (iPhone) no lo tiene: ahí se muestran los pasos.
import { useSyncExternalStore } from "react";

type InstallEvent = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: "accepted" | "dismissed" }> };

let deferred: InstallEvent | null = null;
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();            // sin la barrita del navegador: se instala desde Más
    deferred = e as InstallEvent;
    notify();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    notify();
  });
}

export type InstallState = "installed" | "prompt" | "ios" | "manual";

function current(): InstallState {
  const standalone = window.matchMedia("(display-mode: standalone)").matches
    || (navigator as Navigator & { standalone?: boolean }).standalone === true;
  if (standalone) return "installed";
  if (deferred) return "prompt";
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return "ios";
  return "manual";
}

/** Cómo se instala PPM aquí: ya instalada, con el instalador del navegador, con los pasos de iPhone o a mano. */
export function useInstall(): { state: InstallState; install: () => Promise<boolean> } {
  const state = useSyncExternalStore((l) => { listeners.add(l); return () => listeners.delete(l); }, current, () => "manual" as const);
  const install = async () => {
    if (!deferred) return false;
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    deferred = null;
    notify();
    return outcome === "accepted";
  };
  return { state, install };
}
