import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";

import { Entrar } from "./Entrar";

function renderEntrar(url = "/entrar") {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[url]}>
        <Entrar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

const path = (call: unknown[]) => new URL((call[0] as Request).url).pathname;

function fill(label: RegExp, value: string) {
  fireEvent.input(screen.getByLabelText(label), { target: { value } });
}

afterEach(() => vi.unstubAllGlobals());

test("muestra el refrán con «mayo» en trigo", () => {
  renderEntrar();
  expect(screen.getByRole("heading", { name: "Pan para mayo" })).toBeInTheDocument();
  expect(screen.getByText("mayo.")).toHaveClass("bg-trigo");
});

test("revisa el correo antes de llamar a la API", async () => {
  const fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  renderEntrar();
  fill(/^Correo$/, "no-es-un-correo");
  fill(/^Contraseña$/, "algo");
  fireEvent.click(screen.getByRole("button", { name: /Iniciar sesión/ }));
  expect(await screen.findByText(/Escribe un correo válido/)).toBeInTheDocument();
  expect(fetchMock.mock.calls.map(path)).not.toContain("/api/auth/login");
});

test("si la API dice 401, el mismo mensaje para correo o contraseña", async () => {
  const fetchMock = vi.fn(async (request: Request) =>
    new URL(request.url).pathname === "/api/auth/providers"
      ? Response.json({ google: false })
      : Response.json({ detail: "Correo o contraseña incorrectos" }, { status: 401 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  renderEntrar();
  fill(/^Correo$/, "dany@correo.com");
  fill(/^Contraseña$/, "otra-cosa");
  fireEvent.click(screen.getByRole("button", { name: /Iniciar sesión/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Correo o contraseña incorrectos. Revísalos");
  const request = fetchMock.mock.calls.find((c) => path(c) === "/api/auth/login")![0] as Request;
  expect(await request.json()).toEqual({ email: "dany@correo.com", password: "otra-cosa" });
});

test("«Mostrar» descubre la contraseña", () => {
  renderEntrar();
  const input = screen.getByLabelText(/^Contraseña$/);
  expect(input).toHaveAttribute("type", "password");
  fireEvent.click(screen.getByRole("button", { name: "Mostrar" }));
  expect(input).toHaveAttribute("type", "text");
});

test("«Continuar con Google» aparece si el servidor lo tiene, y avisa si se canceló", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ google: true })));
  renderEntrar("/entrar?google=cancelado");
  expect(await screen.findByRole("link", { name: "Continuar con Google" })).toHaveAttribute("href", "/api/auth/google/start?mode=login");
  expect(screen.getByRole("alert")).toHaveTextContent("No se completó el inicio con Google.");
});

test("sin Google configurado, no hay botón", async () => {
  const fetchMock = vi.fn(async () => Response.json({ google: false }));
  vi.stubGlobal("fetch", fetchMock);
  renderEntrar();
  await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
  expect(screen.queryByRole("link", { name: "Continuar con Google" })).not.toBeInTheDocument();
});
