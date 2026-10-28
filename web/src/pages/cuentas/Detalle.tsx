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
import { RateField, useRateInput } from "@/components/RateField";
import { Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon, LineField, PrimaryButton, Spinner } from "@/components/ui";
import { copyText } from "@/lib/clipboard";
import { longDate, shortDate, todayISO } from "@/lib/dates";
import { formatAmount, formatNumber, isNegative, isZero, parseAmount, symbolOf } from "@/lib/money";

import { AmountField } from "./CuentaForm";

function CopyRow({ label, value, display, last }: { label: string; value: string; display: string; last?: boolean }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className={`flex items-center gap-2 py-2 pr-2 pl-3 ${last ? "" : "border-b border-border"}`}>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-label text-muted-foreground">{label}</span>
        <span className="font-mono text-[14px] leading-5">{display}</span>
      </span>
      <button
        type="button"
        aria-label={copied ? `${label} copiado` : `Copiar ${label.toLowerCase()}`}
        onClick={() => copyText(value).then(setCopied)}
        className="flex h-9 items-center gap-1 rounded-full bg-card px-3 text-caption font-semibold"
      >
        <Icon name={copied ? "check" : "content_copy"} className="text-[18px]" />
        {copied ? "Copiado" : "Copiar"}
      </button>
    </div>
  );
}

const cciDisplay = (cci: string) => `${cci.slice(0, 3)}-${cci.slice(3, 6)}-${cci.slice(6, 18)}-${cci.slice(18)}`;

type Menu = null | "open" | "rename" | "opening" | "archive";

export function Detalle() {
  const id = Number(useParams().id);
  const me = useMe().data;
  const account = useAccount(id);
  const [menu, setMenu] = useState<Menu>(null);
  if (!me?.currency || account.isPending) return <Spinner />;
  if (account.isError) {
    return (
      <main className="mx-auto max-w-md px-6 pt-8">
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
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/cuentas" aria-label="Volver a cuentas" className="grid size-11 place-items-center rounded-full">
          <Icon name="arrow_back" className="text-[24px]" />
        </Link>
        <button type="button" aria-label="Más opciones de la cuenta" aria-haspopup="dialog" onClick={() => setMenu("open")}
          className="grid size-11 place-items-center rounded-full">
          <Icon name="more_vert" className="text-[24px]" />
        </button>
      </div>
      {d.account.subtitle && <span className="mt-2 text-label text-muted-foreground">{d.account.subtitle}</span>}
      <h1 className="mt-1.5 text-title-hero">{d.account.name}</h1>
      <span className="mt-4 text-caption text-muted-foreground">Tienes hoy</span>
      {d.account.balances.length === 0 ? (
        <span className="text-amount-hero">{formatAmount("0.00", symbolOf(d.account.currency ?? me.currency), lang)}</span>
      ) : (
        d.account.balances.map((m) => (
          <span key={m.currency} className="text-amount-hero">{formatAmount(m.amount, symbolOf(m.currency), lang)}</span>
        ))
      )}

      {d.bank && (d.bank.acc_number || d.bank.cci) && (
        <div className="mt-4 flex flex-col rounded-[12px] bg-muted">
          {d.bank.acc_number && <CopyRow label="Número de cuenta" value={d.bank.acc_number} display={d.bank.acc_number} last={!d.bank.cci} />}
          {d.bank.cci && <CopyRow label="CCI" value={d.bank.cci} display={cciDisplay(d.bank.cci)} last />}
        </div>
      )}

      {d.bank && <StatementCard detail={d} lang={lang} />}

      <section aria-label="Movimientos" className="mt-5 flex flex-col">
        <div className="flex justify-between border-b border-border pb-1 text-label text-muted-foreground">
          <span>Movimientos</span>
          <span>Saldo</span>
        </div>
        {d.lines.map((l) => <LineRow key={l.id} line={l} lang={lang} />)}
        {onlyOpening && (
          <span className="py-3 text-caption text-muted-foreground">
            Cuando registres gastos e ingresos, aparecen aquí con el saldo después de cada uno.
          </span>
        )}
      </section>

      <Sheet title="Opciones de la cuenta" open={menu === "open"} onClose={close}>
        <div className="flex flex-col">
          <MenuItem icon="edit" onClick={() => setMenu("rename")}>Renombrar</MenuItem>
          <MenuItem icon="flag" onClick={() => setMenu("opening")}>Corregir el saldo inicial</MenuItem>
          {d.bank && <MenuItem icon="tune" to={`/cuentas/${id}/editar`}>Editar banco, número y CCI</MenuItem>}
          <MenuItem icon="archive" danger onClick={() => setMenu("archive")}>Archivar cuenta</MenuItem>
        </div>
      </Sheet>
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
    ? { icon: "upload", text: "Trae tus movimientos", cls: "" }
    : last.difference === null
      ? { icon: "description", text: last.name, cls: "" }
      : isZero(last.difference)
        ? { icon: "check_circle", text: "El saldo cuadra", cls: "text-income" }
        : { icon: "error", text: `${isNegative(last.difference) ? "Sobran" : "Faltan"} ${formatNumber(last.difference.replace("-", ""), lang)}`, cls: "text-attention" };
  return (
    <>
      <div className="mt-4 flex items-center gap-3 rounded-[12px] bg-muted py-2.5 pr-2.5 pl-3.5">
        {last ? (
          <Link to={`/extractos/${last.id}`} className="flex min-w-0 flex-1 flex-col">
            <span className="text-caption text-muted-foreground">Último extracto{last.date_to ? ` · hasta el ${shortDate(last.date_to)}` : ""}</span>
            <span className={`flex items-center gap-1 truncate font-semibold ${status.cls}`}><Icon name={status.icon} className="text-[18px]" />{status.text}</span>
          </Link>
        ) : (
          <span className="flex min-w-0 flex-1 flex-col">
            <span className="text-caption text-muted-foreground">Extracto del banco</span>
            <span className="flex items-center gap-1 font-semibold"><Icon name={status.icon} className="text-[18px]" />{status.text}</span>
          </span>
        )}
        <Link to={`/cuentas/${d.account.id}/importar`}
          className="flex h-10 flex-none items-center gap-1.5 rounded-full border border-border bg-card px-3.5 text-[14px] font-semibold">
          <Icon name="upload_file" />Importar extracto
        </Link>
      </div>
      {d.unclassified > 0 && (
        <Link to={`/por-clasificar?cuenta=${d.account.id}`}
          className="mt-2 flex min-h-12 items-center gap-2.5 rounded-[12px] bg-attention-soft px-3 text-attention">
          <Icon name="inbox" />
          <span className="flex-1 text-[14px]"><b>{d.unclassified} por clasificar</b> de esta cuenta</span>
          <span className="text-[14px] font-semibold">Clasificar</span>
          <Icon name="chevron_right" />
        </Link>
      )}
    </>
  );
}

function LineRow({ line: l, lang }: { line: AccountDetail["lines"][number]; lang: string }) {
  const opening = l.counterpart_role === "opening";
  const suspense = l.counterpart_role === "suspense";
  const out = isNegative(l.amount);
  const chip = opening
    ? { bg: "var(--secondary)", fg: "var(--secondary-foreground)", icon: "flag" }
    : suspense
      ? { bg: "var(--attention-soft)", fg: "var(--attention)", icon: "inbox" }
      : { bg: `var(--cat-${l.counterpart_color ?? 0})`, fg: "var(--on-category)", icon: l.counterpart_icon ?? "category" };
  const caption = opening ? "lo que tenía al empezar" : suspense ? "Por clasificar" : (l.counterpart ?? "Varias categorías");
  const Row = opening ? "div" : Link;
  return (
    <Row to={`/movimientos/${l.move_id}`} className="flex min-h-[60px] items-center gap-3 border-b border-border">
      <span className="grid size-9 flex-none place-items-center rounded-full" style={{ background: chip.bg, color: chip.fg }}>
        <Icon name={chip.icon} />
      </span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="font-semibold">{opening ? "Saldo inicial" : l.ref}</span>
        <span className={`text-caption ${suspense ? "font-semibold text-attention" : "text-muted-foreground"}`}>
          {shortDate(l.date)} · {caption}{l.posted ? "" : " · por confirmar"}
        </span>
      </span>
      <span className="flex flex-col items-end tabular-nums">
        {opening ? (
          <span className="text-amount">{formatNumber(l.amount, lang)}</span>
        ) : (
          <span className={`flex items-center gap-0.5 text-amount ${out ? "text-expense" : "text-income"}`}>
            <Icon name={out ? "north_east" : "south_west"} className="text-[16px]" />
            {out ? "− " : "+ "}{formatNumber(l.amount.replace("-", ""), lang)}
          </span>
        )}
        {l.running !== null && <span className="text-caption text-muted-foreground">{formatNumber(l.running, lang)}</span>}
      </span>
    </Row>
  );
}

function MenuItem({ icon, children, onClick, to, danger }: {
  icon: string; children: React.ReactNode; onClick?: () => void; to?: string; danger?: boolean;
}) {
  const cls = `flex min-h-12 items-center gap-2.5 rounded-md px-3 text-left ${danger ? "text-destructive" : ""}`;
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
  const rate = useRateInput(currency, base, date, side, detail.opening?.rate ? Number(detail.opening.rate).toFixed(3) : null);
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
        <LineField label="Al día" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value)} />
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
        <button type="button" disabled={hasMoney || archive.isPending}
          onClick={() => archive.mutate(undefined, { onSuccess: () => navigate("/cuentas", { replace: true }) })}
          className="flex h-14 items-center justify-center gap-2 rounded-xl bg-destructive font-semibold text-destructive-foreground disabled:opacity-50">
          <Icon name="archive" />
          Archivar cuenta
        </button>
        <button type="button" onClick={onClose} className="h-11 text-caption font-semibold text-primary-strong underline">
          Cancelar
        </button>
      </div>
    </Sheet>
  );
}
