// La cuenta con la que arranca un formulario de registrar. Como el cajero que te pregunta «¿de la misma
// cuenta de siempre?»: la que elegiste; si esa no vale para este tipo (una tarjeta no recibe un ingreso),
// la de la pantalla de donde vienes (?cuenta=); si no, la de Más › Inicio; si no, la primera.
export function pickAccount<T extends { id: number }>(
  list: T[], chosen: string, ...preferred: (string | number | null | undefined)[]
): T | undefined {
  for (const id of [chosen, ...preferred]) {
    const found = id ? list.find((a) => String(a.id) === String(id)) : undefined;
    if (found) return found;
  }
  return list[0];
}

/** Para llevar la cuenta de un formulario a otro (Gasto → Más → Me pagaron) sin perderla. */
export function withAccount(to: string, account: number | string | null | undefined) {
  if (!account) return to;
  return `${to}${to.includes("?") ? "&" : "?"}cuenta=${account}`;
}
