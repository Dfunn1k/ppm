// X6 · Mi cuenta: cambiar contraseña, cerrar sesión en todos lados y cerrar sesión.
import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link, useNavigate } from "react-router";
import { z } from "zod";

import { ApiError, useChangePassword, useLogout, useLogoutAll, useMe } from "@/api/hooks";
import { Sheet } from "@/components/Sheet";
import { ErrorAlert, Icon, PasswordField, PrimaryButton } from "@/components/ui";
import { CURRENCY_NAME } from "@/lib/money";

const schema = z.object({
  current: z.string().min(1, { error: "Escribe tu contraseña actual" }),
  next: z.string().min(8, { error: "Usa al menos 8 caracteres" }).max(128, { error: "Usa 128 caracteres o menos" }),
});

function Row({ icon, title, hint, onClick, disabled }: { icon: string; title: string; hint: string; onClick?: () => void; disabled?: boolean }) {
  const body = (
    <>
      <Icon name={icon} className="w-9 text-center text-[22px] text-muted-foreground" />
      <span className="flex flex-1 flex-col">
        <span className="font-semibold">{title}</span>
        <span className="text-caption text-muted-foreground">{hint}</span>
      </span>
    </>
  );
  return disabled
    ? <div aria-disabled="true" className="flex min-h-[60px] items-center gap-3.5 border-b border-border text-muted-foreground">{body}</div>
    : <button type="button" onClick={onClick} className="flex min-h-[60px] items-center gap-3.5 border-b border-border text-left">{body}</button>;
}

export function MiCuenta() {
  const navigate = useNavigate();
  const me = useMe().data;
  const logout = useLogout();
  const logoutAll = useLogoutAll();
  const [sheet, setSheet] = useState<null | "password" | "everywhere">(null);
  const [done, setDone] = useState(false);
  if (!me) return null;
  const currencies = me.currencies.map((c) => CURRENCY_NAME[c] ?? c).join(" y ");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-8">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/mas" aria-label="Volver a Más" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
      </div>
      <h1 className="mt-6 text-title-hero">{me.name}</h1>
      <span className="mt-2 text-muted-foreground">{me.email} · {currencies}</span>
      {done && (
        <div role="status" className="mt-4 flex items-start gap-2 rounded-md bg-muted p-3 text-caption">
          <Icon name="check_circle" fill className="text-income" /><span>Contraseña cambiada. Tus otras sesiones se cerraron.</span>
        </div>
      )}

      <div className="mt-6 flex flex-col">
        <Row icon="key" title="Cambiar contraseña" hint="Cierra tus otras sesiones; esta sigue abierta" onClick={() => setSheet("password")} />
        <Row icon="devices" title="Cerrar sesión en todos lados" hint="Si dejaste tu cuenta abierta en otro equipo" onClick={() => setSheet("everywhere")} />
        <Row icon="download" title="Exportar mis datos" hint="Muy pronto" disabled />
        <Row icon="person_remove" title="Eliminar mi cuenta" hint="Muy pronto" disabled />
      </div>

      <div className="min-h-8 flex-1" />
      {logout.error && <ErrorAlert>{logout.error.message}</ErrorAlert>}
      <button type="button" disabled={logout.isPending}
        onClick={() => logout.mutate(undefined, { onSuccess: () => navigate("/entrar", { replace: true }) })}
        className="flex h-14 items-center justify-center gap-2 rounded-xl border border-input-line font-semibold">
        <Icon name="logout" className="text-[22px]" />Cerrar sesión
      </button>

      <PasswordSheet open={sheet === "password"} onClose={() => setSheet(null)} onDone={() => { setSheet(null); setDone(true); }} />
      <Sheet title="¿Cerrar sesión en todos lados?" open={sheet === "everywhere"} onClose={() => setSheet(null)}>
        <div className="flex flex-col gap-4 px-3">
          <p className="text-muted-foreground">Se cierra en este equipo y en cualquier otro donde hayas entrado. Luego entras con tu correo y contraseña.</p>
          {logoutAll.error && <ErrorAlert>{logoutAll.error.message}</ErrorAlert>}
          <PrimaryButton type="button" pending={logoutAll.isPending}
            onClick={() => logoutAll.mutate(undefined, { onSuccess: () => navigate("/entrar", { replace: true }) })}>
            Cerrar en todos lados
          </PrimaryButton>
          <button type="button" onClick={() => setSheet(null)} className="h-11 text-caption font-semibold text-primary-strong underline">Cancelar</button>
        </div>
      </Sheet>
    </main>
  );
}

function PasswordSheet({ open, onClose, onDone }: { open: boolean; onClose: () => void; onDone: () => void }) {
  const change = useChangePassword();
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { current: "", next: "" } });
  const { errors } = form.formState;
  const wrong = change.error instanceof ApiError && change.error.status === 400;
  return (
    <Sheet title="Cambiar contraseña" open={open} onClose={onClose}>
      <form noValidate className="flex flex-col gap-4 px-3"
        onSubmit={form.handleSubmit((v) => change.mutate({ current_password: v.current, new_password: v.next }, {
          onSuccess: () => { form.reset(); onDone(); },
        }))}>
        <PasswordField label="Contraseña actual" autoComplete="current-password"
          error={errors.current?.message ?? (wrong ? "No es tu contraseña actual" : undefined)} {...form.register("current")} />
        <PasswordField label="Contraseña nueva" autoComplete="new-password" hint="Al menos 8 caracteres."
          error={errors.next?.message} {...form.register("next")} />
        {change.error && !wrong && <ErrorAlert>{change.error.message}</ErrorAlert>}
        <PrimaryButton pending={change.isPending}>Guardar contraseña</PrimaryButton>
      </form>
    </Sheet>
  );
}
