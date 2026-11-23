// Borrar en el presupuesto (decisión «Borrar en el presupuesto», boceto Caso14Borrar): deshacer lo
// asignado en un mes, eliminar o renombrar un sobre de ahorro y borrar el presupuesto entero. Cada uno
// por su lado; ninguno toca los movimientos, porque el presupuesto es una capa aparte de la billetera.
import { type FormEvent, type ReactNode, useState } from "react";
import { useNavigate } from "react-router";

import { type BudgetPost, useBudgetMoves, useDeletePost, useRenamePost, useResetBudget, useUndoMonth } from "@/api/hooks";
import { Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon, LineField } from "@/components/ui";
import { monthOnly } from "@/lib/months";
import { listText } from "@/lib/utils";

import { useMoney, withMonth } from "./common";

/** Una hoja que explica qué pasa y pide confirmar. */
function Confirm({ open, onClose, title, children, action, icon, danger, pending, error, onConfirm }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; action: string; icon: string;
  danger?: boolean; pending: boolean; error?: string; onConfirm: () => void;
}) {
  return (
    <Sheet title={title} open={open} onClose={onClose}>
      <div className="flex flex-col gap-3 px-3">
        {children}
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <button type="button" disabled={pending} onClick={onConfirm}
          className={`mt-1 flex h-14 items-center justify-between rounded-xl px-5 font-semibold disabled:opacity-60 ${danger ? "bg-destructive text-destructive-foreground" : "bg-primary text-primary-foreground"}`}>
          <span>{action}</span><Icon name={pending ? "progress_activity" : icon} className={pending ? "animate-spin" : ""} />
        </button>
        <button type="button" onClick={onClose} className="h-11 font-semibold">Cancelar</button>
      </div>
    </Sheet>
  );
}

function Note({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-caption text-muted-foreground">
      <Icon name={icon} className="text-[18px]" /><span>{children}</span>
    </div>
  );
}

export function UndoMonthSheet({ month, open, onClose }: { month: string; open: boolean; onClose: () => void }) {
  const moves = useBudgetMoves(month).data ?? [];
  const undo = useUndoMonth();
  const { money } = useMoney();
  const name = monthOnly(month).toLowerCase();
  // Lo que salió de Por asignar menos lo que volvió: eso es lo que regresa
  const back = moves.reduce((t, m) => t + (m.from_post_id === null ? Number(m.amount) : m.to_post_id === null ? -Number(m.amount) : 0), 0);
  const n = moves.length;
  return (
    <Confirm open={open} onClose={onClose} title={`Deshacer lo asignado en ${name}`} icon="undo"
      action={back > 0 ? `Deshacer ${money(back.toFixed(2))}` : "Deshacer"} pending={undo.isPending} error={undo.error?.message}
      onConfirm={() => undo.mutate(month, { onSuccess: onClose })}>
      <p className="text-muted-foreground tabular-nums">
        {n === 0 ? `No asignaste nada en ${name}.`
          : `Se ${n === 1 ? "borra la asignación" : `borran las ${n} asignaciones y movimientos entre sobres`} de ${name}.${back > 0 ? ` ${money(back.toFixed(2))} vuelven a Por asignar.` : ""} Tus movimientos y los otros meses no cambian.`}
      </p>
      {n > 0 && <Note icon="info">El mes siguiente empieza con lo que quede en cada sobre, así que también puede cambiar lo que traes.</Note>}
    </Confirm>
  );
}

export function ResetSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const reset = useResetBudget();
  const navigate = useNavigate();
  return (
    <Confirm open={open} onClose={onClose} title="Borrar el presupuesto" icon="delete" danger
      action="Borrar el presupuesto" pending={reset.isPending} error={reset.error?.message}
      onConfirm={() => { reset.mutateAsync().then(() => navigate("/presupuesto", { replace: true }), () => {}); }}>
      <p className="text-muted-foreground">Se borra todo lo del presupuesto:</p>
      <ul className="flex flex-col">
        {["Lo asignado y movido, en todos los meses", "Los sobres de ahorro que creaste", "Qué cuentas estaban dentro y desde cuándo", "El mes en que empezaste"].map((t) => (
          <li key={t} className="flex min-h-9 items-center border-b border-border">{t}</li>
        ))}
      </ul>
      <Note icon="verified_user">Tus movimientos, cuentas, categorías y reportes no cambian. Puedes empezar de nuevo cuando quieras.</Note>
    </Confirm>
  );
}

/** El menú de un sobre de ahorro que creaste: cambiar el nombre o eliminarlo. */
export function SavingMenu({ post, month, open, onClose, accounts }: {
  post: BudgetPost; month: string; open: boolean; onClose: () => void; accounts: string[];
}) {
  const [step, setStep] = useState<"menu" | "rename" | "delete">("menu");
  const [name, setName] = useState(post.name);
  const rename = useRenamePost();
  const remove = useDeletePost();
  const navigate = useNavigate();
  const { money } = useMoney();
  const close = () => { setStep("menu"); setName(post.name); rename.reset(); remove.reset(); onClose(); };
  const save = (e: FormEvent) => {
    e.preventDefault();
    rename.mutate({ id: post.id, name: name.trim() }, { onSuccess: close });
  };
  const saved = Number(post.available);
  return (
    <>
      <Sheet title={post.name} open={open && step === "menu"} onClose={close}>
        <div className="mt-1 flex flex-col">
          <button type="button" onClick={() => setStep("rename")} className="flex min-h-14 items-center gap-3 border-b border-border text-left">
            <Icon name="edit" className="text-[22px]" /><span className="flex-1 font-semibold">Cambiar el nombre</span>
          </button>
          <button type="button" onClick={() => setStep("delete")} className="flex min-h-14 items-center gap-3 text-left text-destructive">
            <Icon name="delete" className="text-[22px]" />
            <span className="flex flex-1 flex-col"><span className="font-semibold">Eliminar sobre</span>
              <span className="text-caption text-muted-foreground">Lo guardado vuelve a Por asignar</span></span>
          </button>
        </div>
      </Sheet>
      <Sheet title="Cambiar el nombre" open={open && step === "rename"} onClose={close}>
        <form onSubmit={save} className="flex flex-col gap-4 px-1">
          <LineField label="Nombre" maxLength={60} value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          {rename.error && <ErrorAlert>{rename.error.message}</ErrorAlert>}
          <button type="submit" disabled={rename.isPending || !name.trim() || name.trim() === post.name}
            className="flex h-14 items-center justify-between rounded-xl bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-60">
            <span>Guardar</span><Icon name={rename.isPending ? "progress_activity" : "check"} className={rename.isPending ? "animate-spin" : ""} />
          </button>
        </form>
      </Sheet>
      <Confirm open={open && step === "delete"} onClose={close} title={`Eliminar ${post.name}`} icon="delete" danger
        action={`Eliminar ${post.name}`} pending={remove.isPending} error={remove.error?.message}
        onConfirm={() => {
          // Al borrarse, el sobre deja de existir y su pantalla se desmonta: la promesa sigue igual
          remove.mutateAsync(post.id).then(() => navigate(withMonth("/presupuesto", month), { replace: true }), () => {});
        }}>
        <p className="text-muted-foreground tabular-nums">
          {saved > 0 ? `Lo guardado, ${money(post.available)}, vuelve a Por asignar` : "Vuelve a Por asignar lo que le diste"}, y se borra todo lo que le asignaste en cualquier mes.
          {accounts.length > 0 && ` ${listText(accounts)} ${accounts.length === 1 ? "salía" : "salían"} de este sobre: ${accounts.length === 1 ? "pasa" : "pasan"} a Construir patrimonio.`}
        </p>
      </Confirm>
    </>
  );
}

