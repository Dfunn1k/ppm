// Los filtros de Movimientos se recuerdan mientras la app esté abierta, como un separador en un libro:
// al volver por la pestaña abres donde estabas. Viven en sessionStorage (esta pestaña o la app
// instalada); al cerrarla se empieza limpio, para no olvidarse de que se estaba filtrando.
const key = (user: number | undefined) => `ppm.movimientos.${user ?? ""}`;

/** Anota los filtros de la lista: solo en /movimientos, que es donde la dirección los lleva siempre. */
export function rememberMoves(user: number | undefined, pathname: string, search: string) {
  if (pathname !== "/movimientos") return;
  try {
    if (search) sessionStorage.setItem(key(user), search);
    else sessionStorage.removeItem(key(user));
  } catch { /* sin almacenamiento: la pestaña abre la lista limpia */ }
}

/** Adónde lleva la pestaña Movimientos: la lista con los últimos filtros que usaste. */
export function movesLink(user: number | undefined) {
  try {
    const s = sessionStorage.getItem(key(user));
    if (s?.startsWith("?")) return `/movimientos${s}`;
  } catch { /* igual que arriba */ }
  return "/movimientos";
}
