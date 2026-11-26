// Un monto con su signo, su ícono y su símbolo (design-system/components/Amount). En una fila, tu
// moneda va sin símbolo y las otras con el suyo; en totales, saldos y el monto principal, siempre con
// símbolo. Nunca se parte en dos líneas.
import { cva, type VariantProps } from "class-variance-authority";

import { Icon } from "@/components/Icon";
import { formatAmount, formatNumber, symbolOf } from "@/lib/money";
import { cn } from "@/lib/utils";

export const amountVariants = cva("inline-flex items-center gap-0.5 whitespace-nowrap tabular-nums", {
  variants: {
    size: {
      display: "text-amount-display",
      "display-2": "text-amount-display-2",
      xl: "text-amount-xl",
      lg: "text-amount-lg",
      row: "text-amount",
    },
    direction: { in: "text-income", out: "text-expense", transfer: "text-transfer", none: "" },
  },
  defaultVariants: { size: "row", direction: "none" },
});

export type Direction = "in" | "out" | "transfer" | "none";

const ICON: Partial<Record<Direction, string>> = { in: "south_west", out: "north_east" };
const SIGN: Partial<Record<Direction, string>> = { in: "+ ", out: "− " };

/** El texto del monto: con símbolo, salvo en una fila y en tu moneda. */
export function amountText(value: string | number, currency: string | null | undefined, opts: { base?: string; lang: string; row?: boolean }) {
  const own = opts.row && opts.base !== undefined && (currency ?? opts.base) === opts.base;
  return own ? formatNumber(value, opts.lang) : formatAmount(value, symbolOf(currency ?? opts.base), opts.lang);
}

export function Amount({ value, currency, base, lang, size, direction = "none", className }: VariantProps<typeof amountVariants> & {
  /** El monto sin signo; la dirección dice si entra o sale. */
  value: string | number;
  currency?: string | null;
  /** Tu moneda: en una fila (`size` row o lg) va sin símbolo. */
  base?: string;
  lang: string;
  direction?: Direction;
  className?: string;
}) {
  const big = size === "display" || size === "display-2";
  const row = size === undefined || size === null || size === "row" || size === "lg";
  const icon = !big && ICON[direction];
  return (
    <span className={cn(amountVariants({ size, direction }), className)}>
      {icon && <Icon name={icon} size="sm" />}
      {SIGN[direction] ?? ""}{amountText(value, currency, { base, lang, row })}
    </span>
  );
}
