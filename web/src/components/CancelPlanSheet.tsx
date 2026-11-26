// M2 · Cancelar las cuotas que faltan de una compra tuya: «Lo devolví» (la tarjeta baja por lo que
// faltaba y no queda gasto) o «Pagué lo que faltaba» (lo que cobró el banco es gasto de la categoría
// ese día, el interés que te ahorraste baja de la tarjeta y, si eliges la cuenta, se registra el pago).
// Las cuotas ya facturadas no cambian.
import { useState } from "react";

import { type MoveDetail, useAccounts, useCancelPlan, useMe } from "@/api/hooks";
import { addDays, DateField } from "@/components/DateSheet";
import { Sheet, SheetSelect } from "@/components/Sheet";
import { ErrorAlert, Facts, PrimaryButton } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { formatAmount, formatNumber, parseAmount, subtract, symbolOf } from "@/lib/money";

type Plan = NonNullable<MoveDetail["plan"]>;

export function CancelPlanSheet({ plan, open, onClose }: { plan: Plan; title: string; open: boolean; onClose: () => void }) {
  const me = useMe().data;
  const overview = useAccounts().data;
  const cancel = useCancelPlan(plan.plan_id ?? 0);
  const lang = me?.lang ?? "es-PE";
  const cur = plan.currency;
  const money = (v: string) => formatAmount(v, symbolOf(cur), lang);
  const left = plan.lines.filter((x) => !x.billed && !x.canceled);
  const billed = plan.lines.filter((x) => x.billed);
  // No antes del último corte facturado ni dentro del periodo cerrado
  const afterLock = me?.lock_date ? addDays(1, me.lock_date) : undefined;
  const lastBilled = billed.at(-1)?.closing_date;
  const minDate = [lastBilled, afterLock].filter((x): x is string => !!x).sort().at(-1);

  const [kind, setKind] = useState<"returned" | "prepaid">("returned");
  const [date, setDate] = useState(todayISO());
  const [typed, setTyped] = useState<string | null>(null);
  const [accountId, setAccountId] = useState<string | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  // El banco suele cobrar el capital que falta; se propone lo que faltaba facturar y se corrige
  const charged = parseAmount(typed ?? formatNumber(plan.remaining, lang), lang);
  const saved = charged ? subtract(plan.remaining, charged) : null;
  const sources = (overview?.have ?? []).filter((a) => ["cash", "bank"].includes(a.kind) && a.currency === cur)
    .sort((x, y) => Number(x.kind !== "bank") - Number(y.kind !== "bank"));
  const source = accountId ?? (sources[0] ? String(sources[0].id) : "later");

  const result = kind === "returned"
    ? [["La tarjeta baja", money(plan.remaining)], ["Cuotas por venir", money("0.00")], ["Gasto tuyo", "Ninguno"]]
    : [
        [`Gasto en ${plan.category ?? "su categoría"} ese día`, charged ? money(charged) : "—"],
        ["Interés que te ahorraste", saved && Number(saved) >= 0 ? money(saved) : "—"],
        ...(source !== "later" && charged
          ? [[`Pago de la tarjeta desde ${sources.find((a) => String(a.id) === source)?.name ?? ""}`, money(charged)]]
          : []),
      ];

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (kind === "prepaid") {
      if (!charged || Number(charged) <= 0) return setProblem("Escribe lo que te cobró el banco");
      if (Number(charged) > Number(plan.remaining)) return setProblem(`No puede pasar de lo que faltaba: ${money(plan.remaining)}`);
    }
    cancel.mutate(
      kind === "returned"
        ? { kind, date }
        : { kind, date, charged, account_id: source === "later" ? null : Number(source) },
      { onSuccess: onClose },
    );
  };

  return (
    <Sheet title="Cancelar las cuotas que faltan" open={open} onClose={onClose}>
      <form onSubmit={submit} className="flex flex-col gap-4 px-3">
        <Facts items={[["Faltan", `${left.length} de ${plan.n_installments} cuotas`], ["Suman", money(plan.remaining)]]} />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-label text-muted-foreground">¿Qué pasó?</legend>
          {([
            ["returned", "Lo devolví", "La tienda anuló la compra: lo que faltaba ya no se paga"],
            ["prepaid", "Pagué lo que faltaba", "Lo terminaste de pagar antes: te quedas con él"],
          ] as const).map(([value, label, hint]) => (
            <label key={value}
              className={`flex min-h-16 cursor-pointer items-center gap-3 rounded-lg px-3.5 py-3 ${kind === value ? "border-2 border-primary" : "border border-border"}`}>
              <input type="radio" name="salida" checked={kind === value} onChange={() => setKind(value)} className="size-5 accent-primary" />
              <span className="flex flex-1 flex-col">
                <span className="font-semibold">{label}</span>
                <span className="text-caption text-muted-foreground">{hint}</span>
              </span>
            </label>
          ))}
        </fieldset>

        <div className={kind === "prepaid" ? "grid grid-cols-2 gap-3" : ""}>
          <DateField label="Fecha" value={date} onChange={setDate} max={todayISO()} min={minDate} booked
            sheetTitle={kind === "returned" ? "¿Cuándo lo devolviste?" : "¿Cuándo lo pagaste?"} />
          {kind === "prepaid" && (
            <label className="flex flex-col gap-1.5 text-caption font-semibold">
              Lo que te cobró el banco
              <span className="flex h-11 items-center gap-1.5 border-b-2 border-input-line">
                <span aria-hidden="true" className="text-muted-foreground">{symbolOf(cur)}</span>
                <input inputMode="decimal" value={typed ?? formatNumber(plan.remaining, lang)} onChange={(e) => setTyped(e.target.value)}
                  className="h-10 min-w-0 flex-1 border-0 bg-transparent p-0 text-body-lg tabular-nums" />
              </span>
            </label>
          )}
        </div>

        {kind === "prepaid" && (
          <SheetSelect label="¿De qué cuenta lo pagaste?" sheetTitle="¿De qué cuenta lo pagaste?" value={source} onChange={setAccountId}
            options={[
              ...sources.map((a) => ({ value: String(a.id), label: a.name, hint: formatAmount(a.balances[0]?.amount ?? "0.00", symbolOf(cur), lang) })),
              { value: "later", label: "Todavía no lo pago", hint: "Queda en la tarjeta: págala con «Pagar tarjeta»" },
            ]} />
        )}

        <section aria-label="Así queda" className="flex flex-col gap-1.5 rounded-lg bg-muted p-3.5">
          <span className="text-label text-muted-foreground">Así queda</span>
          {result.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-3 text-[14px] leading-5 tabular-nums">
              <span>{label}</span><span className="font-semibold whitespace-nowrap">{value}</span>
            </div>
          ))}
          {billed.length > 0 && (
            <span className="mt-0.5 text-caption text-muted-foreground">
              {billed.length === 1 ? "La cuota facturada no cambia." : `Las ${billed.length} cuotas facturadas no cambian.`}
            </span>
          )}
        </section>

        {(problem || cancel.error) && <ErrorAlert>{problem ?? cancel.error?.message}</ErrorAlert>}
        <PrimaryButton pending={cancel.isPending}>
          {kind === "returned" ? `Cancelar ${left.length === 1 ? "la cuota" : `las ${left.length} cuotas`}` : "Registrar el pago adelantado"}
        </PrimaryButton>
      </form>
    </Sheet>
  );
}
