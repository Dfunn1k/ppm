// Lo que la persona de muestra trae de un archivo, para que salgan las pantallas que lo necesitan:
// un estado de cuenta de tarjeta importado (Conciliar, con «La cuota del banco es distinta») y un
// extracto de banco (Extracto, y Por clasificar con movimientos). Son los mismos datos de las
// pruebas: tests/fixtures/bcp_visa_2026-10.txt de la API, impreso como PDF por el navegador.
import { readFileSync } from "node:fs";
import type { APIRequestContext, Browser } from "@playwright/test";

export type FileIds = { statementCard: number; closing: string; extract: number };

const PEN = [["2026-10-03", "22.30"], ["2026-10-04", "16.00"], ["2026-10-06", "126.00"], ["2026-10-08", "266.30"],
  ["2026-10-07", "49.80"], ["2026-10-09", "98.60"], ["2026-10-10", "97.00"], ["2026-10-13", "19.90"],
  ["2026-10-16", "79.90"], ["2026-10-17", "80.00"]] as const;
const USD = [["2026-10-12", "6.83"], ["2026-10-17", "24.01"]] as const;

async function ok(r: Awaited<ReturnType<APIRequestContext["post"]>>, what: string) {
  if (!r.ok()) throw new Error(`${what}: ${r.status()} ${await r.text()}`);
  return r.json();
}

function day(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
}

export async function seedFiles(api: APIRequestContext, browser: Browser, bank: number, cat: (name: string) => number): Promise<FileIds> {
  // La tarjeta del estado de cuenta: las compras del ciclo y Unipiel registrada sin escribir la cuota
  const card = (await ok(await api.post("/api/cards", { data: { name: "Visa BCP", closing_day: 25, credit_limit: "7010.91", brand: "Visa", last4: "1111" } }), "card")).account.id;
  const buy = (data: object) => api.post("/api/moves", { data: { kind: "expense", account_id: card, ...data } }).then((r) => ok(r, "compra"));
  for (const [date, amount] of PEN) await buy({ amount, date, ref: "Compra", splits: [{ category_id: cat("Restaurantes"), amount }] });
  for (const [date, amount] of USD) await buy({ amount, date, currency: "USD", rate: "3.500", ref: "Compra en dólares", splits: [{ category_id: cat("Hogar"), amount }] });
  await buy({ amount: "693.00", date: "2026-10-14", ref: "Unipiel", installments: 3, splits: [{ category_id: cat("Hogar"), amount: "693.00" }] });

  const text = readFileSync(new URL("../e2e/fixtures/bcp_visa_2026-10.txt", import.meta.url), "utf8");
  const page = await browser.newPage();
  await page.setContent(`<pre style="font: 7px/9px monospace; margin: 0">${text.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</pre>`);
  const pdf = await page.pdf({ format: "A4", landscape: true });
  await page.close();
  const st = await ok(await api.post(`/api/cards/${card}/statements`, { multipart: { file: { name: "EECC_VISA.pdf", mimeType: "application/pdf", buffer: pdf } } }), "estado de cuenta");

  // El extracto del banco: tres movimientos que quedan por clasificar
  const csv = ["Fecha,Descripción,Monto,N° operación",
    `${day(2).split("-").reverse().join("/")},POS TOTTUS SAN ISIDRO,-142.60,07120931`,
    `${day(3).split("-").reverse().join("/")},YAPE A CARLOS RAMOS,-35.00,004871`,
    `${day(4).split("-").reverse().join("/")},PLIN-SOFIA DIAZ,80.00,`].join("\n");
  await ok(await api.post(`/api/accounts/${bank}/statements`, { multipart: { file: { name: "bcp-sueldo.csv", mimeType: "text/csv", buffer: Buffer.from(csv) } } }), "extracto");
  const list = await ok(await api.get(`/api/accounts/${bank}/statements`), "extractos") as { id: number }[];

  return { statementCard: card, closing: st.closing_date, extract: list[0]!.id };
}
