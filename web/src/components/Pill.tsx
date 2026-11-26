// Una cantidad junto a su rótulo, en pastilla: «Adjuntos 3», «Pendientes 3 1 vencido».
// Reemplaza al «·» que unía el rótulo con su número (caso 2 de «Sin punto como conector»).
// Es el `Chip` chico (design-system/components/Chip).
import { Chip } from "@/components/Chip";

export function Pill({ children, attention = false }: { children: React.ReactNode; attention?: boolean }) {
  return <Chip tone={attention ? "attention" : "neutral"}>{children}</Chip>;
}
