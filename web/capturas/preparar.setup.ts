// Antes de las capturas: dos personas de muestra (la de las pantallas y otra para probar los
// acentos sin cambiarle el color a la primera mientras se fotografía) y su sesión guardada.
import { mkdirSync, writeFileSync } from "node:fs";
import { request, test as setup } from "@playwright/test";
import { seed } from "./datos";

import { OUT } from "./matriz";

setup("preparar las personas de muestra", async ({ baseURL, browser }) => {
  setup.setTimeout(120_000);
  mkdirSync(OUT, { recursive: true });
  for (const who of ["muestra", "acentos"]) {
    const api = await request.newContext({ baseURL, extraHTTPHeaders: { "Accept-Language": "es-PE" } });
    const ids = await seed(api, who, who === "muestra" ? browser : undefined);
    await api.patch("/api/me", { data: { ui_theme: "system", ui_accent: "tinta" } });
    await api.storageState({ path: `${OUT}/${who}.sesion.json` });
    writeFileSync(`${OUT}/${who}.ids.json`, JSON.stringify(ids, null, 1));
    await api.dispose();
  }
});
