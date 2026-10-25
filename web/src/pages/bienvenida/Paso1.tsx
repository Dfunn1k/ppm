import { useNavigate } from "react-router";

import { useCatalog, useMe } from "@/api/hooks";
import { Icon, PrimaryButton, Screen } from "@/components/ui";
import { formatAmount } from "@/lib/money";

import { BASE_CURRENCY, StepHeader, useWizard } from "./wizard";

const select =
  "h-11 border-0 border-b-2 border-input-line bg-transparent p-0 text-[17px] leading-6 text-foreground";

/** Zonas que tiene sentido ofrecer: la del país y la del dispositivo, si es otra. */
function zones() {
  const device = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return [...new Set(["America/Lima", device])].filter(Boolean);
}
const ZONE_NAME: Record<string, string> = { "America/Lima": "Lima (UTC −5)" };

export function Paso1() {
  const navigate = useNavigate();
  const me = useMe().data;
  const catalog = useCatalog().data;
  const { choices, update } = useWizard();
  const base = BASE_CURRENCY[choices.country] ?? BASE_CURRENCY.PE!;
  const today = new Date().toLocaleDateString("es-PE", { day: "2-digit", month: "2-digit", year: "numeric" });

  return (
    <Screen>
      <StepHeader step={1} summary={`Hola, ${me?.name ?? ""}`} />
      <h1 className="mt-10 text-title-hero">¿Dónde vives?</h1>
      <p className="mt-4 text-muted-foreground">Con esto elegimos tu moneda y cómo se ven los números y las fechas.</p>

      <section aria-label="Vista previa" className="mt-6 flex flex-col gap-1 rounded-lg border border-border bg-card p-4 shadow-sm">
        <span className="text-label text-muted-foreground">Así verás tu inicio</span>
        <span className="mt-1 text-caption text-muted-foreground">Lo que realmente tengo</span>
        <span className="text-[36px] leading-10 font-semibold tracking-[-0.02em] tabular-nums">
          {formatAmount(1284.9, base.symbol, choices.lang)}
        </span>
        <span className="text-caption text-muted-foreground tabular-nums">
          Hoy, {today} · en {base.name}, la moneda de tu país. No se cambia.
        </span>
      </section>

      <div className="min-h-6 flex-1" />
      <form
        className="flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault();
          navigate("/bienvenida/2");
        }}
      >
        <label className="flex flex-col gap-1.5 text-caption font-semibold">
          País
          <select className={select} value={choices.country} onChange={(e) => update({ country: e.target.value })}>
            {catalog?.countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-caption font-semibold">
          Idioma y formato
          <select className={select} value={choices.lang} onChange={(e) => update({ lang: e.target.value })}>
            {catalog?.langs.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="flex flex-col gap-1.5">
          <label className="flex flex-col gap-1.5 text-caption font-semibold">
            Zona horaria
            <select className={select} value={choices.tz} onChange={(e) => update({ tz: e.target.value })}>
              {zones().map((z) => (
                <option key={z} value={z}>
                  {ZONE_NAME[z] ?? z.replace("_", " ")}
                </option>
              ))}
            </select>
          </label>
          <span className="flex items-center gap-1 text-caption text-muted-foreground">
            <Icon name="schedule" className="text-[18px]" />
            Define qué es «hoy» para tus movimientos y recordatorios.
          </span>
        </div>
        <PrimaryButton disabled={!catalog}>Siguiente</PrimaryButton>
      </form>
    </Screen>
  );
}
