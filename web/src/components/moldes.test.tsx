// Los moldes de docs/frontend/SISTEMA.md 3.2: lo que promete cada uno para la accesibilidad y los montos.
import { fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router";
import { expect, test, vi } from "vitest";

import { Amount } from "./Amount";
import { Avatar } from "./Avatar";
import { Button, IconButton } from "./Button";
import { Chip, FilterChip } from "./Chip";
import { PageHeader } from "./PageHeader";
import { ProgressBar } from "./ProgressBar";
import { Row } from "./Row";
import { SearchField } from "./SearchField";
import { SectionAction, SectionHeading } from "./SectionHeading";
import { SwitchRow } from "./ui";

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>);

test("Button: mientras guarda queda deshabilitado, avisa aria-busy y gira", () => {
  render(<Button pending>Registrar gasto</Button>);
  const b = screen.getByRole("button", { name: /Registrar gasto/ });
  expect(b).toBeDisabled();
  expect(b).toHaveAttribute("aria-busy", "true");
  expect(b.querySelector(".animate-spin")).toBeInTheDocument();
});

test("Button: el principal lleva la flecha y el secundario no", () => {
  const { rerender } = render(<Button>Continuar</Button>);
  expect(screen.getByRole("button")).toHaveTextContent("arrow_forward");
  rerender(<Button variant="secondary">Filtrar</Button>);
  expect(screen.getByRole("button")).not.toHaveTextContent("arrow_forward");
});

test("IconButton: se llama como dice label y mide 44 (size-control)", () => {
  render(<IconButton icon="more_vert" label="Más opciones" />);
  const b = screen.getByRole("button", { name: "Más opciones" });
  expect(b).toHaveClass("size-control");
});

test("SectionHeading es un encabezado de verdad y su acción se toca en 44 px", () => {
  inRouter(<SectionHeading action={<SectionAction to="/x">Ver todo</SectionAction>}>Lo que tengo</SectionHeading>);
  expect(screen.getByRole("heading", { level: 2, name: "Lo que tengo" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Ver todo" })).toHaveClass("hit-area");
});

test("PageHeader: un h1 y la flecha dice a dónde vuelve", () => {
  inRouter(<PageHeader back={{ to: "/cuentas", label: "Volver a cuentas" }} eyebrow="Ahorros en soles" title="BCP sueldo" />);
  expect(screen.getByRole("heading", { level: 1, name: "BCP sueldo" })).toBeInTheDocument();
  expect(screen.getByRole("link", { name: "Volver a cuentas" })).toHaveAttribute("href", "/cuentas");
});

test("Row: enlace con to, botón con onClick y fila quieta sin nada", () => {
  const onClick = vi.fn();
  inRouter(<>
    <Row to="/cuentas/1" title="BCP sueldo" current />
    <Row onClick={onClick} title="Efectivo" />
    <Row title="Saldo inicial" />
  </>);
  expect(screen.getByRole("link", { name: /BCP sueldo/ })).toHaveAttribute("aria-current", "page");
  expect(screen.getByRole("link", { name: /BCP sueldo/ })).toHaveClass("mark-selected");
  fireEvent.click(screen.getByRole("button", { name: /Efectivo/ }));
  expect(onClick).toHaveBeenCalled();
  expect(screen.getByText("Saldo inicial").closest("a, button")).toBeNull();
});

test("Amount: en una fila tu moneda va sin símbolo y las otras con el suyo", () => {
  render(<>
    <span data-testid="a"><Amount value="35.5" currency="PEN" base="PEN" lang="es-PE" direction="out" /></span>
    <span data-testid="b"><Amount value="20" currency="USD" base="PEN" lang="es-PE" direction="out" /></span>
    <span data-testid="c"><Amount value="9003.48" currency="PEN" base="PEN" lang="es-PE" size="display" /></span>
  </>);
  expect(screen.getByTestId("a")).toHaveTextContent(/^north_east− 35\.50$/);
  expect(screen.getByTestId("b")).toHaveTextContent(/US\$\s?20\.00/);
  expect(screen.getByTestId("c")).toHaveTextContent(/^S\/\s?9,003\.48$/);
  expect(screen.getByTestId("c").firstElementChild).toHaveClass("text-amount-display", "whitespace-nowrap");
});

test("FilterChip dice si está elegido; Chip no se toca", () => {
  render(<><FilterChip pressed>Hoy</FilterChip><Chip>Por confirmar</Chip></>);
  expect(screen.getByRole("button", { name: /Hoy/ })).toHaveAttribute("aria-pressed", "true");
  expect(screen.queryByRole("button", { name: /Por confirmar/ })).toBeNull();
});

test("FilterChip: lo elegido lleva el check; con radio es una opción de su grupo", () => {
  render(<><FilterChip radio pressed>Cada mes</FilterChip><FilterChip radio pressed={false}>Cada semana</FilterChip></>);
  expect(screen.getByRole("radio", { name: /Cada mes/ })).toHaveAttribute("aria-checked", "true");
  expect(screen.getByRole("radio", { name: /Cada mes/ })).toHaveTextContent("check");
  expect(screen.getByRole("radio", { name: /Cada semana/ })).not.toHaveTextContent("check");
});

test("Button: con start, el ícono va a la izquierda y gira mientras guarda", () => {
  render(<Button variant="secondary" start="logout" pending>Cerrar sesión</Button>);
  const b = screen.getByRole("button", { name: /Cerrar sesión/ });
  expect(b.firstElementChild).toHaveClass("animate-spin");
  expect(b).not.toHaveTextContent("arrow_forward");
});

test("ProgressBar: con label es un medidor con su valor en palabras; sin label, decorativa", () => {
  const { container } = render(<><ProgressBar value={57} max={100} label="57 % de lo que entró" tone="trigo" /><ProgressBar value={1} /></>);
  const m = screen.getByRole("meter");
  expect(m).toHaveAttribute("aria-valuenow", "57");
  expect(m).toHaveAttribute("aria-valuetext", "57 % de lo que entró");
  expect(container.querySelectorAll("[aria-hidden='true']").length).toBe(1);
});

test("SearchField: un buscador con nombre y el anillo de foco en la caja", () => {
  render(<SearchField label="Buscar categoría" />);
  const s = screen.getByRole("searchbox", { name: "Buscar categoría" });
  expect(s.closest("label")).toHaveClass("focus-within:outline-2");
});

test("Avatar de categoría toma su color como clase, no como estilo", () => {
  const { container } = render(<Avatar kind="category" color={13} icon="restaurant" />);
  const el = container.firstElementChild!;
  expect(el).toHaveClass("bg-cat-1", "size-avatar");
  expect(el).not.toHaveAttribute("style");
});

test("SwitchRow: el interruptor lleva el texto como nombre y descripción, y el texto visible no se lee dos veces", () => {
  const onChange = vi.fn();
  render(<SwitchRow title="Se repite" hint="PPM lo registra cada vez" checked={false} onChange={onChange} />);
  const sw = screen.getByRole("switch", { name: "Se repite" });
  expect(sw).toHaveAccessibleDescription("PPM lo registra cada vez");
  expect(screen.getByText("Se repite").closest("[aria-hidden]")).toHaveAttribute("aria-hidden", "true");
  fireEvent.click(screen.getByText("Se repite"));   // tocar el texto también lo cambia
  expect(onChange).toHaveBeenCalledWith(true);
});
