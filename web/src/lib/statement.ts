// Los movimientos del estado de cuenta, pegados del PDF o del Excel del banco: una línea por
// movimiento con su fecha, su descripción y su monto. «US$» o «USD» en la línea la hace en dólares.
// Sin año en la fecha, es el del corte (o el anterior si el mes pasa del corte).

export type PastedLine = { date: string; name: string; amount: string; currency: string };

const DATE = /^\s*(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2,4}))?\s*/;
const AMOUNT = /(-?\(?)\s*(?:S\/|US\$|\$)?\s*(\d{1,3}(?:[.,]\d{3})*[.,]\d{2}|\d+[.,]\d{2})(\)?)\s*(-|CR)?\s*$/i;

function amountOf(raw: string): string {
  const last = Math.max(raw.lastIndexOf("."), raw.lastIndexOf(","));
  const whole = raw.slice(0, last).replace(/[.,]/g, "");
  return `${whole || "0"}.${raw.slice(last + 1)}`;
}

/** Lee las líneas pegadas; las que no tienen fecha y monto se ignoran. */
export function parseStatement(text: string, closing: string): PastedLine[] {
  const [cy, cm] = closing.split("-").map(Number) as [number, number];
  const out: PastedLine[] = [];
  for (const row of text.split(/\r?\n/)) {
    const line = row.replace(/\t/g, " ");
    const d = DATE.exec(line);
    if (!d) continue;
    const rest = line.slice(d[0].length);
    const a = AMOUNT.exec(rest);
    if (!a) continue;
    const day = Number(d[1]);
    const month = Number(d[2]);
    const year = d[3] ? Number(d[3].length === 2 ? `20${d[3]}` : d[3]) : month > cm ? cy - 1 : cy;
    if (month < 1 || month > 12 || day < 1 || day > 31) continue;
    const negative = a[1]!.includes("-") || (a[1]!.includes("(") && a[3] === ")") || Boolean(a[4]);
    const name = rest.slice(0, a.index).replace(/\b(US\$|USD|S\/|PEN)\b/gi, "").replace(/\s+/g, " ").trim();
    out.push({
      date: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`,
      name: name || "Movimiento",
      amount: `${negative ? "-" : ""}${amountOf(a[2]!)}`,
      currency: /US\$|\bUSD\b/i.test(line) ? "USD" : "PEN",
    });
  }
  return out;
}
