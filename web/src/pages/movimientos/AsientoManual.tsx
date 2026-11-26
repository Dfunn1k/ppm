// R1 · Asiento manual (avanzado), para casos raros: eliges las cuentas y los montos. Nunca dice Debe
// ni Haber: «Entra a» y «Sale de». Lo que entra tiene que ser igual a lo que sale, y hasta que no
// cuadre no se puede guardar. Va en moneda base.
import { useState } from "react";
import { useNavigate } from "react-router";

import { type ManualAccount, type MoveDetail, useManualAccounts, useMe, usePartners, useSaveMove } from "@/api/hooks";
import { MasHeader } from "@/components/MasTipos";
import { OptionList, Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon, Optional, PrimaryButton, Spinner } from "@/components/ui";
import { DateSheet, dateLabel } from "@/components/DateSheet";
import { todayISO } from "@/lib/dates";
import { formatAmount, formatNumber, parseAmount, symbolOf } from "@/lib/money";
import { useBack } from "@/lib/transitions";

type Line = { account: ManualAccount | null; partner: number | null; debit: string; credit: string };
const TYPE: Record<ManualAccount["type"], string> = {
  asset: "Lo que tengo", liability: "Lo que debo", expense: "Gastos", income: "Ingresos", equity: "Patrimonio",
};
const NAME: Record<string, string> = { receivable: "Me deben", payable: "Debo a personas", custody: "Plata que guardo de otros" };

export function AsientoManual({ editing }: { editing?: MoveDetail }) {
  const navigate = useNavigate();
  const back = useBack();
  const me = useMe().data;
  const all = useManualAccounts().data;
  const partners = usePartners().data ?? [];
  const save = useSaveMove(editing?.summary.id);
  const lang = me?.lang ?? "es-PE";
  const fmt = (v: string) => (Number(v) ? formatNumber(v, lang) : "");
  const [lines, setLines] = useState<Line[] | null>(null);
  const [date, setDate] = useState(editing?.summary.date ?? todayISO());
  const [dateOpen, setDateOpen] = useState(false);
  const [note, setNote] = useState(editing?.summary.ref ?? "");
  const [pickAccount, setPickAccount] = useState<number | null>(null);
  const [pickPartner, setPickPartner] = useState<number | null>(null);
  if (!me?.currency || !all) return <Spinner />;

  const rows: Line[] = lines ?? (editing
    ? editing.lines.map((l) => ({ account: all.find((a) => a.id === l.account_id) ?? null, partner: l.partner_id, debit: fmt(l.debit), credit: fmt(l.credit) }))
    : [{ account: null, partner: null, debit: "", credit: "" }, { account: null, partner: null, debit: "", credit: "" }]);
  const set = (i: number, patch: Partial<Line>) => setLines(rows.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const cents = (v: string) => Math.round(Number(parseAmount(v || "0", lang) ?? "NaN") * 100);
  const inn = rows.reduce((s, l) => s + cents(l.debit), 0);
  const out = rows.reduce((s, l) => s + cents(l.credit), 0);
  const money = (c: number) => formatAmount((Math.abs(c) / 100).toFixed(2), symbolOf(me.currency), lang);
  const bad = Number.isNaN(inn) || Number.isNaN(out);
  const balanced = !bad && inn === out && inn > 0;
  const label = (a: ManualAccount) => (a.role && NAME[a.role]) || a.name;
  const groups = (Object.keys(TYPE) as ManualAccount["type"][]).map((t) => [t, all.filter((a) => a.type === t)] as const).filter(([, l]) => l.length);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!balanced) return;
    save.mutate({
      kind: "manual", date, ref: note.trim() || null, pending: false, later: false, splits: [],
      lines: rows.filter((l) => l.account).map((l) => ({
        account_id: l.account!.id, partner_id: l.partner,
        debit: parseAmount(l.debit || "0", lang) ?? "0", credit: parseAmount(l.credit || "0", lang) ?? "0",
      })),
    }, { onSuccess: (d) => navigate(editing ? `/movimientos/${d.summary.id}` : "/movimientos", { replace: true }) });
  };

  const cell = "h-9 w-full min-w-0 border-0 bg-transparent p-0 text-right font-semibold tabular-nums";
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-6">
      <div className="-mx-2.5 flex items-center justify-between">
        <button type="button" aria-label="Cerrar sin guardar" onClick={back} className="grid size-11 place-items-center rounded-full">
          <Icon name="close" className="text-[24px]" />
        </button>
        <span className="pr-2.5 text-label text-muted-foreground">{editing ? "Editar movimiento" : "Nuevo movimiento"}</span>
      </div>
      <form noValidate onSubmit={submit} className="flex flex-1 flex-col">
        <MasHeader kind="manual" locked={!!editing} />
        <p className="mt-3 text-caption text-muted-foreground">
          Para casos raros. Elige las cuentas y los montos: lo que entra tiene que ser igual a lo que sale. Va en {symbolOf(me.currency)}.
        </p>

        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_84px_84px] gap-2 border-b border-border pb-1 text-label text-muted-foreground">
          <span>Cuenta</span><span className="text-right">Entra a</span><span className="text-right">Sale de</span>
        </div>
        {rows.map((l, i) => (
          <div key={i} className="grid min-h-[60px] grid-cols-[minmax(0,1fr)_84px_84px] items-center gap-2 border-b border-border">
            <span className="flex min-w-0 flex-col items-start gap-0.5">
              <button type="button" onClick={() => setPickAccount(i)} className="flex max-w-full items-center gap-0.5 text-left font-semibold">
                <span className="truncate">{l.account ? label(l.account) : "Elige la cuenta"}</span>
                <Icon name="expand_more" className="text-[18px] text-muted-foreground" />
              </button>
              {l.account?.partner_required && (
                <button type="button" onClick={() => setPickPartner(i)}
                  className="flex h-[26px] items-center gap-1 rounded-full border border-border px-2 text-[12px] leading-4 font-semibold">
                  <Icon name="person" className="text-[16px]" />
                  {partners.find((p) => p.id === l.partner)?.name.split(" ")[0] ?? "¿Con quién?"}
                </button>
              )}
            </span>
            <span className="flex border-b-2 border-input-line">
              <input inputMode="decimal" aria-label={`Entra a ${l.account?.name ?? `la línea ${i + 1}`}`} value={l.debit} placeholder="0.00"
                onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })} className={cell} />
            </span>
            <span className="flex border-b-2 border-input-line">
              <input inputMode="decimal" aria-label={`Sale de ${l.account?.name ?? `la línea ${i + 1}`}`} value={l.credit} placeholder="0.00"
                onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })} className={cell} />
            </span>
          </div>
        ))}
        <div className="grid min-h-11 grid-cols-[minmax(0,1fr)_84px_84px] items-center gap-2 tabular-nums">
          <button type="button" onClick={() => setLines([...rows, { account: null, partner: null, debit: "", credit: "" }])}
            className="flex items-center gap-1 justify-self-start text-[14px] font-semibold text-primary-strong">
            <Icon name="add" />Otra línea
          </button>
          <span className="text-right font-semibold">{bad ? "—" : (inn / 100).toFixed(2)}</span>
          <span className="text-right font-semibold">{bad ? "—" : (out / 100).toFixed(2)}</span>
        </div>
        {balanced ? (
          <span className="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground"><Icon name="check" className="text-[18px]" />Cuadra: entran y salen {money(inn)}.</span>
        ) : !bad && inn + out > 0 && (
          <div role="status" className="mt-1 flex items-start gap-2 rounded-md bg-attention-soft p-3 text-caption text-attention">
            <Icon name="balance" /><span>Falta {money(inn - out)} en «{inn < out ? "Entra a" : "Sale de"}» para que cuadre.</span>
          </div>
        )}

        <div className="mt-2 grid min-h-[52px] grid-cols-[auto_1fr] items-center gap-3 border-b border-border">
          <button type="button" aria-expanded={dateOpen} onClick={() => setDateOpen(!dateOpen)}
            className="flex h-9 items-center gap-1 rounded-full border border-border px-3 text-caption font-semibold">
            <Icon name="event" className="text-[18px]" />{dateLabel(date)}
          </button>
          <span className="flex min-w-0 items-center gap-2"><input aria-label="Nota" placeholder="Nota" value={note} maxLength={120} onChange={(e) => setNote(e.target.value)}
            className="h-10 min-w-0 flex-1 border-0 bg-transparent p-0" /><Optional /></span>
        </div>
        <DateSheet open={dateOpen} onClose={() => setDateOpen(false)} title="¿Cuándo fue?" value={date} onChange={setDate} max={todayISO()} booked />

        <div className="min-h-4 flex-1" />
        <div className="flex flex-col gap-3">
          {save.error && <ErrorAlert>{save.error.message}</ErrorAlert>}
          <PrimaryButton pending={save.isPending} disabled={!balanced}>{editing ? "Guardar cambios" : "Registrar movimiento"}</PrimaryButton>
        </div>
      </form>

      <Sheet title="¿Qué cuenta?" open={pickAccount !== null} onClose={() => setPickAccount(null)}>
        {groups.map(([t, list]) => (
          <div key={t} className="flex flex-col">
            <span className="mx-3 mt-3 mb-0.5 text-label text-muted-foreground">{TYPE[t]}</span>
            <OptionList value={String(rows[pickAccount ?? 0]?.account?.id ?? "")} options={list.map((a) => ({ value: String(a.id), label: label(a) }))}
              onPick={(v) => { set(pickAccount!, { account: all.find((a) => String(a.id) === v) ?? null, partner: null }); setPickAccount(null); }} />
          </div>
        ))}
      </Sheet>
      <Sheet title="¿Con quién?" open={pickPartner !== null} onClose={() => setPickPartner(null)}>
        <OptionList value={String(rows[pickPartner ?? 0]?.partner ?? "")} options={partners.map((p) => ({ value: String(p.id), label: p.name }))}
          onPick={(v) => { set(pickPartner!, { partner: Number(v) }); setPickPartner(null); }} />
      </Sheet>
    </main>
  );
}
