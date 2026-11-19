// Las piezas de una fila de movimiento, iguales en Movimientos, en el Inicio y en una persona:
// su ícono, su monto con signo y la línea chica de abajo, que también usan una cuenta y una tarjeta.
import type { MoveSummary, TagRef } from "@/api/hooks";
import { flow, isPersonKind, tone } from "@/lib/kinds";
import { formatAmount, formatNumber, symbolOf } from "@/lib/money";

import { CategoryChip } from "./CategorySheet";
import { TagChips, tagColor } from "./Tags";
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
  if (x.kind === "unclassified") {
    return <span className="grid size-9 flex-none place-items-center rounded-full bg-attention-soft text-attention"><Icon name="inbox" /></span>;
  }
  if (isPersonKind(x.kind) || x.kind === "offset") return <Avatar name={x.partner} />;
  if (x.kind === "other") {
    return <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground"><Icon name="edit_note" /></span>;
  }
  const single = x.categories.length === 1 ? x.categories[0]! : null;
  return <CategoryChip category={single ?? { icon: "call_split", color: x.categories[0]?.color ?? 0 }} />;
}

/** Un dato de la línea chica: su ícono (o el punto de color de una etiqueta) y su texto. */
export type Bit = { icon?: string; text?: string; label?: string; attention?: boolean; shrink?: boolean };

const pending: Bit = { icon: "schedule", text: "Por confirmar", attention: true };
const clip: Bit = { icon: "attach_file", label: "Tiene adjunto" };

/** La línea chica de una fila de movimiento, igual en todas las listas. Cada dato empieza con su ícono,
 * así no hace falta separador. Las etiquetas van debajo como chips (fila angosta: el celular y las
 * listas) o en la misma línea con su punto de color (fila ancha: las tablas de la computadora). */
export function MoveLine({ bits, tags, wide }: { bits: Bit[]; tags: TagRef[]; wide?: boolean }) {
  if (!bits.length && !tags.length) return null;
  return (
    <>
      {(bits.length > 0 || (wide && tags.length > 0)) && (
        <span className="flex min-w-0 items-center gap-2.5 overflow-hidden whitespace-nowrap text-caption text-muted-foreground">
          {bits.map((b, i) => (
            <span key={i} aria-label={b.label} title={b.label}
              className={`inline-flex min-w-0 items-center gap-1 ${b.shrink ? "shrink" : "flex-none"} ${b.attention ? "font-semibold text-attention" : ""}`}>
              {b.icon && <Icon name={b.icon} className="text-[15px]" />}
              {b.text && <span className="truncate">{b.text}</span>}
            </span>
          ))}
          {wide && tags.map((t) => (
            <span key={t.id} className="inline-flex flex-none items-center gap-1">
              <span aria-hidden="true" className="size-2 rounded-full" style={{ background: tagColor(t.color) }} />{t.name}
            </span>
          ))}
        </span>
      )}
      {!wide && tags.length > 0 && <span className="mt-1"><TagChips tags={tags} small /></span>}
    </>
  );
}

/** El tipo de cambio de una compra o venta de moneda: cuántos de la base por uno de la otra. */
function rate(x: MoveSummary, base: string, lang: string): string | null {
  if (!x.to_amount || !x.to_currency || x.to_currency === x.currency) return null;
  const a = Number(x.amount), b = Number(x.to_amount);
  if (!a || !b) return null;
  const r = x.currency === base ? a / b : b / a;
  return `${formatAmount(x.to_amount, symbolOf(x.to_currency), lang)} a ${r.toLocaleString(lang, { minimumFractionDigits: 3, maximumFractionDigits: 3 })}`;
}

/** La línea chica de un movimiento en Movimientos e Inicio: por confirmar, la fecha (si no hay rótulo
 * de día), la cuenta con su ícono, con quién, el cambio y el clip. La categoría no: ya es el ícono. */
export function moveBits(x: MoveSummary, base: string, lang: string, date?: string): Bit[] {
  const bits: Bit[] = [];
  if (!x.posted) bits.push(pending);
  if (date) bits.push({ text: date });
  const account: Bit = { icon: x.account_icon ?? "payments", text: x.account, shrink: true };
  const person: Bit = { icon: "person", text: x.partner ?? "", shrink: true };
  if (x.kind === "unclassified") bits.push({ text: "Por clasificar" }, account);
  else if (x.kind === "offset" || x.kind === "write_off") bits.push(x.partner ? person : account);
  else if (isPersonKind(x.kind)) bits.push(person, account);
  else if ((x.kind === "expense" || x.kind === "income") && !x.account_icon) bits.push({ icon: "person", text: x.account, shrink: true });   // «Pagó Juan», «Cobró Juan»
  else bits.push(account);
  const fx = x.kind === "transfer" ? rate(x, base, lang) : null;
  if (fx) bits.push({ icon: "currency_exchange", text: fx });
  if (x.attachments > 0) bits.push(clip);
  return bits;
}

export const pendingBit = pending;
export const clipBit = clip;

export function MoveAmount({ move: x, base, lang }: { move: MoveSummary; base: string; lang: string }) {
  const f = flow(x.kind, x.incoming);
  const value = x.currency === base && f !== "none" ? formatNumber(x.amount, lang) : formatAmount(x.amount, symbolOf(x.currency), lang);
  return (
    <span className={`flex items-center gap-0.5 text-amount whitespace-nowrap ${tone(x.kind)}`}>
      {f !== "none" && <Icon name={f === "in" ? "south_west" : "north_east"} className="text-[16px]" />}
      {f === "in" ? "+ " : f === "out" ? "− " : ""}{value}
    </span>
  );
}
