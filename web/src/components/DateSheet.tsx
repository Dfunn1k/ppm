// Elegir una fecha: el calendario de shadcn/ui (react-day-picker) en una hoja desde abajo, con atajos
// («Hoy», «Ayer» o los que pida la pantalla). Igual en todos los celulares y con los colores de PPM;
// nunca el calendario del navegador. Tocar el mes abre los 12 meses y tocar el año, los años: vistas
// propias, sin el selector del navegador. Al elegir un día, la hoja se cierra.
import { lazy, type ReactNode, Suspense, useId, useState } from "react";

import { useMe } from "@/api/hooks";
import { longDate, shortDate, todayISO } from "@/lib/dates";

import { Sheet } from "./Sheet";
import { Icon } from "./ui";

const DayGrid = lazy(() => import("./DayGrid"));   // el calendario, solo al abrir una fecha

export type Shortcut = { label: string; value: string };

const toDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
const MONTHS = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre",
  "Noviembre", "Diciembre"];
const FIRST_YEAR = 1990;
const toISO = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

/** Un día contado desde hoy: addDays(-1) es ayer. */
export function addDays(days: number, from = todayISO()): string {
  const d = toDate(from);
  d.setDate(d.getDate() + days);
  return toISO(d);
}

/** El último día del mes de esa fecha. */
export function endOfMonth(iso = todayISO()): string {
  const d = toDate(iso);
  return toISO(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

export const WHEN_SHORTCUTS = (): Shortcut[] => [{ label: "Hoy", value: todayISO() }, { label: "Ayer", value: addDays(-1) }];

/** El primer día que se puede tocar: el siguiente al cierre de periodo (Más › Cierre de periodo). */
export function useOpenFrom(): { from?: string; lock?: string } {
  const lock = useMe().data?.lock_date ?? undefined;
  return lock ? { from: addDays(1, lock), lock } : {};
}

const later = (a?: string, b?: string) => (!a ? b : !b ? a : a > b ? a : b);

export function DateSheet({ open, onClose, title, value, onChange, min: asked, max, shortcuts = WHEN_SHORTCUTS(), booked, children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  value: string | null;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  shortcuts?: Shortcut[];
  booked?: boolean;                   // la fecha de un asiento: los días cerrados no se pueden elegir
  children?: ReactNode;               // lo que va debajo: «Quitar la fecha», una nota
}) {
  const closed = useOpenFrom();
  const min = booked ? later(asked, closed.from) : asked;
  const [month, setMonth] = useState<Date>(toDate(value ?? todayISO()));
  const [view, setView] = useState<"days" | "months" | "years">("days");
  const pick = (iso: string) => { onChange(iso); onClose(); };
  const disabled = [...(min ? [{ before: toDate(min) }] : []), ...(max ? [{ after: toDate(max) }] : [])];
  const year = month.getFullYear();
  const lastYear = new Date().getFullYear() + 5;
  const fromYear = Math.max(FIRST_YEAR, min ? toDate(min).getFullYear() : FIRST_YEAR);
  const toYear = Math.min(lastYear, max ? toDate(max).getFullYear() : lastYear);
  // Un mes se puede elegir si algún día suyo está dentro de min..max
  const monthOk = (y: number, m: number) =>
    (!min || toISO(new Date(y, m + 1, 0)) >= min) && (!max || toISO(new Date(y, m, 1)) <= max);
  const step = (n: number) => {
    const next = view === "days" ? new Date(year, month.getMonth() + n, 1) : new Date(year + n, month.getMonth(), 1);
    if (next.getFullYear() >= fromYear && next.getFullYear() <= toYear) setMonth(next);
  };
  const cell = (on: boolean) =>
    `h-12 rounded-full text-[15px] font-semibold disabled:opacity-35 ${on ? "bg-primary text-primary-foreground" : ""}`;
  return (
    <Sheet title={title} open={open} onClose={onClose}>
      {shortcuts.length > 0 && view === "days" && (
        <div className="mx-3 flex flex-wrap gap-2">
          {shortcuts.map((s) => {
            const on = s.value === value;
            const out = (!!min && s.value < min) || (!!max && s.value > max);   // «Ayer» en un día cerrado
            return (
              <button key={s.label} type="button" aria-pressed={on} disabled={out} onClick={() => pick(s.value)}
                className={`h-9 rounded-full border px-3.5 text-caption font-semibold disabled:opacity-35 ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                {s.label}
              </button>
            );
          })}
        </div>
      )}
      <div className="mx-1 mt-3 flex h-10 items-center justify-between">
        {view !== "years" ? (
          <button type="button" aria-label={view === "days" ? "Mes anterior" : "Año anterior"} onClick={() => step(-1)}
            className="grid size-10 place-items-center rounded-full"><Icon name="chevron_left" className="text-[22px]" /></button>
        ) : <span className="size-10" />}
        <span className="flex items-center gap-1">
          {view === "days" && (
            <button type="button" aria-label={`Elegir el mes: ${MONTHS[month.getMonth()]}`} onClick={() => setView("months")}
              className="flex h-10 items-center gap-0.5 rounded-full px-2 font-semibold">
              {MONTHS[month.getMonth()]}<Icon name="expand_more" className="text-[20px] text-muted-foreground" />
            </button>
          )}
          <button type="button" aria-label={`Elegir el año: ${year}`} onClick={() => setView(view === "years" ? "days" : "years")}
            className="flex h-10 items-center gap-0.5 rounded-full px-2 font-semibold tabular-nums">
            {year}<Icon name={view === "years" ? "expand_less" : "expand_more"} className="text-[20px] text-muted-foreground" />
          </button>
        </span>
        {view !== "years" ? (
          <button type="button" aria-label={view === "days" ? "Mes siguiente" : "Año siguiente"} onClick={() => step(1)}
            className="grid size-10 place-items-center rounded-full"><Icon name="chevron_right" className="text-[22px]" /></button>
        ) : <span className="size-10" />}
      </div>
      {view === "months" && (
        <div role="group" aria-label={`Meses de ${year}`} className="mx-2 mt-2 grid grid-cols-3 gap-2">
          {MONTHS.map((name, m) => (
            <button key={name} type="button" aria-pressed={m === month.getMonth()} disabled={!monthOk(year, m)}
              onClick={() => { setMonth(new Date(year, m, 1)); setView("days"); }} className={cell(m === month.getMonth())}>
              {name.slice(0, 3)}
            </button>
          ))}
        </div>
      )}
      {view === "years" && (
        <div role="group" aria-label="Años" className="mx-2 mt-2 grid max-h-72 grid-cols-4 gap-2 overflow-y-auto">
          {Array.from({ length: toYear - fromYear + 1 }, (_, i) => toYear - i).map((y) => (
            <button key={y} type="button" aria-pressed={y === year} className={`${cell(y === year)} tabular-nums`}
              ref={(el) => { if (el && y === year) el.scrollIntoView({ block: "center" }); }}
              onClick={() => { setMonth(new Date(y, month.getMonth(), 1)); setView("months"); }}>
              {y}
            </button>
          ))}
        </div>
      )}
      {view === "days" && (
        <Suspense fallback={<div className="h-72" />}>
        <DayGrid
          mode="single"
          weekStartsOn={1}
          month={month}
          onMonthChange={setMonth}
          selected={value ? toDate(value) : undefined}
          onSelect={(d) => d && pick(toISO(d))}
          disabled={disabled}
          showOutsideDays={false}
          hideNavigation
          classNames={{
            root: "mx-1",
            month_caption: "sr-only",
            month_grid: "mt-1 w-full border-collapse",
            weekdays: "h-7",
            weekday: "text-[12px] font-semibold text-muted-foreground uppercase",
            day: "p-0.5 text-center",
            day_button: "mx-auto grid size-11 place-items-center rounded-full text-[15px] tabular-nums disabled:opacity-35",
            selected: "[&>button]:bg-primary [&>button]:font-semibold [&>button]:text-primary-foreground",
            today: "[&>button]:font-semibold [&>button]:ring-[1.5px] [&>button]:ring-foreground [&>button]:ring-inset",
            outside: "invisible",
            hidden: "invisible",
          }}
        />
        </Suspense>
      )}
      {booked && closed.lock && (
        <p className="mx-3 mt-3 flex items-start gap-2 text-caption text-muted-foreground">
          <Icon name="lock_clock" className="text-[18px]" />
          <span>Cerrado hasta el {shortDate(closed.lock)}. Para usar esos días, reábrelo en Más › Cierre de periodo.</span>
        </p>
      )}
      {children}
    </Sheet>
  );
}

/** «Hoy», «Ayer» o «12/11/2026». */
export function dateLabel(iso: string) {
  return iso === todayISO() ? "Hoy" : iso === addDays(-1) ? "Ayer" : longDate(iso);
}

/** Un campo de fecha de una línea (etiqueta arriba) que abre el calendario. */
export function DateField({ label, value, onChange, min, max, shortcuts, placeholder = "Elige una fecha", hint, sheetTitle, booked }: {
  label: string;
  value: string | null;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  shortcuts?: Shortcut[];
  placeholder?: string;
  hint?: ReactNode;
  sheetTitle?: string;
  booked?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="flex flex-col gap-1.5">
      <span id={`${id}-label`} className="text-caption font-semibold">{label}</span>
      <button type="button" aria-labelledby={`${id}-label ${id}-value`} aria-haspopup="dialog" onClick={() => setOpen(true)}
        className="flex h-11 items-center gap-2 border-b-2 border-input-line text-left text-[17px] leading-6">
        <span id={`${id}-value`} className={`min-w-0 flex-1 truncate ${value ? "" : "text-muted-foreground"}`}>
          {value ? dateLabel(value) : placeholder}
        </span>
        <Icon name="calendar_month" className="text-[22px] text-muted-foreground" />
      </button>
      {hint && <span className="text-caption text-muted-foreground">{hint}</span>}
      <DateSheet open={open} onClose={() => setOpen(false)} title={sheetTitle ?? label} value={value} onChange={onChange}
        min={min} max={max} booked={booked} shortcuts={shortcuts ?? (max === todayISO() ? WHEN_SHORTCUTS() : [])} />
    </div>
  );
}
