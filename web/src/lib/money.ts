// Cómo se escriben y se leen los montos según el idioma (los mismos separadores que res_lang).
// La API manda los montos como texto exacto ("1284.90"); aquí se formatean sin pasar por float.
const SEPARATORS: Record<string, { decimal: string; thousands: string }> = {
  "es-PE": { decimal: ".", thousands: "," },
  "es-ES": { decimal: ",", thousands: "." },
};

function sep(lang: string) {
  return SEPARATORS[lang] ?? SEPARATORS["es-PE"]!;
}

/** «S/ 1,284.90»: el símbolo antes, con espacio; lo negativo con signo menos (no guion). */
export function formatAmount(amount: number | string, symbol: string, lang = "es-PE"): string {
  const s = sep(lang);
  const text = typeof amount === "number" ? amount.toFixed(2) : amount.trim();
  const negative = text.startsWith("-");
  const [whole = "0", cents = ""] = text.replace(/^[-+]/, "").split(".");
  const grouped = whole.replace(/^0+(?=\d)/, "").replace(/\B(?=(\d{3})+(?!\d))/g, s.thousands);
  const two = (cents + "00").slice(0, 2);
  return `${negative ? "− " : ""}${symbol ? `${symbol} ` : ""}${grouped}${s.decimal}${two}`;
}

/** Solo el número, sin símbolo: «8,240.30». */
export function formatNumber(amount: number | string, lang = "es-PE"): string {
  return formatAmount(amount, "", lang);
}

/** Lo que la persona escribe («8,240.30» o «8.240,30») → texto exacto para la API («8240.30»), o null. */
export function parseAmount(input: string, lang = "es-PE"): string | null {
  const s = sep(lang);
  let text = input.trim().replace(/\s/g, "").replaceAll(s.thousands, "");
  if (s.decimal !== ".") text = text.replace(s.decimal, ".");
  if (!/^-?\d+(\.\d{1,2})?$/.test(text)) return null;
  const [whole, cents = ""] = text.split(".");
  return `${whole}.${(cents + "00").slice(0, 2)}`;
}

export function isZero(amount: string) {
  return /^-?0*(\.0*)?$/.test(amount);
}

export function isNegative(amount: string) {
  return amount.trim().startsWith("-") && !isZero(amount);
}

/** Símbolo de cada moneda en es-PE (res_currency_format). */
export const CURRENCY_SYMBOL: Record<string, string> = { PEN: "S/", USD: "US$", EUR: "€" };

export const CURRENCY_NAME: Record<string, string> = { PEN: "soles", USD: "dólares", EUR: "euros" };

export function symbolOf(code: string | null | undefined) {
  return code ? (CURRENCY_SYMBOL[code] ?? code) : "";
}

// --- Cuentas exactas con el tipo de cambio (BigInt, nunca float) --------------------------------

/** «3.4430» → 34430n con 4 decimales. Lo que sobra de decimales se corta. */
function scaled(text: string, places: number): bigint {
  const t = text.trim();
  const negative = t.startsWith("-");
  const [whole = "0", frac = ""] = t.replace(/^[-+]/, "").split(".");
  const n = BigInt(`${whole || "0"}${(frac + "0".repeat(places)).slice(0, places)}`);
  return negative ? -n : n;
}

/** Divide redondeando la mitad hacia arriba (lejos del cero), como la API. */
function roundDiv(n: bigint, d: bigint): bigint {
  const negative = n < 0n !== d < 0n;
  const [a, b] = [n < 0n ? -n : n, d < 0n ? -d : d];
  const q = (a * 2n + b) / (b * 2n);
  return negative ? -q : q;
}

function unscaled(n: bigint, places: number): string {
  const negative = n < 0n;
  const digits = (negative ? -n : n).toString().padStart(places + 1, "0");
  const text = places ? `${digits.slice(0, -places)}.${digits.slice(-places)}` : digits;
  return negative ? `-${text}` : text;
}

/** Monto × tipo de cambio, en céntimos exactos: «20.00» × «3.443» = «68.86». */
export function multiply(amount: string, rate: string): string {
  return unscaled(roundDiv(scaled(amount, 2) * scaled(rate, 6), 1_000_000n), 2);
}

/** a ÷ b con `places` decimales: el costo promedio «740.00» ÷ «200.00» = «3.700». */
export function divide(a: string, b: string, places = 3): string {
  return unscaled(roundDiv(scaled(a, 2) * 10n ** BigInt(places), scaled(b, 2)), places);
}

/** a − b, en céntimos. */
export function subtract(a: string, b: string): string {
  return unscaled(scaled(a, 2) - scaled(b, 2), 2);
}

/** Un tipo de la API («3.4430») como se escribe: con 3 decimales (los de SUNAT). */
export function rateText(rate: string): string {
  return unscaled(roundDiv(scaled(rate, 6), 1000n), 3);
}

/** a × b ÷ c, en céntimos: lo que costó una parte de lo que hay («100.00» × «740.00» ÷ «200.00» = «370.00»). */
export function proportion(a: string, b: string, c: string): string {
  return unscaled(roundDiv(scaled(a, 2) * scaled(b, 2), scaled(c, 2)), 2);
}
