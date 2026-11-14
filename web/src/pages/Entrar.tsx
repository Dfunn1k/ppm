import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";

import { ApiError, useLogin } from "@/api/hooks";
import { GoogleButton, googleProblem } from "@/components/GoogleButton";
import { Refran } from "@/components/Refran";
import { ErrorAlert, Icon, LineField, PasswordField, PrimaryButton, Screen, TextLink } from "@/components/ui";

const schema = z.object({
  email: z.email({ error: "Escribe un correo válido, como tu@correo.com" }),
  password: z.string().min(1, { error: "Escribe tu contraseña" }),
});

export function Entrar() {
  const navigate = useNavigate();
  const passwordChanged = (useLocation().state as { passwordChanged?: boolean } | null)?.passwordChanged;
  const login = useLogin();
  const [params] = useSearchParams();
  const fromGoogle = googleProblem(params.get("google"));
  const deleted = params.get("cuenta") === "eliminada";
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: "", password: "" } });
  const { errors } = form.formState;

  const onSubmit = form.handleSubmit((values) =>
    login.mutate(values, {
      onSuccess: (me) => navigate(me.configured ? "/inicio" : "/bienvenida/1", { replace: true }),
    }),
  );

  return (
    <Screen>
      <Refran />
      <p className="mt-5 text-muted-foreground">
        Guarda hoy lo que vas a necesitar mañana. Tus cuentas claras, sin saber contabilidad.
      </p>
      <div className="flex-1" />
      <form noValidate onSubmit={onSubmit} className="mt-8 flex flex-col gap-3">
        {deleted && !login.error && (
          <div role="status" className="flex items-start gap-2 rounded-md bg-muted p-3 text-caption">
            <Icon name="check_circle" fill className="text-income" />
            <span><b>Tu cuenta se eliminó.</b> Gracias por usar PPM.</span>
          </div>
        )}
        {passwordChanged && !login.error && (
          <div role="status" className="flex items-start gap-2 rounded-md bg-muted p-3 text-caption">
            <Icon name="check_circle" fill className="text-income" />
            <span>Contraseña cambiada. Entra con la nueva.</span>
          </div>
        )}
        {fromGoogle && !login.error && <ErrorAlert>{fromGoogle}</ErrorAlert>}
        <GoogleButton />
        {login.error && (
          <ErrorAlert>
            {login.error instanceof ApiError && login.error.status === 401
              ? "Correo o contraseña incorrectos. Revísalos e intenta otra vez."
              : login.error.message}
          </ErrorAlert>
        )}
        <LineField label="Correo" type="email" autoComplete="email" error={errors.email?.message} {...form.register("email")} />
        <PasswordField
          label="Contraseña"
          autoComplete="current-password"
          error={errors.password?.message}
          {...form.register("password")}
        />
        <Link to="/recuperar" className="self-end py-1 text-caption text-primary-strong underline">
          ¿Olvidaste tu contraseña?
        </Link>
        <PrimaryButton pending={login.isPending}>Iniciar sesión</PrimaryButton>
        <p className="text-center text-caption text-muted-foreground">
          ¿Primera vez? <TextLink to="/crear-cuenta">Crea tu cuenta</TextLink>
        </p>
        <p className="mt-2 text-center text-caption text-muted-foreground">
          <Link to="/privacidad" className="underline">Privacidad</Link>
        </p>
      </form>
    </Screen>
  );
}
