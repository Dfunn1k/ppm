import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, useWatch } from "react-hook-form";
import { useNavigate } from "react-router";
import { z } from "zod";

import { ApiError, useSignup } from "@/api/hooks";
import { Refran } from "@/components/Refran";
import { ErrorAlert, Icon, LineField, PasswordField, PrimaryButton, Screen, TextLink } from "@/components/ui";
import { cn } from "@/lib/utils";

const MIN = 8;

const schema = z.object({
  name: z.string().trim().min(1, { error: "Dinos cómo te llamamos" }).max(80, { error: "Usa 80 caracteres o menos" }),
  email: z.email({ error: "Escribe un correo válido, como tu@correo.com" }),
  password: z
    .string()
    .min(MIN, { error: `Usa al menos ${MIN} caracteres` })
    .max(128, { error: "Usa 128 caracteres o menos" }),
});

/** La ayuda de la contraseña cambia mientras escribes. */
export function passwordHint(length: number) {
  if (length >= MIN) return { ok: true, text: `Lista: tiene ${MIN} caracteres o más` };
  if (length === 0) return { ok: false, text: `Al menos ${MIN} caracteres` };
  const left = MIN - length;
  return { ok: false, text: `Falta${left === 1 ? "" : "n"} ${left} caracter${left === 1 ? "" : "es"}` };
}

export function CrearCuenta() {
  const navigate = useNavigate();
  const signup = useSignup();
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { name: "", email: "", password: "" } });
  const { errors } = form.formState;
  const hint = passwordHint(useWatch({ control: form.control, name: "password" }).length);
  const taken = signup.error instanceof ApiError && signup.error.status === 409;

  const onSubmit = form.handleSubmit((values) =>
    signup.mutate(values, { onSuccess: () => navigate("/bienvenida/1", { replace: true }) }),
  );

  return (
    <Screen>
      <Refran label="PPM · Crear cuenta" />
      <div className="flex-1" />
      <form noValidate onSubmit={onSubmit} className="mt-8 flex flex-col gap-3">
        {taken && (
          <ErrorAlert>
            Ese correo ya tiene una cuenta. <TextLink to="/entrar" className="text-inherit">Inicia sesión</TextLink> o{" "}
            <TextLink to="/recuperar" className="text-inherit">recupera tu contraseña</TextLink>.
          </ErrorAlert>
        )}
        {signup.error && !taken && <ErrorAlert>{signup.error.message}</ErrorAlert>}
        <LineField label="¿Cómo te llamamos?" autoComplete="given-name" error={errors.name?.message} {...form.register("name")} />
        <LineField
          label="Correo"
          type="email"
          autoComplete="email"
          error={errors.email?.message ?? (taken ? "Este correo ya está registrado" : undefined)}
          {...form.register("email")}
        />
        <PasswordField
          label="Contraseña"
          autoComplete="new-password"
          error={errors.password?.message}
          hint={
            <span className={cn("flex items-center gap-1", hint.ok && "text-income")}>
              <Icon name={hint.ok ? "check_circle" : "info"} className="text-[18px]" />
              {hint.text}
            </span>
          }
          {...form.register("password")}
        />
        <PrimaryButton pending={signup.isPending}>Crear cuenta</PrimaryButton>
        <p className="text-center text-caption text-muted-foreground">
          ¿Ya tienes cuenta? <TextLink to="/entrar">Inicia sesión</TextLink>
        </p>
      </form>
    </Screen>
  );
}
