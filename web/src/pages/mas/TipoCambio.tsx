// Z1 · Tipo de cambio (solo el administrador): el estado de cada moneda, los últimos días con su
// origen, cargar a mano y traer de SUNAT ahora. Manda el último que se cargó, sea de SUNAT o a mano.
import { useState } from "react";
import { Link, Navigate } from "react-router";

import { type AdminRates, useAdminRates, useImportSunat, useMe, useSetRate } from "@/api/hooks";
import { Segmented, Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon, LineField, PrimaryButton, Spinner } from "@/components/ui";
import { shortDate, todayISO } from "@/lib/dates";
import { rateText, symbolOf } from "@/lib/money";

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
  const how = c.last.source === "SUNAT" ? "SUNAT" : "a mano";
  const loaded = c.loaded_at ? ` Cargado a las ${time(c.loaded_at)}.` : "";
  const who = c.currency === "USD" ? "" : ` SUNAT no publica ${NAME[c.currency]?.toLowerCase() ?? c.currency}s; ${c.users === 1 ? "1 persona lo usa" : `${c.users} personas lo usan`}.`;
  return `${when} · ${how}.${loaded}${who}`;
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
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/mas" aria-label="Volver a Más" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
        <span className="pr-2.5 text-label text-muted-foreground">Tipo de cambio · administrador</span>
      </div>
      <h1 className="mt-4 text-title-hero">Tipo de cambio.</h1>
      <p className="mt-2.5 text-muted-foreground">Lo usa todo PPM. El dólar llega solo desde SUNAT; aquí corriges un día o cargas lo que falte.</p>

      <div className="mt-4 flex flex-col gap-2">
        {currencies.map((c) => (
          <section key={c.currency} aria-label={NAME[c.currency] ?? c.currency} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3.5">
            <span className="flex items-center justify-between">
              <span className="font-semibold">{NAME[c.currency] ?? c.currency} · {symbolOf(c.currency)}</span>
              <span className={`flex h-6 items-center gap-1 rounded-full px-2 text-[12px] leading-4 font-semibold ${c.stale ? "bg-attention-soft text-attention" : "bg-muted text-income"}`}>
                <Icon name={c.stale ? "schedule" : "check_circle"} className="text-[16px]" />
                {c.stale ? (c.days == null ? "Sin tipo" : `Hace ${c.days} días`) : "Al día"}
              </span>
            </span>
            {c.last && (
              <span className="grid grid-cols-2 tabular-nums">
                <span className="flex flex-col"><span className="text-caption text-muted-foreground">Compra</span><span className="text-[22px] leading-7 font-semibold">{rateText(c.last.buy)}</span></span>
                <span className="flex flex-col"><span className="text-caption text-muted-foreground">Venta</span><span className="text-[22px] leading-7 font-semibold">{rateText(c.last.sell)}</span></span>
              </span>
            )}
            <span className="text-caption text-muted-foreground">{caption(c)}</span>
          </section>
        ))}
      </div>

      {codes.filter((code) => history.some((h) => h.currency === code)).map((code) => (
        <section key={code} aria-label={`Últimos días · ${NAME[code] ?? code}`} className="mt-5 flex flex-col">
          <span className="border-b border-border pb-1 text-label text-muted-foreground">Últimos días · {NAME[code] ?? code}</span>
          {history.filter((h) => h.currency === code).map((h) => (
            <div key={h.date} className="grid min-h-11 grid-cols-[1fr_64px_64px_76px] items-center gap-2 border-b border-border tabular-nums">
              <span>{dayLabel(h.date)}</span>
              <span className="text-right">{rateText(h.buy)}</span>
              <span className="text-right">{rateText(h.sell)}</span>
              <span className="justify-self-end text-[12px] leading-4 font-semibold text-muted-foreground">{h.source === "SUNAT" ? "SUNAT" : "A mano"}</span>
            </div>
          ))}
        </section>
      ))}

      <div className="min-h-6 flex-1" />
      <div className="flex flex-col gap-2">
        {sunat.error && <ErrorAlert>{sunat.error.message}</ErrorAlert>}
        {sunat.data && (
          <div role="status" className="flex items-start gap-2 rounded-md bg-muted p-3 text-caption">
            <Icon name="check_circle" fill className="text-income" />
            <span>SUNAT: {shortDate(sunat.data.date)} · compra {rateText(sunat.data.buy)} · venta {rateText(sunat.data.sell)}.</span>
          </div>
        )}
        <PrimaryButton type="button" onClick={() => setLoading(true)}>Cargar a mano</PrimaryButton>
        <button type="button" disabled={sunat.isPending} onClick={() => sunat.mutate()}
          className="flex h-12 items-center justify-center gap-1.5 rounded-xl border border-input-line font-semibold">
          <Icon name="sync" className={sunat.isPending ? "animate-spin" : ""} />Traer de SUNAT ahora
        </button>
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
        <LineField label="Día" type="date" max={todayISO()} value={date} onChange={(e) => setDate(e.target.value || todayISO())} />
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
