// R1 · Registrar (y editar): gasto, ingreso o transferencia; dividir en varias categorías (y una
// parte de otra persona, que te la debe); un gasto que pagó otra persona; «Más» abre el panel;
// en otra moneda con el tipo del día (editable); entre monedas con los dos montos y, al vender, el
// costo del cambio o la ganancia; con tarjeta, en soles o dólares y en cuotas; por confirmar.
// «Se repite» lo vuelve una recurrente (X1): la regla, hasta cuándo y cómo se registra.
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import {
  type AccountRow, type Category, type MoveDetail, type MoveIn, type RecurringDetail, type RuleIn, useAccounts, useMe, useMove,
  usePartners, useRecurring, useReminderDone, useSaveMove, useSaveRecurring, useUploadAttachment,
} from "@/api/hooks";
import { PendingFiles } from "@/components/Attachments";
import { CategoryChip, CategorySheet } from "@/components/CategorySheet";
import { MasTipos } from "@/components/MasTipos";
import { Avatar } from "@/components/MoveBits";
import { PersonPicker } from "@/components/PersonPicker";
import { RateField, useRateInput, useSuggestedRate } from "@/components/RateField";
import { OptionList, Segmented, Sheet, SheetSelect } from "@/components/Sheet";
import { ErrorAlert, Icon, PrimaryButton, Spinner } from "@/components/ui";
import { DateField, DateSheet, dateLabel } from "@/components/DateSheet";
import { Installments } from "@/components/Installments";
import { shortDate, todayISO } from "@/lib/dates";
import { MODE_NAME, ruleText } from "@/lib/recurrence";
import { isPersonKind } from "@/lib/kinds";
import { CURRENCY_NAME, divide, formatAmount, formatNumber, isZero, multiply, parseAmount, proportion, subtract, symbolOf } from "@/lib/money";
import { PersonaSheet } from "@/pages/personas/PersonaForm";
import { useBack } from "@/lib/transitions";

import { AsientoManual } from "./AsientoManual";
import { Reembolso } from "./Reembolso";
import { RegistrarPersona } from "./RegistrarPersona";

type Kind = Extract<MoveIn["kind"], "expense" | "income" | "transfer">;
type Who = { id: number; name: string };
type Part = { category: Category | null; partner?: Who | null; amount: string };

const KIND_LABEL: Record<Kind, string> = { expense: "Gasto", income: "Ingreso", transfer: "Transferir" };
const SUBMIT: Record<Kind, string> = { expense: "Registrar gasto", income: "Registrar ingreso", transfer: "Registrar transferencia" };
type Mode = "auto" | "draft" | "reminder";
type Freq = "month" | "week" | "year" | "other";
const FREQS: [Freq, string][] = [["month", "Cada mes"], ["week", "Cada semana"], ["year", "Cada año"], ["other", "Otro"]];
const MODES: [Mode, string][] = [["auto", "Se registra solo en su fecha"], ["draft", "Se crea para que revises el monto"], ["reminder", "Te avisamos y lo registras tú"]];

/** Pantalla de edición: espera el movimiento y abre el formulario con sus datos. */
export function EditarMovimiento() {
  const id = Number(useParams().id);
  const move = useMove(id);
  if (move.isPending) return <Spinner />;
  if (move.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{move.error.message}</ErrorAlert></main>;
  const k = move.data.summary.kind;
  if (isPersonKind(k)) return <RegistrarPersona editing={move.data} />;
  if (k === "refund") return <Reembolso editing={move.data} />;
  if (k === "other") return <AsientoManual editing={move.data} />;
  return <Registrar editing={move.data} />;
}

/** Editar una recurrente: el mismo formulario con «Se repite» ya puesto. */
export function EditarRecurrente() {
  const id = Number(useParams().id);
  const rec = useRecurring(id);
  if (rec.isPending) return <Spinner />;
  if (rec.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{rec.error.message}</ErrorAlert></main>;
  return <Registrar recurring={rec.data} />;
}

/** Desde el aviso del Inicio: Registrar con lo de la recurrente; al guardar, el aviso se va. */
export function RegistrarAviso() {
  const id = Number(useParams().id);
  const occurrence = useParams().occurrence ?? "";
  const rec = useRecurring(id);
  if (rec.isPending) return <Spinner />;
  if (rec.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{rec.error.message}</ErrorAlert></main>;
  return <Registrar reminder={{ detail: rec.data, occurrence }} />;
}

export function Registrar({ editing, recurring, reminder }: {
  editing?: MoveDetail;
  recurring?: RecurringDetail;
  reminder?: { detail: RecurringDetail; occurrence: string };
}) {
  const navigate = useNavigate();
  const back = useBack();
  const me = useMe().data;
  const overview = useAccounts().data;
  const save = useSaveMove(editing?.summary.id);
  const saveRecurring = useSaveRecurring(recurring?.row.id);
  const reminderDone = useReminderDone();
  const source = recurring ?? reminder?.detail;   // de dónde se llena el formulario
  const lang = me?.lang ?? "es-PE";
  const fmt = (v: string) => formatNumber(v, lang);

  const [search] = useSearchParams();
  const tipo = search.get("tipo");
  const rec = source?.row;
  const initialKind = editing?.summary.kind ?? rec?.kind ?? (tipo === "income" || tipo === "transfer" ? tipo : "expense");
  const [kind, setKind] = useState<Kind>(initialKind as Kind);
  const [accountId, setAccountId] = useState<string>(
    editing?.account_id ? String(editing.account_id) : rec ? String(rec.account_id) : search.get("cuenta") ?? "");
  const [cardCurrency, setCardCurrency] = useState<string | null>(editing?.summary.currency ?? rec?.currency ?? null);
  const [inInstallments, setInInstallments] = useState(false);
  const [installments, setInstallments] = useState(6);
  const [cuota, setCuota] = useState("");
  const [owner, setOwner] = useState<number | null>(null);   // en cuotas, de otra persona: le prestaste la tarjeta
  const [ofOther, setOfOther] = useState(false);
  const [toAccountId, setToAccountId] = useState<string>(editing?.to_account_id ? String(editing.to_account_id) : "");
  const [amount, setAmount] = useState(editing ? fmt(editing.summary.amount) : rec ? fmt(rec.amount.replace("-", "")) : "");
  const [toAmount, setToAmount] = useState(editing?.summary.to_amount ? fmt(editing.summary.to_amount) : "");
  const [parts, setParts] = useState<Part[]>(
    editing?.splits.length
      ? editing.splits.map((s) => ({ category: s.category, partner: s.partner_id ? { id: s.partner_id, name: s.partner ?? "" } : null, amount: fmt(s.amount) }))
      : source?.categories.length
        ? source.categories.map((c, i) => ({ category: c, amount: fmt(source.splits[i] ?? "0") }))
        : [{ category: null, amount: "" }],
  );
  const [split, setSplit] = useState((editing?.splits.length ?? source?.categories.length ?? 0) > 1);
  const [date, setDate] = useState(editing?.summary.date ?? recurring?.rule.start ?? todayISO());
  const [dateOpen, setDateOpen] = useState(false);
  const [note, setNote] = useState(editing && editing.summary.ref !== editing.splits[0]?.category?.name ? editing.summary.ref
    : rec && rec.name !== rec.category?.name && !rec.name.startsWith("Transferencia a ") ? rec.name : "");
  const [pending, setPending] = useState(editing ? !editing.summary.posted : false);
  const [sheetFor, setSheetFor] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [paidBy, setPaidBy] = useState<number | null>(editing?.paid_by_partner_id ?? null);
  const [payer, setPayer] = useState<"me" | "other">(editing?.paid_by_partner_id ? "other" : "me");
  const [mas, setMas] = useState(false);
  const [partFor, setPartFor] = useState(false);
  const [adding, setAdding] = useState(false);
  const [later, setLater] = useState(false);   // «Lo clasifico después»: a Por clasificar
  const [files, setFiles] = useState<File[]>([]);   // adjuntos: se suben al guardar
  const upload = useUploadAttachment();
  const partners = usePartners().data ?? [];
  const rule = recurring?.rule;
  const [repeat, setRepeat] = useState(!!recurring || search.get("repite") === "1");
  const [freq, setFreq] = useState<Freq>(!rule ? "month" : rule.every > 1 || rule.interval === "day" ? "other" : rule.interval as Freq);
  const [every, setEvery] = useState(String(rule?.every ?? 2));
  const [unit, setUnit] = useState<RuleIn["interval"]>(rule?.interval ?? "day");
  const [endType, setEndType] = useState<RuleIn["end_type"]>(rule?.end_type ?? "never");
  const [endDate, setEndDate] = useState<string | null>(rule?.date_end ?? null);
  const [count, setCount] = useState(rule?.max_count ? String(rule.max_count) : "");
  const [mode, setMode] = useState<Mode>(rec?.mode ?? "auto");

  const base = me?.currency ?? "PEN";
  // Una tarjeta: es de donde sale un gasto y adonde entra su pago (no recibe ingresos ni se transfiere desde ella)
  const all: AccountRow[] = overview
    ? [...overview.have, ...overview.owe].filter((a) => ["cash", "bank", "card", "other"].includes(a.kind)) : [];
  const accounts = all.filter((a) => a.kind !== "card" || kind === "expense");
  const account = accounts.find((a) => String(a.id) === accountId) ?? (accountId === "" ? accounts[0] : undefined);
  const toAccount = all.find((a) => String(a.id) === toAccountId) ?? (toAccountId === "" && rec?.to_account
    ? all.find((a) => a.name === rec.to_account) : undefined);
  const other = kind === "expense" && payer === "other";   // lo pagó otra persona: no sale de tus cuentas
  const card = !other && account?.kind === "card";
  const currency = other ? base : card ? (cardCurrency ?? base) : account?.currency ?? base;
  const side = account?.kind === "other" || card ? "sell" : "buy";   // compra para lo que tienes, venta para lo que debes
  const toCurrency = toAccount?.kind === "card" ? currency : toAccount?.currency ?? base;   // a una tarjeta se paga en la moneda que sale
  const rate = useRateInput(currency, base, date, side, editing?.rate ? Number(editing.rate).toFixed(3) : null);
  const foreignSide = toAccount && toCurrency !== base ? toCurrency : currency;
  const sunat = useSuggestedRate(foreignSide, base, date, "buy");
  const sunatSell = useSuggestedRate(foreignSide, base, date, "sell");
  if (!me?.currency || !overview) return <Spinner />;
  const foreign = currency !== base;
  const crossCurrency = kind === "transfer" && toAccount && toCurrency !== currency;
  const repeating = repeat && !editing;
  // «Lo clasifico después» va en un gasto o ingreso entero, pagado por ti, sin cuotas y sin repetir
  const canLater = (kind === "expense" || kind === "income") && !split && !other && !(card && inInstallments) && !repeating && !editing;
  const isLater = later && canLater;
  const future = date > todayISO() && !repeating;
  // El tipo de cambio se escribe solo si nada lo da: en una transferencia que toca la moneda base, sale de los dos montos
  const needRate = foreign && !(kind === "transfer" && toCurrency === base) && !(kind === "transfer" && toAccount?.kind === "card");
  const options = (except?: number, list = accounts) =>
    list.filter((a) => a.id !== except).map((a) => ({
      value: String(a.id),
      label: a.name,
      hint: a.kind === "card" ? a.subtitle ?? "Tarjeta de crédito"
        : [a.subtitle, formatAmount(a.balances[0]?.amount ?? "0.00", symbolOf(a.currency ?? base), lang)].filter(Boolean).join(" · "),
    }));

  const total = parseAmount(amount || "0", lang);
  const partsTotal = parts.reduce((s, p) => s + Math.round(Number(parseAmount(p.amount || "0", lang) ?? "NaN") * 100), 0);
  const remaining = total !== null ? Math.round(Number(total) * 100) - partsTotal : NaN;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!account && !other) return setProblem("Elige la cuenta");
    if (other && !paidBy) return setProblem("Elige quién pagó");
    if (total === null || Number(total) <= 0) return setProblem("Escribe un monto mayor que cero");
    if (needRate && !(Number(rate.value) > 0))
      return setProblem("Escribe el tipo de cambio, como 3.443");
    const cuotaValue = cuota.trim() ? parseAmount(cuota, lang) : null;
    if (cuota.trim() && !(Number(cuotaValue) > 0)) return setProblem("Escribe la cuota como 207.00");
    const body: MoveIn = {
      lines: [],
      kind,
      account_id: other ? null : account!.id,
      amount: total,
      date,
      ref: note.trim() || null,
      pending,
      rate: needRate ? rate.value.trim() : null,
      splits: [],
      to_account_id: null,
      to_amount: null,
      paid_by_partner_id: other ? paidBy : null,
      currency: card ? currency : null,
      later: false,
      installments: card && inInstallments && kind === "expense" ? installments : null,
      installment_amount: card && inInstallments && kind === "expense" ? cuotaValue : null,
    };
    // De otra persona: no es tu gasto, le prestaste la tarjeta en cuotas (te debe el precio y, con
    // cada cuota facturada, su interés)
    if (card && inInstallments && kind === "expense" && ofOther) {
      if (!owner) return setProblem("Elige de quién es la compra");
      save.mutate({ ...body, kind: "lend", partner_id: owner, splits: [] },
        { onSuccess: () => navigate(`/personas/${owner}`, { replace: true }) });
      return;
    }
    if (kind === "transfer") {
      if (!toAccount) return setProblem("Elige adónde entra");
      body.to_account_id = toAccount.id;
      if (crossCurrency) {
        const t = parseAmount(toAmount || "", lang);
        if (!t || Number(t) <= 0) return setProblem(`Escribe cuánto entró en ${symbolOf(toCurrency)}`);
        body.to_amount = t;
      }
    } else if (isLater) {
      body.later = true;
    } else {
      const chosen = split ? parts : [{ ...parts[0]!, amount: total }];
      if (chosen.some((p) => !p.category && !p.partner)) return setProblem(kind === "expense" ? "Elige en qué gastaste" : "Elige de qué es el ingreso");
      if (!chosen.some((p) => p.category)) return setProblem("Al dividir, al menos una parte es tuya: elige su categoría");
      if (split && remaining !== 0) return setProblem("Las partes tienen que sumar el total");
      body.splits = chosen.map((p) => p.partner
        ? { partner_id: p.partner.id, amount: parseAmount(p.amount, lang) ?? p.amount }
        : { category_id: p.category!.id, amount: parseAmount(p.amount, lang) ?? p.amount });
    }
    if (repeating) {
      if (crossCurrency) return setProblem("Un cambio de moneda no se repite: el tipo de cambio es de cada día");
      if (endType === "count" && !(Number(count) >= 1)) return setProblem("Escribe cuántas veces");
      if (endType === "date" && !endDate) return setProblem("Elige hasta qué fecha");
      if (freq === "other" && !(Number(every) >= 1)) return setProblem("Escribe cada cuánto");
      const interval = freq === "other" ? unit : freq;
      const sameStart = rule && rule.start === date && rule.interval === interval;
      const r: RuleIn = {
        interval,
        every: freq === "other" ? Number(every) : 1,
        start: date,
        month_days: sameStart ? rule.month_days : null,
        weekday: sameStart ? rule.weekday : null,
        nth: sameStart ? rule.nth as RuleIn["nth"] : null,
        end_type: endType,
        date_end: endType === "date" ? endDate : null,
        max_count: endType === "count" ? Number(count) : null,
      };
      saveRecurring.mutate({ move: { ...body, pending: false, date: null }, rule: r, mode },
        { onSuccess: (id) => navigate(`/mas/recurrentes/${id}`, { replace: true }) });
      return;
    }
    save.mutate(body, {
      onSuccess: async (d) => {
        if (reminder) reminderDone.mutate({ id: reminder.detail.row.id, occurrence: reminder.occurrence });
        try {
          for (const file of files) await upload.mutateAsync({ moveId: d.summary.id, file });
        } catch {
          // El movimiento ya quedó: el detalle deja volver a adjuntar lo que faltó
          return navigate(`/movimientos/${d.summary.id}`, { replace: true });
        }
        navigate(editing ? `/movimientos/${d.summary.id}` : "/movimientos", { replace: true });
      },
    });
  };
  const ruleNow = { interval: freq === "other" ? unit : freq, every: freq === "other" ? Number(every) || 1 : 1, start: date,
    month_days: rule && rule.start === date ? rule.month_days : null, weekday: rule && rule.start === date ? rule.weekday : null,
    nth: rule && rule.start === date ? rule.nth : null } as const;
  const summary = repeating ? `${mode === "auto" ? "Se registra solo" : mode === "draft" ? "Se crea por confirmar" : "Te avisamos en el Inicio"}: ${ruleText(ruleNow).toLowerCase()}, desde el ${shortDate(date)}${
    endType === "count" && count ? `, ${count} ${count === "1" ? "vez" : "veces"}` : endType === "date" && endDate ? `, hasta el ${shortDate(endDate)}` : ""}.${
    mode === "draft" ? " Corriges el monto con el recibo; si importas el extracto, toma el monto del banco." : mode === "reminder" ? " Lo registras tú cuando lo pagues." : ""}` : "";

  const pickCategory = (c: Category) => {
    setParts((ps) => ps.map((p, i) => (i === sheetFor ? { ...p, category: c } : p)));
    setLater(false);
    setSheetFor(null);
  };
  const changeKind = (k: Kind) => {
    if (k === kind) return;
    setKind(k);
    setLater(false);
    setParts([{ category: null, amount: "" }]);
    setSplit(false);
    setPayer("me");
  };
  const addPartner = (w: Who) => {
    setParts((ps) => (split ? [...ps, { category: null, partner: w, amount: "" }] : [{ ...ps[0]!, amount }, { category: null, partner: w, amount: "" }]));
    setSplit(true);
    setPartFor(false);
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-6">
      <div className="-mx-2.5 flex items-center justify-between">
        <button type="button" aria-label="Cerrar sin guardar" onClick={back} className="grid size-11 place-items-center rounded-full">
          <Icon name="close" className="text-[24px]" />
        </button>
        <span className="pr-2.5 text-label text-muted-foreground">{editing ? "Editar movimiento" : recurring ? "Editar recurrente" : "Nuevo movimiento"}</span>
      </div>

      <form noValidate onSubmit={submit} className="flex flex-1 flex-col">
        <div role="radiogroup" aria-label="Tipo de movimiento" className="mt-2 grid grid-cols-4 gap-1 rounded-md bg-muted p-[3px]">
          {(Object.keys(KIND_LABEL) as Kind[]).map((k) => (
            <button key={k} type="button" role="radio" aria-checked={k === kind} onClick={() => changeKind(k)}
              className={`h-[38px] rounded-[8px] text-[14px] font-semibold ${k === kind ? "bg-selected text-selected-foreground shadow-sm" : ""}`}>
              {KIND_LABEL[k]}
            </button>
          ))}
          {!editing && (
            <button type="button" role="radio" aria-checked="false" onClick={() => setMas(true)} className="h-[38px] rounded-[8px] text-[14px] font-semibold">Más</button>
          )}
        </div>

        <label className="mt-5 flex flex-col gap-0.5 text-caption font-semibold">
          {repeating ? (mode === "draft" ? "¿Cuánto es, más o menos?" : "¿Cuánto es?")
            : kind === "expense" ? "¿Cuánto gastaste?" : kind === "income" ? "¿Cuánto entró?" : "¿Cuánto pasas?"}
          <span className="flex items-baseline gap-2 border-b-2 border-input-line">
            <span aria-hidden="true" className="text-[26px] leading-8 font-semibold text-muted-foreground">{symbolOf(currency)}</span>
            <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)}
              aria-description={`En ${symbolOf(currency)}`}
              className="h-16 min-w-0 flex-1 border-0 bg-transparent p-0 text-[48px] leading-[56px] font-semibold tracking-[-0.02em] tabular-nums" />
          </span>
        </label>

        {kind === "expense" && !repeating && (
          <div className="mt-3 flex flex-col gap-3">
            <Segmented label="¿Quién pagó?" size="sm" value={payer} onChange={(v) => { setPayer(v as "me" | "other"); if (v === "other") setParts((ps) => ps.filter((p) => !p.partner)); }}
              options={[{ value: "me", label: "Yo" }, { value: "other", label: "Otra persona" }]} />
            {other && (
              <>
                <PersonPicker label="¿Quién pagó por ti?" value={paidBy} onChange={setPaidBy} />
                {paidBy && total && (
                  <span className="text-caption text-muted-foreground tabular-nums">
                    No sale de tus cuentas: queda que le debes {formatAmount(total, symbolOf(base), lang)} a {partners.find((p) => p.id === paidBy)?.name.split(" ")[0]}.
                  </span>
                )}
              </>
            )}
          </div>
        )}

        <div className="mt-2 flex flex-col">
          {!other && (
            <SheetSelect label={kind === "income" ? "Entra a" : "Sale de"} sheetTitle={kind === "income" ? "¿A qué cuenta entra?" : "¿De qué cuenta sale?"}
              value={account ? String(account.id) : ""} onChange={setAccountId} options={options()} />
          )}
          {card && me.currencies.length > 1 && (
            <div className="mt-3">
              <Segmented label="Moneda" size="sm" value={currency} onChange={setCardCurrency}
                options={me.currencies.map((c) => ({ value: c, label: `${(CURRENCY_NAME[c] ?? c).replace(/^./, (x) => x.toUpperCase())} · ${symbolOf(c)}` }))} />
            </div>
          )}

          {needRate && !other && (
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
                <SheetSelect label="Entra a" sheetTitle="¿A qué cuenta entra?" value={toAccountId} onChange={setToAccountId} options={options(account?.id, all)} />
              </div>
              {crossCurrency && (
                <div className="mt-3 grid grid-cols-2 items-end gap-4 border-b border-border pb-3">
                  <label className="flex flex-col gap-0.5 text-caption font-semibold">
                    Entraron
                    <span className="flex items-baseline gap-1.5 border-b-2 border-input-line">
                      <span aria-hidden="true" className="font-semibold text-muted-foreground">{symbolOf(toCurrency)}</span>
                      <input inputMode="decimal" placeholder="0.00" value={toAmount} onChange={(e) => setToAmount(e.target.value)}
                        className="h-10 min-w-0 flex-1 border-0 bg-transparent p-0 text-[20px] leading-7 font-semibold tabular-nums" />
                    </span>
                  </label>
                  <span className="pb-1.5 text-caption text-muted-foreground tabular-nums">
                    {impliedRate(amount, toAmount, currency, toCurrency, base, lang)}
                    {sunat.value && sunatSell.value &&
                      ` SUNAT ${sunat.date === todayISO() ? "hoy" : `del ${shortDate(sunat.date!)}`}: ${sunat.value} · ${sunatSell.value}`}
                  </span>
                </div>
              )}
              {crossCurrency && toCurrency === base && (
                <FxPreview account={account} out={parseAmount(amount || "", lang)} into={parseAmount(toAmount || "", lang)}
                  base={base} lang={lang} />
              )}
            </>
          )}

          {kind !== "transfer" && !split && (
            <button type="button" aria-haspopup="dialog" onClick={() => setSheetFor(0)}
              className="flex min-h-[60px] items-center gap-3 border-b border-border text-left">
              {isLater ? (
                <span className="grid size-9 place-items-center rounded-full border-[1.5px] border-dashed border-input-line"><Icon name="inbox" /></span>
              ) : parts[0]?.category ? <CategoryChip category={parts[0].category} /> : (
                <span className="grid size-9 place-items-center rounded-full border-[1.5px] border-dashed border-input-line"><Icon name="category" /></span>
              )}
              <span className="flex flex-1 flex-col">
                <span className="text-caption text-muted-foreground">{kind === "income" ? "De qué" : "En qué"}</span>
                <span className="font-semibold">{isLater ? "Lo clasifico después" : parts[0]?.category?.name ?? "Elige una categoría"}</span>
              </span>
              <Icon name="expand_more" className="text-[22px] text-muted-foreground" />
            </button>
          )}
          {kind !== "transfer" && !split && (isLater || parts[0]?.category?.name === "Ajuste") && (
            <span className="pt-2 text-caption text-muted-foreground">
              {isLater
                ? kind === "income"
                  ? "Entra a tu cuenta, pero no cuenta como ingreso del mes hasta que elijas de qué es. Lo verás en Pendientes y en Por clasificar."
                  : "Baja tu cuenta, pero no cuenta como gasto del mes hasta que elijas la categoría. Lo verás en Pendientes y en Por clasificar."
                : "Es gasto desde ya y no vuelve a preguntar. Úsalo cuando nunca sabrás en qué fue o para cuadrar un descuadre."}
            </span>
          )}

          {kind !== "transfer" && split && (
            <div className="flex flex-col border-b border-border pt-1 pb-2">
              <span className="pt-1.5 pb-0.5 text-caption text-muted-foreground">{kind === "income" ? "De qué, dividido" : "En qué, dividido"}</span>
              {parts.map((p, i) => (
                <div key={i} className="flex min-h-12 items-center gap-3">
                  {p.partner ? (
                    <span className="flex min-w-0 flex-1 items-center gap-3">
                      <Avatar name={p.partner.name} size={32} />
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-semibold">Parte de {p.partner.name.split(" ")[0]}</span>
                        <span className="text-caption text-muted-foreground">Te la debe</span>
                      </span>
                    </span>
                  ) : (
                    <button type="button" onClick={() => setSheetFor(i)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      {p.category ? <CategoryChip category={p.category} size={32} /> : (
                        <span className="grid size-8 place-items-center rounded-full border-[1.5px] border-dashed border-input-line"><Icon name="category" className="text-[18px]" /></span>
                      )}
                      <span className="truncate font-semibold">{p.category?.name ?? "Elige una categoría"}</span>
                    </button>
                  )}
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
              <div className="flex min-h-10 flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <span className="flex items-center gap-4 whitespace-nowrap">
                  <button type="button" onClick={() => setParts((ps) => [...ps, { category: null, amount: "" }])}
                    className="flex items-center gap-1 font-semibold text-primary-strong">
                    <Icon name="add" />Categoría
                  </button>
                  {kind === "expense" && !other && !repeating && (
                    <button type="button" onClick={() => setPartFor(true)} className="flex items-center gap-1 font-semibold text-primary-strong">
                      <Icon name="person_add" />Parte de alguien
                    </button>
                  )}
                </span>
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

          <div className={`grid min-h-[52px] ${repeating ? "grid-cols-1" : "grid-cols-[auto_1fr]"} items-center gap-3 border-b border-border`}>
            {!repeating && (
              <button type="button" aria-expanded={dateOpen} onClick={() => setDateOpen(!dateOpen)}
                className="flex h-9 items-center gap-1 rounded-full border border-border px-3 text-caption font-semibold">
                <Icon name="event" className="text-[18px]" />
                {dateLabel(date)}
              </button>
            )}
            <input aria-label="Nota" placeholder="Nota (opcional)" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)}
              className="h-10 min-w-0 border-0 bg-transparent p-0" />
          </div>
          <DateSheet open={dateOpen} onClose={() => setDateOpen(false)} title={repeating ? "¿Desde cuándo?" : "¿Cuándo fue?"} value={date}
            onChange={setDate} booked />
          {!editing && !repeating && <PendingFiles files={files} onChange={setFiles} />}

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
          {card && kind === "expense" && !editing && !repeating && (
            <>
              <label className={`flex min-h-[52px] cursor-pointer items-center gap-3 ${inInstallments ? "" : "border-b border-border"}`}>
                <Icon name="calendar_month" className="w-9 text-center text-muted-foreground" />
                <span className="flex flex-1 flex-col">
                  <span>En cuotas</span>
                  <span className="text-caption text-muted-foreground">El banco te lo cobra en varios cortes</span>
                </span>
                <input type="checkbox" role="switch" checked={inInstallments} onChange={() => setInInstallments(!inInstallments)}
                  className="size-[22px] accent-primary" />
              </label>
              {inInstallments && (
                <>
                  <Installments n={installments} setN={setInstallments} cuota={cuota} setCuota={setCuota} total={total} currency={currency} date={date}
                    closingDay={account!.card?.closing_day ?? null} category={ofOther ? null : parts[0]?.category?.name ?? null} lang={lang}
                    who={ofOther ? partners.find((p) => p.id === owner)?.name.split(" ")[0] ?? "La persona" : undefined} />
                  <label className={`flex min-h-[52px] cursor-pointer items-center gap-3 ${ofOther ? "" : "border-b border-border"}`}>
                    <Icon name="person" className="w-9 text-center text-muted-foreground" />
                    <span className="flex flex-1 flex-col">
                      <span>Es de otra persona</span>
                      <span className="text-caption text-muted-foreground">Le prestaste la tarjeta: no es tu gasto, te lo debe</span>
                    </span>
                    <input type="checkbox" role="switch" checked={ofOther} onChange={() => setOfOther(!ofOther)}
                      className="size-[22px] accent-primary" />
                  </label>
                  {ofOther && (
                    <div className="border-b border-border pb-3">
                      <PersonPicker label="¿De quién es?" value={owner} onChange={setOwner} />
                    </div>
                  )}
                </>
              )}
            </>
          )}
          {!editing && !recurring && (
            <label className="flex min-h-[52px] cursor-pointer items-center gap-3 border-b border-border">
              <Icon name="repeat" className="w-9 text-center text-muted-foreground" />
              <span className="flex flex-1 flex-col">
                <span>Se repite</span>
                <span className="text-caption text-muted-foreground">El sueldo, el alquiler, Netflix: PPM lo registra cada vez</span>
              </span>
              <input type="checkbox" role="switch" checked={repeat} onChange={() => { setRepeat(!repeat); setInInstallments(false); setPayer("me"); }}
                className="size-[22px] accent-primary" />
            </label>
          )}
          {repeating && (
            <div className="flex flex-col gap-4 pt-3">
              <div role="radiogroup" aria-label="¿Cada cuánto?" className="flex flex-wrap gap-2">
                {FREQS.map(([f, label]) => (
                  <button key={f} type="button" role="radio" aria-checked={f === freq} onClick={() => setFreq(f)}
                    className={`h-9 rounded-full border px-3.5 text-caption font-semibold ${f === freq ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {freq === "other" && (
                <div className="grid grid-cols-[96px_1fr] items-end gap-3">
                  <label className="flex flex-col gap-0.5 text-caption font-semibold">
                    Cada
                    <input inputMode="numeric" value={every} onChange={(e) => setEvery(e.target.value.replace(/\D/g, ""))}
                      className="h-10 border-0 border-b-2 border-input-line bg-transparent p-0 text-[17px] tabular-nums" />
                  </label>
                  <Segmented label="Unidad" size="sm" value={unit} onChange={(v) => setUnit(v as RuleIn["interval"])}
                    options={[{ value: "day", label: "Días" }, { value: "week", label: "Semanas" }, { value: "month", label: "Meses" }]} />
                </div>
              )}
              <button type="button" aria-haspopup="dialog" onClick={() => setDateOpen(true)}
                className="flex flex-col items-start border-b-2 border-input-line pb-1.5 text-left">
                <span className="text-caption font-semibold">¿Qué día?</span>
                <span className="flex w-full items-center gap-2 text-[17px] leading-[26px]">
                  <span className="flex-1">{ruleText(ruleNow)} · desde el {shortDate(date)}</span>
                  <Icon name="calendar_month" className="text-[22px] text-muted-foreground" />
                </span>
              </button>
              <Segmented label="¿Hasta cuándo?" size="sm" value={endType} onChange={(v) => setEndType(v as RuleIn["end_type"])}
                options={[{ value: "never", label: "Sin fin" }, { value: "date", label: "Hasta una fecha" }, { value: "count", label: "Unas veces" }]} />
              {endType === "date" && <DateField label="¿Hasta qué fecha?" value={endDate} onChange={setEndDate} min={date} />}
              {endType === "count" && (
                <label className="flex flex-col gap-0.5 text-caption font-semibold">
                  ¿Cuántas veces?
                  <input inputMode="numeric" value={count} onChange={(e) => setCount(e.target.value.replace(/\D/g, ""))}
                    className="h-10 border-0 border-b-2 border-input-line bg-transparent p-0 text-[17px] tabular-nums" />
                </label>
              )}
              <div role="radiogroup" aria-label="¿Cómo se registra?" className="flex flex-col gap-1">
                <span className="text-caption font-semibold">¿Cómo se registra?</span>
                {MODES.map(([m, hint]) => (
                  <button key={m} type="button" role="radio" aria-checked={m === mode} onClick={() => setMode(m)}
                    className={`flex min-h-12 items-center gap-3 rounded-md px-3 text-left ${m === mode ? "bg-muted" : ""}`}>
                    <Icon name={m === mode ? "radio_button_checked" : "radio_button_unchecked"} fill={m === mode} className="text-[22px]" />
                    <span className="flex flex-col">
                      <span className="font-semibold">{m === "reminder" ? "Solo avisarme" : MODE_NAME[m]}</span>
                      <span className="text-caption text-muted-foreground">{hint}</span>
                    </span>
                  </button>
                ))}
              </div>
              <p role="status" className="rounded-md bg-muted px-3 py-2.5 text-caption">{summary}</p>
            </div>
          )}
          {!repeating && (
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
          )}
        </div>

        <div className="min-h-4 flex-1" />
        <div className="flex flex-col gap-3">
          {(problem || save.error || saveRecurring.error) && <ErrorAlert>{problem ?? save.error?.message ?? saveRecurring.error?.message}</ErrorAlert>}
          <PrimaryButton pending={save.isPending || saveRecurring.isPending || upload.isPending}>
            {editing || recurring ? "Guardar cambios" : repeating ? (mode === "reminder" ? "Guardar recordatorio" : "Guardar recurrente")
              : editing ? "Guardar cambios" : pending || future ? "Guardar por confirmar"
              : card && inInstallments && kind === "expense" ? `Registrar gasto en ${installments} cuotas` : SUBMIT[kind]}
          </PrimaryButton>
        </div>
      </form>

      {kind === "expense" && (
        <Sheet title="¿De quién es esta parte?" open={partFor} onClose={() => setPartFor(false)}>
          <OptionList value="" options={partners.map((p) => ({ value: String(p.id), label: p.name, hint: "Te la queda debiendo" }))}
            onPick={(v) => { const p = partners.find((x) => String(x.id) === v); if (p) addPartner({ id: p.id, name: p.name }); }} />
          <button type="button" onClick={() => { setPartFor(false); setAdding(true); }}
            className="mx-3 mt-2 flex h-12 items-center justify-center gap-1.5 rounded-xl border border-dashed border-input-line font-semibold">
            <Icon name="person_add" />Nueva persona
          </button>
        </Sheet>
      )}
      <PersonaSheet key={String(adding)} open={adding} onClose={() => setAdding(false)}
        onCreated={(id, name) => addPartner({ id, name })} />
      <MasTipos open={mas} onClose={() => setMas(false)} />
      {kind !== "transfer" && (
        <CategorySheet kind={kind} open={sheetFor !== null} onClose={() => setSheetFor(null)} onPick={pickCategory}
          selected={sheetFor !== null && !isLater ? parts[sheetFor]?.category?.id : null}
          later={isLater} onLater={canLater && sheetFor === 0 ? () => { setLater(true); setSheetFor(null); } : undefined} />
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
