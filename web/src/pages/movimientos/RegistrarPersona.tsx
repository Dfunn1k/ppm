// R1 · Con otra persona: le presté, me prestaron, me pagaron, pagué, me dio para guardar y le devolví
// o usé su plata. El mismo formulario para las seis: cuánto, con quién y de qué cuenta, y una tarjeta
// que dice cómo queda la deuda. Un cobro o un pago no pasan de lo que se debe.
import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router";

import { type AccountRow, type MoveDetail, type MoveIn, type PartnerRow, useAccounts, useMe, usePartner, usePartnersOverview, useSaveMove } from "@/api/hooks";
import { MasHeader } from "@/components/MasTipos";
import { PersonPicker } from "@/components/PersonPicker";
import { RateField, useRateInput } from "@/components/RateField";
import { OptionList, Sheet, SheetSelect } from "@/components/Sheet";
import { ErrorAlert, Icon, LineField, PrimaryButton, Spinner } from "@/components/ui";
import { longDate, shortDate, todayISO } from "@/lib/dates";
import { type PersonKind, isPersonKind } from "@/lib/kinds";
import { add, formatAmount, formatNumber, parseAmount, subtract, symbolOf } from "@/lib/money";

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
  const me = useMe().data;
  const overview = useAccounts().data;
  const people = usePartnersOverview().data;
  const save = useSaveMove(editing?.summary.id);
  const lang = me?.lang ?? "es-PE";
  const t = TEXT[kind];

  const [who, setWho] = useState<number | null>(editing?.partner_id ?? initialPerson);
  const [accountId, setAccountId] = useState(editing?.account_id ? String(editing.account_id) : "");
  const [amount, setAmount] = useState(editing ? formatNumber(editing.summary.amount, lang) : "");
  const [date, setDate] = useState(editing?.summary.date ?? todayISO());
  const [dateOpen, setDateOpen] = useState(false);
  const [note, setNote] = useState(editing?.summary.ref ?? "");
  const [pending, setPending] = useState(editing ? !editing.summary.posted : false);
  const [debt, setDebt] = useState<{ id: number; ref: string } | null>(null);
  const [choosing, setChoosing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const detail = usePartner(LIMITED.includes(kind) && who ? who : 0).data;

  const base = me?.currency ?? "PEN";
  const accounts: AccountRow[] = overview ? [...overview.have, ...overview.owe].filter((a) => ["cash", "bank", "other"].includes(a.kind)) : [];
  const account = accounts.find((a) => String(a.id) === accountId) ?? (accountId === "" ? accounts[0] : undefined);
  const currency = account?.currency ?? base;
  const rate = useRateInput(currency, base, date, account?.kind === "other" ? "sell" : "buy", editing?.rate ? Number(editing.rate).toFixed(3) : null);
  if (!me?.currency || !overview || !people) return <Spinner />;

  const person: PartnerRow | undefined = people.people.find((p) => p.id === who);
  const first = person?.name.split(" ")[0] ?? "";
  // Lo que hay con esa persona en la moneda de la cuenta, sin contar este movimiento si se está editando
  const had = person?.[t.role].find((m) => m.currency === currency)?.amount ?? "0.00";
  const mine = editing && editing.summary.currency === currency && who === editing.partner_id ? editing.summary.amount : "0.00";
  const have = LIMITED.includes(kind) ? add(had, mine) : subtract(had, kind === editing?.summary.kind ? mine : "0.00");
  const value = parseAmount(amount || "", lang);
  const money = (v: string) => formatAmount(v, symbolOf(currency), lang);
  const over = LIMITED.includes(kind) && who && value && Number(value) > Number(have);
  const only = LIMITED.includes(kind)
    ? people.people.filter((p) => p[t.role].length > 0 || p.id === editing?.partner_id).map((p) => p.id) : undefined;
  const foreign = currency !== base;
  const future = date > todayISO();
  const openDebts = (kind === "collect" ? detail?.owes_me : detail?.i_owe)?.filter((i) => i.currency === currency) ?? [];

  const card = (() => {
    if (!person || !value || Number(value) <= 0) return null;
    const after = LIMITED.includes(kind) ? subtract(have, value) : add(have, value);
    const oldest = openDebts[0];
    switch (kind) {
      case "lend": return [`${first} te quedará debiendo ${money(after)}`,
        `${Number(have) > 0 ? `Ya te debía ${money(have)}. ` : ""}No es un gasto: la plata sigue siendo tuya.`];
      case "borrow": return [`Le quedarás debiendo ${money(after)} a ${first}`, "No es un ingreso: entra a tu cuenta, pero se la debes."];
      case "collect": return [`${first} te debe ${money(have)} · quedará en ${money(after)}`,
        debt ? `Se descuenta primero de «${debt.ref}».` : oldest ? `Se descuenta de la deuda más antigua: «${oldest.ref}».` : ""];
      case "repay": return [`Le debes ${money(have)} a ${first} · quedará en ${money(after)}`,
        debt ? `Se descuenta primero de «${debt.ref}».` : oldest ? `Se descuenta de la deuda más antigua: «${oldest.ref}».` : ""];
      case "custody_in": return [`Guardarás ${money(after)} de ${first}`, "Entra a tu cuenta, pero no suma a lo que realmente tienes: es suya."];
      case "custody_out": return [`Guardas ${money(have)} de ${first} · quedarán ${money(after)}`, "Sale de tu cuenta y baja lo que guardas. No es un gasto tuyo."];
    }
  })();
  const overText = kind === "collect"
    ? `${first} te debe ${money(have)}. Escribe hasta ${money(have)}; si te dio de más, registra el resto como «Me prestaron» o «Me dio para guardar».`
    : kind === "repay"
      ? `Le debes ${money(have)} a ${first}. Escribe hasta ${money(have)}; si le diste de más, registra el resto como «Le presté a alguien».`
      : `Guardas ${money(have)} de ${first}. Escribe hasta ${money(have)}.`;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!who) return setProblem(`Elige ${t.who.replace(/[¿?]/g, "").toLowerCase()}`);
    if (!account) return setProblem("Elige la cuenta");
    if (!value || Number(value) <= 0) return setProblem("Escribe un monto mayor que cero");
    if (over) return setProblem(overText);
    if (foreign && !(Number(rate.value) > 0)) return setProblem("Escribe el tipo de cambio, como 3.443");
    const body: MoveIn = {
      kind, account_id: account.id, amount: value, date, ref: note.trim() || null, pending,
      rate: foreign ? rate.value.trim() : null, partner_id: who, debt_line_id: debt?.id ?? null, splits: [], lines: [],
    };
    save.mutate(body, { onSuccess: (d) => navigate(editing ? `/movimientos/${d.summary.id}` : `/personas/${who}`, { replace: true }) });
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
        <MasHeader kind={kind} locked={!!editing} />

        <label className="mt-3 flex flex-col gap-0.5 text-caption font-semibold">
          {t.ask}
          <span className="flex items-baseline gap-2 border-b-2 border-input-line">
            <span aria-hidden="true" className="text-[26px] leading-8 font-semibold text-muted-foreground">{symbolOf(currency)}</span>
            <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)}
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
              hint: [a.subtitle, formatAmount(a.balances[0]?.amount ?? "0.00", symbolOf(a.currency ?? base), lang)].filter(Boolean).join(" · ") }))} />
          {foreign && <div className="mt-3 border-b border-border pb-3"><RateField input={rate} currency={currency} /></div>}
          <div className="grid min-h-[52px] grid-cols-[auto_1fr] items-center gap-3 border-b border-border">
            <button type="button" aria-expanded={dateOpen} onClick={() => setDateOpen(!dateOpen)}
              className="flex h-9 items-center gap-1 rounded-full border border-border px-3 text-caption font-semibold">
              <Icon name="event" className="text-[18px]" />{date === todayISO() ? "Hoy" : longDate(date)}
            </button>
            <input aria-label="Nota" placeholder="Nota (opcional)" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)}
              className="h-10 min-w-0 border-0 bg-transparent p-0" />
          </div>
          {dateOpen && <div className="py-3"><LineField label="Fecha" type="date" value={date} onChange={(e) => setDate(e.target.value || todayISO())} /></div>}
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
        ) : card && (
          <div className="mt-3 flex flex-col gap-1 rounded-[12px] border border-border bg-card px-3.5 py-3 tabular-nums">
            <span className="font-semibold">{card[0]}</span>
            {card[1] && <span className="text-caption text-muted-foreground">{card[1]}</span>}
            {(kind === "collect" || kind === "repay") && openDebts.length > 1 && (
              <button type="button" onClick={() => setChoosing(true)} className="mt-0.5 h-8 self-start text-caption font-semibold text-primary-strong underline">
                Elegir otra deuda
              </button>
            )}
          </div>
        )}

        <div className="min-h-4 flex-1" />
        <div className="flex flex-col gap-3">
          {(problem || save.error) && !over && <ErrorAlert>{problem ?? save.error?.message}</ErrorAlert>}
          <PrimaryButton pending={save.isPending} disabled={!!over}>
            {editing ? "Guardar cambios" : pending || future ? "Guardar por confirmar" : t.submit}
          </PrimaryButton>
        </div>
      </form>

      <Sheet title="¿Qué deuda paga primero?" open={choosing} onClose={() => setChoosing(false)}>
        <OptionList value={String(debt?.id ?? openDebts[0]?.line_id ?? "")}
          options={openDebts.map((i) => ({ value: String(i.line_id), label: i.ref,
            hint: `${shortDate(i.date)} · faltan ${formatAmount(i.open, symbolOf(i.currency), lang)}` }))}
          onPick={(v) => {
            const i = openDebts.find((x) => String(x.line_id) === v);
            setDebt(i && i !== openDebts[0] ? { id: i.line_id, ref: i.ref } : null);
            setChoosing(false);
          }} />
      </Sheet>
    </main>
  );
}
