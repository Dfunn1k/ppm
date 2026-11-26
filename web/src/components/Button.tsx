// El botón (design-system/components/Button): principal, secundario, de texto y de borrar, en dos
// tamaños. El principal lleva el texto a la izquierda y la flecha a la derecha; al guardar, la flecha
// pasa a ser el círculo que gira, sin cambiar de ancho.
import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "inline-flex items-center gap-2 font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50",
  {
    variants: {
      variant: {
        primary: "w-full justify-between rounded-lg bg-primary px-5 text-primary-foreground hover:bg-primary/90 active:bg-primary/80",
        secondary: "justify-center rounded-lg border border-input-line bg-card px-4 hover:bg-muted active:bg-muted",
        ghost: "justify-center rounded-md px-3 text-body-sm font-semibold text-primary-strong underline hover:bg-muted active:bg-muted",
        destructive: "w-full justify-between rounded-lg bg-destructive px-5 text-destructive-foreground hover:bg-destructive/90 active:bg-destructive/80",
      },
      size: { md: "min-h-button", sm: "min-h-button-sm" },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

type Variants = VariantProps<typeof buttonVariants>;

/** El ícono de la derecha: la flecha en el principal (o el que se pida) y el círculo mientras guarda. */
function Trailing({ variant, pending, icon }: Variants & { pending?: boolean; icon?: string | false }) {
  const name = pending ? "progress_activity" : icon ?? (variant === "primary" || variant === undefined ? "arrow_forward" : undefined);
  if (!name) return null;
  return <Icon name={name} size="md" className={cn(pending && "animate-spin")} />;
}

/** `start`: el ícono a la izquierda del texto, en el de contorno («Cerrar sesión»); mientras guarda,
 *  ese ícono pasa a ser el círculo que gira y no se agrega nada a la derecha. */
export type ButtonProps = ComponentProps<"button"> & Variants & { pending?: boolean; icon?: string | false; start?: string };

export function Button({ variant, size, pending, icon, start, className, children, type = "button", disabled, ...props }: ButtonProps) {
  return (
    <button type={type} aria-busy={pending || undefined} disabled={pending || disabled}
      className={cn(buttonVariants({ variant, size }), className)} {...props}>
      {start && <Icon name={pending ? "progress_activity" : start} className={cn(pending && "animate-spin")} />}
      <span>{children}</span>
      {!start && <Trailing variant={variant} pending={pending} icon={icon} />}
    </button>
  );
}

/** Un botón de solo ícono: 44×44 y su nombre obligatorio, porque no tiene texto que leer. */
export function IconButton({ icon, label, className, type = "button", ...props }: Omit<ComponentProps<"button">, "aria-label"> & { icon: string; label: string }) {
  return (
    <button type={type} aria-label={label}
      className={cn("grid size-control flex-none place-items-center rounded-full hover:bg-muted active:bg-muted disabled:opacity-50", className)} {...props}>
      <Icon name={icon} size="md" />
    </button>
  );
}
