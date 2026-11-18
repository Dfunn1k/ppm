// Una cantidad junto a su rótulo, en pastilla: «Adjuntos 3», «Pendientes 3 1 vencido».
// Reemplaza al «·» que unía el rótulo con su número (caso 2 de «Sin punto como conector»).
export function Pill({ children, attention = false }: { children: React.ReactNode; attention?: boolean }) {
  return (
    <span className={`inline-flex h-5 flex-none items-center rounded-full px-[7px] text-[12px] leading-4 font-semibold tracking-normal normal-case tabular-nums ${
      attention ? "bg-attention-soft text-attention" : "bg-secondary text-secondary-foreground"}`}>
      {children}
    </span>
  );
}
