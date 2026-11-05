// C7 · Un extracto: si el saldo cuadra con el del banco, lo que trajo (lo que sigue por clasificar,
// lo ya clasificado y lo que se enlazó con lo tuyo), el archivo original y deshacer. Deshacer borra
// solo lo que sigue por clasificar; si se vuelve a importar, lo demás se enlaza y nada se duplica.
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import { statementFileUrl, useMe, useStatement, useUndoStatement } from "@/api/hooks";
import { Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon, Spinner } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { formatAmount, isNegative, isZero, symbolOf } from "@/lib/money";
import { useBack } from "@/lib/transitions";

export function Extracto() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const back = useBack();
  const me = useMe().data;
  const st = useStatement(id);
  const undo = useUndoStatement(id);
  const [asking, setAsking] = useState(false);
  if (!me || st.isPending) return <Spinner />;
  if (st.isError) {
    return (
      <main className="mx-auto max-w-md px-6 pt-8">
        <ErrorAlert>{st.error.message}</ErrorAlert>
        <Link to="/cuentas" className="mt-4 block text-primary-strong underline">Volver a cuentas</Link>
      </main>
    );
  }
  const d = st.data;
  const s = d.statement;
  const lang = me.lang ?? "es-PE";
  const sym = symbolOf(d.currency);
  const created = new Date(s.create_date);
  const when = `${shortDate(s.create_date.slice(0, 10))} a las ${String(created.getHours()).padStart(2, "0")}:${String(created.getMinutes()).padStart(2, "0")}`;
  const check = s.difference === null
    ? null
    : isZero(s.difference)
      ? { icon: "check_circle", title: "El saldo cuadra", cls: "bg-[color-mix(in_srgb,var(--income)_12%,transparent)] text-income" }
      : { icon: "error", title: `${isNegative(s.difference) ? "Sobran" : "Faltan"} ${formatAmount(s.difference.replace("-", ""), sym, lang)}`, cls: "bg-attention-soft text-attention" };
  const groups = [
    { icon: "inbox", name: "Siguen por clasificar", help: "Entraron nuevos con este extracto", n: d.pending, to: `/por-clasificar?cuenta=${d.account_id}`, attention: true },
    { icon: "category", name: "Ya clasificados", help: "Entraron nuevos y ya tienen su lugar", n: d.classified, to: null },
    { icon: "link", name: "Enlazados con lo tuyo", help: "Ya estaban en PPM: no se duplicaron", n: d.matched, to: null },
  ];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-6">
      <div className="-mx-2.5 flex items-center justify-between">
        <button type="button" aria-label="Volver" onClick={back} className="grid size-11 place-items-center rounded-full">
          <Icon name="arrow_back" className="text-[24px]" />
        </button>
        <span className="truncate pr-2.5 text-label text-muted-foreground uppercase">{d.account}</span>
      </div>
      <h1 className="mt-2 text-title-1 break-all">{s.name}</h1>
      <span className="mt-1 text-caption text-muted-foreground">
        {s.date_from && s.date_to ? `Del ${shortDate(s.date_from)} al ${shortDate(s.date_to)} · ` : ""}importado el {when} · {s.lines === 1 ? "1 movimiento" : `${s.lines} movimientos`}
      </span>

      {check && (
        <div className={`mt-4 flex gap-2.5 rounded-lg p-3.5 ${check.cls}`}>
          <Icon name={check.icon} className="text-[22px]" />
          <span className="flex flex-col gap-0.5">
            <b>{check.title}</b>
            <span className="text-caption tabular-nums">
              Tu banco: {formatAmount(s.balance_end!, sym, lang)}{s.date_to ? ` al ${shortDate(s.date_to)}` : ""}. PPM a esa fecha: {formatAmount(d.book ?? "0", sym, lang)}.
            </span>
          </span>
        </div>
      )}

      <div className="mt-3 flex flex-col">
        {groups.map((g) => {
          const body = (
            <>
              <span className={`grid size-9 flex-none place-items-center rounded-full ${g.attention ? "bg-attention-soft text-attention" : "bg-secondary text-secondary-foreground"}`}>
                <Icon name={g.icon} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col"><span className="font-semibold">{g.name}</span><span className="text-caption text-muted-foreground">{g.help}</span></span>
              <span className="text-[18px] leading-6 font-semibold tabular-nums">{g.n}</span>
            </>
          );
          return g.to && g.n > 0
            ? <Link key={g.name} to={g.to} className="flex min-h-14 items-center gap-3 border-b border-border">{body}</Link>
            : <div key={g.name} className="flex min-h-14 items-center gap-3 border-b border-border">{body}</div>;
        })}
      </div>

      {d.has_file && (
        <a href={statementFileUrl(id)} download className="mt-3 flex h-11 items-center gap-2 text-[14px] font-semibold">
          <Icon name="download" />Descargar el archivo original
        </a>
      )}

      <div className="min-h-6 flex-1" />
      <button type="button" onClick={() => setAsking(true)}
        className="flex h-[52px] items-center justify-center gap-2 rounded-xl border border-border bg-card font-semibold text-destructive">
        <Icon name="undo" />Deshacer esta importación
      </button>

      <Sheet title="¿Deshacer la importación?" open={asking} onClose={() => setAsking(false)}>
        <div className="flex flex-col gap-3 px-3">
          <p>
            Se borran {d.pending === 1 ? <b>el movimiento que sigue por clasificar</b> : <b>los {d.pending} movimientos que siguen por clasificar</b>} y
            el extracto con su archivo.
          </p>
          {(d.classified > 0 || d.matched > 0) && (
            <p className="text-caption text-muted-foreground">
              {[d.classified > 0 && `${d.classified === 1 ? "El que ya clasificaste" : `Los ${d.classified} que ya clasificaste`}`,
                d.matched > 0 && `${d.matched === 1 ? "el que se enlazó" : `los ${d.matched} que se enlazaron`} con lo tuyo`].filter(Boolean).join(" y ")} se
              quedan. Si vuelves a importar el archivo, se enlazan otra vez y nada se duplica.
            </p>
          )}
          {undo.error && <ErrorAlert>{undo.error.message}</ErrorAlert>}
          <button type="button" disabled={undo.isPending}
            onClick={() => undo.mutate(undefined, { onSuccess: () => navigate(`/cuentas/${d.account_id}`, { replace: true }) })}
            className="mt-2 flex h-[52px] items-center justify-center gap-2 rounded-xl bg-destructive font-semibold text-destructive-foreground">
            {d.pending === 0 ? "Deshacer" : `Borrar ${d.pending} y deshacer`}
          </button>
          <button type="button" onClick={() => setAsking(false)} className="h-11 text-caption font-semibold text-primary-strong underline">Cancelar</button>
        </div>
      </Sheet>
    </main>
  );
}
