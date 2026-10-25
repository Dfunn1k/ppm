import { type ReactNode, useEffect } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router";

import { type Me, useMe } from "./api/hooks";
import { Spinner } from "./components/ui";
import { WizardProvider } from "./pages/bienvenida/wizard";
import { Paso1 } from "./pages/bienvenida/Paso1";
import { Paso2 } from "./pages/bienvenida/Paso2";
import { Paso3 } from "./pages/bienvenida/Paso3";
import { CrearCuenta } from "./pages/CrearCuenta";
import { Entrar } from "./pages/Entrar";
import { Inicio } from "./pages/Inicio";
import { Recuperar } from "./pages/Recuperar";
import { Restablecer } from "./pages/Restablecer";

/** Adónde va cada quien: sin sesión → entrar; sin configurar → los 3 pasos; si no, al inicio. */
function home(me: Me | null | undefined) {
  if (!me) return "/entrar";
  return me.configured ? "/inicio" : "/bienvenida/1";
}

/** Deja pasar solo si `allow(me)`; si no, manda a donde le toca. */
function Guard({ allow, children }: { allow: (me: Me | null) => boolean; children?: ReactNode }) {
  const me = useMe();
  if (me.isPending) return <Spinner />;
  const data = me.data ?? null;
  if (!allow(data)) return <Navigate to={home(data)} replace />;
  return children ?? <Outlet />;
}

/** Tema y acento de la persona; antes de entrar, el del sistema y tinta. */
function useTheme(me: Me | null | undefined) {
  useEffect(() => {
    const root = document.documentElement;
    const theme = me?.ui_theme;
    if (theme === "light" || theme === "dark") root.dataset.theme = theme;
    else delete root.dataset.theme;
    root.dataset.accent = me?.configured ? me.ui_accent : "tinta";
  }, [me]);
}

export function App() {
  const me = useMe();
  useTheme(me.data);

  return (
    <Routes>
      <Route element={<Guard allow={(m) => m === null} />}>
        <Route path="/entrar" element={<Entrar />} />
        <Route path="/crear-cuenta" element={<CrearCuenta />} />
        <Route path="/recuperar" element={<Recuperar />} />
      </Route>
      <Route path="/restablecer" element={<Restablecer />} />
      <Route
        path="/bienvenida"
        element={
          <Guard allow={(m) => m !== null && !m.configured}>
            <WizardProvider>
              <Outlet />
            </WizardProvider>
          </Guard>
        }
      >
        <Route path="1" element={<Paso1 />} />
        <Route path="2" element={<Paso2 />} />
        <Route path="3" element={<Paso3 />} />
      </Route>
      <Route element={<Guard allow={(m) => m !== null && m.configured} />}>
        <Route path="/inicio" element={<Inicio />} />
      </Route>
      <Route path="*" element={me.isPending ? <Spinner /> : <Navigate to={home(me.data)} replace />} />
    </Routes>
  );
}
