// La portada de acceso: «Pan / para / mayo.» con «mayo» en trigo (el sello de PPM) y el año a la vista.
const MONTHS = ["E", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const MAYO = 4;

export function Refran({ label = "PPM" }: { label?: string }) {
  const today = new Date().getMonth();
  return (
    <div className="flex flex-col gap-5">
      <span className="text-label text-muted-foreground">{label}</span>
      <h1 aria-label="Pan para mayo" className="text-title-display flex flex-col">
        <span>Pan</span>
        <span>para</span>
        <span className="-ml-3 self-start rounded-xl bg-trigo px-3 pb-1 text-on-trigo">mayo.</span>
      </h1>
      <div aria-hidden="true" className="flex flex-col gap-2">
        <div className="grid grid-cols-12 items-end gap-1">
          {MONTHS.map((_, i) => (
            <span
              key={i}
              className={
                i === MAYO ? "h-3.5 rounded-full bg-trigo" : i === today ? "h-1.5 rounded-full bg-foreground" : "h-1.5 rounded-full bg-border"
              }
            />
          ))}
        </div>
        <div className="grid grid-cols-12 gap-1 text-center text-[11px] leading-[14px] text-muted-foreground">
          {MONTHS.map((m, i) => (
            <span key={i} className={i === MAYO || i === today ? "font-bold text-foreground" : undefined}>
              {m}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
