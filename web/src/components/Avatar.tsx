// El círculo de la izquierda de una fila (design-system/components/Avatar): una categoría con su color,
// una cuenta, una persona o un estado. Es decorativo: lo que significa lo dice el texto de la fila.
import { cva, type VariantProps } from "class-variance-authority";

import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";

/** Los 12 colores de categoría como clases (Tailwind solo genera las que ve escritas enteras). */
export const CAT_BG = [
  "bg-cat-0", "bg-cat-1", "bg-cat-2", "bg-cat-3", "bg-cat-4", "bg-cat-5",
  "bg-cat-6", "bg-cat-7", "bg-cat-8", "bg-cat-9", "bg-cat-10", "bg-cat-11",
] as const;

export const catBg = (color: number | null | undefined) => CAT_BG[(((color ?? 0) % 12) + 12) % 12];

export const avatarVariants = cva("grid flex-none place-items-center rounded-full", {
  variants: {
    kind: {
      category: "text-on-category",
      account: "bg-secondary text-secondary-foreground",
      person: "bg-muted font-semibold text-foreground",
      status: "bg-muted text-muted-foreground",
      attention: "bg-attention-soft text-attention",
    },
    size: { md: "size-avatar", sm: "size-avatar-sm" },
  },
  defaultVariants: { kind: "account", size: "md" },
});

export function Avatar({ kind, size, icon, color, initials, className }: VariantProps<typeof avatarVariants> & {
  icon?: string; color?: number | null; initials?: string; className?: string;
}) {
  return (
    <span aria-hidden="true" className={cn(avatarVariants({ kind, size }), kind === "category" && catBg(color), className)}>
      {initials ? <span className={size === "sm" ? "text-caption-sm" : "text-caption"}>{initials}</span>
        : icon && <Icon name={icon} size={size === "sm" ? "sm" : undefined} />}
    </span>
  );
}
