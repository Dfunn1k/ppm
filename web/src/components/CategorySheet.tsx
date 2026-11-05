// La hoja para elegir categoría: buscar, las que más usas y la lista por grupo con su color.
// En Movimientos (filtro) también se puede elegir un grupo entero. En Registrar, arriba, «Lo clasifico
// después» (con `onLater`): a Por clasificar, sin categoría todavía.
import { useState } from "react";

import { type Category, useCategories } from "@/api/hooks";

import { Sheet } from "./Sheet";
import { Icon } from "./ui";

export function CategoryChip({ category, size = 36 }: { category: Pick<Category, "icon" | "color">; size?: number }) {
  return (
    <span
      className="grid flex-none place-items-center rounded-full"
      style={{ width: size, height: size, background: `var(--cat-${category.color ?? 0})`, color: "var(--on-category)" }}
    >
      <Icon name={category.icon ?? "category"} className={size < 36 ? "text-[18px]" : "text-[20px]"} />
    </span>
  );
}

export function CategorySheet({ kind, open, onClose, onPick, selected, allowGroups, onLater, later }: {
  kind: "expense" | "income";
  open: boolean;
  onClose: () => void;
  onPick: (c: Category) => void;
  selected?: number | null;
  allowGroups?: boolean;
  onLater?: () => void;               // «Lo clasifico después»
  later?: boolean;                    // ya está elegido
}) {
  const data = useCategories(kind).data;
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const groups = (data?.groups ?? [])
    .map((g) => ({ ...g, children: g.children.filter((k) => !needle || k.name.toLowerCase().includes(needle) || g.name.toLowerCase().includes(needle)) }))
    .filter((g) => g.children.length > 0);
  const pick = (c: Category) => {
    setQ("");
    onPick(c);
  };

  return (
    <Sheet title={kind === "income" ? "¿De qué es este ingreso?" : "¿En qué gastaste?"} open={open} onClose={onClose}>
      <label className="mx-1 flex h-11 items-center gap-2 rounded-md bg-muted px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
        <Icon name="search" className="text-muted-foreground" />
        <input
          aria-label="Buscar categoría"
          placeholder={kind === "income" ? "Buscar: sueldo, venta, regalo…" : "Buscar: taxi, luz, Netflix…"}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent focus:outline-none"
        />
      </label>

      {onLater && !needle && (
        <button type="button" role="radio" aria-checked={!!later} onClick={() => { setQ(""); onLater(); }}
          className={`mx-1 mt-3 flex min-h-[60px] items-center gap-3 rounded-lg border-[1.5px] border-dashed border-input-line px-3 text-left ${later ? "bg-muted" : ""}`}>
          <span className="grid size-9 flex-none place-items-center rounded-full border-[1.5px] border-dashed border-input-line"><Icon name="inbox" /></span>
          <span className="flex flex-1 flex-col">
            <span className="font-semibold">Lo clasifico después</span>
            <span className="text-caption text-muted-foreground">
              Queda en Por clasificar: no cuenta como {kind === "income" ? "ingreso" : "gasto"} hasta que elijas
            </span>
          </span>
          {later && <Icon name="check_circle" fill className="text-[22px]" />}
        </button>
      )}

      {!needle && data && data.frequent.length > 0 && (
        <>
          <span className="mx-1 mt-4 mb-1.5 text-label text-muted-foreground">Las que más usas</span>
          <div className="mx-1 flex gap-2">
            {data.frequent.map((c) => (
              <button key={c.id} type="button" onClick={() => pick(c)}
                className="flex w-[76px] flex-col items-center gap-1.5 py-2 text-center text-[12px] leading-4">
                <CategoryChip category={c} size={44} />
                {c.name}
              </button>
            ))}
          </div>
        </>
      )}

      <div role="radiogroup" aria-label="Categorías" className="mt-2 flex flex-col">
        {groups.map((g) => (
          <div key={g.id ?? g.name} className="flex flex-col">
            {allowGroups && g.id !== null ? (
              <button type="button" onClick={() => pick({ id: g.id!, name: g.name, icon: null, color: g.color })}
                className="mx-1 mt-3 mb-0.5 flex items-center gap-2 text-left text-label text-muted-foreground">
                <span className="size-2.5 rounded-full" style={{ background: `var(--cat-${g.color ?? 0})` }} />
                {g.name} · todo el grupo
              </button>
            ) : (
              <span className="mx-1 mt-3 mb-0.5 flex items-center gap-2 text-label text-muted-foreground">
                <span className="size-2.5 rounded-full" style={{ background: `var(--cat-${g.color ?? 0})` }} />
                {g.name}
              </span>
            )}
            {g.children.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={k.id === selected} onClick={() => pick(k)}
                className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-left font-semibold ${k.id === selected ? "bg-muted" : ""}`}>
                <CategoryChip category={k} size={34} />
                <span className="flex-1">{k.name}</span>
                {k.id === selected && <Icon name="check_circle" fill className="text-[22px]" />}
              </button>
            ))}
          </div>
        ))}
        {groups.length === 0 && <span className="px-3 py-4 text-caption text-muted-foreground">No hay categorías con «{q}».</span>}
      </div>
    </Sheet>
  );
}
