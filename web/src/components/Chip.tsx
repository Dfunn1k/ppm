// Chips y pastillas (design-system/components/Chip). `Chip` informa y no se toca («Por confirmar»,
// «Adjuntos 3»). `FilterChip` se elige: mide 36 y se toca en 44 px; lo elegido lleva el relleno del
// acento y un check (decisión del 26-nov, opción A), y lo dice con aria-pressed o, en un grupo de
// una sola opción, como radio (aria-checked).
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

export function FilterChip({ pressed, radio, icon, children, className, type = "button", ...props }: ComponentProps<"button"> & { pressed: boolean; radio?: boolean; icon?: string }) {
  const state = radio ? { role: "radio", "aria-checked": pressed } : { "aria-pressed": pressed };
  return (
    <button type={type} {...state}
      className={cn("hit-area inline-flex h-9 flex-none items-center gap-1 rounded-full border px-3.5 text-caption font-semibold disabled:pointer-events-none disabled:opacity-50",
        pressed ? "border-primary bg-primary pl-2.5 text-primary-foreground" : "border-border hover:bg-muted", className)} {...props}>
      {pressed ? <Icon name="check" size="sm" /> : icon && <Icon name={icon} size="sm" />}{children}
    </button>
  );
}
