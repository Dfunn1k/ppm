import { zodResolver } from "@hookform/resolvers/zod";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Link } from "react-router";
import { z } from "zod";

import { useRequestReset } from "@/api/hooks";
import { AccessLayout } from "@/components/AccessLayout";
import { ErrorAlert, Icon, LineField, Note, PrimaryButton, PrimaryLink, Screen } from "@/components/ui";

const schema = z.object({ email: z.email({ error: "Escribe un correo válido, como tu@correo.com" }) });

export function Recuperar() {
  const [sentTo, setSentTo] = useState<string | null>(null);
  const reset = useRequestReset();
  const form = useForm({ resolver: zodResolver(schema), defaultValues: { email: "" } });

  const onSubmit = form.handleSubmit(({ email }) => reset.mutate(email, { onSuccess: () => setSentTo(email) }));

  return (
    <AccessLayout>
    <Screen className="pt-4 lg:min-h-0 lg:max-w-120 lg:py-16">
      <div className="-mx-2.5 flex items-center justify-between">
        <Link to="/entrar" aria-label="Volver a iniciar sesión" className="grid size-11 place-items-center rounded-full">
          <Icon name="arrow_back" size="md" />
        </Link>
        <span className="pr-2.5 text-label text-muted-foreground lg:hidden">PPM</span>
      </div>

      {sentTo === null ? (
        <form noValidate onSubmit={onSubmit} className="flex flex-1 flex-col pt-10">
          <h1 className="text-title-hero">Recupera tu contraseña.</h1>
          <p className="mt-4 text-muted-foreground">
            Escribe el correo con el que creaste tu cuenta y te mandamos un enlace para poner una nueva.
          </p>
          <div className="mt-8 flex flex-col gap-3">
            {reset.error && <ErrorAlert>{reset.error.message}</ErrorAlert>}
            <LineField
              label="Correo"
              type="email"
              autoComplete="email"
              error={form.formState.errors.email?.message}
              {...form.register("email")}
            />
          </div>
          <div className="min-h-8 flex-1" />
          <PrimaryButton pending={reset.isPending}>Enviar enlace</PrimaryButton>
        </form>
      ) : (
        <div className="flex flex-1 flex-col pt-10">
          <h1 className="text-title-hero">Revisa tu correo.</h1>
          <p className="mt-4 text-muted-foreground">
            Si {sentTo} tiene una cuenta, te llegará un enlace para cambiar la contraseña. Sirve una sola vez y vence en
            60 minutos.
          </p>
          <div className="mt-6">
            <Note icon="mark_email_read">
              ¿No llegó en unos minutos? Mira en la carpeta de spam o pide otro. Un enlace nuevo anula el anterior.
            </Note>
          </div>
          <div className="min-h-8 flex-1" />
          <div className="flex flex-col gap-2">
            <PrimaryLink to="/entrar">Volver a iniciar sesión</PrimaryLink>
            <button
              type="button"
              onClick={() => setSentTo(null)}
              className="h-11 text-caption font-semibold text-primary-strong underline"
            >
              Enviar otro enlace
            </button>
          </div>
        </div>
      )}
    </Screen>
    </AccessLayout>
  );
}
