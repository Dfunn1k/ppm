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
