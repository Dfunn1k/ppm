import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

import { Estado } from "./Estado";

function renderEstado() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <Estado />
    </QueryClientProvider>,
  );
}

afterEach(() => vi.unstubAllGlobals());

test("muestra el refrán con «mayo» resaltado", () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
  renderEstado();
  expect(screen.getByRole("heading", { name: "Pan para mayo" })).toBeInTheDocument();
  expect(screen.getByText("mayo.")).toHaveClass("bg-trigo");
});

test("pide la salud a /api/health y muestra la versión de PostgreSQL", async () => {
  const fetchMock = vi.fn(async (_request: Request) => Response.json({ status: "ok", postgres: "18.6" }));
  vi.stubGlobal("fetch", fetchMock);
  renderEstado();
  expect(await screen.findByText("API conectada · PostgreSQL 18.6")).toBeInTheDocument();
  const request = fetchMock.mock.calls[0]![0];
  expect(new URL(request.url).pathname).toBe("/api/health");
});

test("avisa si la API no responde", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 502 })));
  renderEstado();
  expect(await screen.findByText(/No hay conexión con la API/)).toBeInTheDocument();
});
