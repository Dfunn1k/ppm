// C2 · Detalle de cuenta: saldo, número y CCI para copiar, y los movimientos con el saldo después
// de cada uno. El menú ⋮ renombra, corrige el saldo inicial, edita el banco o archiva.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  type AccountDetail,
  ApiError,
  useAccount,
  useArchiveAccount,
  useMe,
  useSetOpening,
  useUpdateAccount,
} from "@/api/hooks";
import { Avatar } from "@/components/Avatar";
import { Button, IconButton } from "@/components/Button";
import { type Bit, MoveLine, clipBit, pendingBit } from "@/components/MoveBits";
import { PageHeader } from "@/components/PageHeader";
import { SectionHeading } from "@/components/SectionHeading";
import { Activities, ActivitySheet } from "@/components/Pending";
import { RateField, useRateInput } from "@/components/RateField";
import { Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon, LineField, PrimaryButton } from "@/components/ui";
import { DateField } from "@/components/DateSheet";
import { copyText } from "@/lib/clipboard";
import { longDate, shortDate, todayISO } from "@/lib/dates";
import { formatAmount, formatNumber, isNegative, isZero, parseAmount, rateText, symbolOf } from "@/lib/money";

import { AmountField } from "./CuentaForm";
import { DetailSkeleton } from "@/components/Skeleton";
import { useDesktop } from "@/lib/desktop";
import { AccountSub } from "@/components/AccountSub";
import { ScopeRow } from "@/pages/presupuesto/Cuentas";

/** En escritorio los movimientos van en tabla: fecha, movimiento, monto y saldo. */
const TABLE = "grid grid-cols-ledger items-center gap-3";

function CopyRow({ label, value, display, last }: { label: string; value: string; display: string; last?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`flex items-center gap-2 py-2 pr-2 pl-3 ${last ? "" : "border-b border-border"}`}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-label text-muted-foreground">{label}</span>
        <span className="text-code">{display}</span>
      </span>
      <button
        type="button"
        aria-label={copied ? `${label} copiado` : `Copiar ${label.toLowerCase()}`}
        onClick={() => copyText(value).then(setCopied)}
        className="flex min-h-control items-center gap-1 rounded-full bg-card px-3 text-caption font-semibold"
      >
        <Icon name={copied ? "check" : "content_copy"} />
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

const cciDisplay = (cci: string) => `${cci.slice(0, 3)}-${cci.slice(3, 6)}-${cci.slice(6, 18)}-${cci.slice(18)}`;

type Menu = null | "open" | "rename" | "opening" | "archive" | "reminder";

export function Detalle() {
  const id = Number(useParams().id);
  const me = useMe().data;
  const account = useAccount(id);
  const [menu, setMenu] = useState<Menu>(null);
  const table = useDesktop();
  if (!me?.currency || account.isPending) return <DetailSkeleton back="/cuentas" />;
  if (account.isError) {
    return (
      <main className="mx-auto max-w-md px-6 pt-8 md:max-w-160">
        <ErrorAlert>{account.error.message}</ErrorAlert>
        <Link to="/cuentas" className="mt-4 block text-primary-strong underline">Volver a cuentas</Link>
      </main>
    );
  }
  const d = account.data;
  const lang = me.lang ?? "es-PE";
  const onlyOpening = d.lines.length <= 1;
  const close = () => setMenu(null);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28 md:max-w-160 md:pb-10">
      <PageHeader back={{ to: "/cuentas", label: "Volver a cuentas" }}
        actions={<IconButton icon="more_vert" label="Más opciones de la cuenta" aria-haspopup="dialog" onClick={() => setMenu("open")} />}
        eyebrow={d.account.subtitle && <AccountSub a={d.account} />} title={d.account.name} />
      <span className="mt-4 text-caption text-muted-foreground">Tienes hoy</span>
      {d.account.balances.length === 0 ? (
        <span className="text-amount-display">{formatAmount("0.00", symbolOf(d.account.currency ?? me.currency), lang)}</span>
      ) : (
        d.account.balances.map((m) => (
          <span key={m.currency} className="text-amount-display">{formatAmount(m.amount, symbolOf(m.currency), lang)}</span>
        ))
      )}

      {d.bank && (d.bank.acc_number || d.bank.cci) && (
        <div className="mt-4 flex flex-col rounded-lg bg-muted">
          {d.bank.acc_number && <CopyRow label="Número de cuenta" value={d.bank.acc_number} display={d.bank.acc_number} last={!d.bank.cci} />}
          {d.bank.cci && <CopyRow label="CCI" value={d.bank.cci} display={cciDisplay(d.bank.cci)} last />}
        </div>
      )}

      <ScopeRow accountId={d.account.id} />
      {d.bank && <StatementCard detail={d} lang={lang} />}

      <Activities target={{ account_id: d.account.id }} hideEmpty />

      <section aria-label="Movimientos" className="mt-5 flex flex-col">
        {table ? (
          <div className={`${TABLE} border-b border-border pb-1 text-label text-muted-foreground`}>
            <span>Fecha</span><h2>Movimiento</h2><span className="text-right">Monto</span><span className="text-right">Saldo</span>
          </div>
        ) : (
          <SectionHeading action={<span className="text-label text-muted-foreground">Saldo</span>}>Movimientos</SectionHeading>
        )}
        {d.lines.map((l) => <LineRow key={l.id} line={l} lang={lang} table={table} />)}
        {onlyOpening && (
          <span className="py-3 text-caption text-muted-foreground">
            Cuando registres gastos e ingresos, aparecen aquí con el saldo después de cada uno.
          </span>
        )}
      </section>

      <Sheet title="Opciones de la cuenta" open={menu === "open"} onClose={close}>
        <div className="flex flex-col">
          <MenuItem icon="edit" onClick={() => setMenu("rename")}>Renombrar</MenuItem>
          <MenuItem icon="notification_add" onClick={() => setMenu("reminder")}>Agregar recordatorio</MenuItem>
          <MenuItem icon="flag" onClick={() => setMenu("opening")}>Corregir el saldo inicial</MenuItem>
          {d.bank && <MenuItem icon="tune" to={`/cuentas/${id}/editar`}>Editar banco, número y CCI</MenuItem>}
          <MenuItem icon="archive" danger onClick={() => setMenu("archive")}>Archivar cuenta</MenuItem>
        </div>
      </Sheet>
      <ActivitySheet open={menu === "reminder"} onClose={close} target={{ account_id: d.account.id }} />
      <RenameSheet open={menu === "rename"} onClose={close} detail={d} />
      <OpeningSheet open={menu === "opening"} onClose={close} detail={d} base={me.currency} lang={lang} />
      <ArchiveSheet open={menu === "archive"} onClose={close} detail={d} />
    </main>
  );
}

/** El último extracto (si cuadra) con «Importar extracto», y cuántos faltan clasificar de esta cuenta. */
function StatementCard({ detail: d, lang }: { detail: AccountDetail; lang: string }) {
  const last = d.last_statement;
  const status = !last
    ? null
    : last.difference === null
      ? { icon: "description", text: last.name, cls: "" }
      : isZero(last.difference)
        ? { icon: "check_circle", text: "El saldo cuadra", cls: "text-income" }
        : { icon: "error", text: `${isNegative(last.difference) ? "Sobran" : "Faltan"} ${formatNumber(last.difference.replace("-", ""), lang)}`, cls: "text-attention" };
  return (
    <>
      {!last ? (
        <Link to={`/cuentas/${d.account.id}/importar`}
          className="mt-4 flex min-h-12 items-center gap-3 rounded-lg bg-muted px-4 font-semibold hover:bg-accent">
          <Icon name="upload_file" /><span className="flex-1">Importar extracto del banco</span>
          <Icon name="chevron_right" size="md" className="text-muted-foreground" />
        </Link>
      ) : (
      <div className="mt-4 flex items-center gap-3 rounded-lg bg-muted py-2 pr-2 pl-4">
        <Link to={`/extractos/${last.id}`} className="flex min-w-0 flex-1 flex-col">
          <span className="text-caption text-muted-foreground">Último extracto{last.date_to ? ` hasta el ${shortDate(last.date_to)}` : ""}</span>
          <span className={`flex items-center gap-1 truncate font-semibold ${status!.cls}`}><Icon name={status!.icon} />{status!.text}</span>
        </Link>
        <Link to={`/cuentas/${d.account.id}/importar`}
          className="flex min-h-control flex-none items-center gap-1.5 rounded-full border border-border bg-card px-4 text-body-sm font-semibold hover:bg-muted">
          <Icon name="upload_file" />Importar extracto
        </Link>
      </div>
      )}
      {d.unclassified > 0 && (
        <Link to={`/por-clasificar?cuenta=${d.account.id}`}
          className="mt-2 flex min-h-12 items-center gap-3 rounded-lg bg-attention-soft px-3 text-attention">
          <Icon name="inbox" />
          <span className="flex-1 text-body-sm"><b>{d.unclassified} por clasificar</b> de esta cuenta</span>
          <span className="text-body-sm font-semibold">Clasificar</span>
          <Icon name="chevron_right" />
        </Link>
      )}
    </>
  );
}

function LineRow({ line: l, lang, table }: { line: AccountDetail["lines"][number]; lang: string; table: boolean }) {
  const opening = l.counterpart_role === "opening";
  const suspense = l.counterpart_role === "suspense";
  const out = isNegative(l.amount);
  const chip = opening
    ? <Avatar kind="account" icon="flag" />
    : suspense
      ? <Avatar kind="attention" icon="inbox" />
      : l.counterpart_money
        ? <Avatar kind="account" icon="sync_alt" />
        : <Avatar kind="category" color={l.counterpart_color} icon={l.counterpart_icon ?? "category"} />;
  // La línea chica, la misma de Movimientos: dentro de la cuenta no se repite la cuenta; en una
  // transferencia va la otra. La categoría ya es el ícono.
  const bits: Bit[] = [];
  if (!l.posted) bits.push(pendingBit);
  if (!table) bits.push({ text: shortDate(l.date) });
  if (opening) bits.push({ text: "Lo que tenía al empezar", shrink: true });
  else if (suspense) bits.push({ text: "Por clasificar", attention: true });
  else if (l.counterpart_money) bits.push({ icon: l.counterpart_icon ?? "payments", text: `${out ? "A" : "De"} ${l.counterpart}`, shrink: true });
  if (l.attachments > 0) bits.push(clipBit);
  const Row = opening ? "div" : Link;
  const amount = opening ? (
    <span className="text-amount">{formatNumber(l.amount, lang)}</span>
  ) : (
    <span className={`flex items-center justify-end gap-0.5 text-amount ${out ? "text-expense" : "text-income"}`}>
      <Icon name={out ? "north_east" : "south_west"} size="sm" />
      {out ? "− " : "+ "}{formatNumber(l.amount.replace("-", ""), lang)}
    </span>
  );
  const name = opening ? "Saldo inicial" : l.ref;
  if (table) {
    return (
      <Row to={`/movimientos/${l.move_id}`} className={`${TABLE} min-h-row-sm border-b border-border hover:bg-muted`}>
        <span className="text-caption text-muted-foreground tabular-nums">{shortDate(l.date)}</span>
        <span className="flex min-w-0 items-center gap-3">
          {chip}
          <span className="max-w-1/2 flex-none truncate font-semibold">{name}</span>
          <MoveLine bits={bits} tags={l.tags} wide />
        </span>
        <span className="text-right tabular-nums">{amount}</span>
        <span className="text-right text-caption text-muted-foreground tabular-nums">{l.running !== null ? formatNumber(l.running, lang) : ""}</span>
      </Row>
    );
  }
  return (
    <Row to={`/movimientos/${l.move_id}`} className="flex min-h-row items-center gap-3 border-b border-border py-2">
      {chip}
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">{name}</span>
        <MoveLine bits={bits} tags={l.tags} />
      </span>
      <span className="flex flex-none flex-col items-end tabular-nums">
        {amount}
        {l.running !== null && <span className="text-caption text-muted-foreground">{formatNumber(l.running, lang)}</span>}
      </span>
    </Row>
  );
}

function MenuItem({ icon, children, onClick, to, danger }: {
  icon: string; children: React.ReactNode; onClick?: () => void; to?: string; danger?: boolean;
}) {
  const cls = `flex min-h-12 items-center gap-3 rounded-md px-3 text-left hover:bg-muted ${danger ? "text-destructive" : ""}`;
  const body = <><Icon name={icon} />{children}</>;
  return to ? <Link to={to} className={cls}>{body}</Link> : <button type="button" onClick={onClick} className={cls}>{body}</button>;
}

function RenameSheet({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: AccountDetail }) {
  const update = useUpdateAccount(detail.account.id);
  const [name, setName] = useState(detail.account.name);
  return (
    <Sheet title="Renombrar" open={open} onClose={onClose}>
      <form className="flex flex-col gap-4 px-3"
        onSubmit={(e) => { e.preventDefault(); update.mutate({ name: name.trim(), clear: [] }, { onSuccess: onClose }); }}>
        <LineField label="Nombre" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        {update.error && <ErrorAlert>{update.error.message}</ErrorAlert>}
        <PrimaryButton pending={update.isPending} disabled={!name.trim()}>Guardar</PrimaryButton>
      </form>
    </Sheet>
  );
}

function OpeningSheet({ open, onClose, detail, base, lang }: {
  open: boolean; onClose: () => void; detail: AccountDetail; base: string; lang: string;
}) {
  const set = useSetOpening(detail.account.id);
  const currency = detail.account.currency ?? base;
  const [amount, setAmount] = useState(detail.opening ? formatNumber(detail.opening.amount, lang) : "");
  const [date, setDate] = useState(detail.opening?.date ?? todayISO());
  const [problem, setProblem] = useState<string | null>(null);
  const foreign = currency !== base;
  const side = detail.account.kind === "other" ? "sell" : "buy";
  const rate = useRateInput(currency, base, date, side, detail.opening?.rate ? rateText(detail.opening.rate) : null);
  return (
    <Sheet title="Corregir el saldo inicial" open={open} onClose={onClose}>
      <form className="flex flex-col gap-4 px-3"
        onSubmit={(e) => {
          e.preventDefault();
          const value = parseAmount(amount || "0", lang);
          if (value === null) return setProblem("Escribe un monto como 1,234.50");
          setProblem(null);
          if (foreign && !(Number(rate.value) > 0)) return setProblem("Escribe el tipo de cambio, como 3.443");
          set.mutate({ amount: value, date, rate: foreign ? rate.value.trim() : null }, { onSuccess: onClose });
        }}>
        <p className="text-caption text-muted-foreground">
          {detail.opening
            ? `Hoy dice ${formatAmount(detail.opening.amount, symbolOf(currency), lang)} al ${longDate(detail.opening.date)}. Lo reemplazamos por lo que escribas.`
            : "Esta cuenta no tiene saldo inicial. Escribe con cuánto empezó."}
        </p>
        <AmountField label="Saldo inicial" symbol={symbolOf(currency)} value={amount} onChange={(e) => setAmount(e.target.value)} />
        <DateField label="Al día" max={todayISO()} value={date} onChange={setDate} booked />
        {foreign && <RateField input={rate} currency={currency} side={side} />}
        {(problem || set.error) && <ErrorAlert>{problem ?? set.error?.message}</ErrorAlert>}
        <PrimaryButton pending={set.isPending}>Guardar saldo</PrimaryButton>
      </form>
    </Sheet>
  );
}

function ArchiveSheet({ open, onClose, detail }: { open: boolean; onClose: () => void; detail: AccountDetail }) {
  const navigate = useNavigate();
  const archive = useArchiveAccount(detail.account.id);
  const hasMoney = detail.account.balances.some((m) => !isZero(m.amount));
  return (
    <Sheet title={`¿Archivar «${detail.account.name}»?`} open={open} onClose={onClose}>
      <div className="flex flex-col gap-4 px-3">
        <p className="text-muted-foreground">
          {hasMoney
            ? "Para archivarla, su saldo tiene que estar en cero: una cuenta archivada no suma en tus totales."
            : "Deja de aparecer en tus cuentas. Sus movimientos se quedan en tu historial."}
        </p>
        {archive.error && <ErrorAlert>{archive.error instanceof ApiError ? archive.error.message : "No se pudo archivar"}</ErrorAlert>}
        <Button variant="destructive" icon="archive" disabled={hasMoney} pending={archive.isPending}
          onClick={() => archive.mutate(undefined, { onSuccess: () => navigate("/cuentas", { replace: true }) })}>
          Archivar cuenta
        </Button>
        <Button variant="ghost" size="sm" onClick={onClose}>Cancelar</Button>
      </div>
    </Sheet>
  );
}
