// X2 · Personas: cuánto te deben, cuánto debes y cuánto guardas; desde cuándo te deben, por tramos de
// antigüedad (tocar un tramo filtra la lista), y quién te debe y a quién le debes, de lo más antiguo
// a lo más nuevo. Lo vencido sale en ámbar.
import { useState } from "react";
import { Link } from "react-router";

import { usePeopleReport } from "@/api/hooks";
import { Avatar } from "@/components/MoveBits";
import { ErrorAlert, Icon, Spinner } from "@/components/ui";
import { shortDate } from "@/lib/dates";

import { ReportHeader, useMoney } from "./common";

const TRAMOS = [
  { label: "0–30 días", from: 0, to: 30 },
  { label: "31–60", from: 31, to: 60 },
  { label: "61–90", from: 61, to: 90 },
  { label: "+90", from: 91, to: Infinity },
];

export function ReportePersonas() {
  const report = usePeopleReport();
  const money = useMoney();
  const [tramo, setTramo] = useState<number | null>(null);

  if (report.isPending) return <Spinner />;
  if (report.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{report.error.message}</ErrorAlert></main>;
  const r = report.data;
  const total = r.ages.reduce((a, v) => a + Number(v), 0);
  const t = tramo === null ? null : TRAMOS[tramo]!;
  const debtors = r.debtors.filter((d) => !t || (d.oldest_days >= t.from && d.oldest_days <= t.to));
  const pick = (i: number) => setTramo((x) => (x === i ? null : i));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-10">
      <ReportHeader title="Personas" />

      <div className="mt-4 grid grid-cols-3 gap-2">
        {[["Me deben", r.owes_me, "me-deben"], ["Debo", r.i_owe, "debo"], ["Guardo", r.keep, "guardo"]].map(([label, amount, ver]) => (
          <Link key={label} to={`/personas?ver=${ver}`} className="flex flex-col gap-0.5 rounded-lg border border-border bg-card p-3">
            <span className="text-caption text-muted-foreground">{label}</span>
            <span className="text-[17px] leading-6 font-semibold tabular-nums">{money(amount!)}</span>
          </Link>
        ))}
      </div>

      <section aria-label="Desde cuándo te deben" className="mt-6 flex flex-col gap-2">
        <span className="border-b border-border pb-1 text-label text-muted-foreground">Desde cuándo te deben</span>
        {total > 0 ? (
          <div className="flex h-7 gap-0.5" role="img"
            aria-label={`Lo que te deben por antigüedad: ${TRAMOS.map((x, i) => `${x.label} ${money(r.ages[i]!)}`).join(", ")}`}>
            {r.ages.map((v, i) => Number(v) > 0 && (
              <button key={i} type="button" aria-label={`${TRAMOS[i]!.label}: ${money(v)}`} onClick={() => pick(i)}
                className="h-full rounded-[4px]" style={{ flex: Number(v), background: `var(--age-${i})`, opacity: tramo === null || tramo === i ? 1 : 0.35 }} />
            ))}
          </div>
        ) : <span className="text-caption text-muted-foreground">Nadie te debe.</span>}
        <div role="group" aria-label="Tramos" className="grid grid-cols-4 gap-1.5">
          {TRAMOS.map((x, i) => (
            <button key={x.label} type="button" aria-pressed={tramo === i} onClick={() => pick(i)}
              className={`flex flex-col items-start gap-0.5 rounded-[10px] border p-2 text-left ${tramo === i ? "border-foreground" : "border-border"}`}>
              <span className="flex items-center gap-1.5 text-[12px] leading-4 text-muted-foreground">
                <span aria-hidden="true" className="size-2.5 rounded-[3px]" style={{ background: `var(--age-${i})` }} />{x.label}
              </span>
              <span className="text-[14px] leading-5 font-semibold tabular-nums">{money(r.ages[i]!)}</span>
            </button>
          ))}
        </div>
        <span className="text-caption text-muted-foreground">Cuenta desde el día del préstamo o del gasto. Lo que ya venció sale marcado en la lista.</span>
      </section>

      <section aria-label="Quién te debe" className="mt-6 flex flex-col">
        <div className="flex justify-between border-b border-border pb-1 text-label text-muted-foreground">
          <span>{t ? `Te deben · ${t.label}` : "Quién te debe"}</span><span>Lo más antiguo</span>
        </div>
        {debtors.map((d) => (
          <Link key={d.partner_id} to={`/personas/${d.partner_id}`} className="flex min-h-[68px] items-center gap-3 border-b border-border">
            <Avatar name={d.name} size={40} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">{d.name}</span>
              <span className={`flex items-center gap-1 text-caption ${d.overdue ? "font-semibold text-attention" : "text-muted-foreground"}`}>
                <Icon name={d.overdue ? "event_busy" : "event"} className="text-[16px]" />
                {d.overdue ? "Tiene algo vencido" : d.next_due ? `Lo próximo vence el ${shortDate(d.next_due)}` : "Sin fecha de vencimiento"}
              </span>
            </span>
            <span className="flex flex-col items-end tabular-nums">
              <span className="font-medium">{money(d.amount)}</span>
              <span className="text-caption text-muted-foreground">hace {d.oldest_days} {d.oldest_days === 1 ? "día" : "días"}</span>
            </span>
          </Link>
        ))}
        {debtors.length === 0 && <span className="py-3 text-caption text-muted-foreground">{t ? "Nadie en este tramo." : "Nadie te debe."}</span>}
      </section>

      {r.creditors.length > 0 && (
        <section aria-label="A quién le debes" className="mt-6 flex flex-col">
          <span className="border-b border-border pb-1 text-label text-muted-foreground">A quién le debes</span>
          {r.creditors.map((c) => (
            <Link key={c.partner_id} to={`/personas/${c.partner_id}`} className="flex min-h-16 items-center gap-3 border-b border-border">
              <Avatar name={c.name} size={40} />
              <span className="min-w-0 flex-1 truncate font-semibold">{c.name}</span>
              <span className="flex flex-col items-end tabular-nums">
                <span className="font-medium">{money(c.amount)}</span>
                <span className="text-caption text-muted-foreground">hace {c.oldest_days} {c.oldest_days === 1 ? "día" : "días"}</span>
              </span>
            </Link>
          ))}
        </section>
      )}
    </main>
  );
}
