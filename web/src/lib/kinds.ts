// Cómo se lee cada tipo de movimiento. La plata que entra lleva + y south_west; la que sale, − y
// north_east. Solo un ingreso (o un reembolso) se pinta en verde y solo un gasto en rojo: prestar,
// cobrar o guardar plata mueve tu cuenta, pero no es ingreso ni gasto, y va en gris.
import type { MoveSummary } from "@/api/hooks";

export type Kind = MoveSummary["kind"];
export type PersonKind = "lend" | "borrow" | "collect" | "repay" | "custody_in" | "custody_out";

export const KIND_NAME: Record<Kind, string> = {
  expense: "Gasto",
  income: "Ingreso",
  transfer: "Transferencia",
  lend: "Préstamo que diste",
  borrow: "Préstamo que recibiste",
  collect: "Cobro",
  repay: "Pago de una deuda",
  custody_in: "Plata para guardar",
  custody_out: "Devolución de plata guardada",
  refund: "Reembolso",
  offset: "Compensación",
  write_off: "Deuda perdida",
  opening: "Saldo inicial",
  unclassified: "Por clasificar",
  other: "Asiento manual",
};

/** Si la plata entra (+), sale (−) o no cambia lo que tienes (una transferencia, una compensación). */
export function flow(kind: Kind): "in" | "out" | "none" {
  if (["income", "borrow", "collect", "custody_in", "refund"].includes(kind)) return "in";
  if (["expense", "lend", "repay", "custody_out", "write_off"].includes(kind)) return "out";
  return "none";
}

export function tone(kind: Kind): string {
  if (kind === "income" || kind === "refund") return "text-income";
  if (kind === "expense" || kind === "write_off") return "text-expense";
  return "text-muted-foreground";
}

export const PERSON_KINDS: PersonKind[] = ["lend", "borrow", "collect", "repay", "custody_in", "custody_out"];

export function isPersonKind(kind: string): kind is PersonKind {
  return (PERSON_KINDS as string[]).includes(kind);
}
