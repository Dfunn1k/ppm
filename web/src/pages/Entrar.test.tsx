import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { afterEach, expect, test, vi } from "vitest";

import { Entrar } from "./Entrar";

function renderEntrar() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <Entrar />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

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
  expect(fetchMock).not.toHaveBeenCalled();
});

test("si la API dice 401, el mismo mensaje para correo o contraseña", async () => {
  const fetchMock = vi.fn(async (_request: Request) =>
    Response.json({ detail: "Correo o contraseña incorrectos" }, { status: 401 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  renderEntrar();
  fill(/^Correo$/, "dany@correo.com");
  fill(/^Contraseña$/, "otra-cosa");
  fireEvent.click(screen.getByRole("button", { name: /Iniciar sesión/ }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Correo o contraseña incorrectos. Revísalos");
  const request = fetchMock.mock.calls[0]![0];
  expect(new URL(request.url).pathname).toBe("/api/auth/login");
  expect(await request.json()).toEqual({ email: "dany@correo.com", password: "otra-cosa" });
});

test("«Mostrar» descubre la contraseña", () => {
  renderEntrar();
  const input = screen.getByLabelText(/^Contraseña$/);
  expect(input).toHaveAttribute("type", "password");
  fireEvent.click(screen.getByRole("button", { name: "Mostrar" }));
  expect(input).toHaveAttribute("type", "text");
});
