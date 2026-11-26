// Las piezas que comparten las pantallas del presupuesto: el mes de la dirección, cómo se escribe la
// plata, el sobre con su color, la pastilla de lo que queda y la fila de un sobre (opción A del
// boceto «Presupuesto en el celular»: lo que queda a la derecha y una barra con la frase de lo gastado).
import { Link, useSearchParams } from "react-router";

import { type BudgetMonth, type BudgetPost, useMe } from "@/api/hooks";
import { CategoryChip } from "@/components/CategorySheet";
import { chipVariants } from "@/components/Chip";
import { ProgressBar } from "@/components/ProgressBar";
import { SectionHeading } from "@/components/SectionHeading";
import { Icon } from "@/components/ui";
import { todayISO } from "@/lib/dates";
import { formatAmount, isNegative, isZero, symbolOf } from "@/lib/money";
import { monthOnly } from "@/lib/months";
import { cn } from "@/lib/utils";

/** El mes que se mira: «?mes=2026-10», o el de hoy. */
export function useBudgetMonth(): [string, (m: string) => void] {
  const [params, setParams] = useSearchParams();
  const month = params.get("mes") ?? todayISO().slice(0, 7);
  return [month, (m) => setParams(m === todayISO().slice(0, 7) ? {} : { mes: m }, { replace: true })];
}

/** La dirección de algo del presupuesto en el mes que se mira. */
export function withMonth(path: string, month: string) {
  return month === todayISO().slice(0, 7) ? path : `${path}?mes=${month}`;
}

/** «S/ 1,284.90» en la moneda de la persona (el presupuesto es en soles: D4). */
export function useMoney() {
  const me = useMe().data;
  const lang = me?.lang ?? "es-PE";
  const symbol = symbolOf(me?.currency ?? "PEN");
  return {
    lang,
    money: (v: string | number) => formatAmount(v, symbol, lang),
    signed: (v: string) => (isNegative(v) || isZero(v) ? formatAmount(v, symbol, lang) : `+ ${formatAmount(v, symbol, lang)}`),
  };
}

export function abs(v: string) {
  return v.replace(/^-/, "");
}

export function addMonth(ym: string, n: number) {
  const [y, m] = ym.split("-").map(Number);
  const d = new Date(y!, m! - 1 + n, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** «Octubre», el mes anterior al que se mira, para «Traías de octubre». */
export function previousMonthName(ym: string) {
  return monthOnly(addMonth(ym, -1)).toLowerCase();
}

/** Los íconos de los sobres de ahorro que crea PPM («foundation», Construir patrimonio) no son de una
 *  cuenta: se nombran aquí para que vayan en la fuente a la medida (scripts/ui-icons.mjs). */
const SAVING_ICONS = ["foundation", "savings"] as const;

export function PostChip({ post, size = 36 }: { post: Pick<BudgetPost, "icon" | "color">; size?: number }) {
  return <CategoryChip category={{ icon: post.icon ?? SAVING_ICONS[1], color: post.color ?? 0 }} size={size} />;
}

/** Lo que queda en un sobre: verde si hay, gris en cero, rojo si se pasó. */
export function AvailablePill({ value, money }: { value: string; money: (v: string) => string }) {
  const tone = isNegative(value) ? "expense" : isZero(value) ? "muted" : "income";
  return (
    <span className={cn(chipVariants({ tone }), "h-7 px-2.5 text-body-sm font-semibold", tone === "muted" && "text-muted-foreground")}>
      {money(value)}
    </span>
  );
}

/** Lo que el sobre tuvo para el mes (lo que traía más lo asignado) y lo que salió de él. */
export function postFigures(p: BudgetPost) {
  const had = Number(p.carried) + Number(p.assigned);
  const spent = -Number(p.activity);
  return { had, spent, share: had > 0 ? Math.min(Math.max(spent / had, 0), 1) : spent > 0 ? 1 : 0 };
}

/** La frase debajo de la barra: «Gastaste S/ 479.58 de S/ 1,020.00», «Te pasaste S/ 46.90. Cúbrelo». */
export function postSentence(p: BudgetPost, money: (v: string | number) => string) {
  const { had, spent } = postFigures(p);
  if (isNegative(p.available)) return `Te pasaste ${money(abs(p.available))}. Cúbrelo`;
  if (p.kind === "saving") return spent > 0 ? `Usaste ${money(spent)} de ${money(had)}` : `Guardado ${money(p.available)}`;
  if (spent <= 0 && had === 0) return "Sin plata asignada";
  return `Gastaste ${money(Math.max(spent, 0))} de ${money(had)}`;
}

export function PostRow({ post: p, month, money, selected }: {
  post: BudgetPost; month: string; money: (v: string | number) => string; selected?: boolean;
}) {
  const { share } = postFigures(p);
  const red = isNegative(p.available);
  return (
    <Link to={withMonth(`/presupuesto/sobres/${p.id}`, month)} aria-current={selected ? "page" : undefined}
      className="flex min-h-row items-center gap-3 border-b border-border py-2.5 lg:-mx-3 lg:px-3 lg:aria-[current=page]:bg-muted lg:aria-[current=page]:mark-selected">
      <PostChip post={p} />
      <span className="flex min-w-0 flex-1 flex-col gap-1.5">
        <span className="flex items-center justify-between gap-2">
          <span className="truncate font-semibold">{p.name}</span>
          <AvailablePill value={p.available} money={money} />
        </span>
        <ProgressBar value={share} tone={red ? "expense" : "category"} color={p.color} />
        <span className={`text-caption tabular-nums ${red ? "font-semibold text-expense" : "text-muted-foreground"}`}>{postSentence(p, money)}</span>
      </span>
    </Link>
  );
}

/** La edad del dinero (D9): cuántos días pasaron desde que llegó la plata que gastas. */
export function AgeOfMoney({ age }: { age: BudgetMonth["age"] }) {
  return (
    <div className="mt-4 flex items-center gap-3 border-t border-border py-3">
      <Icon name="hourglass" size="md" />
      <span className="flex flex-col">
        {age.days === null ? (
          <>
            <span className="font-semibold">La edad de tu plata</span>
            <span className="text-caption text-muted-foreground">Cuando gastes, aquí verás cuántos días tenía la plata que usaste.</span>
          </>
        ) : (
          <>
            <span className="font-semibold">Tu plata tiene {age.days === 1 ? "1 día" : `${age.days} días`}</span>
            <span className="text-caption text-muted-foreground">
              Hoy gastas lo que llegó hace {age.days === 1 ? "1 día" : `${age.days} días`}. Más días, más aire.
            </span>
          </>
        )}
      </span>
    </div>
  );
}

/** El encabezado de una sección de la lista: «Gastos» a la izquierda, «Disponible» a la derecha. */
export function Heading({ label, right }: { label: string; right?: string }) {
  return (
    <SectionHeading className="mt-6" action={right && <span className="text-label text-muted-foreground">{right}</span>}>{label}</SectionHeading>
  );
}
