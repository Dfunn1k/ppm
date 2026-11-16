// R1 · «Repartir en el tiempo»: un gasto pagado por adelantado (el seguro del año) o un ingreso cobrado
// por adelantado. Por días (cada mes según los días que cubre) o por meses (partes iguales). Debajo,
// cómo se reparte, con el mismo cálculo que hace la API.
import { DateField } from "@/components/DateSheet";
import { Icon } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { addMonths, dayBefore, type DeferralMethod, deferralSchedule } from "@/lib/deferral";
import { formatAmount } from "@/lib/money";

export type DeferralState = { on: boolean; method: DeferralMethod; start: string | null; end: string | null; months: string };
export const NO_DEFERRAL: DeferralState = { on: false, method: "days", start: null, end: null, months: "12" };

const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "setiembre", "octubre", "noviembre", "diciembre"];

/** Lo elegido, con lo que falta puesto: desde la fecha del movimiento y por un año. */
export function deferralValues(v: DeferralState, date: string) {
  const start = v.start ?? date;
  const end = v.end ?? dayBefore(addMonths(start, 12));
  const months = Number(v.months) || 0;
  return { start, end, months };
}

export function deferralBody(v: DeferralState, date: string) {
  const { start, end, months } = deferralValues(v, date);
  return v.method === "days" ? { method: v.method, start, end, months: null } : { method: v.method, start, end: null, months };
}

export function DeferralFields({ value: v, onChange, kind, date, total, symbol, lang }: {
  value: DeferralState; onChange: (v: DeferralState) => void; kind: "expense" | "income"; date: string;
  total: string | null; symbol: string; lang: string;
}) {
  const set = (patch: Partial<DeferralState>) => onChange({ ...v, ...patch });
  const { start, end, months } = deferralValues(v, date);
  const parts = total && Number(total) > 0 ? deferralSchedule(total, v.method, start, end, months) : null;
  const money = (x: string) => formatAmount(x, symbol, lang);
  const label = (p: { date: string; days: number | null }) =>
    p.days ? `${MONTHS[Number(p.date.slice(5, 7)) - 1]} ${p.date.slice(0, 4)} · ${p.days} días` : `${shortDate(p.date)} ${p.date.slice(0, 4)}`;
  const shown = parts && parts.length > 4 ? parts.slice(0, 3) : parts;

  return (
    <>
      <label className={`flex min-h-[52px] cursor-pointer items-center gap-3 ${v.on ? "" : "border-b border-border"}`}>
        <Icon name="date_range" className="w-9 text-center text-muted-foreground" />
        <span className="flex flex-1 flex-col">
          <span>Repartir en el tiempo</span>
          <span className="text-caption text-muted-foreground">
            {kind === "expense" ? "Lo pagas hoy; cuenta como gasto mes a mes" : "Entra hoy; cuenta como ingreso mes a mes"}
          </span>
        </span>
        <input type="checkbox" role="switch" checked={v.on} onChange={() => set({ on: !v.on })} className="size-[22px] accent-primary" />
      </label>
      {v.on && (
        <div className="flex flex-col gap-3 border-b border-border pb-3">
          <div role="radiogroup" aria-label="Repartir por" className="flex gap-2">
            {([["days", "Por días"], ["months", "Por meses"]] as const).map(([m, text]) => (
              <button key={m} type="button" role="radio" aria-checked={v.method === m} onClick={() => set({ method: m })}
                className={`h-9 rounded-full border px-3.5 text-caption font-semibold ${v.method === m ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                {text}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <DateField label={v.method === "days" ? "Cubre desde" : "Desde"} value={start} onChange={(x) => set({ start: x })}
              sheetTitle="¿Desde cuándo cuenta?" />
            {v.method === "days" ? (
              <DateField label="Hasta" value={end} onChange={(x) => set({ end: x })} min={start} sheetTitle="¿Hasta cuándo cubre?" />
            ) : (
              <label className="flex flex-col gap-1.5 text-caption font-semibold">
                ¿En cuántos meses?
                <input inputMode="numeric" value={v.months} onChange={(e) => set({ months: e.target.value.replace(/\D/g, "").slice(0, 2) })}
                  className="h-11 border-0 border-b-2 border-input-line bg-transparent p-0 text-[17px] font-normal tabular-nums" />
              </label>
            )}
          </div>
          <section aria-label="Así se reparte" className="flex flex-col">
            <div className="flex justify-between text-label text-muted-foreground">
              <span>Así se reparte</span>
              <span>{parts ? (v.method === "days" ? `${parts.reduce((s, p) => s + (p.days ?? 0), 0)} días · ${parts.length} partes` : `${parts.length} partes iguales`) : ""}</span>
            </div>
            {parts ? (
              <>
                {shown!.map((p) => (
                  <div key={p.date} className="flex min-h-[30px] items-center justify-between text-[14px] tabular-nums">
                    <span className="text-muted-foreground">{label(p)}</span><span className="font-medium">{money(p.amount)}</span>
                  </div>
                ))}
                {parts.length > shown!.length && (
                  <span className="min-h-[30px] text-[14px] text-muted-foreground">… y {parts.length - shown!.length} más</span>
                )}
              </>
            ) : (
              <span className="pt-1 text-caption text-muted-foreground">
                {!total ? "Escribe el monto para ver las partes." : v.method === "days" ? "Que cubra más de un mes, hasta cinco años." : "De 2 a 60 meses."}
              </span>
            )}
          </section>
          <span className="text-caption text-muted-foreground">
            {kind === "expense"
              ? "Lo que aún no usaste espera en «Pagos por adelantado» y cada parte pasa a su categoría cuando llega su fecha."
              : "Lo que aún no ganaste espera en «Cobrado por adelantado» (es algo que debes) y cada parte pasa a ingreso cuando llega su fecha."}
          </span>
        </div>
      )}
    </>
  );
}
