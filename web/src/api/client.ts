// Puerto de la API: un cliente tipado con los tipos generados desde /openapi.json.
// Todo pasa por /api (mismo origen), así la cookie de sesión viaja sola.
import createClient from "openapi-fetch";

import type { paths } from "./schema";

export const api = createClient<paths>({
  baseUrl: `${window.location.origin}/api`,
  credentials: "include",
  fetch: (request) => globalThis.fetch(request), // se resuelve en cada llamada: las pruebas pueden cambiarlo
});
