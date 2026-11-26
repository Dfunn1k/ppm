// Empezar, paso 2 (sección 2 del boceto): repartir. Por asignar arriba, fijo, baja con cada monto; un
// botón llena los sobres de gasto con el promedio de los 3 meses anteriores (D7). Se puede dejar plata
// sin repartir: queda en Por asignar.
import { useState } from "react";
import { useNavigate } from "react-router";

import { useAssign, useBudget } from "@/api/hooks";
import { ListSkeleton } from "@/components/Skeleton";
import { ErrorAlert, Icon } from "@/components/ui";
import { Button, buttonVariants } from "@/components/Button";
import { cn } from "@/lib/utils";
import { add, formatNumber, isNegative, parseAmount, subtract } from "@/lib/money";
import { monthOnly } from "@/lib/months";

import { addMonth, Heading, PostChip, useBudgetMonth, useMoney, withMonth } from "./common";

export function Repartir() {
  const [month] = useBudgetMonth();
  const budget = useBudget(month);
  const { lang, money } = useMoney();
  const [values, setValues] = useState<Record<number, string>>({});
  const assign = useAssign();
  const navigate = useNavigate();

  if (budget.isPending) return <ListSkeleton title="Repartir" />;
  if (budget.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{budget.error.message}</ErrorAlert></main>;
  const b = budget.data;
  const posts = b.posts.filter((p) => p.active);
  const parsed = posts.map((p) => ({ p, amount: parseAmount(values[p.id] ?? "", lang) }));
  const total = parsed.reduce((s, x) => (x.amount ? add(s, x.amount) : s), "0.00");
  const left = subtract(b.to_assign, total);
  const bad = parsed.some((x) => (values[x.p.id] ?? "").trim() !== "" && x.amount === null);
  const averages = () => setValues(Object.fromEntries(posts.filter((p) => p.kind === "expense" && Number(p.average) > 0)
    .map((p) => [p.id, formatNumber(p.average, lang)])));
  const months = [-3, -2, -1].map((n) => monthOnly(addMonth(month, n)).toLowerCase());
  const done = () => navigate(withMonth("/presupuesto", month), { replace: true });
  const save = () => {
    const items = parsed.filter((x) => x.amount && Number(x.amount) > 0)
      .map((x) => ({ month, amount: x.amount!, from_post_id: null, to_post_id: x.p.id, source: "start" as const }));
    if (items.length === 0) return done();
    assign.mutate(items, { onSuccess: done });
  };

  const row = (p: (typeof posts)[number]) => (
    <label key={p.id} className="flex min-h-row items-center gap-3 border-b border-border py-2">
      <PostChip post={p} />
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">{p.name}</span>
        <span className="text-caption text-muted-foreground tabular-nums">
          {p.kind === "saving" ? (p.role === "patrimony" ? "Lo que pagas de capital o inviertes" : "Lo que quieras guardar") : Number(p.average) > 0 ? `Promedio ${money(p.average)}` : "Sin gastos en los últimos meses"}
        </span>
      </span>
      <input inputMode="decimal" autoComplete="off" placeholder="0.00" aria-label={`Para ${p.name}`}
        value={values[p.id] ?? ""} onChange={(e) => setValues({ ...values, [p.id]: e.target.value })}
        aria-invalid={(values[p.id] ?? "").trim() !== "" && parseAmount(values[p.id]!, lang) === null ? true : undefined}
        className="h-control w-28 rounded-md border border-border bg-background px-3 text-right font-semibold tabular-nums aria-invalid:border-destructive" />
    </label>
  );

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pb-10">
      <div className="sticky top-0 z-raised -mx-6 border-b border-border bg-background px-6 pt-6 pb-3">
        <h1 className="text-label text-muted-foreground">Reparte tu plata de {monthOnly(month).toLowerCase()}</h1>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-caption text-muted-foreground">Por asignar</span>
          <span className={`text-amount-display-2 ${isNegative(left) ? "text-expense" : ""}`}>{money(left)}</span>
        </div>
        <span className="text-caption text-muted-foreground">
          {isNegative(left) ? "Estás repartiendo más de lo que tienes." : `De ${money(b.to_assign)}. Baja mientras llenas los sobres.`}
        </span>
      </div>
      <button type="button" onClick={averages} className={cn(buttonVariants({ variant: "secondary" }), "mt-4 gap-1.5 text-body")}>
        <Icon name="auto_fix_high" />Llenar con mis promedios
      </button>
      <span className="mt-1.5 text-center text-caption text-muted-foreground">
        El promedio de lo que gastaste en {months[0]}, {months[1]} y {months[2]}.
      </span>
      <Heading label="Gastos" right={`Para ${monthOnly(month).toLowerCase()}`} />
      {posts.filter((p) => p.kind === "expense").map(row)}
      <Heading label="Ahorro" />
      {posts.filter((p) => p.kind === "saving").map(row)}
      {assign.isError && <div className="mt-4"><ErrorAlert>{assign.error.message}</ErrorAlert></div>}
      <Button onClick={save} pending={assign.isPending} disabled={bad} className="mt-8">Empezar</Button>
      <span className="mt-2 text-center text-caption text-muted-foreground">Lo que no repartas queda en Por asignar; lo cambias cuando quieras.</span>
    </main>
  );
}
