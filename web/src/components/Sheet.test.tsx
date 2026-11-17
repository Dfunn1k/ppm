import { fireEvent, render, screen, within } from "@testing-library/react";
import { expect, test, vi } from "vitest";

import { OptionList } from "./Sheet";

const names = ["Efectivo", "BBVA soles", "BBVA dólares", "BCP sueldo", "BCP ahorros", "Interbank", "Fondo", "Tarjeta BBVA", "Tarjeta Interbank"];
const options = names.map((label, i) => ({ value: String(i), label }));

const labels = () => within(screen.getByRole("radiogroup")).getAllByRole("radio").map((r) => r.querySelector(".font-semibold")?.textContent);

test("con 8 opciones o menos no hay buscador y el orden no cambia", () => {
  render(<OptionList options={options.slice(0, 8)} value="3" onPick={() => {}} />);
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  expect(labels()[0]).toBe("Efectivo");
});

test("con más de 8: la elegida primero y el buscador filtra sin importar tildes", () => {
  const onPick = vi.fn();
  render(<OptionList options={options} value="3" onPick={onPick} searchLabel="Buscar cuenta" />);
  expect(labels()[0]).toBe("BCP sueldo");
  fireEvent.change(screen.getByRole("searchbox", { name: "Buscar cuenta" }), { target: { value: "dolares" } });
  expect(labels()).toEqual(["BBVA dólares"]);
  fireEvent.click(screen.getByRole("radio", { name: "BBVA dólares" }));
  expect(onPick).toHaveBeenCalledWith("2");
  fireEvent.change(screen.getByRole("searchbox"), { target: { value: "yape" } });
  expect(screen.getByText("Nada se llama así.")).toBeInTheDocument();
});

test("search={false} lo apaga aunque sean muchas, como los meses", () => {
  render(<OptionList search={false} options={options} value="3" onPick={() => {}} />);
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  expect(labels()[0]).toBe("Efectivo");
});
