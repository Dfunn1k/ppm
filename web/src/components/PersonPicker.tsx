// Elegir con quién: un solo campo que muestra a la persona elegida; al escribir, busca por nombre (sin
// importar tildes ni mayúsculas) y la lista aparece debajo, con «Nueva persona» al final, que la crea
// ahí mismo con lo escrito. Con `only`, solo las que vienen al caso (a quien le debes, por ejemplo).
import { type KeyboardEvent, useId, useState } from "react";

import { usePartners } from "@/api/hooks";
import { PersonaSheet } from "@/pages/personas/PersonaForm";

import { Avatar } from "./MoveBits";
import { Icon } from "./ui";

const plain = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function PersonPicker({ label, value, onChange, only, canAdd = true }: {
  label: string;
  value: number | null;
  onChange: (id: number) => void;
  only?: number[];
  canAdd?: boolean;
}) {
  const all = usePartners().data ?? [];
  const people = only ? all.filter((p) => only.includes(p.id)) : all;
  const chosen = all.find((p) => p.id === value);
  const [query, setQuery] = useState<string | null>(null);   // null: no está escribiendo
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [adding, setAdding] = useState<string | null>(null);
  const id = useId();

  const q = plain(query?.trim() ?? "");
  const matches = people.filter((p) => !q || plain(p.name).includes(q));
  const options = [...matches.map((p) => ({ id: p.id, name: p.name })), ...(canAdd ? [{ id: 0, name: "" }] : [])];
  const close = () => { setOpen(false); setQuery(null); };
  const choose = (o: { id: number }) => {
    if (o.id) onChange(o.id);
    else setAdding(query?.trim() ?? "");
    close();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      setOpen(true);
      setActive((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + options.length) % Math.max(options.length, 1));
    } else if (e.key === "Enter" && open && options[active]) {
      e.preventDefault();
      choose(options[active]!);
    } else if (e.key === "Escape") {
      close();
    }
  };

  return (
    <div className="relative flex flex-col gap-1.5">
      <label htmlFor={`${id}-input`} className="text-caption font-semibold">{label}</label>
      <div className="flex h-11 items-center gap-2 border-b-2 border-input-line focus-within:border-foreground">
        {chosen && query === null && <Avatar name={chosen.name} size={28} />}
        <input id={`${id}-input`} role="combobox" aria-expanded={open} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={open && options[active] ? `${id}-o${active}` : undefined} autoComplete="off"
          placeholder={people.length || canAdd ? "Busca por nombre" : "Nadie por ahora"}
          value={query ?? chosen?.name ?? ""}
          onClick={() => { setOpen(true); setActive(0); }}   // no al recibir el foco: al volver de «Nueva persona» no se reabre
          onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
          onKeyDown={onKey} onBlur={close}
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-[17px] leading-6 outline-none" />
        <Icon name={open ? "expand_less" : "search"} className="text-[22px] text-muted-foreground" />
      </div>
      {open && (
        <ul id={`${id}-list`} role="listbox" aria-label={label}
          className="absolute inset-x-0 top-full z-30 mt-1 max-h-64 overflow-y-auto rounded-md border border-border bg-card py-1 shadow-lg">
          {options.map((o, i) => (
            <li key={o.id} id={`${id}-o${i}`} role="option" aria-selected={o.id !== 0 && o.id === value}
              onMouseDown={(e) => e.preventDefault()} onClick={() => choose(o)} onMouseEnter={() => setActive(i)}
              className={`flex min-h-12 cursor-pointer items-center gap-2.5 px-3 ${i === active ? "bg-muted" : ""}`}>
              {o.id ? (
                <>
                  <Avatar name={o.name} size={32} />
                  <span className="flex-1 font-semibold">{o.name}</span>
                  {o.id === value && <Icon name="check" className="text-[20px]" />}
                </>
              ) : (
                <>
                  <span className="grid size-8 place-items-center rounded-full border-[1.5px] border-dashed border-input-line"><Icon name="person_add" className="text-[18px]" /></span>
                  <span className="font-semibold">Nueva persona{query?.trim() ? ` «${query.trim()}»` : ""}</span>
                </>
              )}
            </li>
          ))}
          {options.length === 0 && <li className="px-3 py-3 text-caption text-muted-foreground">Nadie con ese nombre.</li>}
        </ul>
      )}
      <PersonaSheet key={adding ?? "closed"} open={adding !== null} onClose={() => setAdding(null)} onCreated={onChange}
        initialName={adding ?? ""} />
    </div>
  );
}
