// Piezas del diseño de acceso (sistema de diseño «PPM»): campos de una línea, botón principal,
// avisos e íconos. Las pantallas se arman solo con esto y con clases de los tokens.
import { type ComponentProps, type ReactNode, useId, useState } from "react";
import { Link, type LinkProps } from "react-router";

import { buttonVariants } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { cn } from "@/lib/utils";

export { Icon };


/** La pantalla de acceso: una columna centrada del ancho de un celular. */
export function Screen({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <main className={cn("mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-10 pb-8", className)}>
      {children}
    </main>
  );
}

const primary = buttonVariants({ variant: "primary" });

/** El botón principal: texto a la izquierda y flecha a la derecha (es `Button` con `type="submit"`). */
export function PrimaryButton({ children, pending, ...props }: ComponentProps<"button"> & { pending?: boolean }) {
  return (
    <button type="submit" className={primary} aria-busy={pending || undefined} disabled={pending || props.disabled} {...props}>
      <span>{children}</span>
      <Icon name={pending ? "progress_activity" : "arrow_forward"} size="md" className={cn(pending && "animate-spin")} />
    </button>
  );
}

export function PrimaryLink({ children, ...props }: LinkProps) {
  return (
    <Link className={primary} {...props}>
      <span>{children}</span>
      <Icon name="arrow_forward" size="md" />
    </Link>
  );
}

/** Enlace de texto subrayado en el color del acento. */
export function TextLink({ className, ...props }: LinkProps) {
  return <Link className={cn("hit-area font-semibold text-primary-strong underline", className)} {...props} />;
}

type FieldProps = ComponentProps<"input"> & { label: string; error?: string; hint?: ReactNode; action?: ReactNode; optional?: boolean };

/** «Opcional», tenue, a la derecha del rótulo de un campo que se puede dejar vacío (caso 3 de «Sin punto como conector»). */
export function Optional() {
  return <span className="flex-none text-caption font-normal text-muted-foreground">Opcional</span>;
}

/** Montos en varias monedas, uno por línea y alineados a la derecha, como una columna de montos (caso 6
 * de «Sin punto como conector»): «S/ 1,284.90» y debajo «US$ 45.00», sin signo que los una. */
export function Amounts({ values, className }: { values: string[]; className?: string }) {
  if (values.length < 2) return <span className={className}>{values[0] ?? ""}</span>;
  return (
    <span className={cn("inline-flex flex-col items-end text-right", className)}>
      {values.map((v) => <span key={v}>{v}</span>)}
    </span>
  );
}

/** Un estado con su ícono (caso 5 de «Sin punto como conector»): «Por confirmar», «Pausada», «Archivada».
 * En ámbar si pide algo de ti; si no, del color del texto que lo rodea. Su detalle va al lado, sin «·». */
export function Status({ icon, children, attention, className }: { icon: string; children: ReactNode; attention?: boolean; className?: string }) {
  return (
    <span className={cn("inline-flex flex-none items-center gap-1 font-semibold normal-case tracking-normal", attention && "text-attention", className)}>
      <Icon name={icon} size="sm" />{children}
    </span>
  );
}

/** Un dato de una ficha: su nombre y su valor; `false` o `null` no se muestran. */
export type Fact = readonly [label: string, value: ReactNode] | false | null | undefined | "";

/** Datos sueltos como etiqueta y valor (caso 7 de «Sin punto como conector»): una ficha chica, el nombre
 * arriba en mayúsculas y el dato abajo, lado a lado. «PAGAR ANTES DEL 20 nov» junto a «FALTAN 3 días».
 * En ámbar si pide algo de ti. */
export function Facts({ items, attention, className }: { items: Fact[]; attention?: boolean; className?: string }) {
  const xs = items.filter(Boolean) as (readonly [string, ReactNode])[];
  return (
    <span className={cn("inline-flex flex-wrap gap-x-4 gap-y-1 text-left", className)}>
      {xs.map(([label, value], i) => (
        <span key={label} className="flex flex-col">
          {/* Para el lector de pantalla se lee «Faltan: 3 días, …» */}
          <span className="text-label text-muted-foreground">
            {i > 0 && <span className="sr-only">, </span>}{label}<span className="sr-only">: </span>
          </span>
          <span className={cn("text-caption font-semibold text-foreground tabular-nums normal-case tracking-normal", attention && "text-attention")}>{value}</span>
        </span>
      ))}
    </span>
  );
}

/** Avance en partes, como la barra de cuotas (caso 7): una rayita por parte, llena si ya pasó. Con
 * muchas partes, una sola barra. */
export function Segments({ done, total, className }: { done: number; total: number; className?: string }) {
  if (total > 24) {
    return (
      <span className={cn("block h-1.5 overflow-hidden rounded-full bg-border", className)} aria-hidden="true">
        <span className="block h-full rounded-full bg-foreground" style={{ width: `${Math.round((done / total) * 100)}%` }} />
      </span>
    );
  }
  return (
    <span className={cn("flex gap-0.5", className)} aria-hidden="true">
      {Array.from({ length: total }, (_, i) => <span key={i} className={cn("h-1.5 flex-1 rounded-xs", i < done ? "bg-foreground" : "bg-border")} />)}
    </span>
  );
}

/** El ejemplo de un formato de números y fechas como una fila de Movimientos (caso 7): se ve tal como
 * quedará, sin unir el monto y la fecha con un signo. */
export function FormatSample({ amount, date }: { amount: string; date: string }) {
  return (
    <span className="mt-1 flex items-center gap-2 rounded-md border border-border bg-card px-2.5 py-1.5">
      <span className="flex flex-1 flex-col">
        <span className="text-caption font-semibold text-foreground">Almuerzo</span>
        <span className="text-caption-sm text-muted-foreground">{date}</span>
      </span>
      <span className="text-caption font-semibold text-foreground tabular-nums">{amount}</span>
    </span>
  );
}

/** Campo de una sola línea: etiqueta arriba y una línea de 2px abajo, sin caja. */
export function LineField({ label, error, hint, action, optional, className, ...props }: FieldProps) {
  const id = useId();
  const describedBy = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="flex justify-between gap-2 text-caption font-semibold">
        {label}{optional && <Optional />}
      </label>
      <div className="relative flex">
        <input
          id={id}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={cn(
            "h-11 min-w-0 flex-1 border-0 border-b-2 border-input-line bg-transparent p-0 text-body-lg text-foreground aria-invalid:border-destructive",
            action && "pr-20",
            className,
          )}
          {...props}
        />
        {action}
      </div>
      {error ? (
        <span id={`${id}-error`} className="flex items-center gap-1 text-caption text-destructive">
          <Icon name="error" size="sm" />
          {error}
        </span>
      ) : (
        hint && (
          <span id={`${id}-hint`} className="text-caption text-muted-foreground">
            {hint}
          </span>
        )
      )}
    </div>
  );
}

/** Contraseña con el botón «Mostrar» / «Ocultar». */
export function PasswordField(props: Omit<FieldProps, "type" | "action">) {
  const [show, setShow] = useState(false);
  return (
    <LineField
      {...props}
      type={show ? "text" : "password"}
      action={
        <button
          type="button"
          aria-pressed={show}
          onClick={() => setShow(!show)}
          className="absolute top-0 right-0 h-11 pl-3 text-caption font-semibold text-primary-strong"
        >
          {show ? "Ocultar" : "Mostrar"}
        </button>
      }
    />
  );
}

/** Aviso de error: dice qué pasó y cómo seguir. */
export function ErrorAlert({ children }: { children: ReactNode }) {
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md bg-destructive-soft p-3 text-caption text-destructive">
      <Icon name="error" />
      <span>{children}</span>
    </div>
  );
}

/** Nota tranquila en gris, con su ícono. */
export function Note({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="flex items-start gap-2 rounded-md bg-muted p-3 text-caption text-muted-foreground">
      <Icon name={icon} />
      <span>{children}</span>
    </div>
  );
}

export function Spinner() {
  return (
    <Screen className="items-center justify-center">
      <Icon name="progress_activity" size="lg" className="animate-spin text-muted-foreground" />
      <span className="sr-only">Cargando</span>
    </Screen>
  );
}
