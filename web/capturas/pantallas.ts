// Todas las pantallas de web/src/App.tsx que se pueden abrir con la persona de muestra. Las que
// necesitan un dato que la muestra no tiene (un extracto importado, el estado de cuenta de un
// corte, un aviso de recurrente) quedan en SKIPPED con su motivo, para que la auditoría lo diga.
import type { Ids } from "./datos";

export type Screen = { id: string; path: string; auth: boolean; form?: boolean };

export function screens(ids: Ids): Screen[] {
  const s = (id: string, path: string, form = false): Screen => ({ id, path, auth: true, form });
  const pub = (id: string, path: string, form = false): Screen => ({ id, path, auth: false, form });
  const list: (Screen | null)[] = [
    pub("entrar", "/entrar", true),
    pub("crear-cuenta", "/crear-cuenta", true),
    pub("recuperar", "/recuperar", true),
    pub("privacidad", "/privacidad"),
    s("inicio", "/inicio"),
    s("por-clasificar", "/por-clasificar"),
    s("pendientes", "/pendientes"),
    s("movimientos", "/movimientos"),
    s("movimiento", `/movimientos/${ids.move}`),
    s("movimiento-editar", `/movimientos/${ids.move}/editar`, true),
    s("cuentas", "/cuentas"),
    s("cuenta-banco", `/cuentas/${ids.bank}`),
    s("cuenta-dolares", `/cuentas/${ids.usd}`),
    s("cuenta-editar", `/cuentas/${ids.bank}/editar`, true),
    s("cuenta-importar", `/cuentas/${ids.bank}/importar`),
    s("cuenta-nueva", "/cuentas/nueva"),
    s("cuenta-nueva-banco", "/cuentas/nueva/banco", true),
    s("cuenta-nueva-efectivo", "/cuentas/nueva/efectivo", true),
    s("cuenta-nueva-guardo", "/cuentas/nueva/guardo", true),
    s("cuenta-nueva-tarjeta", "/cuentas/nueva/tarjeta", true),
    s("cuenta-nueva-prestamo", "/cuentas/nueva/prestamo", true),
    s("tarjeta", `/tarjetas/${ids.card}`),
    s("tarjeta-pagar", `/tarjetas/${ids.card}/pagar`, true),
    s("tarjeta-cuotas-antes", `/tarjetas/${ids.card}/cuotas-antes`, true),
    ids.loan ? s("prestamo", `/prestamos/${ids.loan}`) : null,
    ids.loan ? s("prestamo-pagar", `/prestamos/${ids.loan}/pagar`, true) : null,
    s("presupuesto", "/presupuesto"),
    s("presupuesto-por-asignar", "/presupuesto/por-asignar"),
    ids.post ? s("presupuesto-sobre", `/presupuesto/sobres/${ids.post}`) : null,
    s("presupuesto-repartir", "/presupuesto/repartir"),
    s("presupuesto-cuentas", "/presupuesto/cuentas"),
    s("personas", "/personas"),
    s("persona", `/personas/${ids.partner}`),
    s("persona-ya-debia", `/personas/${ids.partner}/ya-debia`, true),
    s("reportes", "/mas/reportes"),
    s("reporte-gastos", "/mas/reportes/gastos"),
    s("reporte-ingresos", "/mas/reportes/ingresos"),
    s("reporte-flujo", "/mas/reportes/flujo"),
    s("reporte-patrimonio", "/mas/reportes/patrimonio"),
    s("reporte-personas", "/mas/reportes/personas"),
    s("reporte-etiquetas", "/mas/reportes/etiquetas"),
    s("recurrentes", "/mas/recurrentes"),
    ids.recurring ? s("recurrente", `/mas/recurrentes/${ids.recurring}`) : null,
    ids.recurring ? s("recurrente-editar", `/mas/recurrentes/${ids.recurring}/editar`, true) : null,
    s("mas", "/mas"),
    s("categorias", "/mas/categorias"),
    s("categoria-nueva", "/mas/categorias/nueva", true),
    s("etiquetas", "/mas/etiquetas"),
    s("atajos", "/mas/atajos"),
    s("mi-cuenta", "/mas/cuenta"),
    s("exportar", "/mas/cuenta/exportar"),
    s("eliminar-cuenta", "/mas/cuenta/eliminar", true),
    s("apariencia", "/mas/apariencia"),
    s("monedas", "/mas/monedas"),
    s("cierre", "/mas/cierre"),
    s("inicio-a-tu-medida", "/mas/inicio"),
    s("tipo-de-cambio", "/mas/tipo-de-cambio"),
    s("registrar", "/registrar", true),
    s("registrar-prestar", "/registrar/persona/lend", true),
    s("registrar-pedir", "/registrar/persona/borrow", true),
    s("registrar-cobrar", "/registrar/persona/collect", true),
    s("registrar-devolver", "/registrar/persona/repay", true),
    s("registrar-guardo", "/registrar/persona/custody", true),
    s("registrar-reembolso", "/registrar/reembolso", true),
    s("registrar-manual", "/registrar/manual", true),
    s("registrar-saldo-inicial", "/registrar/saldo-inicial", true),
    s("no-existe", "/no-existe"),
  ];
  return list.filter((x): x is Screen => x !== null);
}

export const SKIPPED = [
  ["/bienvenida/1, /2, /3 y /3/banco", "solo se ven antes de terminar la configuración: van en «bienvenida» con una cuenta nueva"],
  ["/entrar/google y /restablecer", "necesitan Google o un enlace del correo"],
  ["/registrar/aviso/:id/:occurrence", "necesita el aviso de una recurrente que ya tocó"],
  ["/tarjetas/:id/estado/:closing y /extractos/:id", "necesitan un estado de cuenta o un extracto importado"],
] as const;
