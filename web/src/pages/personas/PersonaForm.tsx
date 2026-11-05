// La hoja para agregar o editar una persona: nombre, y teléfono y correo opcionales.
import { useState } from "react";

import { type PartnerRow, useCreatePartner, useUpdatePartner } from "@/api/hooks";
import { Sheet } from "@/components/Sheet";
import { ErrorAlert, LineField, PrimaryButton } from "@/components/ui";

export function PersonaSheet({ open, onClose, editing, onCreated, initialName = "" }: {
  open: boolean;
  onClose: () => void;
  editing?: PartnerRow;
  onCreated?: (id: number, name: string) => void;
  initialName?: string;               // lo que ya escribiste al buscarla
}) {
  const create = useCreatePartner();
  const update = useUpdatePartner(editing?.id ?? 0);
  const [name, setName] = useState(editing?.name ?? initialName);
  const [phone, setPhone] = useState(editing?.phone ?? "");
  const [email, setEmail] = useState(editing?.email ?? "");
  const [problem, setProblem] = useState<string | null>(null);
  const failure = (editing ? update.error : create.error)?.message;

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    e.stopPropagation();   // en React el envío sube también desde una hoja: que no envíe la pantalla de atrás
    setProblem(null);
    if (!name.trim()) return setProblem("Escribe cómo se llama");
    const body = { name, phone: phone.trim() || null, email: email.trim() || null };
    if (editing) update.mutate(body, { onSuccess: onClose });
    else create.mutate(body, { onSuccess: (p) => { onCreated?.(p.id, p.name); onClose(); } });
  };

  return (
    <Sheet title={editing ? "Editar persona" : "Nueva persona"} open={open} onClose={onClose}>
      <form noValidate onSubmit={save} className="flex flex-col gap-4 px-3">
        <LineField label="¿Cómo se llama?" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
        <LineField label="Teléfono (opcional)" inputMode="tel" autoComplete="off" placeholder="987 654 321"
          value={phone} onChange={(e) => setPhone(e.target.value)} />
        <LineField label="Correo (opcional)" inputMode="email" autoComplete="off" placeholder="nombre@correo.com"
          value={email} onChange={(e) => setEmail(e.target.value)} />
        {(problem || failure) && <ErrorAlert>{problem ?? failure}</ErrorAlert>}
        <PrimaryButton pending={create.isPending || update.isPending}>{editing ? "Guardar cambios" : "Guardar persona"}</PrimaryButton>
      </form>
    </Sheet>
  );
}
