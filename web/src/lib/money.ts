// Cómo se escriben los montos según el idioma (los mismos separadores que res_lang).
// El símbolo va antes, con espacio: «S/ 1,284.90».
const SEPARATORS: Record<string, { decimal: string; thousands: string }> = {
  "es-PE": { decimal: ".", thousands: "," },
  "es-ES": { decimal: ",", thousands: "." },
};

export function formatAmount(amount: number, symbol: string, lang = "es-PE"): string {
  const sep = SEPARATORS[lang] ?? SEPARATORS["es-PE"]!;
  const [whole, cents] = Math.abs(amount).toFixed(2).split(".");
  const grouped = whole!.replace(/\B(?=(\d{3})+(?!\d))/g, sep.thousands);
  return `${amount < 0 ? "− " : ""}${symbol} ${grouped}${sep.decimal}${cents}`;
}

/** Símbolo de cada moneda en es-PE (res_currency_format). */
export const CURRENCY_SYMBOL: Record<string, string> = { PEN: "S/", USD: "US$", EUR: "€" };
