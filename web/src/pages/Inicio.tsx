import { useNavigate } from "react-router";

import { useLogout, useMe } from "@/api/hooks";
import { Icon, Note, Screen } from "@/components/ui";

// Provisional: el Inicio de verdad (I1) llega con las cuentas y los movimientos
export function Inicio() {
  const me = useMe().data;
  const logout = useLogout();
  const navigate = useNavigate();

  return (
    <Screen>
      <span className="text-label text-muted-foreground">PPM</span>
      <h1 className="mt-10 text-title-hero">Hola, {me?.name}.</h1>
      <p className="mt-4 text-muted-foreground">
        Tu cuenta está lista: {me?.currencies.join(", ")} · {me?.lang} · {me?.tz}.
      </p>
      <div className="mt-6">
        <Note icon="construction">Tus cuentas y movimientos llegan en la próxima rebanada.</Note>
      </div>
      <div className="flex-1" />
      <button
        type="button"
        onClick={() => logout.mutate(undefined, { onSuccess: () => navigate("/entrar", { replace: true }) })}
        className="flex h-14 items-center justify-center gap-2 rounded-xl border border-input-line font-semibold"
      >
        <Icon name="logout" />
        Cerrar sesión
      </button>
    </Screen>
  );
}
