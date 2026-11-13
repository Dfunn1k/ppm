// El estado de cuenta de la tarjeta, importado del PDF: la foto del banco al corte (línea, utilizada,
// disponible, facturado y saldo de cuotas), sus fechas, el capital e interés de cada cuota, si la
// lectura cuadra con el subtotal y qué movimientos no tienen par de cada lado.
import { useRef } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { type Reconciliation, useBankInstallment, useCard, useImportCardStatement, useMe, useReconciliation } from "@/api/hooks";
import { ErrorAlert, Icon, Screen, Spinner } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { add, formatAmount, subtract, symbolOf } from "@/lib/money";
import { FormHeader } from "@/pages/cuentas/Nueva";

/** Subir el PDF del estado de cuenta: al leerlo, abre su conciliación. */
export function ImportStatement({ cardId, label = "Importar estado de cuenta (PDF)" }: { cardId: number; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const navigate = useNavigate();
  const upload = useImportCardStatement(cardId);
  return (
    <div className="mt-2 flex flex-col gap-1.5">
      <input ref={input} type="file" accept="application/pdf,.pdf" aria-label="PDF del estado de cuenta" className="sr-only"
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) upload.mutate(file, { onSuccess: (r) => navigate(`/tarjetas/${cardId}/estado/${r.closing_date}`) });
        }} />
      <button type="button" disabled={upload.isPending} onClick={() => input.current?.click()}
        className="flex min-h-11 items-center gap-1.5 self-start font-semibold disabled:opacity-60">
        <Icon name={upload.isPending ? "progress_activity" : "upload_file"} className={upload.isPending ? "animate-spin" : ""} />
        {upload.isPending ? "Leyendo el PDF…" : label}
      </button>
      {upload.error && <ErrorAlert>{upload.error.message}</ErrorAlert>}
    </div>
  );
}

export function Conciliar() {
  const { id: raw, closing = "" } = useParams();
  const id = Number(raw);
  const me = useMe().data;
  const card = useCard(id);
  const rec = useReconciliation(id, closing);
  if (!me?.currency || card.isPending || rec.isPending) return <Spinner />;
  if (card.isError || rec.isError) return <Screen><ErrorAlert>{(card.error ?? rec.error)!.message}</ErrorAlert></Screen>;
  return <View id={id} name={card.data.account.name} r={rec.data} lang={me.lang ?? "es-PE"} />;
}

function View({ id, name, r, lang }: { id: number; name: string; r: Reconciliation; lang: string }) {
  const bankInstallment = useBankInstallment(id, r.closing_date);
  const money = (v: string, cur = r.limit_currency) => formatAmount(v, symbolOf(cur), lang);
  const missing = r.lines.filter((l) => l.move_id === null);
  const photo: [string, string][] = [
    ["Línea de crédito", money(r.credit_limit)],
    ["Línea utilizada", money(r.used)],
    ["Crédito disponible", money(r.available)],
    ...r.currencies.filter((c) => c.bank_billed !== null)
      .map((c): [string, string] => [`Total facturado ${symbolOf(c.currency)}`, money(c.bank_billed!, c.currency)]),
    ...r.currencies.filter((c) => c.bank_installments !== null && Number(c.bank_installments) > 0)
      .map((c): [string, string] => [`Saldo de compras en cuotas ${symbolOf(c.currency)}`, money(c.bank_installments!, c.currency)]),
  ];

  return (
    <Screen className="pt-4">
      <FormHeader back={`/tarjetas/${id}`} label={name} />
      <h1 className="mt-2 text-title-hero">Estado de cuenta</h1>
      <p className="mt-2 text-muted-foreground">
        Ciclo del {shortDate(r.date_from)} al {shortDate(r.closing_date)}{r.date_due ? ` · pagar antes del ${shortDate(r.date_due)}` : ""}.
      </p>
      {r.filename && <span className="text-caption text-muted-foreground">{r.filename}</span>}

      <section aria-label="Foto del corte" className="mt-5 flex flex-col">
        <span className="border-b border-border pb-1 text-label text-muted-foreground">Foto del corte · lo que dice el banco</span>
        {photo.map(([label, value]) => (
          <div key={label} className="flex min-h-11 items-center justify-between border-b border-border text-[14px] tabular-nums">
            <span className="font-semibold">{label}</span><span>{value}</span>
          </div>
        ))}
        <span className="mt-1.5 text-caption text-muted-foreground">
          No se recalcula: tu línea parte de aquí y suma lo que registres después del corte.
        </span>
      </section>

      {r.installments.length > 0 && (
        <section aria-label="Detalle plan cuotas" className="mt-5 flex flex-col">
          <span className="border-b border-border pb-1 text-label text-muted-foreground">Detalle plan cuotas</span>
          {r.installments.map((x) => {
            const row = (
              <>
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="truncate font-semibold">{x.name} · cuota {x.sequence}/{x.n_installments}</span>
                  <span className="text-caption text-muted-foreground tabular-nums">
                    Capital {money(x.capital, x.currency)} + interés {money(x.interest, x.currency)}
                    {x.differs ? ` · en PPM la cuota es ${money(x.differs.each, x.currency)}` : x.move_id === null ? " · no la encontramos en PPM" : x.mine ? " · dividida en tu gasto" : " · de otra persona: te debe la cuota completa"}
                  </span>
                </span>
                <span className="text-amount">{money(add(x.capital, x.interest), x.currency)}</span>
              </>
            );
            return x.move_id === null
              ? <div key={`${x.name}-${x.sequence}`} className="flex min-h-[58px] items-center gap-3 border-b border-border">{row}</div>
              : <Link key={`${x.name}-${x.sequence}`} to={`/movimientos/${x.move_id}`} className="flex min-h-[58px] items-center gap-3 border-b border-border">{row}</Link>;
          })}
        </section>
      )}

      {r.installments.filter((x) => x.differs).map((x) => {
        const g = x.differs!;
        const bank = add(x.capital, x.interest);
        const up = (Number(bank) - Number(g.each)) * x.n_installments;
        return (
          <section key={x.id} aria-label="La cuota del banco es distinta"
            className="mt-4 flex flex-col gap-2 rounded-xl bg-attention-soft p-3.5 text-attention">
            <span className="flex items-center gap-1.5 text-label"><Icon name="error" className="text-[18px]" />La cuota del banco es distinta</span>
            <p className="text-[14px] leading-5 text-foreground">
              {g.ref}: el banco cobra <b>{money(bank, x.currency)}</b> por cuota ({money(x.capital, x.currency)} de capital
              + {money(x.interest, x.currency)} de interés). En PPM cada cuota es {money(g.each, x.currency)}.
            </p>
            <dl className="grid grid-cols-[1fr_auto] gap-y-0.5 text-[14px] leading-5 text-foreground tabular-nums">
              <dt>Las {x.n_installments} cuotas pasan a</dt><dd className="text-right font-semibold">{money(bank, x.currency)}</dd>
              <dt>La tarjeta {up >= 0 ? "sube" : "baja"}</dt><dd className="text-right font-semibold">{money(Math.abs(up).toFixed(2), x.currency)}</dd>
              <dt>Esta cuota: capital + interés</dt><dd className="text-right font-semibold">{money(x.capital, x.currency)} + {money(x.interest, x.currency)}</dd>
            </dl>
            {bankInstallment.error && <ErrorAlert>{bankInstallment.error.message}</ErrorAlert>}
            <div className="mt-1 flex gap-2">
              <button type="button" disabled={bankInstallment.isPending} onClick={() => bankInstallment.mutate({ rowId: x.id })}
                className="h-11 flex-1 rounded-xl bg-primary font-semibold text-primary-foreground">Usar la del banco</button>
              <button type="button" disabled={bankInstallment.isPending} onClick={() => bankInstallment.mutate({ rowId: x.id, rejectPlan: g.plan_id })}
                className="h-11 rounded-xl border border-input-line px-3.5 font-semibold text-foreground">No es esta compra</button>
            </div>
          </section>
        );
      })}

      <section aria-label="PPM y el banco" className="mt-5 flex flex-col">
        <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 border-b border-border pb-1 text-label text-muted-foreground">
          <span /><span className="text-right">PPM</span><span className="text-right">Banco</span><span className="text-right">Diferencia</span>
        </div>
        {r.currencies.filter((c) => c.bank_subtotal !== null).map((c) => {
          const gap = subtract(c.bank_subtotal!, c.subtotal);
          return (
            <div key={c.currency} className="grid min-h-11 grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 border-b border-border text-[14px] tabular-nums">
              <span className="font-semibold">Subtotal {symbolOf(c.currency)}</span>
              <span className="text-right">{money(c.subtotal, c.currency)}</span>
              <span className="text-right">{money(c.bank_subtotal!, c.currency)}</span>
              <span className={`text-right font-semibold ${Number(gap) === 0 ? "text-income" : "text-attention"}`}>
                {Number(gap) === 0 ? "Cuadra" : money(gap, c.currency)}
              </span>
            </div>
          );
        })}
        {r.fees.map((f) => (
          <div key={f.name} className="flex min-h-11 items-center justify-between border-b border-border text-[14px] tabular-nums">
            <span>{f.name}</span><span>{money(f.amount, f.currency)}</span>
          </div>
        ))}
        {r.bank_charges !== "0.00" && (
          <span className="mt-1.5 text-caption text-muted-foreground">En PPM hay {money(r.bank_charges)} de cargos del banco en este ciclo.</span>
        )}
      </section>

      {r.explanations.length > 0 && (
        <section aria-label="De dónde sale" className="mt-5 flex flex-col gap-2 rounded-[12px] bg-muted p-3.5">
          <span className="text-label text-muted-foreground">De dónde sale</span>
          {r.explanations.map((t) => <p key={t} className="text-[14px] leading-5">{t}</p>)}
        </section>
      )}

      {r.unread.length > 0 && (
        <section aria-label="No se pudieron leer" className="mt-5 flex flex-col gap-1.5 rounded-[12px] bg-attention-soft p-3.5 text-attention">
          <span className="text-label">No se pudieron leer</span>
          {r.unread.map((t) => <span key={t} className="font-mono text-[13px] leading-5">{t}</span>)}
          <span className="text-caption">Regístralas a mano si faltan en PPM.</span>
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
      {r.unmatched.length > 0 && (
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

      <ImportStatement cardId={id} label="Volver a importar el PDF" />
      <div className="h-6" />
    </Screen>
  );
}

