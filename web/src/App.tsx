import { type ReactNode, useEffect } from "react";
import { Navigate, Outlet, Route, Routes } from "react-router";

import { type Me, useMe } from "./api/hooks";
import { AppNav } from "./components/AppNav";
import { Spinner } from "./components/ui";
import { WizardProvider } from "./pages/bienvenida/wizard";
import { Paso1 } from "./pages/bienvenida/Paso1";
import { Paso2 } from "./pages/bienvenida/Paso2";
import { Paso3, Paso3Banco } from "./pages/bienvenida/Paso3";
import { CrearCuenta } from "./pages/CrearCuenta";
import { Cuentas } from "./pages/cuentas/Cuentas";
import { Detalle } from "./pages/cuentas/Detalle";
import { EditarBanco } from "./pages/cuentas/EditarBanco";
import { NuevaGuardo } from "./pages/cuentas/Guardo";
import { NuevaCuenta, NuevaCuentaForm } from "./pages/cuentas/Nueva";
import { Entrar } from "./pages/Entrar";
import { Inicio } from "./pages/Inicio";
import { Apariencia } from "./pages/mas/Apariencia";
import { Mas } from "./pages/mas/Mas";
import { MiCuenta } from "./pages/mas/MiCuenta";
import { TipoCambio } from "./pages/mas/TipoCambio";
import { DetalleMovimiento } from "./pages/movimientos/Detalle";
import { Movimientos } from "./pages/movimientos/Movimientos";
import { AsientoManual } from "./pages/movimientos/AsientoManual";
import { Reembolso } from "./pages/movimientos/Reembolso";
import { EditarMovimiento, Registrar } from "./pages/movimientos/Registrar";
import { RegistrarPersona } from "./pages/movimientos/RegistrarPersona";
import { Persona } from "./pages/personas/Persona";
import { Personas } from "./pages/personas/Personas";
import { YaDebia } from "./pages/personas/YaDebia";
import { Recuperar } from "./pages/Recuperar";
import { Restablecer } from "./pages/Restablecer";
import { CuotasAntes } from "./pages/tarjetas/CuotasAntes";
import { NuevaTarjeta } from "./pages/tarjetas/NuevaTarjeta";
import { PagarTarjeta } from "./pages/tarjetas/PagarTarjeta";
import { Tarjeta } from "./pages/tarjetas/Tarjeta";

/** Adónde va cada quien: sin sesión → entrar; sin configurar → los 3 pasos; si no, al Inicio. */
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

/** Las pantallas de la app con la barra de abajo. */
function WithNav() {
  return (
    <>
      <Outlet />
      <AppNav />
    </>
  );
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
        <Route path="3/banco" element={<Paso3Banco />} />
      </Route>
      <Route element={<Guard allow={(m) => m !== null && m.configured} />}>
        <Route element={<WithNav />}>
          <Route path="/inicio" element={<Inicio />} />
          <Route path="/cuentas" element={<Cuentas />} />
          <Route path="/cuentas/:id" element={<Detalle />} />
          <Route path="/tarjetas/:id" element={<Tarjeta />} />
          <Route path="/personas" element={<Personas />} />
          <Route path="/movimientos" element={<Movimientos />} />
          <Route path="/movimientos/:id" element={<DetalleMovimiento />} />
          <Route path="/mas" element={<Mas />} />
        </Route>
        <Route path="/mas/cuenta" element={<MiCuenta />} />
        <Route path="/mas/apariencia" element={<Apariencia />} />
        <Route path="/mas/tipo-de-cambio" element={<TipoCambio />} />
        <Route path="/registrar" element={<Registrar />} />
        <Route path="/registrar/persona/:kind" element={<RegistrarPersona />} />
        <Route path="/registrar/reembolso" element={<Reembolso />} />
        <Route path="/registrar/manual" element={<AsientoManual />} />
        <Route path="/registrar/saldo-inicial" element={<YaDebia />} />
        <Route path="/personas/:id" element={<Persona />} />
        <Route path="/personas/:id/ya-debia" element={<YaDebia />} />
        <Route path="/movimientos/:id/editar" element={<EditarMovimiento />} />
        <Route path="/cuentas/nueva" element={<NuevaCuenta />} />
        <Route path="/cuentas/nueva/banco" element={<NuevaCuentaForm kind="bank" />} />
        <Route path="/cuentas/nueva/efectivo" element={<NuevaCuentaForm kind="cash" />} />
        <Route path="/cuentas/nueva/guardo" element={<NuevaGuardo />} />
        <Route path="/cuentas/nueva/tarjeta" element={<NuevaTarjeta />} />
        <Route path="/tarjetas/:id/pagar" element={<PagarTarjeta />} />
        <Route path="/tarjetas/:id/cuotas-antes" element={<CuotasAntes />} />
        <Route path="/cuentas/:id/editar" element={<EditarBanco />} />
      </Route>
      <Route path="*" element={me.isPending ? <Spinner /> : <Navigate to={home(me.data)} replace />} />
    </Routes>
  );
}
