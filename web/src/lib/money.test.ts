import { expect, test } from "vitest";

import { formatAmount } from "./money";

test("es-PE: punto decimal y coma de miles, símbolo antes", () => {
  expect(formatAmount(1284.9, "S/")).toBe("S/ 1,284.90");
  expect(formatAmount(1234567, "US$")).toBe("US$ 1,234,567.00");
});

test("es-ES: coma decimal y punto de miles", () => {
  expect(formatAmount(1284.9, "S/", "es-ES")).toBe("S/ 1.284,90");
});

test("lo que sale lleva el signo menos, no un guion", () => {
  expect(formatAmount(-35.5, "S/")).toBe("− S/ 35.50");
});
