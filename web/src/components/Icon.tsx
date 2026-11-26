// Un ícono de Material Symbols Rounded (design-system/README.md › Íconos). Sin `size` mide 20 px (filas,
// botones y campos); `sm` 16, `md` 24 (navegación y Volver), `lg` 32 y `xl` 40 (estado vacío). Es
// decorativo: lo que significa lo dice el texto de al lado o el nombre del botón.
import { cn } from "@/lib/utils";

const ICON_SIZE = { sm: "text-icon-sm", md: "text-icon-md", lg: "text-icon-lg", xl: "text-icon-xl" } as const;

export function Icon({ name, fill, size, className }: { name: string; fill?: boolean; size?: keyof typeof ICON_SIZE; className?: string }) {
  return (
    <span aria-hidden="true" className={cn("icon", size && ICON_SIZE[size], fill && "icon-fill", className)}>
      {name}
    </span>
  );
}
