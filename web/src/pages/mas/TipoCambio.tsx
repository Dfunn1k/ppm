// Z1 · Tipo de cambio (solo el administrador): el estado de cada moneda, los últimos días con su
// origen, cargar a mano y traer de SUNAT ahora. Manda el último que se cargó, sea de SUNAT o a mano.
import { useState } from "react";
import { Navigate } from "react-router";

import { type AdminRates, useAdminRates, useImportSunat, useMe, useSetRate } from "@/api/hooks";
import { Segmented, Sheet } from "@/components/Sheet";
import { SectionHeading } from "@/components/SectionHeading";
import { BackLink } from "@/components/PageHeader";
import { ErrorAlert, Icon, LineField, PrimaryButton, Spinner } from "@/components/ui";
import { DateField } from "@/components/DateSheet";
import { shortDate, todayISO } from "@/lib/dates";
import { rateText, symbolOf } from "@/lib/money";
import { Button } from "@/components/Button";

const NAME: Record<string, string> = { USD: "Dólar", EUR: "Euro" };
const WEEKDAY = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

function dayLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return `${WEEKDAY[new Date(y!, m! - 1, d!).getDay()]} ${shortDate(iso)}`;
}

function time(iso: string) {
  return new Date(iso).toLocaleTimeString("es-PE", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Lima" });
}

type Status = AdminRates["currencies"][number];

function caption(c: Status) {
  if (!c.last) return "Todavía no hay ninguno: cárgalo a mano.";
  const when = c.last.date === todayISO() ? "Hoy" : shortDate(c.last.date);
  const how = c.last.source === "SUNAT" ? "de SUNAT" : "a mano";
  const loaded = c.loaded_at ? `, a las ${time(c.loaded_at)}` : "";
  const who = c.currency === "USD" ? "" : ` SUNAT no publica ${NAME[c.currency]?.toLowerCase() ?? c.currency}s; ${c.users === 1 ? "1 persona lo usa" : `${c.users} personas lo usan`}.`;
  return `${when}, ${how}${loaded}.${who}`;
}

export function TipoCambio() {
  const me = useMe().data;
  const rates = useAdminRates();
  const sunat = useImportSunat();
  const [loading, setLoading] = useState(false);
  if (me && !me.is_admin) return <Navigate to="/mas" replace />;
  if (rates.isPending) return <Spinner />;
  if (rates.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{rates.error.message}</ErrorAlert></main>;
  const { currencies, history } = rates.data;
  const codes = [...new Set(["USD", ...currencies.map((c) => c.currency)])];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-8">
      <div className="-mx-2.5 flex min-h-control items-center justify-between">
        <BackLink to="/mas" label="Volver a Más" />
        <span className="pr-2.5 text-label text-muted-foreground">Solo administrador</span>
      </div>
      <h1 className="mt-4 text-title-hero">Tipo de cambio</h1>
      <p className="mt-2.5 text-muted-foreground">Lo usa todo PPM. El dólar llega solo desde SUNAT; aquí corriges un día o cargas lo que falte.</p>

      <div className="mt-4 flex flex-col gap-2">
        {currencies.map((c) => (
          <section key={c.currency} aria-label={NAME[c.currency] ?? c.currency} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5">
            <span className="flex items-center justify-between">
              <span className="flex items-baseline gap-1.5"><span className="font-semibold">{NAME[c.currency] ?? c.currency}</span><span className="text-caption text-muted-foreground">{symbolOf(c.currency)}</span></span>
              <span className={`flex h-6 items-center gap-1 rounded-full px-2 text-caption-sm leading-4 font-semibold ${c.stale ? "bg-attention-soft text-attention" : "bg-muted text-income"}`}>
                <Icon name={c.stale ? "schedule" : "check_circle"} size="sm" />
                {c.stale ? (c.days == null ? "Sin tipo" : `Hace ${c.days} días`) : "Al día"}
              </span>
            </span>
            {c.last && (
              <span className="grid grid-cols-2 tabular-nums">
                <span className="flex flex-col"><span className="text-caption text-muted-foreground">Compra</span><span className="text-amount-xl">{rateText(c.last.buy)}</span></span>
                <span className="flex flex-col"><span className="text-caption text-muted-foreground">Venta</span><span className="text-amount-xl">{rateText(c.last.sell)}</span></span>
              </span>
            )}
            <span className="text-caption text-muted-foreground">{caption(c)}</span>
          </section>
        ))}
      </div>

      {codes.filter((code) => history.some((h) => h.currency === code)).map((code) => (
        <section key={code} aria-label={`Últimos días del ${(NAME[code] ?? code).toLowerCase()}`} className="mt-5 flex flex-col">
          <SectionHeading>Últimos días del {(NAME[code] ?? code).toLowerCase()}</SectionHeading>
          {history.filter((h) => h.currency === code).map((h) => (
            <div key={h.date} className="grid min-h-control grid-cols-rates items-center gap-2 border-b border-border tabular-nums">
              <span>{dayLabel(h.date)}</span>
              <span className="text-right">{rateText(h.buy)}</span>
              <span className="text-right">{rateText(h.sell)}</span>
              <span className="justify-self-end text-caption-sm leading-4 font-semibold text-muted-foreground">{h.source === "SUNAT" ? "SUNAT" : "A mano"}</span>
            </div>
          ))}
        </section>
      ))}

      <div className="min-h-6 flex-1" />
      <div className="flex flex-col gap-2">
        {sunat.error && <ErrorAlert>{sunat.error.message}</ErrorAlert>}
        {sunat.data && (
          <div role="status" className="flex flex-col gap-2 rounded-md bg-muted p-3 text-caption">
            <span className="flex items-center gap-2"><Icon name="check_circle" fill className="text-income" />SUNAT del {shortDate(sunat.data.date)}</span>
            {/* Compra y venta en grande, cada una en su casilla, como la pizarra de una casa de cambio (caso 7) */}
            <span className="grid grid-cols-2 gap-2">
              {([["Compra", sunat.data.buy], ["Venta", sunat.data.sell]] as const).map(([k, v]) => (
                <span key={k} className="flex flex-col rounded-md border border-border bg-card px-3 py-1.5">
                  <span className="text-label text-muted-foreground uppercase">{k}</span>
                  <span className="font-display text-amount-xl font-bold tabular-nums">{rateText(v)}</span>
                </span>
              ))}
            </span>
          </div>
        )}
        <PrimaryButton type="button" onClick={() => setLoading(true)}>Cargar a mano</PrimaryButton>
        <Button variant="secondary" start="sync" pending={sunat.isPending} onClick={() => sunat.mutate()}>Traer de SUNAT ahora</Button>
      </div>

      <ManualSheet open={loading} onClose={() => setLoading(false)} codes={codes} />
    </main>
  );
}

function ManualSheet({ open, onClose, codes }: { open: boolean; onClose: () => void; codes: string[] }) {
  const save = useSetRate();
  const [currency, setCurrency] = useState(codes[0] ?? "USD");
  const [date, setDate] = useState(todayISO());
  const [buy, setBuy] = useState("");
  const [sell, setSell] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const valid = (v: string) => /^\d{1,6}(\.\d{1,4})?$/.test(v.trim()) && Number(v) > 0;
  return (
    <Sheet title="Cargar un tipo de cambio" open={open} onClose={onClose}>
      <form noValidate className="flex flex-col gap-4 px-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (!valid(buy) || !valid(sell)) return setProblem("Escribe la compra y la venta, como 3.443");
          if (Number(sell) < Number(buy)) return setProblem("La venta no puede ser menor que la compra");
          setProblem(null);
          save.mutate({ currency, date, buy: buy.trim(), sell: sell.trim() }, {
            onSuccess: () => { setBuy(""); setSell(""); onClose(); },
          });
        }}>
        {codes.length > 1 && (
          <Segmented label="Moneda" value={currency} onChange={setCurrency}
            options={codes.map((c) => ({ value: c, label: NAME[c] ?? c }))} />
        )}
        <DateField label="Día" max={todayISO()} value={date} onChange={setDate} />
        <div className="grid grid-cols-2 gap-4">
          <LineField label="Compra" inputMode="decimal" value={buy} onChange={(e) => setBuy(e.target.value)} />
          <LineField label="Venta" inputMode="decimal" value={sell} onChange={(e) => setSell(e.target.value)} />
        </div>
        <p className="text-caption text-muted-foreground">
          Soles por cada {symbolOf(currency)} 1. La venta no puede ser menor que la compra. Si ese día ya tiene uno, este lo reemplaza.
        </p>
        {(problem || save.error) && <ErrorAlert>{problem ?? save.error?.message}</ErrorAlert>}
        <PrimaryButton pending={save.isPending}>Guardar tipo de cambio</PrimaryButton>
      </form>
    </Sheet>
  );
}
