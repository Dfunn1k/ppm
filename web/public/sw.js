// El service worker de PPM: guarda en el equipo los archivos de la app (el código, los estilos, las
// fuentes y los íconos) para que, desde la segunda visita, abra al instante. Los datos (la API) van
// siempre al servidor: PPM no guarda copias sin conexión.
const CACHE = "ppm-v1";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === location.origin && url.pathname.startsWith("/api/")) return;   // los datos: siempre al servidor

  // La página (/inicio, /cuentas…): primero la red, para tener siempre la última versión; sin red, la guardada
  if (req.mode === "navigate") {
    e.respondWith(fetch(req).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put("/index.html", copy));
      return res;
    }).catch(() => caches.match("/index.html")));
    return;
  }

  // Lo que no cambia (archivos con su huella en el nombre, fuentes, íconos): del equipo si ya está
  const immutable = url.pathname.startsWith("/assets/") || url.hostname.endsWith("fonts.gstatic.com")
    || /\.(png|svg|webmanifest|woff2)$/.test(url.pathname);
  const fontCss = url.hostname === "fonts.googleapis.com";
  if (!immutable && !fontCss) return;
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(req);
    const fresh = fetch(req).then((res) => {
      if (res.ok || res.type === "opaque") c.put(req, res.clone());
      return res;
    });
    if (hit) {
      if (fontCss) e.waitUntil(fresh.catch(() => {}));   // la hoja de la fuente se actualiza por detrás
      return hit;
    }
    return fresh;
  }));
});
