// La portada de acceso en la computadora (desde 1024 px): a la izquierda, sobre el panel oscuro, el
// refrán grande, el año entero y lo que hace PPM; a la derecha, el formulario de la pantalla. En el
// celular no cambia nada: solo se ve la pantalla de siempre (decisión «Entrar en la computadora»).
import type { ReactNode } from "react";

import { Icon } from "./ui";

const MONTHS = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MAYO = 4;

const FEATURES = [
  { icon: "account_balance_wallet", title: "Todo en un lugar", text: "Cuentas, efectivo, tarjetas y lo que te deben" },
  { icon: "currency_exchange", title: "Soles y dólares", text: "Con el cambio de SUNAT de cada día" },
  { icon: "credit_card", title: "Tarjetas claras", text: "Cuotas, ciclo y tu estado de cuenta en PDF" },
];

function Panel() {
  const today = new Date().getMonth();
  return (
    <aside aria-label="PPM" className="hidden h-dvh flex-col overflow-hidden bg-panel px-[clamp(48px,5.5vw,80px)] pt-12 pb-10 text-panel-foreground lg:sticky lg:top-0 lg:flex">
      <span className="text-[13px] leading-4 font-bold tracking-[0.06em] text-panel-muted">PPM</span>
      <div className="flex min-h-0 flex-1 flex-col justify-center gap-[clamp(16px,3.5vh,36px)] py-6">
        <p aria-label="Pan para mayo" className="flex flex-col font-display text-[min(11vw,16.5vh,176px)] leading-[0.87] font-extrabold tracking-[-0.045em]">
          <span>Pan</span>
          <span>para</span>
          <span className="-ml-[0.125em] self-start rounded-[0.18em] bg-trigo px-[0.125em] pb-[0.06em] text-on-trigo">mayo.</span>
        </p>
        <div aria-hidden="true" className="flex flex-col gap-2">
          <div className="grid grid-cols-12 items-end gap-2">
            {MONTHS.map((_, i) => (
              <span key={i} className={
                i === MAYO ? "h-[22px] rounded-full bg-trigo" : i === today ? "h-2 rounded-full bg-panel-foreground" : "h-2 rounded-full bg-panel-line"
              } />
            ))}
          </div>
          <div className="grid grid-cols-12 gap-2 text-center text-[13px] leading-4 text-panel-muted">
            {MONTHS.map((m, i) => (
              <span key={i} className={i === MAYO || i === today ? "font-bold text-panel-foreground" : undefined}>{m}</span>
            ))}
          </div>
        </div>
        <p className="max-w-[560px] text-[clamp(17px,2.4vh,22px)] leading-[1.45] text-panel-muted">
          Guarda hoy lo que vas a necesitar mañana. Tus cuentas claras, sin saber contabilidad.
        </p>
      </div>
      <ul className="grid grid-cols-3 gap-8 border-t border-panel-line pt-[clamp(16px,3vh,32px)]">
        {FEATURES.map((f) => (
          <li key={f.title} className="flex flex-col gap-2.5">
            <span className="grid size-11 place-items-center rounded-xl bg-panel-chip"><Icon name={f.icon} className="text-[24px]" /></span>
            <span className="font-semibold">{f.title}</span>
            <span className="text-[14px] leading-5 text-panel-muted">{f.text}</span>
          </li>
        ))}
      </ul>
    </aside>
  );
}

export function AccessLayout({ children }: { children: ReactNode }) {
  return (
    <div className="lg:grid lg:min-h-dvh lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
      <Panel />
      <div className="lg:flex lg:flex-col lg:justify-center">{children}</div>
    </div>
  );
}

/** El título del formulario a la derecha, solo en la computadora (en el celular manda el refrán). */
export function AccessTitle({ title, lead }: { title: string; lead?: string }) {
  return (
    <div className="mb-3 hidden flex-col gap-2 lg:flex">
      <h1 className="font-display text-[48px] leading-[50px] font-extrabold tracking-[-0.03em]">{title}</h1>
      {lead && <p className="text-[17px] leading-[26px] text-muted-foreground">{lead}</p>}
    </div>
  );
}
