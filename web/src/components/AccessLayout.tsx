// La portada de acceso en la computadora (desde 1024 px): a la izquierda, sobre el panel oscuro, el
// refrán grande, el año entero y lo que hace PPM (todo en un lugar, los
// reportes y los avisos); a la derecha, el formulario de la pantalla. En el
// celular no cambia nada: solo se ve la pantalla de siempre (decisión «Entrar en la computadora»).
import type { ReactNode } from "react";

import { Icon } from "./ui";

const MONTHS = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MAYO = 4;

const FEATURES = [
  { icon: "account_balance_wallet", title: "Todo en un lugar", text: "Cuentas, efectivo, tarjetas y lo que te deben" },
  { icon: "bar_chart", title: "En qué se va la plata", text: "Gastos, ingresos, flujo y patrimonio, mes a mes" },
  { icon: "notifications", title: "Nada se te pasa", text: "Te avisa el pago de la tarjeta, las cuotas y lo que vence" },
];

function Panel() {
  const today = new Date().getMonth();
  return (
    <aside aria-label="PPM" className="hidden h-dvh flex-col overflow-hidden bg-panel px-access pt-12 pb-10 text-panel-foreground lg:sticky lg:top-0 lg:flex">
      <span className="text-label font-bold text-panel-muted">PPM</span>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-access py-6">
        <p aria-label="Pan para mayo" className="flex flex-col text-poster">
          <span>Pan</span>
          <span>para</span>
          <span className="mark-mayo self-start bg-trigo text-on-trigo">mayo.</span>
        </p>
        <div aria-hidden="true" className="flex flex-col gap-2">
          <div className="grid grid-cols-12 items-end gap-2">
            {MONTHS.map((_, i) => (
              <span key={i} className={
                i === MAYO ? "h-6 rounded-full bg-trigo" : i === today ? "h-2 rounded-full bg-panel-foreground" : "h-2 rounded-full bg-panel-line"
              } />
            ))}
          </div>
          <div className="grid grid-cols-12 gap-2 text-center text-caption text-panel-muted">
            {MONTHS.map((m, i) => (
              <span key={i} className={i === MAYO || i === today ? "font-bold text-panel-foreground" : undefined}>{m}</span>
            ))}
          </div>
        </div>
        <p className="max-w-140 text-access-lead text-panel-muted">
          Guarda hoy lo que vas a necesitar mañana. Tus cuentas claras, sin saber contabilidad.
        </p>
      </div>
      <ul className="grid grid-cols-3 gap-8 border-t border-panel-line pt-access">
        {FEATURES.map((f) => (
          <li key={f.title} className="flex flex-col gap-2.5">
            <span className="grid size-11 place-items-center rounded-lg bg-panel-chip"><Icon name={f.icon} size="md" /></span>
            <span className="font-semibold">{f.title}</span>
            <span className="text-body-sm text-panel-muted">{f.text}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function AccessLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-access">
      <Panel />
      <div className="lg:flex lg:flex-col lg:justify-center">{children}</div>
    </div>
  );
}

/** El título del formulario a la derecha, solo en la computadora (en el celular manda el refrán). */
export function AccessTitle({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="mb-3 hidden flex-col gap-2 lg:flex">
      <h1 className="text-title-hero">{title}</h1>
      {lead && <p className="text-body-lg text-muted-foreground">{lead}</p>}
    </div>
  );
}
