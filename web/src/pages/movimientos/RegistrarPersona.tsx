// R1 · Con otra persona: le presté, me prestaron, me pagaron, pagué, me dio para guardar y le devolví
// o usé su plata. El mismo formulario para las seis: cuánto, con quién y de qué cuenta, y una tarjeta
// que dice cómo queda la deuda. Un cobro o un pago no pasan de lo que se debe, y pueden ir en otra
// moneda, como en una casa de cambio: la deuda en dólares se paga con soles (o al revés).
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { type AccountRow, type MoveDetail, type MoveIn, type PartnerRow, useAccounts, useMe, usePartner, usePartnersOverview, useSaveMove } from "@/api/hooks";
import { MasHeader } from "@/components/MasTipos";
import { pickAccount } from "@/lib/startAccount";
import { PersonPicker } from "@/components/PersonPicker";
import { Installments } from "@/components/Installments";
import { RateField, useRateInput } from "@/components/RateField";
import { CurrencyChoice, Sheet, SheetSelect } from "@/components/Sheet";
import { DebtCard } from "@/components/DebtCard";
import { ErrorAlert, Icon, Optional, PrimaryButton, Spinner } from "@/components/ui";
import { DateSheet, dateLabel } from "@/components/DateSheet";
import { todayISO } from "@/lib/dates";
import { type PersonKind, isPersonKind } from "@/lib/kinds";
import { CURRENCY_NAME, add, currencyOption, divide, formatAmount, formatNumber, multiply, parseAmount, subtract, symbolOf } from "@/lib/money";
import { useBack } from "@/lib/transitions";
import { useDesktopFocus } from "@/lib/desktop";
import { accountOption } from "@/components/AccountSub";

const TEXT: Record<PersonKind, { ask: string; who: string; into: boolean; submit: string; role: "owes_me" | "i_owe" | "keep" }> = {
  lend: { ask: "¿Cuánto le prestaste?", who: "¿A quién?", into: false, submit: "Registrar préstamo", role: "owes_me" },
  borrow: { ask: "¿Cuánto te prestaron?", who: "¿Quién te prestó?", into: true, submit: "Registrar préstamo", role: "i_owe" },
  collect: { ask: "¿Cuánto te pagaron?", who: "¿Quién te pagó?", into: true, submit: "Registrar cobro", role: "owes_me" },
  repay: { ask: "¿Cuánto pagaste?", who: "¿A quién le pagaste?", into: false, submit: "Registrar pago", role: "i_owe" },
  custody_in: { ask: "¿Cuánto te dio para guardar?", who: "¿De quién es la plata?", into: true, submit: "Guardar su plata", role: "keep" },
  custody_out: { ask: "¿Cuánto le devolviste o usaste?", who: "¿De quién era la plata?", into: false, submit: "Registrar devolución", role: "keep" },
};
const LIMITED: PersonKind[] = ["collect", "repay", "custody_out"];

export function RegistrarPersona({ editing }: { editing?: MoveDetail }) {
  const params = useParams();
  const [search] = useSearchParams();
  const kind = (editing?.summary.kind ?? params.kind ?? "lend") as PersonKind;
  if (!isPersonKind(kind)) return <ErrorAlert>Ese tipo de movimiento no existe.</ErrorAlert>;
  return <Form key={kind} kind={kind} editing={editing} initialPerson={Number(search.get("persona")) || null} />;
}

function Form({ kind, editing, initialPerson }: { kind: PersonKind; editing?: MoveDetail; initialPerson: number | null }) {
  const navigate = useNavigate();
  const back = useBack();
  const [search] = useSearchParams();
  const me = useMe().data;
  const overview = useAccounts().data;
  const people = usePartnersOverview().data;
  const save = useSaveMove(editing?.summary.id);
  const lang = me?.lang ?? "es-PE";
  const t = TEXT[kind];

  const [who, setWho] = useState<number | null>(editing?.partner_id ?? initialPerson);
  const [accountId, setAccountId] = useState(editing?.account_id ? String(editing.account_id) : "");
  const [amount, setAmount] = useState(editing ? formatNumber(editing.summary.amount, lang) : "");
  const focusAmount = useDesktopFocus<HTMLInputElement>();
  const [date, setDate] = useState(editing?.summary.date ?? todayISO());
  const [dateOpen, setDateOpen] = useState(false);
  const [note, setNote] = useState(editing?.summary.ref ?? "");
  const [pending, setPending] = useState(editing ? !editing.summary.posted : false);
  const [debt, setDebt] = useState<{ id: number; ref: string } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [cardCurrency, setCardCurrency] = useState(editing?.summary.currency ?? "");
  const [inInstallments, setInInstallments] = useState(false);
  const [installments, setInstallments] = useState(6);
  const [cuota, setCuota] = useState("");
  const [debtPick, setDebtPick] = useState(editing?.summary.to_currency ?? "");   // qué deuda paga, si hay en varias monedas
  const [debtAmount, setDebtAmount] = useState(editing?.summary.to_amount ? formatNumber(editing.summary.to_amount, lang) : "");
  const detail = usePartner(LIMITED.includes(kind) && who ? who : 0).data;

  const base = me?.currency ?? "PEN";
  // Prestar la tarjeta: la persona compra con ella; el banco te cobra a ti y ella te debe a ti
  const kinds = kind === "lend" ? ["cash", "bank", "other", "card"] : ["cash", "bank", "other"];
  const accounts: AccountRow[] = overview ? [...overview.have, ...overview.owe].filter((a) => kinds.includes(a.kind)) : [];
  const account = editing ? accounts.find((a) => String(a.id) === accountId)
    : pickAccount(accounts, accountId, search.get("cuenta"), me?.home_account_id);
  const isCard = account?.kind === "card";
  const currency = isCard ? cardCurrency || base : account?.currency ?? base;
  const rate = useRateInput(currency, base, date, account?.kind === "other" || isCard ? "sell" : "buy", editing?.rate ? Number(editing.rate).toFixed(3) : null);
  if (!me?.currency || !overview || !people) return <Spinner />;

  const person: PartnerRow | undefined = people.people.find((p) => p.id === who);
  const first = person?.name.split(" ")[0] ?? "";
  // Cobrar o pagar: la deuda puede estar en otra moneda que la cuenta. Sin elegir, la de la cuenta si
  // hay deuda en ella; si no, la primera que haya
  const twoWay = kind === "collect" || kind === "repay";
  const editedDebt = editing && who === editing.partner_id ? editing.summary.to_currency ?? editing.summary.currency : null;
  const debtCurrencies = twoWay && person
    ? [...new Set([...person[t.role].map((m) => m.currency), ...(editedDebt ? [editedDebt] : [])])] : [];
  const debtCur = !twoWay || debtCurrencies.length === 0 ? currency
    : debtCurrencies.includes(debtPick) ? debtPick : debtCurrencies.includes(currency) ? currency : debtCurrencies[0]!;
  const cross = debtCur !== currency;
  // Lo que hay con esa persona en la moneda de la deuda, sin contar este movimiento si se está editando
  const had = person?.[t.role].find((m) => m.currency === debtCur)?.amount ?? "0.00";
  const mine = editedDebt === debtCur ? editing!.summary.to_amount ?? editing!.summary.amount : "0.00";
  const have = LIMITED.includes(kind) ? add(had, mine) : subtract(had, kind === editing?.summary.kind ? mine : "0.00");
  const value = parseAmount(amount || "", lang);
  const debtValue = cross ? parseAmount(debtAmount || "", lang) : value;
  const cuotaValue = cuota.trim() ? parseAmount(cuota, lang) : null;
  const cuotas = isCard && inInstallments && !editing;
  // En cuotas te debe todas: la cuota del banco × cuántas (sin cuota, lo que costó)
  const owed = cuotas && value && Number(cuotaValue) > 0 ? multiply(cuotaValue!, String(installments)) : value;
  const money = (v: string) => formatAmount(v, symbolOf(currency), lang);
  const nameOf = (c: string) => CURRENCY_NAME[c] ?? c;
  const owedMoney = (v: string) => formatAmount(v, symbolOf(debtCur), lang);   // en la moneda de la deuda
  const over = LIMITED.includes(kind) && who && debtValue && Number(debtValue) > Number(have);
  // El tipo que sale de los dos montos, en soles por unidad de la otra moneda
  const crossRate = cross && Number(value) > 0 && Number(debtValue) > 0
    ? currency === base ? divide(value!, debtValue!) : debtCur === base ? divide(debtValue!, value!) : null : null;
  const only = LIMITED.includes(kind)
    ? people.people.filter((p) => p[t.role].length > 0 || p.id === editing?.partner_id).map((p) => p.id) : undefined;
  const foreign = currency !== base;
  const future = date > todayISO();
  const openDebts = (kind === "collect" ? detail?.owes_me : detail?.i_owe)?.filter((i) => i.currency === debtCur) ?? [];

  const card = (() => {
    if (!person || !value || Number(value) <= 0 || !debtValue || Number(debtValue) <= 0) return null;
    const after = LIMITED.includes(kind) ? subtract(have, debtValue) : add(have, value);
    const how = debt ? `Se descuenta primero de «${debt.ref}».` : openDebts[0] ? `Se descuenta de la deuda más antigua: «${openDebts[0].ref}».` : "";
    const fx = cross ? " La diferencia con lo que valía la deuda va a Ganancia por tipo de cambio o Costo del cambio." : "";
    switch (kind) {
      case "lend": return [`${first} te quedará debiendo ${money(add(have, owed ?? value))}`,
        `${Number(have) > 0 ? `Ya te debía ${money(have)}. ` : ""}` + (isCard
          ? `No es un gasto tuyo: tu tarjeta sube y ${first} te debe.${cuotas ? " Te debe todas las cuotas; cada una vence con la fecha de pago de su corte." : ""}`
          : "No es un gasto: la plata sigue siendo tuya.")];
      case "borrow": return [`Le quedarás debiendo ${money(after)} a ${first}`, "No es un ingreso: entra a tu cuenta, pero se la debes."];
      case "collect": return [`${first} te debe ${owedMoney(have)}; quedará en ${owedMoney(after)}`, how + fx];
      case "repay": return [`Le debes a ${first} ${owedMoney(have)}; quedará en ${owedMoney(after)}`, how + fx];
      case "custody_in": return [`Guardarás ${money(after)} de ${first}`, "Entra a tu cuenta, pero no suma a lo que realmente tienes: es suya."];
      case "custody_out": return [`Guardas de ${first} ${money(have)}; quedarán ${money(after)}`, "Sale de tu cuenta y baja lo que guardas. No es un gasto tuyo."];
    }
  })();
  // La deuda que se descuenta: la elegida o la más antigua
  const chosen = (kind === "collect" || kind === "repay") ? (debt ? openDebts.find((i) => i.line_id === debt.id) : openDebts[0]) : undefined;
  const down = card && LIMITED.includes(kind) && debtValue && Number(have) > 0 ? (() => {
    const isCustody = kind === "custody_out";
    const show = isCustody ? money : owedMoney;
    const label = kind === "collect" ? `${first} te debe` : kind === "repay" ? `Le debes a ${first}` : `Guardas de ${first}`;
    const text = kind === "custody_out" ? "Sale de tu cuenta y baja lo que guardas. No es un gasto tuyo."
      : `Este pago baja ${show(debtValue)} de lo que ${kind === "collect" ? "te debe" : "le debes"}.${cross ? " La diferencia con lo que valía la deuda va a Ganancia por tipo de cambio o Costo del cambio." : ""}`;
    return { label, before: show(have), after: show(subtract(have, debtValue)), text,
      share: Math.min(100, Math.round(Number(debtValue) / Number(have) * 100)) };
  })() : null;
  const overText = kind === "collect"
    ? `${first} te debe ${owedMoney(have)}. Escribe hasta ${owedMoney(have)}; si te dio de más, registra el resto como «Me prestaron» o «Me dio para guardar».`
    : kind === "repay"
      ? `Le debes ${owedMoney(have)} a ${first}. Escribe hasta ${owedMoney(have)}; si le diste de más, registra el resto como «Le presté a alguien».`
      : `Guardas ${money(have)} de ${first}. Escribe hasta ${money(have)}.`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!who) return setProblem(`Elige ${t.who.replace(/[¿?]/g, "").toLowerCase()}`);
    if (!account) return setProblem("Elige la cuenta");
    if (!value || Number(value) <= 0) return setProblem("Escribe un monto mayor que cero");
    if (cross && !(Number(debtValue) > 0)) return setProblem(`Escribe cuánto de la deuda en ${nameOf(debtCur)} cancela`);
    if (over) return setProblem(overText);
    if (foreign && !cross && !(Number(rate.value) > 0)) return setProblem("Escribe el tipo de cambio, como 3.443");
    if (cuotas && cuota.trim() && !(Number(cuotaValue) > 0)) return setProblem("Escribe la cuota como 207.00");
    const body: MoveIn = {
      kind, account_id: account.id, amount: value, date, ref: note.trim() || null, pending, later: false,
      rate: foreign && !cross ? rate.value.trim() : null, partner_id: who, debt_line_id: debt?.id ?? null, splits: [], lines: [],
      currency: isCard ? currency : null,
      installments: cuotas ? installments : null,
      installment_amount: cuotas ? cuotaValue : null,
      debt_currency: cross ? debtCur : null,
      debt_amount: cross ? debtValue : null,
    };
    save.mutate(body, { onSuccess: (d) => navigate(editing ? `/movimientos/${d.summary.id}` : `/personas/${who}`, { replace: true }) });
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
        <MasHeader kind={kind} locked={!!editing} account={account?.id} />

        <label className="mt-3 flex flex-col gap-0.5 text-caption font-semibold">
          {t.ask}
          <span className="flex items-baseline gap-2 border-b-2 border-input-line">
            <span aria-hidden="true" className="text-[26px] leading-8 font-semibold text-muted-foreground">{symbolOf(currency)}</span>
            <input ref={focusAmount} inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)}
              className="h-16 min-w-0 flex-1 border-0 bg-transparent p-0 text-[48px] leading-[56px] font-semibold tracking-[-0.02em] tabular-nums" />
          </span>
        </label>

        <div className="mt-4">
          <PersonPicker label={t.who} value={who} onChange={(id) => { setWho(id); setDebt(null); }} only={only} canAdd={!LIMITED.includes(kind)} />
        </div>

        <div className="mt-2 flex flex-col">
          <SheetSelect label={t.into ? "Entra a" : "Sale de"} sheetTitle={t.into ? "¿A qué cuenta entra?" : "¿De qué cuenta sale?"}
            value={account ? String(account.id) : ""} onChange={setAccountId}
            options={accounts.map((a) => ({ value: String(a.id), label: a.name,
              ...accountOption(a), right: formatAmount(a.balances[0]?.amount ?? "0.00", symbolOf(a.currency ?? base), lang) }))} />
          {isCard && me.currencies.length > 1 && (
            <div className="mt-3">
              <CurrencyChoice label="¿En qué moneda?" size="sm" value={currency} onChange={setCardCurrency}
                options={me.currencies.map(currencyOption)} />
            </div>
          )}
          {twoWay && debtCurrencies.length > 1 && (
            <div className="mt-3">
              <CurrencyChoice label="¿Qué deuda paga?" size="sm" value={debtCur} onChange={(c) => { setDebtPick(c); setDebt(null); }}
                options={debtCurrencies.map(currencyOption)} />
            </div>
          )}
          {cross && (
            <div className="mt-3 flex flex-col gap-1 border-b border-border pb-3">
              <label className="flex flex-col gap-0.5 text-caption font-semibold">
                ¿Cuánto de la deuda en {nameOf(debtCur)} cancela?
                <span className="flex items-baseline gap-2 border-b-2 border-input-line">
                  <span aria-hidden="true" className="text-[20px] font-semibold text-muted-foreground">{symbolOf(debtCur)}</span>
                  <input inputMode="decimal" placeholder={formatNumber(have, lang)} value={debtAmount} onChange={(e) => setDebtAmount(e.target.value)}
                    className="h-11 min-w-0 flex-1 border-0 bg-transparent p-0 text-[24px] font-semibold tabular-nums" />
                </span>
              </label>
              <span className="text-caption text-muted-foreground tabular-nums">
                La deuda es en {nameOf(debtCur)} y la plata {t.into ? "entra" : "sale"} en {nameOf(currency)}
                {crossRate ? `: a ${Number(crossRate).toFixed(3)} por ${symbolOf(currency === base ? debtCur : currency)}` : ""}.
              </span>
            </div>
          )}
          {foreign && !cross && <div className="mt-3 border-b border-border pb-3"><RateField input={rate} currency={currency} side={isCard ? "sell" : undefined} /></div>}
          {isCard && !editing && (
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
                  <Installments n={installments} setN={setInstallments} cuota={cuota} setCuota={setCuota} total={value} currency={currency}
                    date={date} closingDay={account!.card?.closing_day ?? null} category={null} lang={lang}
                    who={first || undefined} />
                </>
              )}
            </>
          )}
          <div className="grid min-h-[52px] grid-cols-[auto_1fr] items-center gap-3 border-b border-border">
            <button type="button" aria-expanded={dateOpen} onClick={() => setDateOpen(!dateOpen)}
              className="flex h-9 items-center gap-1 rounded-full border border-border px-3 text-caption font-semibold">
              <Icon name="event" className="text-[18px]" />{dateLabel(date)}
            </button>
            <span className="flex min-w-0 items-center gap-2"><input aria-label="Nota" placeholder="Nota" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)}
              className="h-10 min-w-0 flex-1 border-0 bg-transparent p-0" /><Optional /></span>
          </div>
          <DateSheet open={dateOpen} onClose={() => setDateOpen(false)} title="¿Cuándo fue?" value={date} onChange={setDate} booked />
          <label className="flex min-h-[52px] cursor-pointer items-center gap-3">
            <Icon name="schedule" className="w-9 text-center text-muted-foreground" />
            <span className="flex flex-1 flex-col">
              <span>Por confirmar</span>
              <span className="text-caption text-muted-foreground">
                {future ? "Con fecha futura queda por confirmar hasta su día" : "No cuenta en tus saldos hasta que lo confirmes"}
              </span>
            </span>
            <input type="checkbox" role="switch" checked={pending || future} disabled={future} onChange={() => setPending(!pending)} className="size-[22px] accent-primary" />
          </label>
        </div>

        {over ? (
          <div role="alert" className="mt-3 flex items-start gap-2 rounded-md bg-attention-soft p-3 text-caption text-attention tabular-nums">
            <Icon name="error" /><span>{overText}</span>
          </div>
        ) : down ? (
          // Cobrar, pagar o devolver: lo de antes tachado, lo que queda y la deuda que se descuenta,
          // con la misma tarjeta de la persona (decisión «La persona que te debe», C2)
          <section aria-label={down.label} className="mt-3 flex flex-col gap-2.5 rounded-[12px] border border-border bg-card px-3.5 py-3 tabular-nums">
            <span className="text-caption text-muted-foreground">{down.label}</span>
            <span className="flex flex-wrap items-center gap-x-2.5">
              <span className="font-display text-[22px] leading-7 font-extrabold text-muted-foreground line-through decoration-2">{down.before}</span>
              <Icon name="arrow_forward" className="text-[20px] text-muted-foreground" />
              <span className="font-display text-[28px] leading-8 font-extrabold tracking-[-0.02em]">{down.after}</span>
            </span>
            <span aria-hidden="true" className="h-2 overflow-hidden rounded-full bg-muted">
              <span className="block h-2 rounded-full bg-foreground" style={{ width: `${down.share}%` }} />
            </span>
            <span className="text-caption text-muted-foreground">{down.text}</span>
            {chosen && (
              <>
                <span className="mt-1 text-label text-muted-foreground">Se descuenta de</span>
                <DebtCard item={chosen} lang={lang} paid={kind === "collect" ? "Te pagó" : "Le pagaste"} selected />
                {openDebts.length > 1 && (
                  <button type="button" onClick={() => setChoosing(true)}
                    className="flex h-10 items-center gap-1.5 self-start rounded-full bg-secondary px-4 text-caption font-semibold text-secondary-foreground">
                    <Icon name="swap_horiz" className="text-[18px]" />Elegir otra deuda
                  </button>
                )}
              </>
            )}
          </section>
        ) : card && (
          <div className="mt-3 flex flex-col gap-1 rounded-[12px] border border-border bg-card px-3.5 py-3 tabular-nums">
            <span className="font-semibold">{card[0]}</span>
            {card[1] && <span className="text-caption text-muted-foreground">{card[1]}</span>}
          </div>
        )}

        <div className="min-h-4 flex-1" />
        <div className="flex flex-col gap-3">
          {(problem || save.error) && !over && <ErrorAlert>{problem ?? save.error?.message}</ErrorAlert>}
          <PrimaryButton pending={save.isPending} disabled={!!over}>
            {editing ? "Guardar cambios" : pending || future ? "Guardar por confirmar" : cuotas ? `${t.submit} en ${installments} cuotas` : t.submit}
          </PrimaryButton>
        </div>
      </form>

      <Sheet title="¿Qué deuda paga primero?" open={choosing} onClose={() => setChoosing(false)}>
        {/* Las mismas tarjetas de la persona; la elegida con el acento y su marca en la esquina */}
        <div role="radiogroup" aria-label="¿Qué deuda paga primero?" className="flex flex-col gap-3 px-1 pt-2.5 pb-1">
          {openDebts.map((i) => {
            const on = i.line_id === (debt?.id ?? openDebts[0]?.line_id);
            return (
              <button key={i.line_id} type="button" role="radio" aria-checked={on} aria-label={`${i.ref}, ${formatAmount(i.open, symbolOf(i.currency), lang)}`}
                onClick={() => { setDebt(i !== openDebts[0] ? { id: i.line_id, ref: i.ref } : null); setChoosing(false); }}
                className="rounded-[16px] text-left">
                <DebtCard item={i} lang={lang} paid={kind === "collect" ? "Te pagó" : "Le pagaste"} selected={on} />
              </button>
            );
          })}
        </div>
      </Sheet>
    </main>
  );
}
