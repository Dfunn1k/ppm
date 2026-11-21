import { useNavigate } from "react-router";

import { useCatalog, useMe } from "@/api/hooks";
import { SheetSelect } from "@/components/Sheet";
import { FormatSample, Icon, PrimaryButton, Screen } from "@/components/ui";
import { formatAmount } from "@/lib/money";

import { BASE_CURRENCY, StepHeader, useWizard } from "./wizard";

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
        <span className="flex flex-wrap items-center gap-x-3 text-caption text-muted-foreground tabular-nums">
          <span className="inline-flex items-center gap-1"><Icon name="today" className="text-[15px]" />Hoy es {today}</span>
          <span className="inline-flex items-center gap-1"><Icon name="lock" className="text-[15px]" />Todo en {base.name}, la moneda de tu país</span>
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
        <SheetSelect
          label="País"
          sheetTitle="Elige tu país"
          value={choices.country}
          onChange={(country) => update({ country })}
          options={(catalog?.countries ?? []).map((c) => ({
            value: c.code,
            label: c.name,
            hint: BASE_CURRENCY[c.code] ? `Moneda: ${BASE_CURRENCY[c.code]!.name} (${BASE_CURRENCY[c.code]!.symbol})` : undefined,
          }))}
        />
        <SheetSelect
          label="Idioma y formato"
          value={choices.lang}
          onChange={(lang) => update({ lang })}
          options={(catalog?.langs ?? []).map((l) => ({
            value: l.code,
            label: l.name,
            detail: <FormatSample amount={formatAmount(1284.9, base.symbol, l.code)} date={today} />,
          }))}
        />
        <div className="flex flex-col gap-1.5">
          <SheetSelect
            label="Zona horaria"
            value={choices.tz}
            onChange={(tz) => update({ tz })}
            options={zones().map((z) => ({
              value: z,
              label: ZONE_NAME[z] ?? z.replace("_", " "),
              hint: z === "America/Lima" ? "La de tu país" : "La de este dispositivo",
            }))}
          />
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
