// X0 · Más › Inicio: qué cuentas de dinero se ven en el Inicio, en qué orden (flechas ↑↓) y con qué
// cuenta arranca el +. Cada cambio se guarda al instante.
import { Link } from "react-router";

import { type HomeSetup, useAccounts, useHomeSetup, useMe, useSaveHomeSetup } from "@/api/hooks";
import { SheetSelect } from "@/components/Sheet";
import { ErrorAlert, Icon, Spinner } from "@/components/ui";
import { formatAmount, symbolOf } from "@/lib/money";

export function InicioAjustes() {
  const me = useMe().data;
  const setup = useHomeSetup();
  const money = (useAccounts().data?.have ?? []).filter((a) => a.kind === "cash" || a.kind === "bank" || a.kind === "card");
  const save = useSaveHomeSetup();
  if (!me || setup.isPending) return <Spinner />;
  if (setup.isError) return <main className="mx-auto max-w-md px-6 pt-8"><ErrorAlert>{setup.error.message}</ErrorAlert></main>;
  const s = setup.data;
  const lang = me.lang ?? "es-PE";

  const send = (next: Partial<{ order: number[]; hidden: number[]; account_id: number | null }>, from: HomeSetup = s) =>
    save.mutate({
      order: next.order ?? from.accounts.map((a) => a.id),
      hidden: next.hidden ?? from.accounts.filter((a) => !a.shown).map((a) => a.id),
      account_id: next.account_id !== undefined ? next.account_id : from.account_id,
    });
  const move = (i: number, d: -1 | 1) => {
    const order = s.accounts.map((a) => a.id);
    [order[i], order[i + d]] = [order[i + d]!, order[i]!];
    send({ order });
  };
  const toggle = (id: number) => {
    const hidden = s.accounts.filter((a) => !a.shown).map((a) => a.id);
    send({ hidden: hidden.includes(id) ? hidden.filter((x) => x !== id) : [...hidden, id] });
  };

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-8">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/mas" aria-label="Volver a Más" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
      </div>
      <h1 className="mt-6 text-title-hero">Tu Inicio</h1>
      <p className="mt-3 text-muted-foreground">Qué cuentas ves al abrir PPM, en qué orden, y con cuál arranca el + al registrar.</p>

      <section aria-label="Cuentas en el Inicio" className="mt-6 flex flex-col">
        <span className="border-b border-border pb-1 text-label text-muted-foreground">Cuentas en el Inicio</span>
        {s.accounts.map((a, i) => (
          <div key={a.id} className={`flex min-h-16 items-center gap-2.5 border-b border-border ${a.shown ? "" : "opacity-60"}`}>
            <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground">
              <Icon name={a.icon ?? "payments"} className="text-[20px]" />
            </span>
            <span className="flex min-w-0 flex-1 flex-col">
              <span className="truncate font-semibold">{a.name}</span>
              <span className="text-caption text-muted-foreground tabular-nums">
                {a.shown ? formatAmount(a.amount, symbolOf(a.currency), lang) : "No se ve en el Inicio"}
              </span>
            </span>
            <button type="button" aria-label={`Subir ${a.name}`} disabled={i === 0} onClick={() => move(i, -1)}
              className="grid size-9 place-items-center rounded-full disabled:opacity-30"><Icon name="arrow_upward" /></button>
            <button type="button" aria-label={`Bajar ${a.name}`} disabled={i === s.accounts.length - 1} onClick={() => move(i, 1)}
              className="grid size-9 place-items-center rounded-full disabled:opacity-30"><Icon name="arrow_downward" /></button>
            <button type="button" role="switch" aria-checked={a.shown} aria-label={`Ver ${a.name} en el Inicio`} onClick={() => toggle(a.id)}
              className={`relative h-[26px] w-11 flex-none rounded-full transition-colors ${a.shown ? "bg-primary" : "bg-input-line/50"}`}>
              <span className={`absolute top-[3px] size-5 rounded-full bg-card shadow-sm transition-[left] ${a.shown ? "left-[21px]" : "left-[3px]"}`} />
            </button>
          </div>
        ))}
        <span className="mt-1.5 text-caption text-muted-foreground">Las apagadas siguen en Cuentas; solo no aparecen en el Inicio.</span>
      </section>

      <div className="mt-5 flex flex-col gap-1.5">
        <SheetSelect label="Al tocar +, sale de" sheetTitle="¿De qué cuenta sale?"
          value={s.account_id ? String(s.account_id) : ""} onChange={(v) => send({ account_id: v ? Number(v) : null })}
          options={[{ value: "", label: "Elegirla cada vez", hint: "Registrar arranca con la primera de tus cuentas" },
            ...money.map((a) => ({ value: String(a.id), label: a.name, hint: a.subtitle ?? undefined }))]} />
        <span className="text-caption text-muted-foreground">Dentro de una cuenta o tarjeta, el + registra con esa.</span>
      </div>
      {save.error && <div className="mt-3"><ErrorAlert>{save.error.message}</ErrorAlert></div>}
    </main>
  );
}
