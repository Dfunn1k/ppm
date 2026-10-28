// M1 · Movimientos: el mes por días, con lo que entró y salió, búsqueda y filtros.
import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";

import { type MonthFilters, type MoveSummary, useAccounts, useMe, useMonth } from "@/api/hooks";
import { CategorySheet } from "@/components/CategorySheet";
import { MoveAmount, MoveIcon, moveCaption } from "@/components/MoveBits";
import { OptionList, Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { monthName, monthOptions } from "@/lib/months";
import { formatAmount, isZero, symbolOf } from "@/lib/money";

const DAYS = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];

function dayLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const day = DAYS[new Date(y!, m! - 1, d!).getDay()];
  return `${iso === todayISO() ? "HOY, " : ""}${day} ${d}`;
}

type Sheet = null | "month" | "account" | "category" | "kind";
const KIND_OPTIONS = [
  { value: "", label: "Todos" },
  { value: "expense", label: "Gastos" },
  { value: "income", label: "Ingresos" },
  { value: "transfer", label: "Transferencias" },
  { value: "lend", label: "Préstamos que diste" },
  { value: "borrow", label: "Préstamos que recibiste" },
  { value: "collect", label: "Cobros" },
  { value: "repay", label: "Pagos de deudas" },
  { value: "refund", label: "Reembolsos" },
  { value: "unclassified", label: "Por clasificar" },
];

export function Movimientos() {
  const me = useMe().data;
  const accounts = useAccounts().data;
  const [params, setParams] = useSearchParams();
  const [sheet, setSheet] = useState<Sheet>(null);
  const [categoryKind, setCategoryKind] = useState<"expense" | "income">("expense");
  const [search, setSearch] = useState(params.get("q") ?? "");

  const filters: MonthFilters = {
    month: params.get("mes") ?? todayISO().slice(0, 7),
    account_id: params.get("cuenta") ? Number(params.get("cuenta")) : undefined,
    category_id: params.get("categoria") ? Number(params.get("categoria")) : undefined,
    kind: (params.get("tipo") || undefined) as MonthFilters["kind"],
    q: params.get("q") || undefined,
    pending: params.get("pendientes") === "1" || undefined,
  };
  const month = useMonth(filters);

  // Siempre desde la URL actual: la búsqueda se aplica 300 ms después y no debe pisar un filtro
  // elegido mientras tanto
  const set = (key: string, value: string | null, also: Record<string, string | null> = {}) => {
    const next = new URLSearchParams(window.location.search);
    for (const [k, v] of Object.entries({ [key]: value, ...also })) {
      if (v) next.set(k, v);
      else next.delete(k);
    }
    setParams(next, { replace: true });
  };

  // La búsqueda espera a que dejes de escribir. Solo toca la URL si de verdad cambió: si no, al abrir
  // la pantalla esos 300 ms reescribían la dirección y podían pisar el movimiento que tocaste
  useEffect(() => {
    const t = setTimeout(() => {
      const q = search.trim() || null;
      if (q !== new URLSearchParams(window.location.search).get("q")) set("q", q);
    }, 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  const lang = me?.lang ?? "es-PE";
  const m = month.data;
  const sym = symbolOf(m?.currency ?? me?.currency);
  const accountName = accounts && filters.account_id
    ? [...accounts.have, ...accounts.owe].find((a) => a.id === filters.account_id)?.name : null;
  const chip = (on: boolean) =>
    `flex h-9 flex-none items-center gap-0.5 rounded-full px-3 text-caption font-semibold ${on ? "bg-primary text-primary-foreground" : "border border-border"}`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-8 pb-28">
      <span className="text-label text-muted-foreground">Movimientos</span>
      <button type="button" aria-haspopup="dialog" onClick={() => setSheet("month")}
        className="mt-2 flex items-center gap-1 self-start font-display text-[34px] leading-[38px] font-extrabold tracking-[-0.02em]">
        <h1>{monthName(filters.month)}</h1>
        <Icon name="expand_more" className="text-[28px] text-muted-foreground" />
      </button>
      {m && (
        <div className="mt-2 flex gap-4 text-caption font-semibold tabular-nums">
          <span className="flex items-center gap-0.5 text-income"><Icon name="south_west" className="text-[16px]" />Entró + {formatAmount(m.income_total, sym, lang)}</span>
          <span className="flex items-center gap-0.5 text-expense"><Icon name="north_east" className="text-[16px]" />Salió − {formatAmount(m.expense_total, sym, lang)}</span>
        </div>
      )}

      <label className="mt-4 flex h-11 items-center gap-2 rounded-md bg-muted px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
        <Icon name="search" className="text-muted-foreground" />
        <input aria-label="Buscar movimientos" placeholder="Buscar por nota, categoría o monto" value={search}
          onChange={(e) => setSearch(e.target.value)} className="min-w-0 flex-1 border-0 bg-transparent focus:outline-none" />
        {search && (
          <button type="button" aria-label="Borrar búsqueda" onClick={() => setSearch("")}><Icon name="close" className="text-muted-foreground" /></button>
        )}
      </label>
      <div className="-mr-6 mt-2.5 flex gap-2 overflow-x-auto pr-6 pb-1">
        <button type="button" className={chip(!!filters.account_id)} onClick={() => (filters.account_id ? set("cuenta", null) : setSheet("account"))}>
          {accountName ?? "Cuenta"}<Icon name={filters.account_id ? "close" : "expand_more"} className="text-[18px]" />
        </button>
        <button type="button" className={chip(!!filters.category_id)} onClick={() => (filters.category_id ? set("categoria", null) : setSheet("category"))}>
          {filters.category_id ? params.get("categoria_nombre") ?? "Categoría" : "Categoría"}
          <Icon name={filters.category_id ? "close" : "expand_more"} className="text-[18px]" />
        </button>
        <button type="button" className={chip(!!filters.kind)} onClick={() => (filters.kind ? set("tipo", null) : setSheet("kind"))}>
          {KIND_OPTIONS.find((k) => k.value === filters.kind)?.label ?? "Tipo"}
          <Icon name={filters.kind ? "close" : "expand_more"} className="text-[18px]" />
        </button>
        {(m?.pending_count ?? 0) > 0 || filters.pending ? (
          <button type="button" aria-pressed={!!filters.pending} onClick={() => set("pendientes", filters.pending ? null : "1")}
            className={`flex h-9 flex-none items-center gap-1 rounded-full px-3 text-caption font-semibold ${filters.pending ? "bg-attention text-background" : "bg-attention-soft text-attention"}`}>
            <Icon name="schedule" className="text-[18px]" />
            {m?.pending_count ?? 0} por confirmar
          </button>
        ) : null}
      </div>

      {month.isError && <div className="mt-4"><ErrorAlert>{month.error.message}</ErrorAlert></div>}
      {m && m.days.length === 0 && (
        <p className="mt-8 text-center text-muted-foreground">
          {filters.q || filters.account_id || filters.category_id || filters.kind || filters.pending
            ? "Nada coincide con lo que buscas en este mes."
            : "Todavía no hay movimientos este mes. Toca + para registrar el primero."}
        </p>
      )}
      {m?.days.map((d) => (
        <section key={d.date} aria-label={dayLabel(d.date)} className="flex flex-col">
          <div className="mt-4 flex justify-between border-b border-border pb-1 text-label text-muted-foreground tabular-nums">
            <span>{dayLabel(d.date)}{d.moves.every((x) => !x.posted) ? " · por confirmar" : ""}</span>
            {!isZero(d.total) && <span>{d.total.startsWith("-") ? "− " : "+ "}{formatAmount(d.total.replace("-", ""), sym, lang)}</span>}
          </div>
          {d.moves.map((x) => <MoveRow key={x.id} move={x} lang={lang} base={m.currency} />)}
        </section>
      ))}

      <Sheet title="Elige el mes" open={sheet === "month"} onClose={() => setSheet(null)}>
        <OptionList value={filters.month} options={monthOptions().map((v) => ({ value: v, label: monthName(v) }))}
          onPick={(v) => { set("mes", v); setSheet(null); }} />
      </Sheet>
      <Sheet title="Filtrar por cuenta" open={sheet === "account"} onClose={() => setSheet(null)}>
        <OptionList value={String(filters.account_id ?? "")}
          options={[...(accounts?.have ?? []), ...(accounts?.owe ?? [])].map((a) => ({ value: String(a.id), label: a.name, hint: a.subtitle ?? undefined }))}
          onPick={(v) => { set("cuenta", v); setSheet(null); }} />
      </Sheet>
      <Sheet title="Filtrar por tipo" open={sheet === "kind"} onClose={() => setSheet(null)}>
        <OptionList value={filters.kind ?? ""} options={KIND_OPTIONS} onPick={(v) => { set("tipo", v || null); setSheet(null); }} />
      </Sheet>
      {sheet === "category" && (
        <div className="fixed inset-x-0 top-3 z-[60] mx-auto flex max-w-md justify-center gap-1">
          {(["expense", "income"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={categoryKind === k} onClick={() => setCategoryKind(k)}
              className={`h-9 rounded-full px-4 text-caption font-semibold ${categoryKind === k ? "bg-primary text-primary-foreground" : "bg-card"}`}>
              {k === "expense" ? "De gasto" : "De ingreso"}
            </button>
          ))}
        </div>
      )}
      <CategorySheet kind={categoryKind} allowGroups open={sheet === "category"} onClose={() => setSheet(null)}
        onPick={(c) => {
          set("categoria", String(c.id), { categoria_nombre: c.name });
          setSheet(null);
        }} />
    </main>
  );
}

function MoveRow({ move: x, lang, base }: { move: MoveSummary; lang: string; base: string }) {
  const caption = moveCaption(x, lang);
  return (
    <Link to={`/movimientos/${x.id}`} className="flex min-h-[60px] items-center gap-3 border-b border-border">
      <MoveIcon move={x} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">{x.ref}</span>
        <span className={`truncate text-caption ${x.posted ? "text-muted-foreground" : "font-semibold text-attention"}`}>
          {x.posted ? caption : `Por confirmar · ${caption}`}
        </span>
      </span>
      <MoveAmount move={x} base={base} lang={lang} />
    </Link>
  );
}
