// Más › Etiquetas: las tuyas, con cuántos movimientos las llevan. Crear una nueva, renombrarla,
// cambiarle el color, archivarla (ya no se ofrece al elegir, pero sus movimientos la conservan) o
// eliminarla (sale de sus movimientos, que no se tocan).
import { useState } from "react";

import { type Tag, useCreateTag, useDeleteTag, useTags, useUpdateTag } from "@/api/hooks";
import { Sheet } from "@/components/Sheet";

import { catBg } from "@/components/Avatar";
import { BackLink } from "@/components/PageHeader";
import { ErrorAlert, Icon, LineField, Spinner, Status } from "@/components/ui";
import { cn } from "@/lib/utils";

const COLORS = ["gris", "rojo", "naranja", "mostaza", "turquesa", "morado", "marrón", "verde azulado", "azul", "frambuesa", "verde", "índigo"];

const count = (n: number) => (n === 0 ? "Sin movimientos" : n === 1 ? "1 movimiento" : `${n} movimientos`);

export function Etiquetas() {
  const tags = useTags();
  const [editing, setEditing] = useState<Tag | "new" | null>(null);
  if (tags.isPending) return <Spinner />;
  const list = tags.data ?? [];
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28">
      <div className="-mx-2.5 flex min-h-control items-center justify-between">
        <BackLink to="/mas" label="Volver a Más" />
      </div>
      <h1 className="mt-1 text-title-hero">Etiquetas</h1>
      <p className="mt-1 text-caption text-muted-foreground">
        Pónselas a un movimiento al registrarlo o desde su detalle. En Movimientos y en Reportes juntas todo lo que la lleva.
      </p>
      <button type="button" onClick={() => setEditing("new")}
        className="mt-4 flex h-12 items-center justify-center gap-1.5 rounded-xl border border-dashed border-input-line font-semibold">
        <Icon name="add" />Nueva etiqueta
      </button>
      {tags.isError && <div className="mt-4"><ErrorAlert>{tags.error.message}</ErrorAlert></div>}
      <ul className="mt-1 flex flex-col">
        {list.map((t) => (
          <li key={t.id}>
            <button type="button" onClick={() => setEditing(t)}
              className={`flex min-h-14 w-full items-center gap-3 border-b border-border text-left ${t.active ? "" : "opacity-60"}`}>
              <span aria-hidden="true" className={cn("size-3 flex-none rounded-full", catBg(t.color))} />
              <span className="flex flex-1 flex-col">
                <span className="font-semibold">{t.name}</span>
                <span className="flex items-center gap-2.5 text-caption text-muted-foreground">{!t.active && <Status icon="inventory_2">Archivada</Status>}{t.active ? count(t.moves) : count(t.moves).toLowerCase()}</span>
              </span>
              <Icon name="chevron_right" size="md" className="text-muted-foreground" />
            </button>
          </li>
        ))}
      </ul>
      {list.length === 0 && !tags.isError && (
        <p className="mt-6 text-center text-muted-foreground">
          Todavía no tienes etiquetas. «Viaje a Cusco», «Boda de Lucía», «Mudanza»: lo que quieras juntar aunque sea de varias categorías.
        </p>
      )}
      <Sheet title={editing === "new" ? "Nueva etiqueta" : "Editar etiqueta"} open={editing !== null} onClose={() => setEditing(null)}>
        {editing !== null && <TagForm key={editing === "new" ? "new" : editing.id} tag={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Sheet>
    </main>
  );
}

function TagForm({ tag, onDone }: { tag: Tag | null; onDone: () => void }) {
  const create = useCreateTag();
  const update = useUpdateTag();
  const remove = useDeleteTag();
  const [name, setName] = useState(tag?.name ?? "");
  const [color, setColor] = useState<number | null>(tag?.color ?? null);
  const [confirming, setConfirming] = useState(false);
  const error = create.error ?? update.error ?? remove.error;
  const busy = create.isPending || update.isPending || remove.isPending;

  const save = () => {
    if (!name.trim()) return;
    if (!tag) {
      create.mutate(name.trim(), {
        onSuccess: (t) => (color !== null && color !== t.color ? update.mutate({ id: t.id, color }, { onSuccess: onDone }) : onDone()),
      });
    } else {
      update.mutate({ id: tag.id, name: name.trim(), color: color ?? tag.color }, { onSuccess: onDone });
    }
  };

  return (
    <form className="flex flex-col gap-4 px-3 pb-2" onSubmit={(e) => { e.preventDefault(); save(); }}>
      <LineField label="Nombre" value={name} maxLength={40} autoFocus={!tag} placeholder="Viaje a Cusco"
        onChange={(e) => setName(e.target.value)} />
      <div className="flex flex-col gap-2">
        <span className="text-caption font-semibold">Color</span>
        <div role="radiogroup" aria-label="Color" className="grid grid-cols-6 gap-2.5">
          {COLORS.map((label, i) => {
            const on = (color ?? -1) === i;
            return (
              <button key={i} type="button" role="radio" aria-checked={on} aria-label={label} onClick={() => setColor(i)}
                className={cn("hit-area size-10 rounded-full", catBg(i), on && "ring-2 ring-foreground ring-offset-2 ring-offset-card")} />
            );
          })}
        </div>
      </div>
      {error && <ErrorAlert>{error.message}</ErrorAlert>}
      <button type="submit" disabled={busy || !name.trim()}
        className="flex h-13 items-center justify-center rounded-lg bg-primary font-semibold text-primary-foreground disabled:opacity-60">
        {tag ? "Guardar" : "Crear etiqueta"}
      </button>
      {tag && !confirming && (
        <div className="flex gap-2">
          <button type="button" disabled={busy} onClick={() => update.mutate({ id: tag.id, active: !tag.active }, { onSuccess: onDone })}
            className="flex h-11 flex-1 items-center justify-center rounded-lg border border-border font-semibold">
            {tag.active ? "Archivar" : "Desarchivar"}
          </button>
          <button type="button" disabled={busy} onClick={() => setConfirming(true)}
            className="flex h-11 flex-1 items-center justify-center rounded-lg border border-border font-semibold text-expense">
            Eliminar
          </button>
        </div>
      )}
      {tag && confirming && (
        <div className="flex flex-col gap-2 rounded-md bg-muted p-3">
          <span className="text-caption">
            {tag.moves ? `Sale de ${count(tag.moves).toLowerCase()}; los movimientos no se tocan.` : "No la lleva ningún movimiento."}
          </span>
          <div className="flex gap-2">
            <button type="button" onClick={() => setConfirming(false)} className="flex h-11 flex-1 items-center justify-center rounded-lg border border-border bg-card font-semibold">No</button>
            <button type="button" disabled={busy} onClick={() => remove.mutate(tag.id, { onSuccess: onDone })}
              className="flex h-11 flex-1 items-center justify-center rounded-lg bg-expense font-semibold text-background">Sí, eliminarla</button>
          </div>
        </div>
      )}
      {tag && <span className="text-caption text-muted-foreground">Archivada ya no se ofrece al elegir, pero sus movimientos la conservan.</span>}
    </form>
  );
}
