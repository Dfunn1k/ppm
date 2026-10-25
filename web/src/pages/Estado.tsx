import { useQuery } from "@tanstack/react-query";

import { api } from "@/api/client";

// Comprueba la cadena entera: navegador → Vite (/api) → FastAPI → PostgreSQL
export function Estado() {
  const health = useQuery({
    queryKey: ["health"],
    queryFn: async () => {
      const { data, error } = await api.GET("/health");
      if (error || !data) throw new Error("La API no respondió");
      return data;
    },
  });

  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col gap-5 px-6 py-10">
      <span className="text-label text-muted-foreground">PPM</span>
      <h1 aria-label="Pan para mayo" className="text-title-display flex flex-col">
        <span>Pan</span>
        <span>para</span>
        <span className="-ml-3 self-start rounded-lg bg-trigo px-3 pb-1 text-on-trigo">mayo.</span>
      </h1>
      <p className="text-muted-foreground">La web ya está en marcha. Las pantallas de acceso llegan en el siguiente paso.</p>
      <div role="status" className="flex items-center gap-2 rounded-md bg-muted p-3 text-caption">
        {health.isPending && <span>Buscando la API…</span>}
        {health.isError && (
          <>
            <span aria-hidden="true" className="icon text-destructive">
              error
            </span>
            <span>No hay conexión con la API. Revisa que docker compose esté arriba.</span>
          </>
        )}
        {health.isSuccess && (
          <>
            <span aria-hidden="true" className="icon icon-fill text-income">
              check_circle
            </span>
            <span>API conectada · PostgreSQL {health.data.postgres}</span>
          </>
        )}
      </div>
    </main>
  );
}
