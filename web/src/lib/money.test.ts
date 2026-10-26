import { expect, test } from "vitest";

import { formatAmount, formatNumber, parseAmount } from "./money";

test("es-PE: punto decimal y coma de miles, símbolo antes", () => {
  expect(formatAmount(1284.9, "S/")).toBe("S/ 1,284.90");
  expect(formatAmount("1234567.00", "US$")).toBe("US$ 1,234,567.00");
});

test("es-ES: coma decimal y punto de miles", () => {
  expect(formatAmount(1284.9, "S/", "es-ES")).toBe("S/ 1.284,90");
});

test("lo que sale lleva el signo menos, no un guion", () => {
  expect(formatAmount("-35.50", "S/")).toBe("− S/ 35.50");
});

test("los montos de la API se formatean sin perder céntimos", () => {
  expect(formatNumber("0.10")).toBe("0.10");
  expect(formatNumber("999999999999.99")).toBe("999,999,999,999.99");
});

test("lo que escribe la persona se vuelve texto exacto", () => {
  expect(parseAmount("8,240.3")).toBe("8240.30");
  expect(parseAmount(" 320 ")).toBe("320.00");
  expect(parseAmount("8.240,30", "es-ES")).toBe("8240.30");
  expect(parseAmount("-150")).toBe("-150.00");
  expect(parseAmount("1.005")).toBeNull();
  expect(parseAmount("diez")).toBeNull();
});
