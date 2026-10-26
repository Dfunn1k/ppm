// R1 · Registrar (y editar): gasto, ingreso o transferencia; dividir en varias categorías;
// en otra moneda con el tipo del día (editable); entre monedas con los dos montos y, al vender, el
// costo del cambio o la ganancia; por confirmar.
import { useState } from "react";
import { useNavigate, useParams } from "react-router";

import { type AccountRow, type Category, type MoveDetail, type MoveIn, useAccounts, useMe, useMove, useSaveMove } from "@/api/hooks";
import { CategoryChip, CategorySheet } from "@/components/CategorySheet";
import { RateField, useRateInput, useSuggestedRate } from "@/components/RateField";
import { SheetSelect } from "@/components/Sheet";
import { ErrorAlert, Icon, LineField, PrimaryButton, Spinner } from "@/components/ui";
import { longDate, shortDate, todayISO } from "@/lib/dates";
import { divide, formatAmount, formatNumber, isZero, multiply, parseAmount, proportion, subtract, symbolOf } from "@/lib/money";

type Kind = Extract<MoveIn["kind"], "expense" | "income" | "transfer">;
type Part = { category: Category | null; amount: string };

const KIND_LABEL: Record<Kind, string> = { expense: "Gasto", income: "Ingreso", transfer: "Transferir" };
const SUBMIT: Record<Kind, string> = { expense: "Registrar gasto", income: "Registrar ingreso", transfer: "Registrar transferencia" };

/** Pantalla de edición: espera el movimiento y abre el formulario con sus datos. */
export function EditarMovimiento() {
  const id = Number(useParams().id);
  const move = useMove(id);
  if (move.isPending) return <Spinner />;
  if (move.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{move.error.message}</ErrorAlert></main>;
  return <Registrar editing={move.data} />;
}

export function Registrar({ editing }: { editing?: MoveDetail }) {
  const navigate = useNavigate();
  const me = useMe().data;
  const overview = useAccounts().data;
  const save = useSaveMove(editing?.summary.id);
  const lang = me?.lang ?? "es-PE";
  const fmt = (v: string) => formatNumber(v, lang);

  const initialKind = (editing?.summary.kind === "other" ? "expense" : editing?.summary.kind) ?? "expense";
  const [kind, setKind] = useState<Kind>(initialKind as Kind);
  const [accountId, setAccountId] = useState<string>(editing?.account_id ? String(editing.account_id) : "");
  const [toAccountId, setToAccountId] = useState<string>(editing?.to_account_id ? String(editing.to_account_id) : "");
  const [amount, setAmount] = useState(editing ? fmt(editing.summary.amount) : "");
  const [toAmount, setToAmount] = useState(editing?.summary.to_amount ? fmt(editing.summary.to_amount) : "");
  const [parts, setParts] = useState<Part[]>(
    editing?.splits.length ? editing.splits.map((s) => ({ category: s.category, amount: fmt(s.amount) })) : [{ category: null, amount: "" }],
  );
  const [split, setSplit] = useState((editing?.splits.length ?? 0) > 1);
  const [date, setDate] = useState(editing?.summary.date ?? todayISO());
  const [dateOpen, setDateOpen] = useState(false);
  const [note, setNote] = useState(editing && editing.summary.ref !== editing.splits[0]?.category?.name ? editing.summary.ref : "");
  const [pending, setPending] = useState(editing ? !editing.summary.posted : false);
  const [sheetFor, setSheetFor] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const base = me?.currency ?? "PEN";
  const accounts: AccountRow[] = overview
    ? [...overview.have, ...overview.owe].filter((a) => ["cash", "bank", "other"].includes(a.kind)) : [];
  const account = accounts.find((a) => String(a.id) === accountId) ?? (accountId === "" ? accounts[0] : undefined);
  const toAccount = accounts.find((a) => String(a.id) === toAccountId);
  const currency = account?.currency ?? base;
  const side = account?.kind === "other" ? "sell" : "buy";   // compra para lo que tienes, venta para lo que debes
  const rate = useRateInput(currency, base, date, side, editing?.rate ? Number(editing.rate).toFixed(3) : null);
  const foreignSide = toAccount && toAccount.currency !== base ? toAccount.currency ?? base : currency;
  const sunat = useSuggestedRate(foreignSide, base, date, "buy");
  const sunatSell = useSuggestedRate(foreignSide, base, date, "sell");
  if (!me?.currency || !overview) return <Spinner />;
  const foreign = currency !== base;
  const crossCurrency = kind === "transfer" && toAccount && toAccount.currency !== currency;
  const future = date > todayISO();
  // El tipo de cambio se escribe solo si nada lo da: en una transferencia que toca la moneda base, sale de los dos montos
  const needRate = foreign && !(kind === "transfer" && toAccount?.currency === base);
  const options = (except?: number) =>
    accounts.filter((a) => a.id !== except).map((a) => ({
      value: String(a.id),
      label: a.name,
      hint: [a.subtitle, formatAmount(a.balances[0]?.amount ?? "0.00", symbolOf(a.currency ?? base), lang)].filter(Boolean).join(" · "),
    }));

  const total = parseAmount(amount || "0", lang);
  const partsTotal = parts.reduce((s, p) => s + Math.round(Number(parseAmount(p.amount || "0", lang) ?? "NaN") * 100), 0);
  const remaining = total !== null ? Math.round(Number(total) * 100) - partsTotal : NaN;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!account) return setProblem("Elige la cuenta");
    if (total === null || Number(total) <= 0) return setProblem("Escribe un monto mayor que cero");
    if (needRate && !(Number(rate.value) > 0))
      return setProblem("Escribe el tipo de cambio, como 3.443");
    const body: MoveIn = {
      lines: [],
      kind,
      account_id: account.id,
      amount: total,
      date,
      ref: note.trim() || null,
      pending,
      rate: needRate ? rate.value.trim() : null,
      splits: [],
      to_account_id: null,
      to_amount: null,
    };
    if (kind === "transfer") {
      if (!toAccount) return setProblem("Elige adónde entra");
      body.to_account_id = toAccount.id;
      if (crossCurrency) {
        const t = parseAmount(toAmount || "", lang);
        if (!t || Number(t) <= 0) return setProblem(`Escribe cuánto entró en ${symbolOf(toAccount.currency)}`);
        body.to_amount = t;
      }
    } else {
      const chosen = split ? parts : [{ ...parts[0]!, amount: total }];
      if (chosen.some((p) => !p.category)) return setProblem(kind === "expense" ? "Elige en qué gastaste" : "Elige de qué es el ingreso");
      if (split && remaining !== 0) return setProblem("Las partes tienen que sumar el total");
      body.splits = chosen.map((p) => ({ category_id: p.category!.id, amount: parseAmount(p.amount, lang) ?? p.amount }));
    }
    save.mutate(body, { onSuccess: (d) => navigate(editing ? `/movimientos/${d.summary.id}` : "/movimientos", { replace: true }) });
  };

  const pickCategory = (c: Category) => {
    setParts((ps) => ps.map((p, i) => (i === sheetFor ? { ...p, category: c } : p)));
    setSheetFor(null);
  };
  const changeKind = (k: Kind) => {
    if (k === kind) return;
    setKind(k);
    setParts([{ category: null, amount: "" }]);
    setSplit(false);
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-6">
      <div className="-mx-2.5 flex items-center justify-between">
        <button type="button" aria-label="Cerrar sin guardar" onClick={() => navigate(-1)} className="grid size-11 place-items-center rounded-full">
          <Icon name="close" className="text-[24px]" />
        </button>
        <span className="pr-2.5 text-label text-muted-foreground">{editing ? "Editar movimiento" : "Nuevo movimiento"}</span>
      </div>

      <form noValidate onSubmit={submit} className="flex flex-1 flex-col">
        <div role="radiogroup" aria-label="Tipo de movimiento" className="mt-2 grid grid-cols-4 gap-1 rounded-md bg-muted p-[3px]">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={k === kind} onClick={() => changeKind(k)}
              className={`h-[38px] rounded-[8px] text-[14px] font-semibold ${k === kind ? "bg-card shadow-sm" : ""}`}>
              {KIND_LABEL[k]}
            </button>
          ))}
          <span aria-disabled="true" title="Préstamos, reembolsos y más: muy pronto"
            className="grid h-[38px] place-items-center text-[14px] font-semibold text-muted-foreground opacity-60">Más</span>
        </div>

        <label className="mt-5 flex flex-col gap-0.5 text-caption font-semibold">
          {kind === "expense" ? "¿Cuánto gastaste?" : kind === "income" ? "¿Cuánto entró?" : "¿Cuánto pasas?"}
          <span className="flex items-baseline gap-2 border-b-2 border-input-line">
            <span aria-hidden="true" className="text-[26px] leading-8 font-semibold text-muted-foreground">{symbolOf(currency)}</span>
            <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)}
              aria-description={`En ${symbolOf(currency)}`}
              className="h-16 min-w-0 flex-1 border-0 bg-transparent p-0 text-[48px] leading-[56px] font-semibold tracking-[-0.02em] tabular-nums" />
          </span>
        </label>

        <div className="mt-2 flex flex-col">
          <SheetSelect label={kind === "income" ? "Entra a" : "Sale de"} sheetTitle={kind === "income" ? "¿A qué cuenta entra?" : "¿De qué cuenta sale?"}
            value={account ? String(account.id) : ""} onChange={setAccountId} options={options()} />

          {needRate && (
            <div className="mt-3 border-b border-border pb-3">
              <RateField input={rate} currency={currency} side={side}
                aside={total && Number(rate.value) > 0 && kind !== "transfer" && (
                  <>
                    <span className="text-caption text-muted-foreground">Son</span>
                    <span className="font-semibold">{formatAmount(multiply(total, rate.value), symbolOf(base), lang)}</span>
                  </>
                )} />
            </div>
          )}

          {kind === "transfer" && (
            <>
              <div className="mt-3">
                <SheetSelect label="Entra a" sheetTitle="¿A qué cuenta entra?" value={toAccountId} onChange={setToAccountId} options={options(account?.id)} />
              </div>
              {crossCurrency && (
                <div className="mt-3 grid grid-cols-2 items-end gap-4 border-b border-border pb-3">
                  <label className="flex flex-col gap-0.5 text-caption font-semibold">
                    Entraron
                    <span className="flex items-baseline gap-1.5 border-b-2 border-input-line">
                      <span aria-hidden="true" className="font-semibold text-muted-foreground">{symbolOf(toAccount.currency)}</span>
                      <input inputMode="decimal" placeholder="0.00" value={toAmount} onChange={(e) => setToAmount(e.target.value)}
                        className="h-10 min-w-0 flex-1 border-0 bg-transparent p-0 text-[20px] leading-7 font-semibold tabular-nums" />
                    </span>
                  </label>
                  <span className="pb-1.5 text-caption text-muted-foreground tabular-nums">
                    {impliedRate(amount, toAmount, currency, toAccount.currency ?? base, base, lang)}
                    {sunat.value && sunatSell.value &&
                      ` SUNAT ${sunat.date === todayISO() ? "hoy" : `del ${shortDate(sunat.date!)}`}: ${sunat.value} · ${sunatSell.value}`}
                  </span>
                </div>
              )}
              {crossCurrency && toAccount.currency === base && (
                <FxPreview account={account} out={parseAmount(amount || "", lang)} into={parseAmount(toAmount || "", lang)}
                  base={base} lang={lang} />
              )}
            </>
          )}

          {kind !== "transfer" && !split && (
            <button type="button" aria-haspopup="dialog" onClick={() => setSheetFor(0)}
              className="flex min-h-[60px] items-center gap-3 border-b border-border text-left">
              {parts[0]?.category ? <CategoryChip category={parts[0].category} /> : (
                <span className="grid size-9 place-items-center rounded-full border-[1.5px] border-dashed border-input-line"><Icon name="category" /></span>
              )}
              <span className="flex flex-1 flex-col">
                <span className="text-caption text-muted-foreground">{kind === "income" ? "De qué" : "En qué"}</span>
                <span className="font-semibold">{parts[0]?.category?.name ?? "Elige una categoría"}</span>
              </span>
              <Icon name="expand_more" className="text-[22px] text-muted-foreground" />
            </button>
          )}

          {kind !== "transfer" && split && (
            <div className="flex flex-col border-b border-border pt-1 pb-2">
              <span className="pt-1.5 pb-0.5 text-caption text-muted-foreground">{kind === "income" ? "De qué, dividido" : "En qué, dividido"}</span>
              {parts.map((p, i) => (
                <div key={i} className="flex min-h-12 items-center gap-3">
                  <button type="button" onClick={() => setSheetFor(i)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                    {p.category ? <CategoryChip category={p.category} size={32} /> : (
                      <span className="grid size-8 place-items-center rounded-full border-[1.5px] border-dashed border-input-line"><Icon name="category" className="text-[18px]" /></span>
                    )}
                    <span className="truncate font-semibold">{p.category?.name ?? "Elige una categoría"}</span>
                  </button>
                  <label className="flex w-28 items-baseline gap-1 border-b-2 border-input-line">
                    <span aria-hidden="true" className="text-muted-foreground">{symbolOf(currency)}</span>
                    <input inputMode="decimal" placeholder="0.00" aria-label={`Monto para ${p.category?.name ?? `la parte ${i + 1}`}`}
                      value={p.amount} onChange={(e) => setParts((ps) => ps.map((x, j) => (j === i ? { ...x, amount: e.target.value } : x)))}
                      className="h-8 min-w-0 flex-1 border-0 bg-transparent p-0 text-right font-medium tabular-nums" />
                  </label>
                  {parts.length > 1 && (
                    <button type="button" aria-label={`Quitar ${p.category?.name ?? "esta parte"}`} onClick={() => setParts((ps) => ps.filter((_, j) => j !== i))}
                      className="grid size-8 place-items-center text-muted-foreground"><Icon name="close" className="text-[18px]" /></button>
                  )}
                </div>
              ))}
              <div className="flex min-h-10 items-center justify-between">
                <button type="button" onClick={() => setParts((ps) => [...ps, { category: null, amount: "" }])}
                  className="flex items-center gap-1 font-semibold text-primary-strong">
                  <Icon name="add" />Otra categoría
                </button>
                <span className={`flex items-center gap-1 text-caption font-semibold ${remaining === 0 ? "text-income" : "text-attention"}`}>
                  <Icon name={remaining === 0 ? "check_circle" : "info"} fill={remaining === 0} className="text-[18px]" />
                  {Number.isNaN(remaining) ? "Revisa los montos" : remaining === 0
                    ? `Suma ${formatAmount(total ?? "0", symbolOf(currency), lang)}`
                    : remaining > 0 ? `Falta ${formatAmount((remaining / 100).toFixed(2), symbolOf(currency), lang)}`
                      : `Sobra ${formatAmount((-remaining / 100).toFixed(2), symbolOf(currency), lang)}`}
                </span>
              </div>
            </div>
          )}

          <div className="grid min-h-[52px] grid-cols-[auto_1fr] items-center gap-3 border-b border-border">
            <button type="button" aria-expanded={dateOpen} onClick={() => setDateOpen(!dateOpen)}
              className="flex h-9 items-center gap-1 rounded-full border border-border px-3 text-caption font-semibold">
              <Icon name="event" className="text-[18px]" />
              {date === todayISO() ? "Hoy" : longDate(date)}
            </button>
            <input aria-label="Nota" placeholder="Nota (opcional)" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)}
              className="h-10 min-w-0 border-0 bg-transparent p-0" />
          </div>
          {dateOpen && (
            <div className="py-3">
              <LineField label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value || todayISO())} />
            </div>
          )}

          {kind !== "transfer" && (
            <label className="flex min-h-[52px] cursor-pointer items-center gap-3 border-b border-border">
              <Icon name="call_split" className="w-9 text-center text-muted-foreground" />
              <span className="flex-1">Dividir en varias categorías</span>
              <input type="checkbox" role="switch" checked={split} className="size-[22px] accent-primary"
                onChange={() => {
                  setSplit(!split);
                  setParts((ps) => (split ? [ps[0]!] : [{ ...ps[0]!, amount: amount }, { category: null, amount: "" }]));
                }} />
            </label>
          )}
          <label className="flex min-h-[52px] cursor-pointer items-center gap-3">
            <Icon name="schedule" className="w-9 text-center text-muted-foreground" />
            <span className="flex flex-1 flex-col">
              <span>Por confirmar</span>
              <span className="text-caption text-muted-foreground">
                {future ? "Con fecha futura queda por confirmar hasta su día" : "No cuenta en tus saldos hasta que lo confirmes"}
              </span>
            </span>
            <input type="checkbox" role="switch" checked={pending || future} disabled={future} onChange={() => setPending(!pending)}
              className="size-[22px] accent-primary" />
          </label>
        </div>

        <div className="min-h-4 flex-1" />
        <div className="flex flex-col gap-3">
          {(problem || save.error) && <ErrorAlert>{problem ?? save.error?.message}</ErrorAlert>}
          <PrimaryButton pending={save.isPending}>
            {editing ? "Guardar cambios" : pending || future ? "Guardar por confirmar" : SUBMIT[kind]}
          </PrimaryButton>
        </div>
      </form>

      {kind !== "transfer" && (
        <CategorySheet kind={kind} open={sheetFor !== null} onClose={() => setSheetFor(null)} onPick={pickCategory}
          selected={sheetFor !== null ? parts[sheetFor]?.category?.id : null} />
      )}
    </main>
  );
}

/** Al vender: cuánto costaron esos dólares (su costo promedio en la cuenta) y la diferencia con lo recibido.
 *  La API hace la misma cuenta; aquí solo se adelanta lo que va a quedar. */
function FxPreview({ account, out, into, base, lang }: {
  account: AccountRow | undefined; out: string | null; into: string | null; base: string; lang: string;
}) {
  const held = account?.balances[0];
  if (!held || !out || !into || Number(out) <= 0 || Number(into) <= 0 || Number(held.amount) <= 0 || Number(held.book) <= 0) return null;
  const avg = divide(held.book, held.amount);
  const cost = out === held.amount ? held.book : proportion(out, held.book, held.amount);
  const diff = subtract(into, cost);
  if (isZero(diff)) return null;
  const gain = !diff.startsWith("-");
  const money = (v: string) => formatAmount(v, symbolOf(base), lang);
  return (
    <section aria-label={gain ? "Ganancia por tipo de cambio" : "Costo del cambio"}
      className="mt-3 flex flex-col gap-1.5 rounded-[12px] border border-border bg-card px-3.5 py-3">
      <span className="flex items-center gap-2.5">
        <CategoryChip category={{ icon: "currency_exchange", color: gain ? 10 : 1 }} size={32} />
        <span className="flex-1 font-semibold">{gain ? "Ganancia por tipo de cambio" : "Costo del cambio"}</span>
        <span className={`font-semibold tabular-nums ${gain ? "text-income" : "text-expense"}`}>
          {gain ? "+ " : "− "}{money(diff.replace("-", ""))}
        </span>
      </span>
      <span className="text-caption text-muted-foreground tabular-nums">
        Esos {formatAmount(out, symbolOf(account!.currency), lang)} te costaron {money(cost)} (a {avg} en promedio) y recibes {money(into)}.
      </span>
    </section>
  );
}

/** «Tipo de cambio 3.750, sale solo de los dos montos». */
function impliedRate(out: string, into: string, from: string, to: string, base: string, lang: string) {
  const a = Number(parseAmount(out || "0", lang));
  const b = Number(parseAmount(into || "0", lang));
  if (!a || !b) return "El tipo de cambio sale solo de los dos montos.";
  const rate = from === base ? a / b : to === base ? b / a : null;
  return rate ? `Tipo de cambio ${rate.toFixed(3)}, sale solo de los dos montos.` : "Cambio entre dos monedas extranjeras.";
}
