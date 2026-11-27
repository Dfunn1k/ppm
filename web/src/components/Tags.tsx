// Etiquetas: post-its de colores que cruzan categorías («Viaje a Cusco» en el taxi, la comida y el
// hotel). La hoja para elegirlas busca mientras escribes y crea una nueva con lo escrito; se usa al
// registrar y desde el detalle. Las archivadas no se ofrecen, salvo las que el movimiento ya lleva.
import { useState } from "react";

import { type TagRef, useCreateTag, useSetMoveTags, useTags } from "@/api/hooks";
import { cn } from "@/lib/utils";
import { catBg } from "./Avatar";

import { Sheet } from "./Sheet";
import { ErrorAlert, Icon, Optional } from "./ui";
import { Button } from "@/components/Button";

const plain = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().trim();

/** Las etiquetas como chips de color, para el detalle y la lista. */
export function TagChips({ tags, small }: { tags: TagRef[]; small?: boolean }) {
  return (
    <span className="flex flex-wrap gap-1.5">
      {tags.map((t) => (
        <span key={t.id} className={`inline-flex items-center gap-1.5 rounded-full border border-border bg-card font-semibold ${small ? "h-6 px-2 text-caption-sm" : "h-7 px-2.5 text-caption"}`}>
          <span aria-hidden="true" className={cn("size-2 rounded-full", catBg(t.color))} />
          {t.name}
        </span>
      ))}
    </span>
  );
}

/** La fila «Etiquetas», opcional, que abre la hoja (en Registrar). */
export function TagField({ value, onChange }: { value: number[]; onChange: (ids: number[]) => void }) {
  const all = useTags().data ?? [];
  const [open, setOpen] = useState(false);
  const chosen = value.map((id) => all.find((t) => t.id === id)).filter((t): t is NonNullable<typeof t> => !!t);
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => setOpen(true)}
        className="flex min-h-13 items-center gap-3 border-b border-border py-2 text-left">
        <Icon name="sell" className="w-8 text-center text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex justify-between gap-2 text-caption text-muted-foreground">Etiquetas<Optional /></span>
          {chosen.length ? <TagChips tags={chosen} small /> : <span className="font-semibold">Ninguna</span>}
        </span>
        <Icon name="expand_more" className="text-muted-foreground" />
      </button>
      <TagSheet open={open} onClose={() => setOpen(false)} value={value} onDone={(ids) => { onChange(ids); setOpen(false); }} />
    </>
  );
}

/** La hoja para elegir: marcar, buscar o crear. «Listo» entrega las elegidas. */
export function TagSheet({ open, onClose, value, onDone, pending, error }: {
  open: boolean;
  onClose: () => void;
  value: number[];
  onDone: (ids: number[]) => void;
  pending?: boolean;
  error?: string;
}) {
  return (
    <Sheet title="Etiquetas" open={open} onClose={onClose}>
      {open && <TagSheetBody value={value} onDone={onDone} pending={pending} error={error} />}
    </Sheet>
  );
}

function TagSheetBody({ value, onDone, pending, error }: { value: number[]; onDone: (ids: number[]) => void; pending?: boolean; error?: string }) {
  const all = useTags().data ?? [];
  const create = useCreateTag();
  const [picked, setPicked] = useState<number[]>(value);
  const [q, setQ] = useState("");
  const needle = plain(q);
  const offered = all.filter((t) => (t.active || value.includes(t.id)) && (!needle || plain(t.name).includes(needle)));
  const exact = all.some((t) => plain(t.name) === needle);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const add = () => create.mutate(q.trim(), { onSuccess: (t) => { setPicked((p) => [...p, t.id]); setQ(""); } });

  return (
    <div className="flex flex-col gap-2 px-1 pb-2">
      <span className="mx-2 -mt-1 text-caption text-muted-foreground">Post-its que cruzan categorías: «Viaje a Cusco» en el taxi, la comida y el hotel.</span>
      <label className="mx-1 flex h-11 items-center gap-2 rounded-md bg-muted px-3">
        <Icon name="search" className="text-muted-foreground" />
        <input aria-label="Buscar o crear etiqueta" placeholder="Buscar o crear" value={q} maxLength={40}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && needle && !exact) { e.preventDefault(); add(); } }}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 outline-none" />
      </label>
      <div role="group" aria-label="Tus etiquetas" className="flex max-h-72 flex-col overflow-y-auto">
        {offered.map((t) => {
          const on = picked.includes(t.id);
          return (
            <button key={t.id} type="button" role="checkbox" aria-checked={on} onClick={() => toggle(t.id)}
              className="flex min-h-13 items-center gap-3 rounded-md px-2 text-left">
              <span aria-hidden="true" className={cn("size-3 rounded-full", catBg(t.color))} />
              <span className="flex-1 font-semibold">{t.name}</span>
              <Icon name={on ? "check_box" : "check_box_outline_blank"} fill={on} size="md" />
            </button>
          );
        })}
        {needle && !exact && (
          <button type="button" onClick={add} disabled={create.isPending}
            className="flex min-h-13 items-center gap-3 border-t border-border px-2 text-left disabled:opacity-60">
            <Icon name="add" size="md" />
            <span>Crear «<b>{q.trim()}</b>»</span>
          </button>
        )}
        {!needle && all.length === 0 && (
          <span className="px-2 py-3 text-caption text-muted-foreground">Todavía no tienes etiquetas: escribe un nombre para crear la primera.</span>
        )}
      </div>
      {(create.error || error) && <ErrorAlert>{create.error?.message ?? error}</ErrorAlert>}
      <Button disabled={pending || create.isPending} onClick={() => onDone(picked)} className="mx-1 mt-1 w-auto">Listo</Button>
    </div>
  );
}

/** En el detalle: las etiquetas del movimiento y la hoja para cambiarlas. Las heredadas (una cuota o
 *  una parte repartida) se cambian en la compra que las originó. */
export function MoveTagsRow({ moveId, tags, inherited }: { moveId: number; tags: TagRef[]; inherited: boolean }) {
  const [open, setOpen] = useState(false);
  const save = useSetMoveTags(moveId);
  if (inherited) {
    if (!tags.length) return null;
    return (
      <div className="flex min-h-13 items-center gap-3 border-b border-border py-2">
        <Icon name="sell" className="w-9 text-center text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-caption text-muted-foreground">Etiquetas</span>
          <TagChips tags={tags} />
          <span className="text-caption text-muted-foreground">Las de su compra</span>
        </span>
      </div>
    );
  }
  return (
    <>
      <button type="button" aria-haspopup="dialog" onClick={() => { save.reset(); setOpen(true); }}
        className="flex min-h-13 items-center gap-3 border-b border-border py-2 text-left">
        <Icon name="sell" className="w-9 text-center text-muted-foreground" />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="text-caption text-muted-foreground">Etiquetas</span>
          {tags.length ? <TagChips tags={tags} /> : <><span className="font-semibold">Ninguna</span><span className="-mt-1 text-caption text-muted-foreground">Toca para ponerle una</span></>}
        </span>
        <Icon name="chevron_right" size="md" className="text-muted-foreground" />
      </button>
      <TagSheet open={open} onClose={() => setOpen(false)} value={tags.map((t) => t.id)} pending={save.isPending}
        error={save.error?.message} onDone={(ids) => save.mutate(ids, { onSuccess: () => setOpen(false) })} />
    </>
  );
}
