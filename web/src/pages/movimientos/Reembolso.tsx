// R1 · Reembolso: te devolvieron plata de un gasto. Entra a tu cuenta y resta de la categoría de
// ese gasto, como una nota de crédito: tu gasto queda neto y tus ingresos no se inflan.
import { useState } from "react";
import { useNavigate, useSearchParams } from "react-router";

import { type AccountRow, type Category, type MoveDetail, useAccounts, useMe, useSaveMove } from "@/api/hooks";
import { CategoryChip, CategorySheet } from "@/components/CategorySheet";
import { MasHeader } from "@/components/MasTipos";
import { pickAccount } from "@/lib/startAccount";
import { RateField, useRateInput } from "@/components/RateField";
import { SheetSelect } from "@/components/Sheet";
import { ErrorAlert, Icon, PrimaryButton, Spinner } from "@/components/ui";
import { DateSheet, dateLabel } from "@/components/DateSheet";
import { todayISO } from "@/lib/dates";
import { formatAmount, formatNumber, parseAmount, symbolOf } from "@/lib/money";
import { useBack } from "@/lib/transitions";

export function Reembolso({ editing }: { editing?: MoveDetail }) {
  const navigate = useNavigate();
  const back = useBack();
  const [search] = useSearchParams();
  const me = useMe().data;
  const overview = useAccounts().data;
  const save = useSaveMove(editing?.summary.id);
  const lang = me?.lang ?? "es-PE";
  const [accountId, setAccountId] = useState(editing?.account_id ? String(editing.account_id) : "");
  const [amount, setAmount] = useState(editing ? formatNumber(editing.summary.amount, lang) : "");
  const [category, setCategory] = useState<Category | null>(editing?.splits[0]?.category ?? null);
  const [picking, setPicking] = useState(false);
  const [date, setDate] = useState(editing?.summary.date ?? todayISO());
  const [dateOpen, setDateOpen] = useState(false);
  const [note, setNote] = useState(editing && editing.summary.ref !== category?.name ? editing.summary.ref : "");
  const [problem, setProblem] = useState<string | null>(null);

  const base = me?.currency ?? "PEN";
  const accounts: AccountRow[] = overview ? overview.have.filter((a) => a.kind === "cash" || a.kind === "bank") : [];
  const account = editing ? accounts.find((a) => String(a.id) === accountId)
    : pickAccount(accounts, accountId, search.get("cuenta"), me?.home_account_id);
  const currency = account?.currency ?? base;
  const rate = useRateInput(currency, base, date, "buy", editing?.rate ? Number(editing.rate).toFixed(3) : null);
  if (!me?.currency || !overview) return <Spinner />;
  const foreign = currency !== base;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const value = parseAmount(amount || "", lang);
    if (!account) return setProblem("Elige adónde entró");
    if (!value || Number(value) <= 0) return setProblem("Escribe un monto mayor que cero");
    if (!category) return setProblem("Elige de qué gasto es el reembolso");
    if (foreign && !(Number(rate.value) > 0)) return setProblem("Escribe el tipo de cambio, como 3.443");
    save.mutate({
      kind: "refund", account_id: account.id, amount: value, date, ref: note.trim() || null, pending: false, later: false,
      rate: foreign ? rate.value.trim() : null, splits: [{ category_id: category.id, amount: value }], lines: [],
    }, { onSuccess: (d) => navigate(editing ? `/movimientos/${d.summary.id}` : "/movimientos", { replace: true }) });
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-6">
      <div className="-mx-2.5 flex items-center justify-between">
        <button type="button" aria-label="Cerrar sin guardar" onClick={back} className="grid size-11 place-items-center rounded-full">
          <Icon name="close" className="text-[24px]" />
        </button>
        <span className="pr-2.5 text-label text-muted-foreground">{editing ? "Editar movimiento" : "Nuevo movimiento"}</span>
      </div>
      <form noValidate onSubmit={submit} className="flex flex-1 flex-col">
        <MasHeader kind="refund" locked={!!editing} account={account?.id} />
        <label className="mt-3 flex flex-col gap-0.5 text-caption font-semibold">
          ¿Cuánto te devolvieron?
          <span className="flex items-baseline gap-2 border-b-2 border-input-line">
            <span aria-hidden="true" className="text-[26px] leading-8 font-semibold text-muted-foreground">{symbolOf(currency)}</span>
            <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="h-16 min-w-0 flex-1 border-0 bg-transparent p-0 text-[48px] leading-[56px] font-semibold tracking-[-0.02em] tabular-nums" />
          </span>
        </label>
        <div className="mt-2 flex flex-col">
          <SheetSelect label="Entra a" sheetTitle="¿A qué cuenta entró?" value={account ? String(account.id) : ""} onChange={setAccountId}
            options={accounts.map((a) => ({ value: String(a.id), label: a.name, hint: a.subtitle ?? undefined }))} />
          {foreign && <div className="mt-3 border-b border-border pb-3"><RateField input={rate} currency={currency} /></div>}
          <button type="button" aria-haspopup="dialog" onClick={() => setPicking(true)} className="flex min-h-[60px] items-center gap-3 border-b border-border text-left">
            {category ? <CategoryChip category={category} /> : (
              <span className="grid size-9 place-items-center rounded-full border-[1.5px] border-dashed border-input-line"><Icon name="category" /></span>
            )}
            <span className="flex flex-1 flex-col">
              <span className="text-caption text-muted-foreground">De qué gasto</span>
              <span className="font-semibold">{category?.name ?? "Elige una categoría"}</span>
            </span>
            <Icon name="expand_more" className="text-[22px] text-muted-foreground" />
          </button>
          <div className="grid min-h-[52px] grid-cols-[auto_1fr] items-center gap-3 border-b border-border">
            <button type="button" aria-expanded={dateOpen} onClick={() => setDateOpen(!dateOpen)}
              className="flex h-9 items-center gap-1 rounded-full border border-border px-3 text-caption font-semibold">
              <Icon name="event" className="text-[18px]" />{dateLabel(date)}
            </button>
            <input aria-label="Nota" placeholder="Nota (opcional)" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)}
              className="h-10 min-w-0 border-0 bg-transparent p-0" />
          </div>
          <DateSheet open={dateOpen} onClose={() => setDateOpen(false)} title="¿Cuándo fue?" value={date} onChange={setDate} max={todayISO()} booked />
        </div>
        {category && (
          <div className="mt-3 flex flex-col gap-1 rounded-[12px] border border-border bg-card px-3.5 py-3">
            <span className="font-semibold">Resta de {category.name}</span>
            <span className="text-caption text-muted-foreground">
              Tu gasto en esa categoría baja{amount ? ` ${formatAmount(parseAmount(amount, lang) ?? "0", symbolOf(currency), lang)}` : ""}. No cuenta como ingreso.
            </span>
          </div>
        )}
        <div className="min-h-4 flex-1" />
        <div className="flex flex-col gap-3">
          {(problem || save.error) && <ErrorAlert>{problem ?? save.error?.message}</ErrorAlert>}
          <PrimaryButton pending={save.isPending}>{editing ? "Guardar cambios" : "Registrar reembolso"}</PrimaryButton>
        </div>
      </form>
      <CategorySheet kind="expense" open={picking} onClose={() => setPicking(false)} selected={category?.id}
        onPick={(c) => { setCategory(c); setPicking(false); }} />
    </main>
  );
}
