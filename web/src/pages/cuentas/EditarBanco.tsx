// Editar banco, número y CCI de una cuenta (desde el menú ⋮ del detalle).
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { useAccount, useCatalog, useUpdateAccount } from "@/api/hooks";
import { Segmented, SheetSelect } from "@/components/Sheet";
import { ErrorAlert, LineField, PrimaryButton, Screen, Spinner } from "@/components/ui";

import { FormHeader } from "./Nueva";

export function EditarBanco() {
  const id = Number(useParams().id);
  const detail = useAccount(id).data;
  const banks = useCatalog().data?.banks ?? [];
  if (!detail?.bank) return <Spinner />;
  return <Form id={id} bank={detail.bank} banks={banks} />;
}

function Form({ id, bank, banks }: {
  id: number;
  bank: NonNullable<ReturnType<typeof useAccount>["data"]>["bank"] & object;
  banks: { id: number; name: string; cci_code: string | null }[];
}) {
  const navigate = useNavigate();
  const update = useUpdateAccount(id);
  const [bankId, setBankId] = useState(String(bank.bank_id));
  const [kind, setKind] = useState<string>(bank.acc_kind);
  const [number, setNumber] = useState(bank.acc_number ?? "");
  const [cci, setCci] = useState(bank.cci ?? "");
  const [problem, setProblem] = useState<string | null>(null);

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    const digits = cci.replace(/\D/g, "");
    const chosen = banks.find((b) => String(b.id) === bankId);
    if (digits && digits.length !== 20) return setProblem("El CCI tiene 20 dígitos");
    if (digits && chosen?.cci_code && !digits.startsWith(chosen.cci_code))
      return setProblem(`Ese CCI no es de ${chosen.name}: los de ${chosen.name} empiezan con ${chosen.cci_code}`);
    setProblem(null);
    const clear: ("acc_number" | "cci")[] = [];
    if (!number.trim()) clear.push("acc_number");
    if (!digits) clear.push("cci");
    update.mutate(
      {
        bank_id: Number(bankId),
        acc_kind: kind as "savings" | "checking",
        acc_number: number.trim() || null,
        cci: digits || null,
        clear,
      },
      { onSuccess: () => navigate(`/cuentas/${id}`, { replace: true }) },
    );
  };

  return (
    <Screen className="pt-4">
      <FormHeader back={`/cuentas/${id}`} label="Datos del banco" />
      <form noValidate onSubmit={save} className="mt-4 flex flex-1 flex-col gap-5">
        <div className="grid grid-cols-2 gap-4">
          <SheetSelect label="Banco" sheetTitle="Elige el banco" value={bankId} onChange={setBankId}
            options={banks.map((b) => ({ value: String(b.id), label: b.name, hint: b.cci_code ? `El CCI empieza con ${b.cci_code}` : undefined }))} />
          <Segmented label="Tipo" size="sm" value={kind} onChange={setKind}
            options={[{ value: "savings", label: "Ahorros" }, { value: "checking", label: "Corriente" }]} />
        </div>
        <LineField label="Número de cuenta (opcional)" inputMode="numeric" className="font-mono text-[15px]"
          value={number} onChange={(e) => setNumber(e.target.value)} />
        <LineField label="CCI (opcional, 20 dígitos)" inputMode="numeric" className="font-mono text-[15px]"
          value={cci} onChange={(e) => setCci(e.target.value)} />
        <div className="flex-1" />
        {(problem || update.error) && <ErrorAlert>{problem ?? update.error?.message}</ErrorAlert>}
        <PrimaryButton pending={update.isPending}>Guardar</PrimaryButton>
      </form>
    </Screen>
  );
}
