import { expect, test } from "vitest";

import { parseStatement } from "./statement";

test("lee las líneas del estado de cuenta con su moneda y sin año", () => {
  const text = [
    "17/10 OPENAI *CHATGPT US$ 30.84",
    "12/10/2026\tTIKTOK ADS\t1,117.82",
    "25/10 PAGO RECIBIDO 500.00-",
    "30/09 SPOTIFY USD 0.60",
    "Total del periodo 1,120.23",
  ].join("\n");
  expect(parseStatement(text, "2026-10-25")).toEqual([
    { date: "2026-10-17", name: "OPENAI *CHATGPT", amount: "30.84", currency: "USD" },
    { date: "2026-10-12", name: "TIKTOK ADS", amount: "1117.82", currency: "PEN" },
    { date: "2026-10-25", name: "PAGO RECIBIDO", amount: "-500.00", currency: "PEN" },
    { date: "2026-09-30", name: "SPOTIFY", amount: "0.60", currency: "USD" },
  ]);
});

test("un corte de enero lee diciembre del año anterior", () => {
  expect(parseStatement("28/12 NETFLIX 44.90", "2027-01-25")[0]!.date).toBe("2026-12-28");
});
