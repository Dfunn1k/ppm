// A1 · Une tu cuenta con Google: volviendo de Google con un correo que ya tiene cuenta en PPM, su
// contraseña una sola vez (así nadie que haya creado antes una cuenta con tu correo se queda con ella).
import { useState } from "react";
import { Link, useNavigate } from "react-router";

import { ApiError, useGooglePending, useGooglePendingConfirm } from "@/api/hooks";
import { GoogleMark } from "@/components/GoogleButton";
import { ErrorAlert, Icon, PasswordField, PrimaryButton, Screen } from "@/components/ui";

export function UnirGoogle() {
  const navigate = useNavigate();
  const pending = useGooglePending();
  const confirm = useGooglePendingConfirm();
  const [password, setPassword] = useState("");
  const [empty, setEmpty] = useState(false);

  const wrong = confirm.error instanceof ApiError && confirm.error.status === 401;
  const p = pending.data;

  return (
    <Screen className="pt-4">
      <div className="-mx-2.5 flex items-center">
        <Link to="/entrar" aria-label="Volver a iniciar sesión" className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></Link>
      </div>
      <h1 className="mt-4 text-title-hero">Une tu cuenta con Google</h1>
      {pending.isPending && <p className="mt-3 text-muted-foreground">Un momento…</p>}
      {pending.isError && <div className="mt-4"><ErrorAlert>{pending.error.message}</ErrorAlert></div>}
      {pending.data === null && (
        <div className="mt-4 flex flex-col gap-4">
          <ErrorAlert>Pasaron más de 15 minutos. Vuelve a entrar con Google.</ErrorAlert>
          <Link to="/entrar" className="text-caption font-semibold text-primary-strong underline">Volver a iniciar sesión</Link>
        </div>
      )}
      {p && (
        <>
          <p className="mt-3 text-muted-foreground">
            Ya tienes una cuenta en PPM con <b className="text-foreground">{p.email}</b>. Escribe su contraseña una sola vez;
            desde entonces entras con Google o con tu contraseña.
          </p>
          <div className="mt-6 flex items-center gap-3 rounded-md bg-muted p-3">
            <GoogleMark className="size-6 flex-none" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate font-semibold">{p.google_email}</span>
              <span className="text-caption text-muted-foreground">cuenta de Google</span>
            </span>
          </div>
          <form noValidate className="mt-6 flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (!password) { setEmpty(true); return; }
              confirm.mutate(password, { onSuccess: (me) => navigate(me.configured ? "/inicio" : "/bienvenida/1", { replace: true }) });
            }}>
            <PasswordField label="Contraseña de PPM" autoComplete="current-password" value={password}
              onChange={(e) => { setPassword(e.target.value); setEmpty(false); }}
              error={empty ? "Escribe tu contraseña" : wrong ? "No es la contraseña de esa cuenta" : undefined} />
            <Link to="/recuperar" className="self-end py-1 text-caption text-primary-strong underline">¿Olvidaste tu contraseña?</Link>
            {confirm.error && !wrong && <ErrorAlert>{confirm.error.message}</ErrorAlert>}
            <PrimaryButton pending={confirm.isPending}>Unir y entrar</PrimaryButton>
            <Link to="/entrar" replace className="py-2 text-center text-caption font-semibold underline">No unir y volver</Link>
          </form>
        </>
      )}
    </Screen>
  );
}
