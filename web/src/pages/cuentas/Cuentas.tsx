// C1 · Cuentas: lo que realmente tengo, y debajo lo que tengo, lo que guardo de otros y lo que debo.
import { Link, useLocation } from "react-router";

import { type AccountRow, useAccounts, useMe } from "@/api/hooks";
import { ErrorAlert, Icon } from "@/components/ui";
import { cardHint } from "@/lib/cards";
import { formatAmount, symbolOf } from "@/lib/money";
import { ListSkeleton } from "@/components/Skeleton";

function Group({ label, total, children }: { label: string; total: string; children: React.ReactNode }) {
  return (
    <section aria-label={label} className="mt-6 flex flex-col">
      <div className="flex justify-between border-b border-border pb-1 text-label text-muted-foreground tabular-nums">
        <span>{label}</span>
        <span>{total}</span>
      </div>
      {children}
    </section>
  );
}

function Row({ to, icon, letter, name, subtitle, amount, negative, attention }: {
  to?: string;
  icon?: string | null;
  letter?: string;
  name: string;
  subtitle?: string | null;
  amount: string;
  negative?: boolean;
  attention?: boolean;   // el subtítulo pide algo (falta la fecha de pago)
}) {
  const body = (
    <>
      <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary font-semibold text-secondary-foreground">
        {letter ?? <Icon name={icon ?? "payments"} />}
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{name}</span>
        {subtitle && (
          <span className={`text-caption tabular-nums ${attention ? "font-semibold text-attention" : "text-muted-foreground"}`}>{subtitle}</span>
        )}
      </span>
      <span className={`text-amount ${negative ? "text-expense" : ""}`}>{amount}</span>
    </>
  );
  const cls = "flex min-h-[60px] items-center gap-3 border-b border-border";
  return to ? <Link to={to} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

/** Por cobrar y Por pagar se leen como «Me deben» y «Debo a personas», y llevan a Personas ya filtrada. */
function people(n: number | null | undefined, to: boolean) {
  const count = n ?? 0;
  return `${to ? "A " : ""}${count} ${count === 1 ? "persona" : "personas"}`;
}

function accountRow(a: AccountRow, base: string, lang: string, negative?: boolean) {
  const { amount, subtitle } = rowAmount(a, base, lang);
  if (a.kind === "receivable") {
    return <Row key={a.id} to="/personas?ver=me-deben" icon="group" name="Me deben" subtitle={people(a.partners, false)}
      amount={formatAmount(a.base_total, symbolOf(base), lang)} />;
  }
  if (a.kind === "payable") {
    return <Row key={a.id} to="/personas?ver=debo" icon="group" name="Debo a personas" subtitle={people(a.partners, true)}
      amount={formatAmount(a.base_total.replace("-", ""), symbolOf(base), lang)} />;
  }
  if (a.kind === "installments") {   // lo que ya le debes al banco por compras en cuotas: cada cuota es gasto en su corte
    return <Row key={a.id} to={`/cuentas/${a.id}`} icon={a.icon} name={a.name} subtitle="Se vuelven gasto en su corte"
      amount={formatAmount(a.base_total, symbolOf(base), lang)} />;
  }
  if (a.kind === "card") {
    const hint = cardHint(a, lang);
    return <Row key={a.id} to={`/tarjetas/${a.id}`} icon="credit_card" name={a.name} subtitle={hint.text} attention={hint.attention}
      amount={formatAmount(a.base_total.replace("-", ""), symbolOf(base), lang)} negative={!a.base_total.startsWith("-") ? false : negative} />;
  }
  if (a.kind === "loan") {
    return <Row key={a.id} to={`/prestamos/${a.id}`} icon={a.icon} name={a.name} subtitle={a.subtitle ?? subtitle}
      amount={formatAmount(a.base_total.replace("-", ""), symbolOf(base), lang)} />;
  }
  return <Row key={a.id} to={`/cuentas/${a.id}`} icon={a.icon} name={a.name} subtitle={subtitle} amount={amount} negative={negative} />;
}

/** El saldo de una cuenta en su moneda; si no es la base, el subtítulo dice cuánto es en soles. */
function rowAmount(a: AccountRow, base: string, lang: string) {
  const single = a.balances.length === 1 ? a.balances[0]! : null;
  const currency = single?.currency ?? a.currency ?? base;
  const amount = formatAmount(single?.amount ?? (a.balances.length ? a.base_total : "0.00"), symbolOf(currency), lang);
  const inBase = currency !== base && single ? `son ${formatAmount(single.base, symbolOf(base), lang)}` : null;
  return { amount, subtitle: [a.subtitle, inBase].filter(Boolean).join(" · ") || null };
}

export function Cuentas() {
  const me = useMe().data;
  const accounts = useAccounts();
  const notice = (useLocation().state as { notice?: string } | null)?.notice;
  if (!me?.currency || accounts.isPending) return <ListSkeleton />;
  if (accounts.isError) return <ErrorAlert>{accounts.error.message}</ErrorAlert>;

  const o = accounts.data;
  const lang = me.lang ?? "es-PE";
  const money = (v: string) => formatAmount(v, symbolOf(o.currency), lang);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-8 pb-28">
      <div className="-mr-2.5 flex items-center justify-between">
        <span className="text-label text-muted-foreground">Cuentas</span>
        <div className="flex items-center gap-2">
          {/* Personas siempre a mano, aunque todavía no haya deudas */}
          <Link to="/personas" aria-label="Personas" className="grid size-11 place-items-center rounded-full">
            <Icon name="group" className="text-[24px]" />
          </Link>
          <Link to="/cuentas/nueva" aria-label="Nueva cuenta"
            className="grid size-11 place-items-center rounded-full bg-secondary text-secondary-foreground">
            <Icon name="add" className="text-[24px]" />
          </Link>
        </div>
      </div>
      {notice && <div className="mt-4"><ErrorAlert>{notice}</ErrorAlert></div>}
      <span className="mt-5 text-caption text-muted-foreground">Lo que realmente tengo</span>
      <h1 className="font-display text-[48px] leading-[50px] font-extrabold tracking-[-0.03em] tabular-nums">
        {money(o.real_total)}
      </h1>
      <span className="mt-1 text-caption text-muted-foreground">Lo que tienes, menos lo que guardas de otros y lo que debes.</span>

      <Group label="Lo que tengo" total={money(o.have_total)}>
        {/* Primero tu plata (efectivo y bancos); después lo que te deben y lo por clasificar */}
        {[...o.have].sort((x, y) => Number(!["cash", "bank"].includes(x.kind)) - Number(!["cash", "bank"].includes(y.kind)))
          .map((a) => accountRow(a, o.currency, lang))}
      </Group>

      {o.custody.length > 0 && (
        <Group label="Guardo de otros" total={money(o.custody_total)}>
          {o.custody.map((c) => (
            <Row key={c.partner_id} to={`/personas/${c.partner_id}`} letter={c.partner_name[0]?.toUpperCase()} name={c.partner_name}
              subtitle="Te la dio para guardar"
              amount={c.balances.map((m) => formatAmount(m.amount, symbolOf(m.currency), lang)).join(" · ")} />
          ))}
        </Group>
      )}

      <Group label="Lo que debo" total={money(o.owe_total)}>
        {o.owe.length === 0 ? (
          <span className="py-3 text-caption text-muted-foreground">Nada por ahora. Tus tarjetas y préstamos aparecerán aquí.</span>
        ) : (
          o.owe.map((a) => accountRow(a, o.currency, lang, true))
        )}
      </Group>
    </main>
  );
}
