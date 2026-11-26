// Una barra de avance o de proporción, con un solo trato para el lector de pantalla: un medidor
// (role="meter") que dice su valor en palabras. El trigo es solo para «para mayo» (regla del trigo).
import { cva, type VariantProps } from "class-variance-authority";

import { catBg } from "@/components/Avatar";
import { cn } from "@/lib/utils";

export const barVariants = cva("block h-full rounded-full", {
  variants: {
    tone: { foreground: "bg-foreground", trigo: "bg-trigo", expense: "bg-expense", income: "bg-income", category: "" },
  },
  defaultVariants: { tone: "foreground" },
});

export function ProgressBar({ value, max = 1, tone, color, size = "sm", label, className }: VariantProps<typeof barVariants> & {
  value: number; max?: number;
  /** El color de categoría, si `tone` es category. */
  color?: number | null;
  size?: "sm" | "md";
  /** Lo que dice el lector de pantalla: «57 % de lo que entró». Sin él, la barra es decorativa. */
  label?: string;
  className?: string;
}) {
  const pct = Math.max(0, Math.min(100, Math.round((value / (max || 1)) * 100)));
  const a11y = label ? { role: "meter", "aria-valuemin": 0, "aria-valuemax": 100, "aria-valuenow": pct, "aria-valuetext": label } : { "aria-hidden": true };
  return (
    <span {...a11y} className={cn("block overflow-hidden rounded-full bg-muted", size === "sm" ? "h-1.5" : "h-2.5", className)}>
      <span className={cn(barVariants({ tone }), tone === "category" && catBg(color))} style={{ width: `${pct}%` }} />
    </span>
  );
}
