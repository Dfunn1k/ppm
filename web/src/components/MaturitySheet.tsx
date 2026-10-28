// Poner o cambiar la fecha de vencimiento de una deuda, en el calendario. En un préstamo suelto, con
// atajos («En 15 días», «Fin de mes») y «Quitar la fecha». En una parte de una compra en cuotas, vence
// con la fecha de pago de su corte; una fecha puesta a mano manda y se puede volver a la de la tarjeta.
import { useSetMaturity } from "@/api/hooks";
import { shortDate, todayISO } from "@/lib/dates";

import { DateSheet, addDays, endOfMonth } from "./DateSheet";
import { ErrorAlert, Icon } from "./ui";

export type Maturity = {
  line_id: number;
  date_maturity?: string | null;      // el que vale
  maturity_manual?: string | null;    // el puesto a mano
  maturity_closing?: string | null;   // parte de una compra en cuotas: el corte de su cuota
};

/** Qué dice el vencimiento, y si ya llegó (para pintarlo en ámbar). */
export function maturityText(m: Omit<Maturity, "line_id">): { text: string; late: boolean } | null {
  if (m.date_maturity) {
    const days = Math.round((Date.parse(m.date_maturity) - Date.parse(todayISO())) / 86_400_000);
    if (days < 0) return { text: `Vencida hace ${-days === 1 ? "1 día" : `${-days} días`} (era el ${shortDate(m.date_maturity)})`, late: true };
    if (days === 0) return { text: "Vence hoy", late: true };
    return { text: `Vence el ${shortDate(m.date_maturity)}`, late: false };
  }
  if (m.maturity_closing) return { text: `Vence con el pago del corte del ${shortDate(m.maturity_closing)}`, late: false };
  return null;
}

export function MaturitySheet({ open, onClose, item, title }: { open: boolean; onClose: () => void; item: Maturity; title: string }) {
  const set = useSetMaturity();
  const part = !!item.maturity_closing;
  const save = (date: string | null) => set.mutate({ lineId: item.line_id, date }, { onSuccess: onClose });
  return (
    <DateSheet open={open} onClose={onClose} title={title} value={item.date_maturity ?? null} onChange={(d) => save(d)}
      shortcuts={part ? [] : [{ label: "En 15 días", value: addDays(15) }, { label: "Fin de mes", value: endOfMonth() }]}>
      <div className="mx-3 mt-2 flex flex-col gap-2">
        {part && !item.maturity_manual && (
          <span className="flex gap-2 text-caption text-muted-foreground">
            <Icon name="credit_card" className="text-[18px]" />
            {item.date_maturity
              ? `Es la fecha de pago del corte del ${shortDate(item.maturity_closing!)}, la de tu tarjeta.`
              : `Toma la fecha de pago del corte del ${shortDate(item.maturity_closing!)} cuando la escribas en tu tarjeta.`}
          </span>
        )}
        {set.error && <ErrorAlert>{set.error.message}</ErrorAlert>}
        {item.maturity_manual && (
          <button type="button" disabled={set.isPending} onClick={() => save(null)}
            className="h-11 text-[14px] font-semibold underline">
            {part ? "Volver a la fecha de la tarjeta" : "Quitar la fecha"}
          </button>
        )}
      </div>
    </DateSheet>
  );
}
