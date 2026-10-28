// Conciliar un estado de cuenta: escribes lo que dice el banco del ciclo (subtotales, total
// facturado, línea disponible y saldo de cuotas) y pegas sus movimientos. PPM muestra cada
// diferencia, de dónde sale y qué movimientos no tienen par de cada lado. El saldo de cuotas del
// banco reemplaza el de PPM en la línea hasta el siguiente estado de cuenta.
import { useState } from "react";
import { Link, useParams } from "react-router";

import { type Reconciliation, useCard, useMe, useReconciliation, useSaveStatement } from "@/api/hooks";
import { ErrorAlert, Icon, LineField, PrimaryButton, Screen, Spinner } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { formatAmount, parseAmount, subtract, symbolOf } from "@/lib/money";
import { parseStatement } from "@/lib/statement";
import { FormHeader } from "@/pages/cuentas/Nueva";

export function Conciliar() {
  const { id: raw, closing = "" } = useParams();
  const id = Number(raw);
  const me = useMe().data;
  const card = useCard(id);
  const rec = useReconciliation(id, closing);
  if (!me?.currency || card.isPending || rec.isPending) return <Spinner />;
  if (card.isError || rec.isError) return <Screen><ErrorAlert>{(card.error ?? rec.error)!.message}</ErrorAlert></Screen>;
  return <Form key={closing} id={id} name={card.data.account.name} r={rec.data} lang={me.lang ?? "es-PE"} />;
}

function Form({ id, name, r, lang }: { id: number; name: string; r: Reconciliation; lang: string }) {
  const save = useSaveStatement(id, r.closing_date);
  const fmt = (v: string | null | undefined) => (v == null ? "" : v);
  const [subtotals, setSubtotals] = useState<Record<string, string>>(
    Object.fromEntries(r.currencies.map((c) => [c.currency, fmt(c.bank_subtotal)])));
  const [billed, setBilled] = useState(fmt(r.bank_billed));
  const [available, setAvailable] = useState(fmt(r.bank_available));
  const [installments, setInstallments] = useState(fmt(r.bank_installments));
  const [pasted, setPasted] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const lines = pasted.trim() ? parseStatement(pasted, r.closing_date) : null;
  const money = (v: string, cur = r.limit_currency) => formatAmount(v, symbolOf(cur), lang);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    const read = (v: string, label: string) => {
      if (!v.trim()) return null;
      const x = parseAmount(v, lang);
      if (x === null) throw new Error(`Escribe ${label} como 1,120.23`);
      return x;
    };
    try {
      save.mutate({
        subtotals: Object.entries(subtotals).map(([currency, v]) => ({ currency, amount: read(v, `el subtotal en ${symbolOf(currency)}`) })),
        billed: read(billed, "el total facturado"),
        available: read(available, "la línea disponible"),
        installments: read(installments, "el saldo de cuotas"),
        lines,
      });
    } catch (err) {
      setProblem((err as Error).message);
    }
  };

  const rows: { label: string; ppm: string; bank: string | null; cur: string }[] = [
    ...r.currencies.map((c) => ({ label: `Subtotal en ${symbolOf(c.currency)}`, ppm: c.subtotal, bank: c.bank_subtotal, cur: c.currency })),
    { label: "Total facturado", ppm: r.billed, bank: r.bank_billed, cur: r.limit_currency },
    { label: "Saldo de cuotas", ppm: r.installments, bank: r.bank_installments, cur: r.limit_currency },
    { label: "Línea disponible hoy", ppm: r.available, bank: r.bank_available, cur: r.limit_currency },
  ];
  const missing = r.lines.filter((l) => l.move_id === null);
  const foreign = r.currencies.filter((c) => c.rate);

  return (
    <Screen className="pt-4">
      <FormHeader back={`/tarjetas/${id}`} label={name} />
      <h1 className="mt-2 text-title-hero">Estado de cuenta</h1>
      <p className="mt-2 text-muted-foreground">
        Ciclo del {shortDate(nextDay(r.previous_closing))} al {shortDate(r.closing_date)}. Escribe lo que dice el banco y pega sus movimientos.
      </p>
      <span className="mt-2 text-caption text-muted-foreground tabular-nums">
        Foto del corte: línea usada {money(r.used_at_closing)}
        {foreign.map((c) => ` · ${symbolOf(c.currency)} a ${Number(c.rate).toFixed(3)} del ${shortDate(c.rate_date!)}`).join("")}. No cambia con el tipo de cambio de otro día.
      </span>

      <form noValidate onSubmit={submit} className="mt-5 flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-4">
          {r.currencies.map((c) => (
            <LineField key={c.currency} label={`Subtotal ${symbolOf(c.currency)}`} inputMode="decimal" placeholder="0.00"
              value={subtotals[c.currency] ?? ""} onChange={(e) => setSubtotals({ ...subtotals, [c.currency]: e.target.value })} />
          ))}
          <LineField label="Total facturado" inputMode="decimal" placeholder="0.00" value={billed} onChange={(e) => setBilled(e.target.value)} />
          <LineField label="Línea disponible" inputMode="decimal" placeholder="0.00" value={available} onChange={(e) => setAvailable(e.target.value)} />
        </div>
        <LineField label="Saldo de compras en cuotas" inputMode="decimal" placeholder="0.00" value={installments}
          onChange={(e) => setInstallments(e.target.value)} hint="En «¿Cómo está compuesta su deuda?» → Compras cuotas. Reemplaza el de PPM en tu línea hasta el próximo estado de cuenta." />
        <label className="flex flex-col gap-1.5 text-caption font-semibold">
          Movimientos del estado de cuenta
          <textarea value={pasted} onChange={(e) => setPasted(e.target.value)} rows={5}
            placeholder={"17/10 OPENAI *CHATGPT US$ 30.84\n12/10 TIKTOK ADS 25.90"}
            className="rounded-md border border-input-line bg-transparent p-3 font-mono text-[13px] leading-5 font-normal" />
          <span className="font-normal text-muted-foreground">
            {lines ? `Se leyeron ${lines.length} ${lines.length === 1 ? "movimiento" : "movimientos"}.`
              : r.lines.length ? `Ya pegaste ${r.lines.length}: si pegas otros, los reemplazan.` : "Cópialos del PDF o del Excel: fecha, descripción y monto."}
          </span>
        </label>
        {(problem ?? save.error?.message) && <ErrorAlert>{problem ?? save.error?.message}</ErrorAlert>}
        <PrimaryButton pending={save.isPending}>Conciliar</PrimaryButton>
      </form>

      <section aria-label="PPM y el banco" className="mt-6 flex flex-col">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 border-b border-border pb-1 text-label text-muted-foreground">
          <span /><span className="text-right">PPM</span><span className="text-right">Banco</span><span className="text-right">Diferencia</span>
        </div>
        {rows.map((x) => {
          const gap = x.bank === null ? null : subtract(x.bank, x.ppm);
          return (
            <div key={x.label} className="grid min-h-11 grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 border-b border-border text-[14px] tabular-nums">
              <span className="font-semibold">{x.label}</span>
              <span className="text-right">{money(x.ppm, x.cur)}</span>
              <span className="text-right">{x.bank === null ? "—" : money(x.bank, x.cur)}</span>
              <span className={`text-right font-semibold ${gap === null ? "" : Number(gap) === 0 ? "text-income" : "text-attention"}`}>
                {gap === null ? "" : Number(gap) === 0 ? "Cuadra" : money(gap, x.cur)}
              </span>
            </div>
          );
        })}
        {r.bank_charges !== "0.00" && (
          <span className="mt-1.5 text-caption text-muted-foreground">El total facturado de PPM incluye {money(r.bank_charges)} de cargos del banco.</span>
        )}
      </section>

      {r.explanations.length > 0 && (
        <section aria-label="De dónde sale" className="mt-5 flex flex-col gap-2 rounded-[12px] bg-muted p-3.5">
          <span className="text-label text-muted-foreground">De dónde sale</span>
          {r.explanations.map((t) => <p key={t} className="text-[14px] leading-5">{t}</p>)}
        </section>
      )}

      {missing.length > 0 && (
        <section aria-label="Del banco, sin par en PPM" className="mt-5 flex flex-col">
          <span className="border-b border-border pb-1 text-label text-muted-foreground">Del banco, sin par en PPM</span>
          {missing.map((l, k) => (
            <div key={k} className="flex min-h-11 items-center gap-3 border-b border-border">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{l.name}</span>
                <span className="text-caption text-muted-foreground">{shortDate(l.date)}</span>
              </span>
              <span className="text-amount">{money(l.amount, l.currency)}</span>
            </div>
          ))}
          <Link to={`/registrar?cuenta=${id}`} className="flex min-h-12 items-center gap-1.5 font-semibold">
            <Icon name="add" />Registrarlo
          </Link>
        </section>
      )}
      {r.unmatched.length > 0 && r.lines.length > 0 && (
        <section aria-label="De PPM, sin par en el banco" className="mt-5 flex flex-col">
          <span className="border-b border-border pb-1 text-label text-muted-foreground">De PPM, sin par en el banco</span>
          {r.unmatched.map((u) => (
            <Link key={`${u.move_id}-${u.amount}`} to={`/movimientos/${u.move_id}`} className="flex min-h-11 items-center gap-3 border-b border-border">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{u.ref}</span>
                <span className="text-caption text-muted-foreground">{shortDate(u.date)} · revisa el monto o la fecha</span>
              </span>
              <span className="text-amount">{money(u.amount, u.currency)}</span>
            </Link>
          ))}
        </section>
      )}
      <div className="h-6" />
    </Screen>
  );
}

function nextDay(iso: string) {
  const d = new Date(`${iso}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
}
