// El estado de cuenta de la tarjeta, importado del PDF: la foto del banco al corte (línea, utilizada,
// disponible, facturado y saldo de cuotas), sus fechas, el capital e interés de cada cuota, si la
// lectura cuadra con el subtotal y qué movimientos no tienen par de cada lado.
import { useRef } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { type Reconciliation, useBankInstallment, useCard, useImportCardStatement, useMe, useReconciliation } from "@/api/hooks";
import { Pill } from "@/components/Pill";
import { ErrorAlert, Facts, Icon, Screen, Segments, Spinner, Status } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { add, formatAmount, isNegative, multiply, subtract, symbolOf } from "@/lib/money";
import { FormHeader } from "@/pages/cuentas/Nueva";
import { Button } from "@/components/Button";

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
        className="flex min-h-control items-center gap-1.5 self-start font-semibold disabled:opacity-60">
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
  const notSplit = r.installments.filter((x) => x.not_split);
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
      <Facts className="mt-2" items={[["Ciclo", `${shortDate(r.date_from)} al ${shortDate(r.closing_date)}`], r.date_due && ["Pagar antes del", shortDate(r.date_due)]]} />
      {r.filename && <span className="text-caption text-muted-foreground">{r.filename}</span>}

      <section aria-label="Foto del corte" className="mt-5 flex flex-col">
        <span className="flex flex-col border-b border-border pb-1"><span className="text-label text-muted-foreground">Foto del corte</span><span className="text-caption text-muted-foreground">Lo que dice el banco</span></span>
        {photo.map(([label, value]) => (
          <div key={label} className="flex min-h-control items-center justify-between border-b border-border text-body-sm tabular-nums">
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
                  {/* La barra de rayitas de las cuotas de la tarjeta (caso 7) y «3 de 12» (caso 9, opción C) */}
                  <span className="flex items-center gap-2.5">
                    <span className="truncate font-semibold">{x.name}</span>
                    <Segments done={x.sequence} total={x.n_installments} className="w-24 flex-none" />
                    <span className="flex-none text-caption text-muted-foreground tabular-nums">
                      <span className="sr-only">Cuota </span>{x.sequence} de {x.n_installments}
                    </span>
                  </span>
                  <span className="text-caption text-muted-foreground tabular-nums">
                    Capital {money(x.capital, x.currency)} + interés {money(x.interest, x.currency)}
                  </span>
                  <span className="text-caption text-muted-foreground tabular-nums">
                    {x.differs ? <Status icon="error" attention>En PPM la cuota es {money(x.differs.each, x.currency)}</Status>
                      : x.move_id === null ? <Status icon="error" attention>No está en PPM</Status>
                      : x.mine ? <Status icon="call_split">Dividida en tu gasto</Status>
                      : <Status icon="person">De otra persona: te debe la cuota completa</Status>}
                  </span>
                </span>
                <span className="text-amount">{money(add(x.capital, x.interest), x.currency)}</span>
              </>
            );
            return x.move_id === null
              ? <div key={`${x.name}-${x.sequence}`} className="flex min-h-row items-center gap-3 border-b border-border">{row}</div>
              : <Link key={`${x.name}-${x.sequence}`} to={`/movimientos/${x.move_id}`} className="flex min-h-row items-center gap-3 border-b border-border">{row}</Link>;
          })}
        </section>
      )}

      {r.installments.filter((x) => x.differs).map((x) => {
        const g = x.differs!;
        const bank = add(x.capital, x.interest);
        const up = multiply(subtract(bank, g.each), String(x.n_installments));
        return (
          <section key={x.id} aria-label="La cuota del banco es distinta"
            className="mt-4 flex flex-col gap-2 rounded-lg bg-attention-soft p-3.5 text-attention">
            <span className="flex items-center gap-1.5 text-label"><Icon name="error" size="sm" />La cuota del banco es distinta</span>
            <p className="text-body-sm text-foreground">
              {g.ref}: el banco cobra <b>{money(bank, x.currency)}</b> por cuota ({money(x.capital, x.currency)} de capital
              + {money(x.interest, x.currency)} de interés). En PPM cada cuota es {money(g.each, x.currency)}.
            </p>
            <dl className="grid grid-cols-title-amount gap-y-0.5 text-body-sm text-foreground tabular-nums">
              <dt>Las {x.n_installments} cuotas pasan a</dt><dd className="text-right font-semibold">{money(bank, x.currency)}</dd>
              <dt>La tarjeta {isNegative(up) ? "baja" : "sube"}</dt><dd className="text-right font-semibold">{money(up.replace("-", ""), x.currency)}</dd>
              <dt>Esta cuota: capital + interés</dt><dd className="text-right font-semibold">{money(x.capital, x.currency)} + {money(x.interest, x.currency)}</dd>
            </dl>
            {bankInstallment.error && <ErrorAlert>{bankInstallment.error.message}</ErrorAlert>}
            <div className="mt-1 flex flex-wrap gap-2">
              <Button size="sm" disabled={bankInstallment.isPending} onClick={() => bankInstallment.mutate({ rowId: x.id })}
                className="flex-1 basis-48">Usar la del banco</Button>
              <Button variant="secondary" size="sm" disabled={bankInstallment.isPending} className="whitespace-nowrap text-foreground"
                onClick={() => bankInstallment.mutate({ rowId: x.id, rejectPlan: g.plan_id })}>No es esta compra</Button>
            </div>
          </section>
        );
      })}

      <section aria-label="PPM y el banco" className="mt-5 flex flex-col">
        <div className="grid grid-cols-currency-table gap-x-3 border-b border-border pb-1 text-label text-muted-foreground">
          <span /><span className="text-right">PPM</span><span className="text-right">Banco</span><span className="text-right">Diferencia</span>
        </div>
        {r.currencies.filter((c) => c.bank_subtotal !== null).map((c) => {
          const gap = subtract(c.bank_subtotal!, c.subtotal);
          return (
            <div key={c.currency} className="grid min-h-control grid-cols-currency-table items-center gap-x-3 border-b border-border text-body-sm tabular-nums">
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
          <div key={f.name} className="flex min-h-control items-center justify-between border-b border-border text-body-sm tabular-nums">
            <span>{f.name}</span><span>{money(f.amount, f.currency)}</span>
          </div>
        ))}
        {r.bank_charges !== "0.00" && (
          <span className="mt-1.5 text-caption text-muted-foreground">En PPM hay {money(r.bank_charges)} de cargos del banco en este ciclo.</span>
        )}
      </section>

      {(r.explanations.length > 0 || notSplit.length > 0) && (
        <section aria-label="De dónde sale" className="mt-5 flex flex-col gap-2 rounded-lg bg-muted p-3.5">
          <span className="text-label text-muted-foreground">De dónde sale</span>
          {r.explanations.map((t) => <p key={t} className="text-body-sm">{t}</p>)}
          {/* Una cuota en un periodo cerrado: el nombre en negrita y la cuota en pastilla (caso 10, opción C) */}
          {notSplit.map((x) => (
            <p key={`${x.name}-${x.sequence}`} className="text-body-sm">
              <b>{x.name}</b> <Pill>Cuota {x.sequence} de {x.n_installments}</Pill> cae en un periodo cerrado y no se dividió en
              capital e interés. Reabre el periodo y vuelve a importar el PDF para dividirla.
            </p>
          ))}
        </section>
      )}

      {r.unread.length > 0 && (
        <section aria-label="No se pudieron leer" className="mt-5 flex flex-col gap-1.5 rounded-lg bg-attention-soft p-3.5 text-attention">
          <span className="text-label">No se pudieron leer</span>
          {r.unread.map((t) => <span key={t} className="text-code leading-5">{t}</span>)}
          <span className="text-caption">Regístralas a mano si faltan en PPM.</span>
        </section>
      )}

      {missing.length > 0 && (
        <section aria-label="Del banco, sin par en PPM" className="mt-5 flex flex-col">
          <span className="border-b border-border pb-1 text-label text-muted-foreground">Del banco, sin par en PPM</span>
          {missing.map((l, k) => (
            <div key={k} className="flex min-h-control items-center gap-3 border-b border-border">
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
            <Link key={`${u.move_id}-${u.amount}`} to={`/movimientos/${u.move_id}`} className="flex min-h-control items-center gap-3 border-b border-border">
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{u.ref}</span>
                <Facts items={[["Del", shortDate(u.date)], ["Revisa", "El monto o la fecha"]]} attention />
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

