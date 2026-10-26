// Las piezas de una fila de movimiento, iguales en Movimientos, en el Inicio y en una persona:
// su ícono, su monto con signo y la línea de abajo.
import type { MoveSummary } from "@/api/hooks";
import { flow, isPersonKind, tone } from "@/lib/kinds";
import { formatAmount, formatNumber, symbolOf } from "@/lib/money";

import { CategoryChip } from "./CategorySheet";
import { Icon } from "./ui";

export function Avatar({ name, size = 36 }: { name: string | null | undefined; size?: number }) {
  return (
    <span className="grid flex-none place-items-center rounded-full bg-secondary font-semibold text-secondary-foreground"
      style={{ width: size, height: size, fontSize: size < 36 ? 13 : 15 }}>
      {(name ?? "?").trim()[0]?.toUpperCase() ?? "?"}
    </span>
  );
}

export function MoveIcon({ move: x }: { move: MoveSummary }) {
  if (x.kind === "transfer") {
    return <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="sync_alt" /></span>;
  }
  if (isPersonKind(x.kind) || x.kind === "offset") return <Avatar name={x.partner} />;
  if (x.kind === "other") {
    return <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="edit_note" /></span>;
  }
  const single = x.categories.length === 1 ? x.categories[0]! : null;
  return <CategoryChip category={single ?? { icon: "call_split", color: x.categories[0]?.color ?? 0 }} />;
}

/** Lo que va debajo del nombre: la categoría (o con quién) y la cuenta. */
export function moveCaption(x: MoveSummary, lang: string): string {
  if (x.kind === "transfer") {
    return `${x.account}${x.to_amount && x.to_currency !== x.currency ? ` · ${formatAmount(x.to_amount, symbolOf(x.to_currency), lang)}` : ""}`;
  }
  if (isPersonKind(x.kind)) return `${x.partner} · ${x.account}`;
  if (x.kind === "offset" || x.kind === "write_off") return x.partner ?? x.account;
  if (x.kind === "other" || x.categories.length === 0) return x.account;
  const what = x.categories.length === 1 ? x.categories[0]!.name : `Dividido en ${x.categories.length} categorías`;
  return `${what} · ${x.account}`;
}

export function MoveAmount({ move: x, base, lang }: { move: MoveSummary; base: string; lang: string }) {
  const f = flow(x.kind);
  const value = x.currency === base && f !== "none" ? formatNumber(x.amount, lang) : formatAmount(x.amount, symbolOf(x.currency), lang);
  return (
    <span className={`flex items-center gap-0.5 text-amount whitespace-nowrap ${tone(x.kind)}`}>
      {f !== "none" && <Icon name={f === "in" ? "south_west" : "north_east"} className="text-[16px]" />}
      {f === "in" ? "+ " : f === "out" ? "− " : ""}{value}
    </span>
  );
}
