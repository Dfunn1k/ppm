// X5 · Monedas y formato: la moneda principal (fija: todo el historial está en ella), las demás que usas
// (se agregan del catálogo ISO 4217 y se quitan si ninguna cuenta ni movimiento las usa) y el formato de
// números y fechas, cada uno con su ejemplo.
import { useState } from "react";
import { Link } from "react-router";

import { type MyCurrency, useCatalog, useMe, useMyCurrencies, useToggleCurrency, useUpdateMe } from "@/api/hooks";
import { Sheet } from "@/components/Sheet";
import { DetailSkeleton } from "@/components/Skeleton";
import { ErrorAlert, Icon } from "@/components/ui";
import { formatAmount, symbolOf } from "@/lib/money";

/** «14/11/2026»: los dos formatos de hoy escriben la fecha igual (res_lang.date_format). */
function sampleDate() {
  return new Date().toLocaleDateString("en-GB", { timeZone: "America/Lima" });
}

function rateCaption(c: MyCurrency) {
  if (c.rate === "SUNAT") return "tipo de cambio de SUNAT, cada día";
  if (c.rate === "manual") return "tipo de cambio a mano";
  return null;
}

function Badge({ symbol }: { symbol: string }) {
  return (
    <span className="grid h-9 min-w-11 flex-none place-items-center rounded-[10px] bg-secondary px-1.5 text-[14px] font-bold text-secondary-foreground">
      {symbol}
    </span>
  );
}

export function Monedas() {
  const me = useMe().data;
  const mine = useMyCurrencies();
  const catalog = useCatalog().data;
  const toggle = useToggleCurrency();
  const update = useUpdateMe();
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState("");

  if (!me || mine.isPending) return <DetailSkeleton back="/mas" />;
  if (mine.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{mine.error.message}</ErrorAlert></main>;
  const list = mine.data;
  const base = list.find((c) => c.base);
  const others = list.filter((c) => !c.base);
  const have = new Set(list.map((c) => c.code));
  const needle = q.trim().toLowerCase();
  const candidates = (catalog?.currencies ?? []).filter((c) => !have.has(c.code)
    && (!needle || c.code.toLowerCase().includes(needle) || c.name.toLowerCase().normalize("NFD").replace(/\p{M}/gu, "")
      .includes(needle.normalize("NFD").replace(/\p{M}/gu, ""))));
  // El formato de tu país primero
  const langs = [...(catalog?.langs ?? [])].sort((a, b) => Number(b.code.endsWith(`-${me.country}`)) - Number(a.code.endsWith(`-${me.country}`)));

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-8">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/mas" aria-label="Volver a Más" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
      </div>
      <h1 className="mt-4 text-title-hero">Monedas y formato</h1>
      {toggle.isError && <div className="mt-4"><ErrorAlert>{toggle.error.message}</ErrorAlert></div>}

      {base && (
        <section aria-label="Moneda principal" className="mt-5 flex flex-col">
          <span className="border-b border-border pb-1 text-label text-muted-foreground">Moneda principal</span>
          <div className="flex min-h-[62px] items-center gap-3 border-b border-border py-2">
            <Badge symbol={base.symbol} />
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="font-semibold">{base.name}</span>
              <span className="text-caption text-muted-foreground">Con ella se ven tus totales. No se cambia: todo tu historial está en ella.</span>
            </span>
            <Icon name="lock" className="text-[20px] text-muted-foreground" />
          </div>
        </section>
      )}

      <section aria-label="Otras monedas" className="mt-6 flex flex-col">
        <span className="border-b border-border pb-1 text-label text-muted-foreground">Otras monedas</span>
        {others.length === 0 && <span className="py-3 text-caption text-muted-foreground">Solo usas {base?.name.toLowerCase() ?? "tu moneda"}.</span>}
        {others.map((c) => {
          const rate = rateCaption(c);
          const used = c.accounts.length > 0;
          return (
            <div key={c.code} className="flex min-h-[62px] items-center gap-3 border-b border-border py-2">
              <Badge symbol={c.symbol} />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{c.name}</span>
                <span className={`text-caption ${rate ? "text-muted-foreground" : "text-attention"}`}>
                  {used ? `En uso: ${c.accounts.join(", ")}` : "Sin cuentas todavía"}
                  {" · "}
                  {rate ?? (me.is_admin
                    ? <>sin tipo de cambio todavía: cárgalo en <Link to="/mas/tipo-de-cambio" className="underline">Más › Tipo de cambio</Link></>
                    : "sin tipo de cambio todavía: el administrador lo carga")}
                </span>
              </span>
              {!used && (
                <button type="button" disabled={toggle.isPending} onClick={() => toggle.mutate({ code: c.code, add: false })}
                  aria-label={`Quitar ${c.name}`}
                  className="h-9 flex-none rounded-full border border-border px-3 text-caption font-semibold disabled:opacity-60">
                  Quitar
                </button>
              )}
            </div>
          );
        })}
        <button type="button" aria-haspopup="dialog" onClick={() => { setQ(""); setAdding(true); }}
          className="flex min-h-12 items-center gap-1.5 font-semibold">
          <Icon name="add" />Agregar moneda
        </button>
      </section>

      <section aria-label="Formato de números y fechas" className="mt-4 flex flex-col">
        <span className="border-b border-border pb-1 text-label text-muted-foreground">Formato de números y fechas</span>
        <div role="radiogroup" aria-label="Formato de números y fechas" className="mt-2 flex flex-col gap-1">
          {langs.map((l) => {
            const on = me.lang === l.code;
            const country = /\((.+)\)/.exec(l.name)?.[1] ?? l.name;
            return (
              <button key={l.code} type="button" role="radio" aria-checked={on} onClick={() => !on && update.mutate({ lang: l.code })}
                className={`flex min-h-[60px] items-center gap-3 rounded-md px-3 text-left ${on ? "bg-muted" : ""}`}>
                <span className="flex flex-1 flex-col">
                  <span className="font-semibold">{country}</span>
                  <span className="text-caption text-muted-foreground tabular-nums">
                    {formatAmount("1284.90", symbolOf(me.currency), l.code)} · {sampleDate()}
                  </span>
                </span>
                {on ? <Icon name="check_circle" fill className="text-[22px]" /> : <span aria-hidden="true" className="size-5 rounded-full border-2 border-input-line" />}
              </button>
            );
          })}
        </div>
        <span className="mt-2.5 text-caption text-muted-foreground">Idioma: español. Lo que escribes en los montos sigue el formato elegido.</span>
      </section>

      <Sheet title="Agregar moneda" open={adding} onClose={() => setAdding(false)}>
        <label className="mx-3 mb-2 flex h-11 items-center gap-2 rounded-md bg-muted px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
          <Icon name="search" className="text-muted-foreground" />
          <input aria-label="Buscar moneda" placeholder="Buscar por nombre o código (EUR)" value={q} onChange={(e) => setQ(e.target.value)}
            className="min-w-0 flex-1 border-0 bg-transparent focus:outline-none" />
        </label>
        <div className="flex flex-col">
          {candidates.map((c) => (
            <button key={c.code} type="button" disabled={toggle.isPending}
              onClick={() => toggle.mutate({ code: c.code, add: true }, { onSuccess: () => setAdding(false) })}
              className="flex min-h-14 items-center gap-3 rounded-md px-3 text-left">
              <span className="min-w-11 text-[14px] font-bold tabular-nums">{c.code}</span>
              <span className="flex flex-1 flex-col">
                <span className="font-semibold">{c.name}</span>
                {c.decimals === 0 && <span className="text-caption text-muted-foreground">Sin decimales</span>}
              </span>
            </button>
          ))}
          {candidates.length === 0 && <span className="px-3 py-3 text-caption text-muted-foreground">Ninguna moneda se llama así.</span>}
        </div>
        <span className="mx-3 mt-2 text-caption text-muted-foreground">
          SUNAT solo publica el dólar: el tipo de cambio de las demás se carga a mano en Más › Tipo de cambio.
        </span>
      </Sheet>
    </main>
  );
}
