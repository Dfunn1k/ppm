// X5 · Apariencia: tema y acento. Cambian al instante y se guardan en la cuenta.
import { Link } from "react-router";

import { useMe, useUpdateMe } from "@/api/hooks";
import { Segmented } from "@/components/Sheet";
import { ErrorAlert, Icon } from "@/components/ui";

const ACCENTS = [
  { value: "tinta", label: "Tinta" },
  { value: "trigo", label: "Trigo" },
  { value: "morado", label: "Morado" },
  { value: "azul", label: "Azul" },
] as const;

export function Apariencia() {
  const me = useMe().data;
  const update = useUpdateMe();
  if (!me) return null;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-8">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/mas" aria-label="Volver a Más" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
        <span className="pr-2.5 text-label text-muted-foreground">Apariencia</span>
      </div>
      <h1 className="mt-6 text-title-hero">Cómo se ve PPM.</h1>
      <p className="mt-3 text-muted-foreground">Se guarda en tu cuenta: se ve igual en todos tus dispositivos.</p>

      <div className="mt-6">
        <Segmented label="Tema" value={me.ui_theme} onChange={(v) => update.mutate({ ui_theme: v as "system" | "light" | "dark" })}
          options={[{ value: "system", label: "Sistema" }, { value: "light", label: "Claro" }, { value: "dark", label: "Oscuro" }]} />
      </div>

      <div className="mt-6 flex flex-col gap-1.5">
        <span className="text-caption font-semibold">Color de acento</span>
        <div role="radiogroup" aria-label="Color de acento" className="grid grid-cols-4 gap-2">
          {ACCENTS.map((a) => {
            const on = me.ui_accent === a.value;
            return (
              <button key={a.value} type="button" role="radio" aria-checked={on} onClick={() => update.mutate({ ui_accent: a.value })}
                className={`flex flex-col items-center gap-1.5 rounded-[12px] border-2 bg-card py-2.5 text-caption font-semibold ${on ? "border-primary" : "border-border"}`}>
                <span className={`grid size-9 place-items-center rounded-full swatch-${a.value}`}>
                  {on && <Icon name="check" fill className="text-[20px]" />}
                </span>
                {a.label}
              </button>
            );
          })}
        </div>
      </div>

      <section aria-label="Así se ve" className="mt-6 flex flex-col gap-3 rounded-lg border border-border bg-card p-4">
        <span className="text-label text-muted-foreground">Así se ve</span>
        <div className="flex items-center gap-2.5">
          <span className="grid h-8 place-items-center rounded-full bg-secondary px-3 text-caption font-semibold text-secondary-foreground">Pestaña activa</span>
          <span className="font-semibold text-primary-strong underline">Un enlace</span>
        </div>
        <span className="flex h-12 items-center justify-between rounded-xl bg-primary px-4 font-semibold text-primary-foreground">
          Registrar gasto<Icon name="arrow_forward" className="text-[22px]" />
        </span>
        <div className="flex flex-col gap-1.5">
          <div className="h-2.5 overflow-hidden rounded-full bg-muted"><div className="h-2.5 w-[52%] rounded-full bg-trigo" /></div>
          <span className="text-caption text-muted-foreground">La barra «para mayo» queda siempre en trigo: es el sello de PPM.</span>
        </div>
      </section>
      {update.error && <div className="mt-4"><ErrorAlert>{update.error.message}</ErrorAlert></div>}
    </main>
  );
}
