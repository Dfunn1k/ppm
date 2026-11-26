// Chips y pastillas (design-system/components/Chip). `Chip` informa y no se toca («Por confirmar»,
// «Adjuntos 3»). `FilterChip` se elige: dice si está elegido (aria-pressed) y se toca en 44 px aunque
// se vea de 32.
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps, ReactNode } from "react";

import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";

export const chipVariants = cva("inline-flex flex-none items-center gap-1 rounded-full font-semibold tracking-normal normal-case tabular-nums", {
  variants: {
    tone: {
      neutral: "bg-secondary text-secondary-foreground",
      muted: "bg-muted text-foreground",
      attention: "bg-attention-soft text-attention",
      income: "bg-income-soft text-income",
      expense: "bg-destructive-soft text-expense",
      selected: "bg-selected text-selected-foreground",
    },
    size: { sm: "h-5 px-1.5 text-caption-sm", md: "h-8 px-3 text-caption-sm" },
  },
  defaultVariants: { tone: "neutral", size: "sm" },
});

export function Chip({ tone, size, icon, children, className }: VariantProps<typeof chipVariants> & { icon?: string; children: ReactNode; className?: string }) {
  return (
    <span className={cn(chipVariants({ tone, size }), className)}>
      {icon && <Icon name={icon} size="sm" />}{children}
    </span>
  );
}

export function FilterChip({ pressed, icon, children, className, type = "button", ...props }: ComponentProps<"button"> & { pressed: boolean; icon?: string }) {
  return (
    <button type={type} aria-pressed={pressed}
      className={cn(chipVariants({ tone: pressed ? "selected" : "muted", size: "md" }), "hit-area", !pressed && "hover:bg-border", className)} {...props}>
      {pressed ? <Icon name="check" size="sm" /> : icon && <Icon name={icon} size="sm" />}{children}
    </button>
  );
}
