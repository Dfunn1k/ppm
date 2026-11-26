// «Con quién»: solo informativo (la cena fue con Juan). No crea deudas: para eso están «Dividir»
// con la parte de otra persona y «Pagó otra persona». Va en las categorías de un gasto o un ingreso.
import { useState } from "react";
import { Link } from "react-router";

import { usePartners, useSetWithPartner } from "@/api/hooks";

import { Avatar } from "./MoveBits";
import { PersonPicker } from "./PersonPicker";
import { Sheet } from "./Sheet";
import { ErrorAlert, Icon, Optional } from "./ui";

/** En Registrar: una fila «Con quién», opcional, que se abre en el buscador de personas. */
export function WithPartnerField({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const [open, setOpen] = useState(value !== null);
  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex min-h-row-sm items-center gap-3 border-b border-border text-left">
        <Icon name="person" className="w-9 text-center text-muted-foreground" />
        <span className="flex flex-1 flex-col">
          <span className="flex justify-between gap-2 text-caption text-muted-foreground">Con quién<Optional /></span>
          <span className="font-semibold">Nadie</span>
        </span>
        <Icon name="expand_more" className="text-muted-foreground" />
      </button>
    );
  }
  return (
    <div className="flex flex-col gap-1 border-b border-border pb-3">
      <PersonPicker label="Con quién" optional value={value} onChange={onChange} />
      <span className="flex items-center justify-between gap-2 text-caption text-muted-foreground">
        Solo para recordarlo: no es una deuda.
        <button type="button" onClick={() => { onChange(null); setOpen(false); }} className="min-h-9 font-semibold text-foreground">Nadie</button>
      </span>
    </div>
  );
}

/** En el detalle: con quién fue, y la hoja para cambiarlo o quitarlo. */
export function WithPartnerRow({ moveId, partnerId, partner, locked }: {
  moveId: number; partnerId: number | null; partner: string | null; locked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const save = useSetWithPartner(moveId);
  const people = usePartners().data ?? [];
  const [chosen, setChosen] = useState<number | null>(partnerId);
  const row = (
    <>
      {partner ? <Avatar name={partner} /> : <Icon name="person" className="w-9 text-center text-muted-foreground" />}
      <span className="flex flex-1 flex-col">
        <span className="flex justify-between gap-2 text-caption text-muted-foreground">Con quién{!partner && <Optional />}</span>
        <span className="font-semibold">{partner ?? "Nadie"}</span>
      </span>
    </>
  );
  if (locked) {
    return partner ? <div className="flex min-h-14 items-center gap-3 border-b border-border">{row}</div> : null;
  }
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => { setChosen(partnerId); save.reset(); setOpen(true); }}
        className="flex min-h-14 items-center gap-3 border-b border-border text-left">
        {row}
        <Icon name="chevron_right" size="md" className="text-muted-foreground" />
      </button>
      <Sheet title="Con quién" open={open} onClose={() => setOpen(false)}>
        <div className="flex flex-col gap-3 px-3 pb-2">
          <span className="text-caption text-muted-foreground">Solo para recordarlo: no es una deuda. Para que te deba su parte, edítalo y usa «Dividir».</span>
          <PersonPicker label="¿Con quién fue?" value={chosen} onChange={setChosen} />
          {partnerId && people.some((p) => p.id === partnerId) && (
            <Link to={`/personas/${partnerId}`} className="flex min-h-11 items-center gap-1 text-caption font-semibold">
              Ver a {partner}<Icon name="chevron_right" size="sm" />
            </Link>
          )}
          {save.error && <ErrorAlert>{save.error.message}</ErrorAlert>}
          <button type="button" disabled={save.isPending || chosen === null || chosen === partnerId}
            onClick={() => save.mutate(chosen, { onSuccess: () => setOpen(false) })}
            className="flex h-13 items-center justify-center rounded-lg bg-primary font-semibold text-primary-foreground disabled:opacity-60">
            Guardar
          </button>
          {partnerId && (
            <button type="button" disabled={save.isPending} onClick={() => save.mutate(null, { onSuccess: () => setOpen(false) })}
              className="flex h-11 items-center justify-center rounded-lg border border-border font-semibold">
              Quitar: no fue con nadie
            </button>
          )}
        </div>
      </Sheet>
    </>
  );
}
