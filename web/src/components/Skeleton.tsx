import type { ReactNode } from "react";
import { Link } from "react-router";
import { Icon } from "@/components/ui";
import { cn } from "@/lib/utils";

/* Siluetas mientras llegan los datos: la forma de lo que viene, en vez de una pantalla en blanco.
   Laten despacio y no se anuncian una por una: el lector de pantalla oye «Cargando» una vez. */

export function Bone({ className }: { className?: string }) {
  return <span aria-hidden="true" className={cn("block animate-pulse rounded-md bg-foreground/8", className)} />;
}

/** Una fila de lista: el círculo del ícono, dos líneas de texto y el monto. */
export function BoneRow() {
  return (
    <div aria-hidden="true" className="flex min-h-[60px] items-center gap-3 border-b border-border">
      <Bone className="size-9 flex-none rounded-full" />
      <span className="flex flex-1 flex-col gap-1.5">
        <Bone className="h-3.5 w-1/2" />
        <Bone className="h-3 w-4/5" />
      </span>
      <Bone className="h-3.5 w-16" />
    </div>
  );
}

export function BoneRows({ count = 4, label = true }: { count?: number; label?: boolean }) {
  return (
    <div aria-hidden="true" className="mt-5 flex flex-col">
      {label && <div className="border-b border-border pb-1"><Bone className="h-3 w-28" /></div>}
      {Array.from({ length: count }, (_, i) => <BoneRow key={i} />)}
    </div>
  );
}

function Loading({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main aria-busy="true" className={cn("mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pb-28", className)}>
      <span role="status" className="sr-only">Cargando</span>
      {children}
    </main>
  );
}

function Back({ to }: { to?: string }) {
  return (
    <div className="-mx-2.5 flex h-11 items-center">
      {to ? (
        <Link to={to} aria-label="Volver" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
      ) : <span className="grid size-11 place-items-center text-muted-foreground"><Icon name="arrow_back" className="text-[24px]" /></span>}
    </div>
  );
}

/** Inicio: el mes, el saldo grande, la tarjeta de Para mayo y las categorías. */
export function HomeSkeleton() {
  return (
    <Loading className="pt-6">
      <div className="flex items-center justify-between"><Bone className="h-7 w-44" /><Bone className="size-9 rounded-full" /></div>
      <span className="mt-6 text-caption text-muted-foreground">Lo que realmente tengo hoy</span>
      <Bone className="mt-1.5 h-11 w-3/4 rounded-xl" />
      <Bone className="mt-2.5 h-3.5 w-1/2" />
      <div aria-hidden="true" className="mt-5 flex flex-col gap-2.5 rounded-xl border border-border bg-card p-4">
        <Bone className="h-3 w-36" />
        <Bone className="h-2 w-full rounded-full" />
        <Bone className="h-4 w-3/5" />
        <div className="flex gap-4"><Bone className="h-8 flex-1" /><Bone className="h-8 flex-1" /></div>
      </div>
      <BoneRows count={3} />
    </Loading>
  );
}

/** Una pantalla de detalle (cuenta, tarjeta, movimiento, persona): flecha, nombre, monto y su lista. */
export function DetailSkeleton({ back, rows = 5 }: { back?: string; rows?: number }) {
  return (
    <Loading className="pt-4">
      <Back to={back} />
      <Bone className="mt-2 h-3 w-32" />
      <Bone className="mt-2.5 h-11 w-2/3 rounded-xl" />
      <Bone className="mt-5 h-3.5 w-20" />
      <Bone className="mt-2 h-9 w-1/2 rounded-xl" />
      <BoneRows count={rows} />
    </Loading>
  );
}

/** Una lista principal (Cuentas, Personas): etiqueta, total grande y filas. */
export function ListSkeleton({ back, title }: { back?: string; title?: string }) {
  return (
    <Loading className={back ? "pt-4" : "pt-8"}>
      {back && <Back to={back} />}
      {title ? <h1 className="mt-3 text-title-hero">{title}</h1> : <Bone className="h-3 w-24" />}
      <Bone className="mt-5 h-3.5 w-36" />
      <Bone className="mt-2 h-11 w-3/4 rounded-xl" />
      <BoneRows count={5} />
    </Loading>
  );
}

/** Lo que va debajo del título y el periodo de un reporte: el gráfico y la lista. */
export function ReportBones({ chart = "donut" }: { chart?: "donut" | "bars" }) {
  return (
    <div aria-busy="true" className="flex flex-col">
      <span role="status" className="sr-only">Cargando</span>
      {chart === "donut" ? (
        <div aria-hidden="true" className="flex items-center gap-5">
          <span className="size-[148px] flex-none animate-pulse rounded-full border-[26px] border-foreground/8" />
          <span className="flex flex-1 flex-col gap-2"><Bone className="h-3 w-1/2" /><Bone className="h-8 w-11/12 rounded-xl" /><Bone className="h-3 w-3/4" /></span>
        </div>
      ) : (
        <div aria-hidden="true" className="flex flex-col gap-2"><Bone className="h-3 w-1/3" /><Bone className="h-9 w-2/3 rounded-xl" /><Bone className="mt-3 h-40 w-full rounded-lg" /></div>
      )}
      <BoneRows count={3} />
    </div>
  );
}
