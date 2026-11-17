import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { Link, useNavigate, useSearchParams } from "react-router";
import { z } from "zod";

import { ApiError, useConfirmReset } from "@/api/hooks";
import { AccessLayout } from "@/components/AccessLayout";
import { ErrorAlert, Icon, Note, PasswordField, PrimaryButton, PrimaryLink, Screen } from "@/components/ui";

const schema = z.object({
  password: z.string().min(8, { error: "Usa al menos 8 caracteres" }).max(128, { error: "Usa 128 caracteres o menos" }),
});

// Se abre desde el enlace del correo: /restablecer?token=…
export function Restablecer() {
  const navigate = useNavigate();
  const token = useSearchParams()[0].get("token") ?? "";
  const confirm = useConfirmReset();
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { password: "" } });
  const expired = token.length < 20 || (confirm.error instanceof ApiError && confirm.error.status === 400);

  const onSubmit = form.handleSubmit(({ password }) =>
    confirm.mutate(
      { token, new_password: password },
      { onSuccess: () => navigate("/entrar", { replace: true, state: { passwordChanged: true } }) },
    ),
  );

  return (
    <AccessLayout>
    <Screen className="lg:min-h-0 lg:max-w-[480px] lg:py-16">
      <span className="text-label text-muted-foreground">PPM</span>
      {expired ? (
        <div className="flex flex-1 flex-col pt-11">
          <Icon name="link_off" className="text-[40px] text-destructive" />
          <h1 className="mt-4 text-title-hero">Este enlace ya no sirve.</h1>
          <p className="mt-4 text-muted-foreground">Venció o ya se usó. Pide uno nuevo: llega en un momento y dura 60 minutos.</p>
          <div className="min-h-8 flex-1" />
          <div className="flex flex-col gap-2">
            <PrimaryLink to="/recuperar">Pedir otro enlace</PrimaryLink>
            <Link to="/entrar" className="grid h-11 place-items-center text-caption font-semibold text-primary-strong underline">
              Volver a iniciar sesión
            </Link>
          </div>
        </div>
      ) : (
        <form noValidate onSubmit={onSubmit} className="flex flex-1 flex-col pt-11">
          <h1 className="text-title-hero">Pon tu contraseña nueva.</h1>
          <p className="mt-4 text-muted-foreground">Elige una que no uses en otro lado.</p>
          <div className="mt-8 flex flex-1 flex-col gap-4">
            {confirm.error && <ErrorAlert>{confirm.error.message}</ErrorAlert>}
            <PasswordField
              label="Contraseña nueva"
              autoComplete="new-password"
              hint="Al menos 8 caracteres. Una frase larga protege más que los símbolos raros."
              error={form.formState.errors.password?.message}
              {...form.register("password")}
            />
            <Note icon="devices">Al guardarla cerramos tu sesión en todos tus dispositivos. Luego entras con la contraseña nueva.</Note>
            <div className="flex-1" />
            <PrimaryButton pending={confirm.isPending}>Guardar contraseña</PrimaryButton>
          </div>
        </form>
      )}
    </Screen>
    </AccessLayout>
  );
}
