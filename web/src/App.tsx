import { lazy, type ReactNode, Suspense, useEffect } from "react";
import { type Location, Navigate, Outlet, Route, Routes, useLocation } from "react-router";

import { type Me, useMe } from "./api/hooks";
import { applyIconsOf } from "./lib/iconFont";
import { setCurrencyFormats } from "./lib/money";
import { AppNav } from "./components/AppNav";
import { Rail } from "./components/Rail";
import { RegisterPanel } from "./components/RegisterPanel";
import { Shortcuts } from "./components/Shortcuts";
import { ShortcutsHelp } from "./components/ShortcutsHelp";
import { Split, SplitIndex } from "./components/Split";
import { useRail } from "./lib/desktop";
import { Spinner } from "./components/ui";
import { WizardProvider } from "./pages/bienvenida/wizard";
import { Entrar } from "./pages/Entrar";
import { UnirGoogle } from "./pages/UnirGoogle";
import { Inicio } from "./pages/Inicio";

// Cada pantalla es un archivo aparte que se descarga al abrirla: así la primera carga trae solo lo
// necesario (Reportes con sus gráficos, el importador o el calendario no viajan con el Inicio)
const Paso1 = lazy(() => import("./pages/bienvenida/Paso1").then((m) => ({ default: m.Paso1 })));
const Paso2 = lazy(() => import("./pages/bienvenida/Paso2").then((m) => ({ default: m.Paso2 })));
const Paso3 = lazy(() => import("./pages/bienvenida/Paso3").then((m) => ({ default: m.Paso3 })));
const Paso3Banco = lazy(() => import("./pages/bienvenida/Paso3").then((m) => ({ default: m.Paso3Banco })));
const CrearCuenta = lazy(() => import("./pages/CrearCuenta").then((m) => ({ default: m.CrearCuenta })));
const Cuentas = lazy(() => import("./pages/cuentas/Cuentas").then((m) => ({ default: m.Cuentas })));
const Detalle = lazy(() => import("./pages/cuentas/Detalle").then((m) => ({ default: m.Detalle })));
const EditarBanco = lazy(() => import("./pages/cuentas/EditarBanco").then((m) => ({ default: m.EditarBanco })));
const NuevaGuardo = lazy(() => import("./pages/cuentas/Guardo").then((m) => ({ default: m.NuevaGuardo })));
const NuevaCuenta = lazy(() => import("./pages/cuentas/Nueva").then((m) => ({ default: m.NuevaCuenta })));
const NuevaCuentaForm = lazy(() => import("./pages/cuentas/Nueva").then((m) => ({ default: m.NuevaCuentaForm })));
const Extracto = lazy(() => import("./pages/importar/Extracto").then((m) => ({ default: m.Extracto })));
const Importar = lazy(() => import("./pages/importar/Importar").then((m) => ({ default: m.Importar })));
const Pendientes = lazy(() => import("./pages/Pendientes").then((m) => ({ default: m.Pendientes })));
const Apariencia = lazy(() => import("./pages/mas/Apariencia").then((m) => ({ default: m.Apariencia })));
const Categorias = lazy(() => import("./pages/mas/Categorias").then((m) => ({ default: m.Categorias })));
const NuevaCategoria = lazy(() => import("./pages/mas/Categorias").then((m) => ({ default: m.NuevaCategoria })));
const Cierre = lazy(() => import("./pages/mas/Cierre").then((m) => ({ default: m.Cierre })));
const InicioAjustes = lazy(() => import("./pages/mas/InicioAjustes").then((m) => ({ default: m.InicioAjustes })));
const NuevoPrestamo = lazy(() => import("./pages/prestamos/Prestamos").then((m) => ({ default: m.NuevoPrestamo })));
const PagarCuota = lazy(() => import("./pages/prestamos/Prestamos").then((m) => ({ default: m.PagarCuota })));
const Prestamo = lazy(() => import("./pages/prestamos/Prestamos").then((m) => ({ default: m.Prestamo })));
const Recurrente = lazy(() => import("./pages/recurrentes/Recurrentes").then((m) => ({ default: m.Recurrente })));
const Recurrentes = lazy(() => import("./pages/recurrentes/Recurrentes").then((m) => ({ default: m.Recurrentes })));
const ReporteCategorias = lazy(() => import("./pages/reportes/Categorias").then((m) => ({ default: m.ReporteCategorias })));
const ReporteFlujo = lazy(() => import("./pages/reportes/Flujo").then((m) => ({ default: m.ReporteFlujo })));
const ReportePatrimonio = lazy(() => import("./pages/reportes/Patrimonio").then((m) => ({ default: m.ReportePatrimonio })));
const ReportePersonas = lazy(() => import("./pages/reportes/Personas").then((m) => ({ default: m.ReportePersonas })));
const Reportes = lazy(() => import("./pages/reportes/Reportes").then((m) => ({ default: m.Reportes })));
const ReporteEtiquetas = lazy(() => import("./pages/reportes/Etiquetas").then((m) => ({ default: m.ReporteEtiquetas })));
const Presupuesto = lazy(() => import("./pages/presupuesto/Presupuesto").then((m) => ({ default: m.Presupuesto })));
const Repartir = lazy(() => import("./pages/presupuesto/Repartir").then((m) => ({ default: m.Repartir })));
const Sobre = lazy(() => import("./pages/presupuesto/Sobre").then((m) => ({ default: m.Sobre })));
const PorAsignar = lazy(() => import("./pages/presupuesto/PorAsignar").then((m) => ({ default: m.PorAsignar })));
const CuentasPresupuesto = lazy(() => import("./pages/presupuesto/Cuentas").then((m) => ({ default: m.CuentasPresupuesto })));
const Atajos = lazy(() => import("./pages/mas/Atajos").then((m) => ({ default: m.Atajos })));
const Etiquetas = lazy(() => import("./pages/mas/Etiquetas").then((m) => ({ default: m.Etiquetas })));
const Mas = lazy(() => import("./pages/mas/Mas").then((m) => ({ default: m.Mas })));
const Monedas = lazy(() => import("./pages/mas/Monedas").then((m) => ({ default: m.Monedas })));
const MiCuenta = lazy(() => import("./pages/mas/MiCuenta").then((m) => ({ default: m.MiCuenta })));
const ExportarDatos = lazy(() => import("./pages/mas/ExportarDatos").then((m) => ({ default: m.ExportarDatos })));
const EliminarCuenta = lazy(() => import("./pages/mas/EliminarCuenta").then((m) => ({ default: m.EliminarCuenta })));
const Privacidad = lazy(() => import("./pages/Privacidad").then((m) => ({ default: m.Privacidad })));
const TipoCambio = lazy(() => import("./pages/mas/TipoCambio").then((m) => ({ default: m.TipoCambio })));
const DetalleMovimiento = lazy(() => import("./pages/movimientos/Detalle").then((m) => ({ default: m.DetalleMovimiento })));
const Movimientos = lazy(() => import("./pages/movimientos/Movimientos").then((m) => ({ default: m.Movimientos })));
const PorClasificar = lazy(() => import("./pages/movimientos/PorClasificar").then((m) => ({ default: m.PorClasificar })));
const AsientoManual = lazy(() => import("./pages/movimientos/AsientoManual").then((m) => ({ default: m.AsientoManual })));
const Reembolso = lazy(() => import("./pages/movimientos/Reembolso").then((m) => ({ default: m.Reembolso })));
const EditarMovimiento = lazy(() => import("./pages/movimientos/Registrar").then((m) => ({ default: m.EditarMovimiento })));
const EditarRecurrente = lazy(() => import("./pages/movimientos/Registrar").then((m) => ({ default: m.EditarRecurrente })));
const Registrar = lazy(() => import("./pages/movimientos/Registrar").then((m) => ({ default: m.Registrar })));
const RegistrarAviso = lazy(() => import("./pages/movimientos/Registrar").then((m) => ({ default: m.RegistrarAviso })));
const RegistrarPersona = lazy(() => import("./pages/movimientos/RegistrarPersona").then((m) => ({ default: m.RegistrarPersona })));
const Persona = lazy(() => import("./pages/personas/Persona").then((m) => ({ default: m.Persona })));
const Personas = lazy(() => import("./pages/personas/Personas").then((m) => ({ default: m.Personas })));
const YaDebia = lazy(() => import("./pages/personas/YaDebia").then((m) => ({ default: m.YaDebia })));
const Recuperar = lazy(() => import("./pages/Recuperar").then((m) => ({ default: m.Recuperar })));
const Restablecer = lazy(() => import("./pages/Restablecer").then((m) => ({ default: m.Restablecer })));
const Conciliar = lazy(() => import("./pages/tarjetas/Conciliar").then((m) => ({ default: m.Conciliar })));
const CuotasAntes = lazy(() => import("./pages/tarjetas/CuotasAntes").then((m) => ({ default: m.CuotasAntes })));
const NuevaTarjeta = lazy(() => import("./pages/tarjetas/NuevaTarjeta").then((m) => ({ default: m.NuevaTarjeta })));
const PagarTarjeta = lazy(() => import("./pages/tarjetas/PagarTarjeta").then((m) => ({ default: m.PagarTarjeta })));
const Tarjeta = lazy(() => import("./pages/tarjetas/Tarjeta").then((m) => ({ default: m.Tarjeta })));

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

/** Dentro de la app: desde la tablet, el riel a la izquierda y los atajos de teclado. */
function Shell() {
  const rail = useRail();
  return (
    <>
      {rail && <Rail />}
      {rail && <Shortcuts />}
      {rail && <ShortcutsHelp />}
      <div className="md:pl-rail"><Outlet /></div>
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
  // Antes de pintar: los montos se escriben con el símbolo y los decimales de cada moneda de la persona
  if (me.data?.formats) setCurrencyFormats(me.data.formats);
  const location = useLocation();
  const rail = useRail();
  // Desde la tablet el + abre Registrar (y «Editar», el de un movimiento) en un panel sobre la pantalla de la que viniste
  const background = rail ? (location.state as { background?: Location } | null)?.background : undefined;
  useTheme(me.data);
  useEffect(() => applyIconsOf(me.data?.icons), [me.data]);

  return (
    <Suspense fallback={<Spinner />}>
    <Routes location={background ?? location}>
      <Route element={<Guard allow={(m) => m === null} />}>
        <Route path="/entrar" element={<Entrar />} />
        <Route path="/entrar/google" element={<UnirGoogle />} />
        <Route path="/crear-cuenta" element={<CrearCuenta />} />
        <Route path="/recuperar" element={<Recuperar />} />
      </Route>
      <Route path="/restablecer" element={<Restablecer />} />
      <Route path="/privacidad" element={<Privacidad />} />
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
      <Route element={<Shell />}>
        <Route element={<WithNav />}>
          <Route path="/inicio" element={<Inicio />} />
          <Route path="/por-clasificar" element={<PorClasificar />} />
          <Route path="/pendientes" element={<Pendientes />} />
        </Route>
        {/* Lista y detalle: en escritorio lado a lado; en el celular, cada una en su pantalla */}
        <Route element={<Split list={<Movimientos />} />}>
          <Route element={<WithNav />}>
            <Route path="/movimientos" element={<SplitIndex icon="receipt_long" title="Elige un movimiento">Ábrelo aquí al lado para ver su detalle, confirmarlo o cambiarlo. Con ↑ ↓ pasas al siguiente.</SplitIndex>} />
            <Route path="/movimientos/:id" element={<DetalleMovimiento />} />
          </Route>
        </Route>
        <Route element={<Split list={<Cuentas />} />}>
          <Route element={<WithNav />}>
            <Route path="/cuentas" element={<SplitIndex icon="account_balance_wallet" title="Elige una cuenta">Aquí al lado ves su saldo, su número y CCI para copiar y sus movimientos.</SplitIndex>} />
            <Route path="/cuentas/:id" element={<Detalle />} />
            <Route path="/tarjetas/:id" element={<Tarjeta />} />
            <Route path="/prestamos/:id" element={<Prestamo />} />
          </Route>
        </Route>
        {/* El presupuesto: la lista del mes a la izquierda; al entrar, Por asignar al lado */}
        <Route element={<Split list={<Presupuesto />} />}>
          <Route element={<WithNav />}>
            <Route path="/presupuesto" element={<SplitIndex to="/presupuesto/por-asignar" />} />
            <Route path="/presupuesto/por-asignar" element={<PorAsignar />} />
            <Route path="/presupuesto/sobres/:id" element={<Sobre />} />
          </Route>
        </Route>
        <Route path="/presupuesto/repartir" element={<Repartir />} />
        <Route element={<WithNav />}>
          <Route path="/presupuesto/cuentas" element={<CuentasPresupuesto />} />
        </Route>
        <Route element={<Split list={<Personas />} />}>
          <Route element={<WithNav />}>
            <Route path="/personas" element={<SplitIndex icon="group" title="Elige una persona">Aquí al lado ves lo que te debe o le debes, sus préstamos y recordatorios.</SplitIndex>} />
          </Route>
          <Route path="/personas/:id" element={<Persona />} />
        </Route>
        <Route element={<Split list={<Reportes />} />}>
          <Route element={<WithNav />}>
            <Route path="/mas/reportes" element={<SplitIndex to="/mas/reportes/gastos" />} />
          </Route>
          <Route path="/mas/reportes/gastos" element={<ReporteCategorias kind="expense" />} />
          <Route path="/mas/reportes/ingresos" element={<ReporteCategorias kind="income" />} />
          <Route path="/mas/reportes/flujo" element={<ReporteFlujo />} />
          <Route path="/mas/reportes/patrimonio" element={<ReportePatrimonio />} />
          <Route path="/mas/reportes/personas" element={<ReportePersonas />} />
          <Route path="/mas/reportes/etiquetas" element={<ReporteEtiquetas />} />
        </Route>
        <Route element={<Split list={<Recurrentes />} />}>
          <Route element={<WithNav />}>
            <Route path="/mas/recurrentes" element={<SplitIndex icon="event_repeat" title="Elige una recurrente">Aquí al lado ves sus próximas fechas, lo ya registrado y la pausas o la terminas.</SplitIndex>} />
          </Route>
          <Route path="/mas/recurrentes/:id" element={<Recurrente />} />
        </Route>
        {/* Más como los Ajustes de la computadora: el índice a la izquierda y el ajuste elegido al lado */}
        <Route element={<Split list={<Mas />} />}>
          <Route element={<WithNav />}>
            <Route path="/mas" element={<SplitIndex to="/mas/cuenta" />} />
            <Route path="/mas/categorias" element={<Categorias />} />
            <Route path="/mas/etiquetas" element={<Etiquetas />} />
            <Route path="/mas/atajos" element={<Atajos />} />
          </Route>
          <Route path="/mas/cuenta" element={<MiCuenta />} />
          <Route path="/mas/cuenta/exportar" element={<ExportarDatos />} />
          <Route path="/mas/cuenta/eliminar" element={<EliminarCuenta />} />
          <Route path="/mas/apariencia" element={<Apariencia />} />
          <Route path="/mas/monedas" element={<Monedas />} />
          <Route path="/mas/cierre" element={<Cierre />} />
          <Route path="/mas/inicio" element={<InicioAjustes />} />
          <Route path="/mas/categorias/nueva" element={<NuevaCategoria />} />
          <Route path="/mas/tipo-de-cambio" element={<TipoCambio />} />
        </Route>
        <Route path="/mas/recurrentes/:id/editar" element={<EditarRecurrente />} />
        <Route path="/registrar/aviso/:id/:occurrence" element={<RegistrarAviso />} />
        <Route path="/cuentas/nueva/prestamo" element={<NuevoPrestamo />} />
        <Route path="/prestamos/:id/pagar" element={<PagarCuota />} />
        <Route path="/registrar" element={<Registrar />} />
        <Route path="/registrar/persona/:kind" element={<RegistrarPersona />} />
        <Route path="/registrar/reembolso" element={<Reembolso />} />
        <Route path="/registrar/manual" element={<AsientoManual />} />
        <Route path="/registrar/saldo-inicial" element={<YaDebia />} />
        <Route path="/personas/:id/ya-debia" element={<YaDebia />} />
        <Route path="/movimientos/:id/editar" element={<EditarMovimiento />} />
        <Route path="/cuentas/nueva" element={<NuevaCuenta />} />
        <Route path="/cuentas/nueva/banco" element={<NuevaCuentaForm kind="bank" />} />
        <Route path="/cuentas/nueva/efectivo" element={<NuevaCuentaForm kind="cash" />} />
        <Route path="/cuentas/nueva/guardo" element={<NuevaGuardo />} />
        <Route path="/cuentas/nueva/tarjeta" element={<NuevaTarjeta />} />
        <Route path="/tarjetas/:id/pagar" element={<PagarTarjeta />} />
        <Route path="/tarjetas/:id/cuotas-antes" element={<CuotasAntes />} />
        <Route path="/tarjetas/:id/estado/:closing" element={<Conciliar />} />
        <Route path="/cuentas/:id/editar" element={<EditarBanco />} />
        <Route path="/cuentas/:id/importar" element={<Importar />} />
        <Route path="/extractos/:id" element={<Extracto />} />
      </Route>
      </Route>
      <Route path="*" element={me.isPending ? <Spinner /> : <Navigate to={home(me.data)} replace />} />
    </Routes>
    {background && (
      <Routes>
        <Route path="/registrar" element={<RegisterPanel><Registrar /></RegisterPanel>} />
        <Route path="/registrar/persona/:kind" element={<RegisterPanel><RegistrarPersona /></RegisterPanel>} />
        <Route path="/registrar/reembolso" element={<RegisterPanel><Reembolso /></RegisterPanel>} />
        <Route path="/registrar/manual" element={<RegisterPanel><AsientoManual /></RegisterPanel>} />
        <Route path="/registrar/saldo-inicial" element={<RegisterPanel><YaDebia /></RegisterPanel>} />
        {/* Editar se abre en el mismo panel que Registrar, sobre el movimiento (boceto Caso20, 27-nov) */}
        <Route path="/movimientos/:id/editar" element={<RegisterPanel label="Editar movimiento"><EditarMovimiento /></RegisterPanel>} />
        <Route path="*" element={null} />
      </Routes>
    )}
    </Suspense>
  );
}
