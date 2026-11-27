// X6 · Exportar tus datos: como pedirle al banco el historial antes de cerrar la cuenta. Un ZIP con
// datos.json (el respaldo, fiel al modelo), csv/ (una tabla por archivo, para Excel) y adjuntos/,
// que se pueden dejar fuera si pesan mucho. Se arma al momento y no queda en el servidor.
import { formatCount } from "@/lib/money";
import { type ReactNode, useState } from "react";
import { Link } from "react-router";

import { useExportSummary, useExportZip } from "@/api/hooks";
import { BackLink } from "@/components/PageHeader";
import { ErrorAlert, Facts, Icon } from "@/components/ui";
import { Button, buttonVariants } from "@/components/Button";
import { cn } from "@/lib/utils";

const n = (v: number) => formatCount(v);

/** 18.3 MB, 640 KB: lo que se ve en el botón. */
function size(bytes: number) {
  if (bytes >= 1024 * 1024) return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

export function ExportarDatos() {
  const what = useExportSummary().data;
  const zip = useExportZip();
  const [withFiles, setWithFiles] = useState(true);
  const files = what?.attachments ?? 0;

  const contents: [string, string, ReactNode, boolean?][] = [
    ["data_object", "datos.json", "Todo, tal como lo guarda PPM: tu respaldo"],
    ["table", "csv/", "Una tabla por archivo, para Excel o Sheets"],
    ["attach_file", "adjuntos/", withFiles
      ? <Facts items={[["Tal como los subiste", `${n(files)} ${files === 1 ? "foto o PDF" : "fotos y PDF"}`], what && ["Pesan", size(what.attachments_bytes)]]} />
      : "No va: solo sus nombres en datos.json", !withFiles],
  ];
  const counts: [string, number | undefined][] = [
    ["Cuentas", what?.accounts], ["Movimientos", what?.moves], ["Categorías", what?.categories],
    ["Personas", what?.partners], ["Recurrentes", what?.recurring], ["Adjuntos", withFiles ? what?.attachments : 0],
  ];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-8">
      <div className="-mx-2.5 flex min-h-control items-center">
        <BackLink to="/mas/cuenta" label="Volver a Mi cuenta" />
      </div>
      <h1 className="mt-4 text-title-hero">Exportar tus datos</h1>
      <p className="mt-3 text-muted-foreground">
        Un ZIP con todo lo que registraste en PPM. Se arma ahora, solo con lo tuyo, y no queda guardado en el servidor.
      </p>

      <h2 className="mt-6 text-label text-muted-foreground">QUÉ TRAE EL ZIP</h2>
      <ul aria-label="Qué trae el ZIP" className="mt-2 flex flex-col rounded-md bg-muted px-3.5 py-1">
        {contents.map(([icon, name, hint, off], i) => (
          <li key={name} className={`flex min-h-row items-center gap-3 ${i < contents.length - 1 ? "border-b border-border" : ""} ${off ? "text-muted-foreground" : ""}`}>
            <Icon name={icon} className="text-muted-foreground" />
            <span className="flex flex-1 flex-col">
              <span className={`font-mono text-body-sm font-medium ${off ? "line-through" : ""}`}>{name}</span>
              <span className="text-caption text-muted-foreground">{hint}</span>
            </span>
          </li>
        ))}
      </ul>

      <label className="mt-3 flex min-h-14 cursor-pointer items-center gap-3.5">
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">Incluir adjuntos</span>
          <span className="text-caption text-muted-foreground">Si pesan mucho, déjalos fuera</span>
        </span>
        <input type="checkbox" role="switch" checked={withFiles} className="size-6 accent-primary"
          onChange={() => { setWithFiles(!withFiles); zip.reset(); }} />
      </label>

      <h2 className="mt-5 text-label text-muted-foreground">LO QUE VA ADENTRO</h2>
      <dl aria-label="Lo que va adentro" className="mt-2 grid grid-cols-2 gap-2">
        {counts.map(([label, count]) => (
          <div key={label} className="rounded-md border border-border bg-card px-3 py-2.5">
            <dt className="text-caption text-muted-foreground">{label}</dt>
            <dd className="font-bold tabular-nums">
              {count === undefined ? "…" : label === "Adjuntos" && !withFiles ? `0 de ${n(files)}` : n(count)}
            </dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-caption text-muted-foreground">
        Los montos van con punto decimal y las fechas como 2026-11-15, para que cualquier programa las lea igual.
      </p>

      {zip.data && (
        <div role="status" className="mt-5 flex items-start gap-2 rounded-md bg-muted p-3 text-caption">
          <Icon name="check_circle" fill className="text-income" />
          <span><b>Listo.</b> Se descargó <span className="font-mono">{zip.data.name}</span> ({size(zip.data.size)}). En el celular queda en Descargas.</span>
        </div>
      )}
      {zip.error && <div className="mt-5"><ErrorAlert>{zip.error.message}</ErrorAlert></div>}

      <Button icon="download" pending={zip.isPending} disabled={!what} onClick={() => zip.mutate(withFiles)} className="mt-5">
        {zip.isPending ? "Armando tu ZIP…" : <>Descargar ZIP{what && withFiles && what.attachments_bytes > 0 ? ` (${size(what.attachments_bytes)})` : ""}</>}
      </Button>
      <Link to="/mas/cuenta" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "mt-3")}>Volver</Link>
    </main>
  );
}
