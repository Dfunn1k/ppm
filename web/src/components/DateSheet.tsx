// Elegir una fecha: el calendario de shadcn/ui (react-day-picker) en una hoja desde abajo, con atajos
// («Hoy», «Ayer» o los que pida la pantalla). Igual en todos los celulares y con los colores de PPM;
// nunca el calendario del navegador. Al elegir un día, la hoja se cierra.
import { type ReactNode, useId, useState } from "react";
import { DayPicker } from "react-day-picker";
import { es } from "react-day-picker/locale";

import { longDate, todayISO } from "@/lib/dates";

import { Sheet } from "./Sheet";
import { Icon } from "./ui";

export type Shortcut = { label: string; value: string };

const toDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y!, m! - 1, d!);
};
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

export function DateSheet({ open, onClose, title, value, onChange, min, max, shortcuts = WHEN_SHORTCUTS(), children }: {
  open: boolean;
  onClose: () => void;
  title: string;
  value: string | null;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  shortcuts?: Shortcut[];
  children?: ReactNode;               // lo que va debajo: «Quitar la fecha», una nota
}) {
  const [month, setMonth] = useState<Date>(toDate(value ?? todayISO()));
  const pick = (iso: string) => { onChange(iso); onClose(); };
  const disabled = [...(min ? [{ before: toDate(min) }] : []), ...(max ? [{ after: toDate(max) }] : [])];
  return (
    <Sheet title={title} open={open} onClose={onClose}>
      {shortcuts.length > 0 && (
        <div className="mx-3 flex flex-wrap gap-2">
          {shortcuts.map((s) => {
            const on = s.value === value;
            return (
              <button key={s.label} type="button" aria-pressed={on} onClick={() => pick(s.value)}
                className={`h-9 rounded-full border px-3.5 text-caption font-semibold ${on ? "border-primary bg-primary text-primary-foreground" : "border-border"}`}>
                {s.label}
              </button>
            );
          })}
        </div>
      )}
      <DayPicker
        mode="single"
        locale={es}
        weekStartsOn={1}
        month={month}
        onMonthChange={setMonth}
        selected={value ? toDate(value) : undefined}
        onSelect={(d) => d && pick(toISO(d))}
        disabled={disabled}
        showOutsideDays={false}
        captionLayout="dropdown"
        startMonth={new Date(1990, 0)}
        endMonth={new Date(new Date().getFullYear() + 5, 11)}
        classNames={{
          root: "mx-1 mt-3",
          months: "relative",
          month_caption: "flex h-10 items-center justify-center font-semibold capitalize",
          dropdowns: "flex items-center gap-3",
          dropdown_root: "relative inline-flex items-center",
          dropdown: "absolute inset-0 cursor-pointer opacity-0",
          caption_label: "flex items-center gap-0.5 font-semibold capitalize [&>svg]:hidden",
          nav: "absolute inset-x-0 top-0 flex h-10 items-center justify-between",
          button_previous: "grid size-10 place-items-center rounded-full disabled:opacity-30",
          button_next: "grid size-10 place-items-center rounded-full disabled:opacity-30",
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
        components={{
          Chevron: ({ orientation }) => <Icon name={orientation === "left" ? "chevron_left" : "chevron_right"} className="text-[22px]" />,
        }}
      />
      {children}
    </Sheet>
  );
}

/** «Hoy», «Ayer» o «12/11/2026». */
export function dateLabel(iso: string) {
  return iso === todayISO() ? "Hoy" : iso === addDays(-1) ? "Ayer" : longDate(iso);
}

/** Un campo de fecha de una línea (etiqueta arriba) que abre el calendario. */
export function DateField({ label, value, onChange, min, max, shortcuts, placeholder = "Elige una fecha", hint, sheetTitle }: {
  label: string;
  value: string | null;
  onChange: (iso: string) => void;
  min?: string;
  max?: string;
  shortcuts?: Shortcut[];
  placeholder?: string;
  hint?: ReactNode;
  sheetTitle?: string;
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
        min={min} max={max} shortcuts={shortcuts ?? (max === todayISO() ? WHEN_SHORTCUTS() : [])} />
    </div>
  );
}
