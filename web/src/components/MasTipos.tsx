// R1 · Más tipos de movimiento: lo ocasional en un cajón aparte. Cada opción abre el mismo
// formulario de Registrar con los campos que le tocan. Y la cabecera que comparten esas pantallas.
import { useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router";

import { withAccount } from "@/lib/startAccount";

import { Sheet } from "./Sheet";
import { Icon } from "./ui";

export type MasKind = "lend" | "borrow" | "collect" | "repay" | "custody_in" | "custody_out" | "refund" | "manual" | "opening";

export const MAS: Record<MasKind, { icon: string; name: string; hint: string; to: string }> = {
  lend: { icon: "volunteer_activism", name: "Le presté a alguien", hint: "Sale de tu cuenta y te queda debiendo", to: "/registrar/persona/lend" },
  borrow: { icon: "handshake", name: "Me prestaron", hint: "Entra a tu cuenta y le quedas debiendo", to: "/registrar/persona/borrow" },
  collect: { icon: "south_west", name: "Me pagaron lo que me debían", hint: "Entra a tu cuenta y baja lo que te deben", to: "/registrar/persona/collect" },
  repay: { icon: "north_east", name: "Pagué lo que debía", hint: "Sale de tu cuenta y baja lo que debes", to: "/registrar/persona/repay" },
  custody_in: { icon: "inventory_2", name: "Me dio para guardar", hint: "Entra a tu cuenta, pero sigue siendo suya", to: "/registrar/persona/custody_in" },
  custody_out: { icon: "undo", name: "Le devolví o usé su plata", hint: "Sale de tu cuenta y baja lo que guardas", to: "/registrar/persona/custody_out" },
  refund: { icon: "replay", name: "Reembolso", hint: "Te devolvieron plata de un gasto: no es ingreso", to: "/registrar/reembolso" },
  opening: { icon: "history", name: "De antes de PPM", hint: "Lo que ya se debían cuando empezaste: no mueve tus cuentas", to: "/registrar/saldo-inicial" },
  manual: { icon: "edit_note", name: "Asiento manual", hint: "Eliges las cuentas y los montos a mano", to: "/registrar/manual" },
};

const GROUPS: [string, MasKind[]][] = [
  ["Con otra persona", ["lend", "borrow", "collect", "repay", "opening"]],
  ["Plata de otros", ["custody_in", "custody_out"]],
  ["Otros", ["refund", "manual"]],
];

/** `account`: la cuenta que ya estaba elegida, para que el otro formulario arranque con ella. */
export function MasTipos({ open, onClose, account }: { open: boolean; onClose: () => void; account?: number | string | null }) {
  // En escritorio sigue en el panel de registrar sobre la misma pantalla de fondo
  const state = useLocation().state;
  return (
    <Sheet title="Más tipos de movimiento" open={open} onClose={onClose}>
      {GROUPS.map(([label, kinds]) => (
        <div key={label} className="flex flex-col">
          <span className="mx-1 mt-3 mb-0.5 text-label text-muted-foreground">{label}</span>
          {kinds.map((k) => (
            <Link key={k} to={k === "opening" || k === "manual" ? MAS[k].to : withAccount(MAS[k].to, account)} replace state={state} data-replace="true" onClick={onClose} className="flex min-h-14 items-center gap-3 rounded-md px-2">
              <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground">
                <Icon name={MAS[k].icon} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{MAS[k].name}</span>
                <span className="text-caption text-muted-foreground">{MAS[k].hint}</span>
              </span>
              {k === "manual" && (
                <span className="grid h-[22px] place-items-center rounded-full border border-border px-2 text-[12px] leading-4 text-muted-foreground">avanzado</span>
              )}
            </Link>
          ))}
        </div>
      ))}
    </Sheet>
  );
}

/** Gasto · Ingreso · Transferir · Más, con «Más» elegido, y el chip con la opción para cambiarla. */
export function MasHeader({ kind, locked, account }: { kind: MasKind; locked?: boolean; account?: number }) {
  const state = useLocation().state;
  const [search] = useSearchParams();
  const cuenta = account ?? search.get("cuenta");
  const [open, setOpen] = useState(false);
  const tab = "grid h-[38px] place-items-center rounded-[8px] text-[14px] font-semibold";
  return (
    <>
      {!locked && (
        <div role="radiogroup" aria-label="Tipo de movimiento" className="mt-2 grid grid-cols-4 gap-1 rounded-md bg-muted p-[3px]">
          <Link to={withAccount("/registrar", cuenta)} replace state={state} data-replace="true" role="radio" aria-checked="false" className={tab}>Gasto</Link>
          <Link to={withAccount("/registrar?tipo=income", cuenta)} replace state={state} data-replace="true" role="radio" aria-checked="false" className={tab}>Ingreso</Link>
          <Link to={withAccount("/registrar?tipo=transfer", cuenta)} replace state={state} data-replace="true" role="radio" aria-checked="false" className={tab}>Transferir</Link>
          <button type="button" role="radio" aria-checked="true" onClick={() => setOpen(true)} className={`${tab} bg-selected text-selected-foreground shadow-sm`}>Más</button>
        </div>
      )}
      <div className="mt-3 flex items-center gap-2">
        <button type="button" disabled={locked} onClick={() => setOpen(true)} aria-label={locked ? MAS[kind].name : `${MAS[kind].name}: cambiar el tipo`}
          className="flex h-9 items-center gap-1.5 rounded-full border border-border pr-2 pl-3 text-caption font-semibold">
          <Icon name={MAS[kind].icon} className="text-[18px]" />
          {MAS[kind].name}
          {!locked && <Icon name="expand_more" className="text-[20px] text-muted-foreground" />}
        </button>
        {kind === "manual" && (
          <span className="grid h-[22px] place-items-center rounded-full border border-border px-2 text-[12px] leading-4 text-muted-foreground">avanzado</span>
        )}
      </div>
      <MasTipos open={open} onClose={() => setOpen(false)} account={cuenta} />
    </>
  );
}
