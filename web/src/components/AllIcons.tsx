// «Todos los íconos»: el catálogo completo de Material Symbols (más de 4,000) para elegir el de una
// categoría. Este archivo, la lista de nombres y la fuente completa solo se descargan al abrirlo.
import { useEffect, useMemo, useState } from "react";

import catalog from "@/data/material-icons.json";
import { loadFullIconFont } from "@/lib/iconFont";

import { Icon } from "./ui";
import { FilterChip } from "./Chip";
import { Button } from "@/components/Button";

const GROUPS: Record<string, string> = {
  "Actions": "Acciones", "Activities": "Actividades", "Android": "Android", "Audio&Video": "Audio y video",
  "Business": "Negocios", "Communicate": "Comunicación", "Hardware": "Equipos", "Home": "Hogar",
  "Household": "Casa", "Images": "Imágenes", "Maps": "Lugares", "Privacy": "Privacidad", "Social": "Personas",
  "Text": "Texto", "Transit": "Transporte", "Travel": "Viajes", "UI actions": "Interfaz",
};
const PAGE = 140;

export default function AllIcons({ value, onPick, tint }: { value: string | null; onPick: (name: string) => void; tint: number }) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState<number | null>(null);
  const [shown, setShown] = useState(PAGE);
  useEffect(() => { loadFullIconFont(); }, []);
  const needle = q.trim().toLowerCase().replace(/\s+/g, "_");
  const list = useMemo(() => (catalog.icons as [string, string, number][])
    .filter(([n, tags, g]) => (group === null || g === group)
      && (!needle || n.includes(needle) || tags.includes(needle.replace(/_/g, " ")))), [needle, group]);

  return (
    <div className="flex flex-col gap-2">
      <label className="flex h-10 items-center gap-2 rounded-md bg-muted px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
        <Icon name="search" className="text-muted-foreground" />
        <input aria-label="Buscar en todos los íconos" placeholder="En inglés: dog, gym, baby…" value={q}
          onChange={(e) => { setQ(e.target.value); setShown(PAGE); }}
          className="min-w-0 flex-1 border-0 bg-transparent focus:outline-none" />
      </label>
      {/* py-1: el área de 44 px de cada pastilla cabe en la tira sin que aparezca scroll vertical */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-1">
        {[null, ...catalog.groups.map((_, i) => i)].map((g) => (
          <FilterChip key={g ?? "all"} pressed={group === g} onClick={() => { setGroup(g); setShown(PAGE); }}>
            {g === null ? "Todos" : GROUPS[catalog.groups[g]!] ?? catalog.groups[g]}
          </FilterChip>
        ))}
      </div>
      <div role="radiogroup" aria-label="Todos los íconos" className="grid grid-cols-7 gap-1.5">
        {list.slice(0, shown).map(([n]) => (
          <button key={n} type="button" role="radio" aria-label={n} aria-checked={n === value} onClick={() => onPick(n)} title={n}
            className={`grid h-10 place-items-center rounded-md ${n === value ? "" : "border border-border"}`}
            style={n === value ? { background: `var(--cat-${tint})`, color: "var(--on-category)" } : undefined}>
            <Icon name={n} size="md" />
          </button>
        ))}
        {list.length === 0 && <span className="col-span-7 py-2 text-caption text-muted-foreground">No hay íconos con «{q}». Prueba en inglés.</span>}
      </div>
      {list.length > shown && (
        <Button variant="secondary" size="sm" onClick={() => setShown((s) => s + PAGE)}>Ver más ({list.length - shown})</Button>
      )}
    </div>
  );
}
