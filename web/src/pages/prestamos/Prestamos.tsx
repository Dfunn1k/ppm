// C4 · Préstamo de banco: crearlo (ya lo venía pagando o recién me lo dieron), su detalle (lo que
// debes, la próxima cuota y las pagadas) y pagar la cuota con los montos de la boleta.
import { SectionHeading } from "@/components/SectionHeading";
import { ProgressBar } from "@/components/ProgressBar";
import { PageHeader } from "@/components/PageHeader";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { type AccountRow, useAccounts, useCatalog, useCreateLoan, useLoan, useMe, usePayLoan } from "@/api/hooks";
import { DateSheet, dateLabel } from "@/components/DateSheet";
import { Segmented, SheetSelect } from "@/components/Sheet";
import { ErrorAlert, Icon, LineField, PrimaryButton, Screen, Spinner } from "@/components/ui";
import { shortDate, todayISO } from "@/lib/dates";
import { add, formatAmount, formatNumber, parseAmount, symbolOf } from "@/lib/money";
import { FormHeader } from "@/pages/cuentas/Nueva";
import { dayDate } from "@/pages/recurrentes/Recurrentes";
import { accountOption } from "@/components/AccountSub";

function payAccounts(have: AccountRow[] | undefined, currency: string) {
  return (have ?? []).filter((a) => (a.kind === "bank" || a.kind === "cash") && (a.currency ?? currency) === currency);
}

function PartField({ label, hint, value, onChange, symbol }: {
  label: string; hint?: string; value: string; onChange: (v: string) => void; symbol: string;
}) {
  return (
    <label className="flex items-end gap-3">
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{label}</span>
        {hint && <span className="text-caption-sm text-muted-foreground">{hint}</span>}
      </span>
      <span className="flex w-35 flex-none items-baseline gap-1.5 border-b-2 border-input-line">
        <span aria-hidden="true" className="font-semibold text-muted-foreground">{symbol}</span>
        <input inputMode="decimal" placeholder="0.00" aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}
          className="h-control min-w-0 flex-1 border-0 bg-transparent p-0 text-right text-amount-xl" />
      </span>
    </label>
  );
}

export function NuevoPrestamo() {
  const navigate = useNavigate();
  const me = useMe().data;
  const banks = useCatalog().data?.banks ?? [];
  const accounts = useAccounts().data;
  const create = useCreateLoan();
  const [name, setName] = useState("");
  const [bankId, setBankId] = useState("");
  const [currency, setCurrency] = useState(me?.currency ?? "PEN");
  const [fresh, setFresh] = useState(false);
  const [amount, setAmount] = useState("");
  const [payId, setPayId] = useState("");
  const [day, setDay] = useState("15");
  const [left, setLeft] = useState("");
  const [capital, setCapital] = useState("");
  const [interest, setInterest] = useState("");
  const [insurance, setInsurance] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  if (!me?.currency || !accounts) return <Spinner />;
  const lang = me.lang ?? "es-PE";
  const sym = symbolOf(currency);
  const pays = payAccounts(accounts.have, currency);
  const pay = pays.find((a) => String(a.id) === payId) ?? pays[0];
  const n = (v: string) => parseAmount(v || "0", lang) ?? "0";
  const total = add(add(n(capital), n(interest)), n(insurance));

  const save = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!name.trim()) return setProblem("Ponle un nombre, como «Préstamo vehicular»");
    if (!bankId) return setProblem("Elige el banco");
    const value = parseAmount(amount, lang);
    if (!value || Number(value) <= 0) return setProblem(fresh ? "Escribe cuánto te dieron" : "Escribe cuánto debes hoy");
    if (!pay) return setProblem(`Necesitas una cuenta en ${sym} para pagar la cuota`);
    const d = Number(day);
    if (!(d >= 1 && d <= 31)) return setProblem("El día de pago va del 1 al 31");
    if (!(Number(left) >= 1)) return setProblem("Escribe cuántas cuotas faltan");
    if (!(Number(n(capital)) > 0)) return setProblem("Escribe el capital de la cuota");
    create.mutate({
      name: name.trim(), bank_id: Number(bankId), currency, fresh, amount: value, pay_account_id: pay.id, day: d,
      left: Number(left), capital: n(capital), interest: n(interest), insurance: n(insurance),
    }, { onSuccess: (id) => navigate(`/prestamos/${id}`, { replace: true }) });
  };

  return (
    <Screen className="pt-4">
      <FormHeader back="/cuentas/nueva" label="Nueva cuenta" />
      <form noValidate onSubmit={save} className="flex flex-1 flex-col">
        <h1 className="mt-4 text-title-hero">Préstamo</h1>
        <div className="mt-4 flex flex-col gap-4">
          <LineField label="Nombre" placeholder="Préstamo vehicular" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          <SheetSelect label="Banco" sheetTitle="Elige el banco" value={bankId} onChange={setBankId}
            options={banks.map((b) => ({ value: String(b.id), label: b.name }))} />
          {me.currencies.length > 1 && (
            <Segmented label="Moneda" size="sm" value={currency} onChange={setCurrency}
              options={me.currencies.map((c) => ({ value: c, label: symbolOf(c) }))} />
          )}
          <Segmented label="Cómo empiezas" size="sm" value={fresh ? "fresh" : "paying"} onChange={(v) => setFresh(v === "fresh")}
            options={[{ value: "paying", label: "Ya lo venía pagando" }, { value: "fresh", label: "Recién me lo dieron" }]} />
          <label className="flex flex-col gap-0.5 text-caption font-semibold">
            {fresh ? "¿Cuánto te dieron?" : "¿Cuánto debes hoy?"}
            <span className="flex items-baseline gap-2 border-b-2 border-input-line">
              <span aria-hidden="true" className="text-amount-xl text-muted-foreground">{sym}</span>
              <input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value)}
                className="h-16 min-w-0 flex-1 border-0 bg-transparent p-0 text-amount-input" />
            </span>
            <span className="font-normal text-muted-foreground">
              {fresh ? "Entra a tu cuenta y nace la deuda: no es un ingreso." : "Solo el capital. Míralo en tu cronograma o en la app del banco. Tus cuentas no se mueven."}
            </span>
          </label>
          <SheetSelect label={fresh ? "¿A qué cuenta entró?" : "¿De qué cuenta pagas la cuota?"} hint={fresh ? "De ahí pagas la cuota" : undefined}
            sheetTitle="Elige la cuenta" value={pay ? String(pay.id) : ""} onChange={setPayId}
            options={pays.map((a) => ({ value: String(a.id), label: a.name, ...accountOption(a) }))} />

          <span className="mt-2 flex flex-col border-b border-border pb-1"><span className="text-label text-muted-foreground">La cuota</span><span className="text-caption text-muted-foreground">Se repite cada mes</span></span>
          <div className="grid grid-cols-2 gap-4">
            <label className="flex flex-col gap-0.5 text-caption font-semibold">
              Se paga el día
              <input inputMode="numeric" value={day} onChange={(e) => setDay(e.target.value.replace(/\D/g, ""))}
                className="h-control border-0 border-b-2 border-input-line bg-transparent p-0 text-body-lg tabular-nums" />
            </label>
            <label className="flex flex-col gap-0.5 text-caption font-semibold">
              Cuotas que faltan
              <input inputMode="numeric" value={left} onChange={(e) => setLeft(e.target.value.replace(/\D/g, ""))}
                className="h-control border-0 border-b-2 border-input-line bg-transparent p-0 text-body-lg tabular-nums" />
            </label>
          </div>
          <PartField label="Capital" hint="Baja lo que debes" value={capital} onChange={setCapital} symbol={sym} />
          <PartField label="Interés" hint="Es gasto, en Gastos financieros" value={interest} onChange={setInterest} symbol={sym} />
          <PartField label="Seguro" hint="Es gasto, el desgravamen" value={insurance} onChange={setInsurance} symbol={sym} />
          <div role="status" className="flex flex-col gap-0.5 rounded-md bg-muted px-3 py-2.5 tabular-nums">
            <span className="font-semibold">Cuota de {formatAmount(total, sym, lang)} el {day || "…"} de cada mes</span>
            <span className="text-caption text-muted-foreground">
              Copia el reparto de tu cronograma. Cada mes se crea por confirmar y lo corriges con la boleta: el interés y el seguro son gasto; el capital baja lo que debes.
            </span>
          </div>
        </div>
        <div className="min-h-6 flex-1" />
        {(problem || create.error) && <div className="mb-3"><ErrorAlert>{problem ?? create.error?.message}</ErrorAlert></div>}
        <PrimaryButton pending={create.isPending}>Crear préstamo</PrimaryButton>
      </form>
    </Screen>
  );
}

export function Prestamo() {
  const id = Number(useParams().id);
  const me = useMe().data;
  const loan = useLoan(id);
  if (!me?.currency || loan.isPending) return <Spinner />;
  if (loan.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{loan.error.message}</ErrorAlert></main>;
  const l = loan.data;
  const lang = me.lang ?? "es-PE";
  const sym = symbolOf(l.currency);
  const money = (v: string) => formatAmount(v, sym, lang);
  const paidOff = Number(l.debt) <= 0;
  const progress = Number(l.start_debt) > 0 ? Math.min(100, Math.round((1 - Number(l.debt) / Number(l.start_debt)) * 100)) : 0;
  const total = l.paid_count + l.left_count;
  const progressText = paidOff ? "Lo terminaste de pagar" : `${l.paid_count} de ${total} cuotas`;
  // Un punto por cuota, lleno si ya la pagaste (caso 7); con muchas cuotas, la barra del capital
  const dots = !paidOff && total > 0 && total <= 36;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28 md:max-w-160 md:pb-10">
      <PageHeader back={{ to: "/cuentas", label: "Volver a cuentas" }} title={l.name}
        eyebrow={`Préstamo en ${l.currency === "PEN" ? "soles" : l.currency === "USD" ? "dólares" : l.currency}${l.bank ? ` del ${l.bank}` : ""}`} />
      <span className="mt-3 text-caption text-muted-foreground">Debes hoy</span>
      <span className="text-amount-display">{money(l.debt)}</span>
      <span className="text-caption text-muted-foreground">Solo el capital, sin los intereses que faltan</span>
      <div className="mt-2 flex flex-col gap-1.5">
        {dots ? (
          <div role="img" aria-label={`Pagaste ${progressText}`} className="flex flex-wrap gap-1">
            {Array.from({ length: total }, (_, i) => (
              <span key={i} className={`size-2.5 rounded-full ${i < l.paid_count ? "bg-primary" : "border-2 border-input-line"}`} />
            ))}
          </div>
        ) : (
          <ProgressBar value={paidOff ? 100 : progress} max={100} tone="primary" size="md" label={progressText} />
        )}
        <span className="text-caption text-muted-foreground">{progressText}</span>
      </div>

      {l.next && !paidOff && (
        <section aria-label="Próxima cuota" className="mt-4 flex flex-col gap-1.5 rounded-md border border-border bg-card px-4 py-3 tabular-nums">
          <span className="flex items-baseline justify-between"><b>Próxima cuota el {shortDate(l.next.occurrence)}</b><b>{money(l.next.total)}</b></span>
          <span className="grid grid-cols-pairs gap-y-0.5 text-caption text-muted-foreground">
            {l.next.parts.map((p) => (
              <span key={p.name} className="contents">
                <span className="flex flex-col"><span className="text-foreground">{p.name}</span><span className="text-caption-sm">{p.name === "Capital" ? "Baja lo que debes" : "Es gasto"}</span></span><span>{formatNumber(p.amount, lang)}</span>
              </span>
            ))}
          </span>
          <span className="flex items-center gap-1 text-caption-sm font-semibold text-attention">
            <Icon name="schedule" size="sm" />
            {l.next.move_id ? "Ya está por confirmar: corrígela con la boleta" : `Se crea por confirmar el ${Number(l.next.occurrence.slice(8))}; corrígela con la boleta`}
          </span>
          <Link to={`/prestamos/${id}/pagar`} className="mt-1 flex min-h-12 items-center justify-between rounded-md bg-primary px-4 font-semibold text-primary-foreground hover:bg-primary/90">
            <span>Pagar cuota</span><Icon name="arrow_forward" size="md" />
          </Link>
        </section>
      )}
      {paidOff && (
        <div className="mt-4 flex gap-2 rounded-md bg-muted p-4">
          <Icon name="celebration" size="md" />
          <span><b>Lo terminaste de pagar.</b> Ya no le debes nada al banco; la cuota dejó de repetirse.</span>
        </div>
      )}
      {l.recurring_id && !paidOff && (
        <Link to={`/mas/recurrentes/${l.recurring_id}`} className="mt-2 flex min-h-row-sm items-center gap-3 border-b border-border">
          <Icon name="repeat" className="text-muted-foreground" />
          <span className="flex flex-1 flex-col">
            <span className="font-semibold">Se repite cada mes</span>
            <span className="text-caption text-muted-foreground">Saltar una cuota o moverla</span>
          </span>
          <Icon name="chevron_right" className="text-muted-foreground" />
        </Link>
      )}

      <SectionHeading className="mt-4">Cuotas pagadas</SectionHeading>
      {l.paid.length === 0 && <span className="py-3 text-caption text-muted-foreground">Todavía no pagas una cuota en PPM.</span>}
      {l.paid.map((p) => (
        <Link key={p.move_id} to={`/movimientos/${p.move_id}`} className="flex min-h-row-sm items-center gap-3 border-b border-border">
          <span className="flex flex-1 flex-col">
            <span className="font-semibold">{dayDate(p.date)}</span>
            <span className="text-caption-sm text-muted-foreground tabular-nums">
              {p.parts.map((x, k) => `${k ? x.name.toLowerCase() : x.name} ${formatNumber(x.amount, lang)}`).join(" + ")}
            </span>
          </span>
          <span className="tabular-nums">{formatNumber(p.total, lang)}</span>
        </Link>
      ))}
    </main>
  );
}

export function PagarCuota() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const me = useMe().data;
  const loan = useLoan(id);
  const accounts = useAccounts().data;
  const pay = usePayLoan(id);
  const [values, setValues] = useState<Record<string, string> | null>(null);
  const [fromId, setFromId] = useState("");
  const [date, setDate] = useState(todayISO());
  const [dateOpen, setDateOpen] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  if (!me?.currency || loan.isPending || !accounts) return <Spinner />;
  if (loan.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{loan.error.message}</ErrorAlert></main>;
  const l = loan.data;
  if (!l.next) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>Este préstamo no tiene cuotas por pagar.</ErrorAlert></main>;
  const lang = me.lang ?? "es-PE";
  const sym = symbolOf(l.currency);
  const estimated = Object.fromEntries(l.next.parts.map((p) => [p.name, formatNumber(p.amount, lang)]));
  const v = values ?? { Capital: estimated.Capital ?? "", Interés: estimated["Interés"] ?? "", Seguro: estimated.Seguro ?? "" };
  const n = (x: string) => parseAmount(x || "0", lang) ?? "0";
  const total = add(add(n(v.Capital ?? ""), n(v["Interés"] ?? "")), n(v.Seguro ?? ""));
  const pays = payAccounts(accounts.have, l.currency);
  const from = pays.find((a) => String(a.id) === fromId) ?? pays.find((a) => a.id === l.pay_account_id) ?? pays[0];
  const set = (k: string) => (x: string) => setValues({ ...v, [k]: x });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!from) return setProblem("Elige de qué cuenta sale");
    if (!(Number(total) > 0)) return setProblem("Escribe los montos de tu boleta");
    pay.mutate({ account_id: from.id, date, capital: n(v.Capital ?? ""), interest: n(v["Interés"] ?? ""), insurance: n(v.Seguro ?? "") },
      { onSuccess: () => navigate(`/prestamos/${id}`, { replace: true }) });
  };

  return (
    <Screen className="pt-4">
      <FormHeader back={`/prestamos/${id}`} label={l.left_count === 1 ? "Queda 1 cuota" : `Quedan ${l.left_count} cuotas`} icon="close" />
      <form noValidate onSubmit={submit} className="flex flex-1 flex-col">
        <h1 className="mt-2 text-title-hero">{l.name}</h1>
        <span className="mt-1 text-caption text-muted-foreground">La del {shortDate(l.next.occurrence)}. Copia los montos de tu boleta.</span>
        <div className="mt-5 flex flex-col gap-3.5">
          <PartField label="Capital" hint="Baja lo que debes" value={v.Capital ?? ""} onChange={set("Capital")} symbol={sym} />
          <PartField label="Interés" hint="Es gasto, en Gastos financieros" value={v["Interés"] ?? ""} onChange={set("Interés")} symbol={sym} />
          <PartField label="Seguro" hint="Es gasto, el desgravamen" value={v.Seguro ?? ""} onChange={set("Seguro")} symbol={sym} />
        </div>
        <div role="status" className="mt-4 flex items-baseline justify-between rounded-md bg-muted px-4 py-3 tabular-nums">
          <span className="font-semibold">Pagas</span><span className="text-amount-xl">{formatAmount(total, sym, lang)}</span>
        </div>
        <span className="mt-1.5 text-caption text-muted-foreground">
          {total === n(l.next.total) ? "Son los montos estimados de la cuota; cámbialos si tu boleta dice otra cosa." : `Lo estimado era ${formatAmount(l.next.total, sym, lang)}.`}
        </span>
        <div className="mt-3 flex flex-col gap-3">
          <SheetSelect label="Sale de" sheetTitle="¿De qué cuenta sale?" value={from ? String(from.id) : ""} onChange={setFromId}
            options={pays.map((a) => ({ value: String(a.id), label: a.name, hint: formatAmount(a.balances[0]?.amount ?? "0.00", sym, lang) }))} />
          <button type="button" onClick={() => setDateOpen(true)}
            className="hit-area flex h-9 items-center gap-1 self-start rounded-full border border-border px-3 text-caption font-semibold hover:bg-muted">
            <Icon name="event" />{dateLabel(date)}
          </button>
          <DateSheet open={dateOpen} onClose={() => setDateOpen(false)} title="¿Cuándo pagaste?" value={date} onChange={setDate} max={todayISO()} booked />
          <span className="text-caption text-muted-foreground">Es la cuota del {shortDate(l.next.occurrence)}: si pagas antes, ese día no se crea otra.</span>
        </div>
        <div className="min-h-6 flex-1" />
        {(problem || pay.error) && <div className="mb-3"><ErrorAlert>{problem ?? pay.error?.message}</ErrorAlert></div>}
        <PrimaryButton pending={pay.isPending}>Pagar {formatAmount(total, sym, lang)}</PrimaryButton>
      </form>
    </Screen>
  );
}
