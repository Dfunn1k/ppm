// M1 · Movimientos: el mes por días, con lo que entró y salió, búsqueda y filtros.
import { useEffect, useState } from "react";
import { NavLink, useLocation, useSearchParams } from "react-router";

import { type MonthFilters, type MoveSummary, useAccounts, useMe, useMonth, useTags } from "@/api/hooks";
import { CategorySheet } from "@/components/CategorySheet";
import { MoveAmount, MoveIcon, MoveLine, MoveName, moveBits } from "@/components/MoveBits";
import { IconButton } from "@/components/Button";
import { SearchField } from "@/components/SearchField";
import { SectionHeading } from "@/components/SectionHeading";
import { OptionList, Sheet } from "@/components/Sheet";
import { BoneRows } from "@/components/Skeleton";
import { Kbd } from "@/components/ShortcutsHelp";
import { catBg } from "@/components/Avatar";
import { keyLabel, useShortcuts } from "@/lib/shortcuts";
import { ErrorAlert, Icon, Status } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { cn } from "@/lib/utils";
import { useDesktop } from "@/lib/desktop";
import { monthName, monthOptions } from "@/lib/months";
import { formatAmount, isZero, symbolOf } from "@/lib/money";
import { accountOption } from "@/components/AccountSub";

const DAYS = ["DOMINGO", "LUNES", "MARTES", "MIÉRCOLES", "JUEVES", "VIERNES", "SÁBADO"];

function dayLabel(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  const day = DAYS[new Date(y!, m! - 1, d!).getDay()];
  return `${iso === todayISO() ? "HOY, " : ""}${day} ${d}`;
}

type Sheet = null | "month" | "account" | "category" | "kind" | "tag";
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
  const tags = useTags().data ?? [];
  const { keys, hints } = useShortcuts();
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
    tag_id: params.get("etiqueta") ? Number(params.get("etiqueta")) : undefined,
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
  // Un filtro: elegido, con el acento y una × para quitarlo; se toca en 44 px aunque mida 36
  const chip = (on: boolean) =>
    `hit-area flex h-9 flex-none items-center gap-0.5 rounded-full px-3 text-caption font-semibold ${on ? "bg-primary text-primary-foreground" : "border border-border hover:bg-muted"}`;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-8 pb-28 md:max-w-160 md:pb-10">
      <span className="text-label text-muted-foreground">Movimientos</span>
      <button type="button" aria-haspopup="dialog" onClick={() => setSheet("month")}
        className="mt-2 flex min-h-control items-center gap-1 self-start text-title-1">
        <h1>{monthName(filters.month)}</h1>
        <Icon name="expand_more" size="md" className="text-muted-foreground" />
      </button>
      {m && (
        <div className="mt-2 flex gap-4 text-caption font-semibold tabular-nums">
          <span className="flex items-center gap-0.5 text-income"><Icon name="south_west" size="sm" />Entró + {formatAmount(m.income_total, sym, lang)}</span>
          <span className="flex items-center gap-0.5 text-expense"><Icon name="north_east" size="sm" />Salió − {formatAmount(m.expense_total, sym, lang)}</span>
        </div>
      )}

      <SearchField label="Buscar movimientos" type="text" placeholder="Buscar por nota, categoría o monto" value={search}
        onChange={(e) => setSearch(e.target.value)} className="mt-4">
        {hints && !search && <span className="peer-focus:hidden"><Kbd>{keyLabel(keys.search)}</Kbd></span>}
        {search && <IconButton icon="close" label="Borrar búsqueda" onClick={() => setSearch("")} className="-mr-3 text-muted-foreground" />}
      </SearchField>
      <div className="-mr-6 mt-2 flex gap-2 overflow-x-auto py-1 pr-6">
        <button type="button" className={chip(!!filters.account_id)} onClick={() => (filters.account_id ? set("cuenta", null) : setSheet("account"))}>
          {accountName ?? "Cuenta"}<Icon name={filters.account_id ? "close" : "expand_more"} />
        </button>
        <button type="button" className={chip(!!filters.category_id)} onClick={() => (filters.category_id ? set("categoria", null) : setSheet("category"))}>
          {filters.category_id ? params.get("categoria_nombre") ?? "Categoría" : "Categoría"}
          <Icon name={filters.category_id ? "close" : "expand_more"} />
        </button>
        <button type="button" className={chip(!!filters.kind)} onClick={() => (filters.kind ? set("tipo", null) : setSheet("kind"))}>
          {KIND_OPTIONS.find((k) => k.value === filters.kind)?.label ?? "Tipo"}
          <Icon name={filters.kind ? "close" : "expand_more"} />
        </button>
        {(tags.length > 0 || filters.tag_id) && (
          <button type="button" className={chip(!!filters.tag_id)} onClick={() => (filters.tag_id ? set("etiqueta", null) : setSheet("tag"))}>
            {filters.tag_id ? tags.find((t) => t.id === filters.tag_id)?.name ?? "Etiqueta" : "Etiqueta"}
            <Icon name={filters.tag_id ? "close" : "expand_more"} />
          </button>
        )}
        {(m?.pending_count ?? 0) > 0 || filters.pending ? (
          <button type="button" aria-pressed={!!filters.pending} onClick={() => set("pendientes", filters.pending ? null : "1")}
            className={`hit-area flex h-9 flex-none items-center gap-1 rounded-full px-3 text-caption font-semibold ${filters.pending ? "bg-attention text-background" : "bg-attention-soft text-attention"}`}>
            <Icon name="schedule" />
            {m?.pending_count ?? 0} por confirmar
          </button>
        ) : null}
      </div>

      {month.isError && <div className="mt-4"><ErrorAlert>{month.error.message}</ErrorAlert></div>}
      {month.isPending && (
        <div aria-busy="true"><span role="status" className="sr-only">Cargando</span><BoneRows count={3} /><BoneRows count={3} /></div>
      )}
      {m && m.days.length === 0 && (
        <p className="mt-8 text-center text-muted-foreground">
          {filters.q || filters.account_id || filters.category_id || filters.kind || filters.pending || filters.tag_id
            ? "Nada coincide con lo que buscas en este mes."
            : "Todavía no hay movimientos este mes. Toca + para registrar el primero."}
        </p>
      )}
      {m?.days.map((d) => (
        <section key={d.date} aria-label={dayLabel(d.date)} className="flex flex-col">
          <SectionHeading className="mt-4"
            action={!isZero(d.total) && <span className="text-label text-muted-foreground tabular-nums">{d.total.startsWith("-") ? "− " : "+ "}{formatAmount(d.total.replace("-", ""), sym, lang)}</span>}>
            <span className="flex items-center gap-2">{dayLabel(d.date)}{d.moves.every((x) => !x.posted) && <Status icon="schedule" attention>Por confirmar</Status>}</span>
          </SectionHeading>
          {d.moves.map((x) => <MoveRow key={x.id} move={x} lang={lang} base={m.currency} />)}
        </section>
      ))}

      <Sheet title="Elige el mes" open={sheet === "month"} onClose={() => setSheet(null)}>
        <OptionList search={false} value={filters.month} options={monthOptions().map((v) => ({ value: v, label: monthName(v) }))}
          onPick={(v) => { set("mes", v); setSheet(null); }} />
      </Sheet>
      <Sheet title="Filtrar por cuenta" open={sheet === "account"} onClose={() => setSheet(null)}>
        <OptionList value={String(filters.account_id ?? "")}
          options={[...(accounts?.have ?? []), ...(accounts?.owe ?? [])].map((a) => ({ value: String(a.id), label: a.name, ...accountOption(a) }))}
          onPick={(v) => { set("cuenta", v); setSheet(null); }} />
      </Sheet>
      <Sheet title="Filtrar por tipo" open={sheet === "kind"} onClose={() => setSheet(null)}>
        <OptionList value={filters.kind ?? ""} options={KIND_OPTIONS} onPick={(v) => { set("tipo", v || null); setSheet(null); }} />
      </Sheet>
      <Sheet title="Filtrar por etiqueta" open={sheet === "tag"} onClose={() => setSheet(null)}>
        <div role="radiogroup" className="flex flex-col">
          {tags.filter((t) => t.active || t.id === filters.tag_id).map((t) => (
            <button key={t.id} type="button" role="radio" aria-checked={t.id === filters.tag_id}
              onClick={() => { set("etiqueta", String(t.id)); setSheet(null); }}
              className={`flex min-h-row-option items-center gap-3 rounded-md px-3 text-left text-body-lg ${t.id === filters.tag_id ? "bg-muted" : "hover:bg-muted"}`}>
              <span aria-hidden="true" className={cn("size-3 rounded-full", catBg(t.color))} />
              <span className="flex-1">{t.name}</span>
            </button>
          ))}
        </div>
      </Sheet>
      {sheet === "category" && (
        <div className="fixed inset-x-0 top-3 z-toast md:left-rail mx-auto flex max-w-md justify-center gap-1">
          {(["expense", "income"] as const).map((k) => (
            <button key={k} type="button" aria-pressed={categoryKind === k} onClick={() => setCategoryKind(k)}
              className={`hit-area h-9 rounded-full px-4 text-caption font-semibold ${categoryKind === k ? "bg-primary text-primary-foreground" : "bg-card"}`}>
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
  // En escritorio la lista sigue al lado: el detalle se abre sin perder el mes, la búsqueda ni los filtros
  const search = useLocation().search;
  const desktop = useDesktop();
  return (
    <NavLink to={{ pathname: `/movimientos/${x.id}`, search: desktop ? search : "" }}
      className="flex min-h-row items-center gap-3 border-b border-border py-2 lg:-mx-3 lg:px-3 lg:aria-[current=page]:bg-muted lg:aria-[current=page]:mark-selected">
      <MoveIcon move={x} />
      <span className="flex min-w-0 flex-1 flex-col">
        <MoveName move={x} />
        <MoveLine bits={moveBits(x, base, lang)} tags={x.tags} />
      </span>
      <MoveAmount move={x} base={base} lang={lang} />
    </NavLink>
  );
}
