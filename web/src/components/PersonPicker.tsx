// Elegir con quién: las personas como chips (la elegida rellena con el acento) y «Nueva persona»,
// que la crea ahí mismo. Con `only`, solo las que vienen al caso (a quien le debes, por ejemplo).
import { useState } from "react";

import { usePartners } from "@/api/hooks";
import { PersonaSheet } from "@/pages/personas/PersonaForm";

import { Avatar } from "./MoveBits";
import { Icon } from "./ui";

export function PersonPicker({ label, value, onChange, only, canAdd = true }: {
  label: string;
  value: number | null;
  onChange: (id: number) => void;
  only?: number[];
  canAdd?: boolean;
}) {
  const all = usePartners().data ?? [];
  const [adding, setAdding] = useState(false);
  const people = only ? all.filter((p) => only.includes(p.id)) : all;
  const pill = "flex h-10 items-center gap-2 rounded-full border text-[15px] leading-[22px] font-semibold";
  return (
    <div className="flex flex-col gap-2">
      <span className="text-caption font-semibold">{label}</span>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-2">
        {people.map((p) => {
          const on = p.id === value;
          return (
            <button key={p.id} type="button" role="radio" aria-checked={on} onClick={() => onChange(p.id)}
              className={`${pill} pr-3.5 pl-1 ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
              <Avatar name={p.name} size={32} />
              {p.name.split(" ")[0]}
            </button>
          );
        })}
        {canAdd && (
          <button type="button" onClick={() => setAdding(true)} className={`${pill} border-dashed border-input-line px-3.5`}>
            <Icon name="person_add" />Nueva persona
          </button>
        )}
        {!canAdd && people.length === 0 && <span className="text-caption text-muted-foreground">Nadie por ahora.</span>}
      </div>
      <PersonaSheet key={String(adding)} open={adding} onClose={() => setAdding(false)} onCreated={onChange} />
    </div>
  );
}
