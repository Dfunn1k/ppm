// X6 · Eliminar tu cuenta: como cerrar la cuenta en el banco. Se ve lo que se va, se firma con la
// contraseña (o con el correo, si la cuenta se creó con Google y no tiene) y se borra todo al instante.
import { formatCount } from "@/lib/money";
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { ApiError, useDeleteAccount, useDeletion, useMe } from "@/api/hooks";
import { BackLink } from "@/components/PageHeader";
import { ErrorAlert, Icon, LineField, PasswordField } from "@/components/ui";
import { Button, buttonVariants } from "@/components/Button";

const n = (v: number) => formatCount(v);

export function EliminarCuenta() {
  const navigate = useNavigate();
  const me = useMe().data;
  const what = useDeletion().data;
  const del = useDeleteAccount();
  const [value, setValue] = useState("");
  const [empty, setEmpty] = useState(false);
  if (!me) return null;
  const withPassword = me.has_password;
  const wrong = del.error instanceof ApiError && del.error.status === 400;

  const rows: [string, string, number | undefined][] = [
    ["account_balance_wallet", "Cuentas", what?.accounts],
    ["receipt_long", "Movimientos", what?.moves],
    ["attach_file", "Adjuntos", what?.attachments],
    ["event_repeat", "Recurrentes", what?.recurring],
  ];

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-8">
      <div className="-mx-2.5 flex min-h-control items-center">
        <BackLink to="/mas/cuenta" label="Volver a Mi cuenta" />
      </div>
      <h1 className="mt-4 text-title-hero">Eliminar tu cuenta</h1>
      <p className="mt-3 text-muted-foreground">
        Se borra al instante todo lo que registraste en PPM. <b className="text-foreground">No se puede deshacer.</b>
      </p>

      <Link to="/mas/cuenta/exportar" className="mt-5 flex min-h-row items-center gap-3 rounded-md border border-border bg-card px-3.5 py-2.5">
        <Icon name="download" size="md" className="text-muted-foreground" />
        <span className="flex flex-1 flex-col">
          <span className="font-semibold">¿Te llevas tus datos?</span>
          <span className="text-caption text-muted-foreground">Exporta un ZIP antes de borrar</span>
        </span>
        <Icon name="chevron_right" size="md" className="text-muted-foreground" />
      </Link>

      <dl aria-label="Lo que se borra" className="mt-4 flex flex-col rounded-md bg-muted px-3.5 py-1">
        {rows.map(([icon, label, count], i) => (
          <div key={label} className={`flex min-h-control items-center gap-3 ${i < rows.length - 1 ? "border-b border-border" : ""}`}>
            <Icon name={icon} className="text-muted-foreground" />
            <dt className="flex-1">{label}</dt>
            <dd className="font-semibold tabular-nums">{count === undefined ? "…" : n(count)}</dd>
          </div>
        ))}
      </dl>

      <div className="mt-5 flex items-start gap-2.5 rounded-md bg-destructive-soft p-3 text-caption text-destructive">
        <Icon name="info" />
        <span>Las copias de seguridad del servidor se renuevan solas: en 14 días ya no queda nada tuyo.</span>
      </div>

      <form noValidate className="mt-6 flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (!value.trim()) { setEmpty(true); return; }
          del.mutate(withPassword ? { password: value } : { email: value },
            { onSuccess: () => navigate("/entrar?cuenta=eliminada", { replace: true }) });
        }}>
        {withPassword
          ? <PasswordField label="Tu contraseña de PPM" autoComplete="current-password" value={value} hint="Para confirmar que eres tú"
              onChange={(e) => { setValue(e.target.value); setEmpty(false); del.reset(); }}
              error={empty ? "Escribe tu contraseña" : wrong ? "No es tu contraseña" : undefined} />
          : <LineField label="Escribe tu correo" type="email" autoComplete="off" value={value} hint={`Para confirmar: ${me.email}`}
              onChange={(e) => { setValue(e.target.value); setEmpty(false); del.reset(); }}
              error={empty ? "Escribe tu correo" : wrong ? "No es tu correo" : undefined} />}
        {del.error && !wrong && <ErrorAlert>{del.error.message}</ErrorAlert>}
        <Button type="submit" variant="destructive" icon="delete_forever" pending={del.isPending}>Eliminar mi cuenta</Button>
        <Link to="/mas/cuenta" className={buttonVariants({ variant: "ghost", size: "sm" })}>No, volver</Link>
      </form>
    </main>
  );
}
