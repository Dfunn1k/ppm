// La persona de muestra de las capturas: una cuenta con datos de varios meses, para que cada
// pantalla muestre algo (listas, gráficos, tarjetas, personas, presupuesto). Se arma por la API,
// igual que las pruebas e2e.
import type { APIRequestContext } from "@playwright/test";

export type Ids = {
  email: string;
  cash: number;
  bank: number;
  usd: number;
  card: number;
  loan: number | null;
  partner: number;
  move: number;
  recurring: number | null;
  post: number | null;
};

const PASSWORD = "pan-para-mayo-2026";

function day(daysAgo: number): string {
  return new Date(Date.now() - daysAgo * 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/Lima" });
}

async function json(r: Awaited<ReturnType<APIRequestContext["post"]>>, what: string) {
  if (!r.ok()) throw new Error(`${what}: ${r.status()} ${await r.text()}`);
  return r.json();
}

/** El id de una cuenta por su nombre, en la respuesta de GET /api/accounts (se busca en todo el árbol). */
function findAccount(tree: unknown, name: string): number {
  const stack = [tree];
  while (stack.length) {
    const x = stack.pop();
    if (Array.isArray(x)) stack.push(...x);
    else if (x && typeof x === "object") {
      const o = x as Record<string, unknown>;
      if (o.name === name && typeof o.id === "number") return o.id;
      stack.push(...Object.values(o));
    }
  }
  throw new Error(`No encontré la cuenta ${name}`);
}

export async function seed(api: APIRequestContext, tag: string): Promise<Ids> {
  const email = `e2e-capturas-${tag}-${Date.now()}@prueba.ppm`;
  await json(await api.post("/api/auth/signup", { data: { name: "Ana Torres", email, password: PASSWORD } }), "signup");
  await json(await api.post("/api/me/setup", { data: { country: "PE", other_currencies: ["USD"] } }), "setup");

  const banks = (await json(await api.get("/api/catalog"), "catalog")).banks as { id: number; name: string }[];
  const bank = (name: string) => banks.find((b) => b.name === name)?.id ?? banks[0]!.id;
  const cats: Record<string, number> = {};
  for (const kind of ["expense", "income"]) {
    const groups = (await json(await api.get(`/api/categories?kind=${kind}`), "categories")).groups as
      { children: { id: number; name: string }[] }[];
    for (const g of groups) for (const k of g.children) cats[k.name] = k.id;
  }
  const cat = (name: string) => cats[name] ?? Object.values(cats)[0]!;

  // El Efectivo lo crea la configuración; aquí solo se le pone lo que hay hoy, como el paso 3
  const accounts = (await json(await api.get("/api/accounts"), "accounts")) as { groups?: unknown } | unknown;
  const cash = findAccount(accounts, "Efectivo");
  await json(await api.put(`/api/accounts/${cash}/opening`, { data: { amount: "350" } }), "opening");
  const bcp = (await json(await api.post("/api/accounts/bank", { data: { name: "BCP sueldo", currency: "PEN", bank_id: bank("BCP"), opening: { amount: "4200" } } }), "bank")).account.id;
  const usd = (await json(await api.post("/api/accounts/bank", { data: { name: "BBVA dólares", currency: "USD", bank_id: bank("BBVA"), opening: { amount: "800", rate: "3.70" } } }), "usd")).account.id;
  const card = (await json(await api.post("/api/cards", { data: { name: "Visa Qore", closing_day: 20, credit_limit: "6000", brand: "Visa", last4: "4417" } }), "card")).account.id;

  const move = async (data: object) => json(await api.post("/api/moves", { data }), `move ${JSON.stringify(data).slice(0, 80)}`);
  // Tres meses de ingresos y gastos, con categorías de varios grupos
  let first = 0;
  for (const back of [0, 30, 60]) {
    await move({ kind: "income", account_id: bcp, amount: "5200", date: day(back + 2), ref: "Sueldo", splits: [{ category_id: cat("Salario y facturas"), amount: "5200" }] });
    const m = await move({ kind: "expense", account_id: bcp, amount: "412.30", date: day(back + 1), ref: "Plaza Vea", splits: [{ category_id: cat("Supermercado y mercado"), amount: "412.30" }] });
    first ||= m.summary.id;
    await move({ kind: "expense", account_id: bcp, amount: "1200", date: day(back + 3), ref: "Alquiler", splits: [{ category_id: cat("Alquiler"), amount: "1200" }] });
    await move({ kind: "expense", account_id: cash, amount: "38.50", date: day(back + 4), ref: "Taxi al aeropuerto", splits: [{ category_id: cat("Taxi y apps"), amount: "38.50" }] });
    await move({ kind: "expense", account_id: card, amount: "186.90", date: day(back + 5), ref: "Restaurante Central", splits: [{ category_id: cat("Restaurantes"), amount: "186.90" }] });
  }
  await move({ kind: "expense", account_id: card, amount: "1499.00", date: day(20), ref: "Televisor", installments: 6, splits: [{ category_id: cat("Hogar"), amount: "1499.00" }] });
  await move({ kind: "expense", account_id: usd, amount: "45.99", rate: "3.72", date: day(6), ref: "Suscripción anual", splits: [{ category_id: cat("Hogar"), amount: "45.99" }] });

  const partner = (await json(await api.post("/api/partners", { data: { name: "Luis Pérez" } }), "partner")).id;
  await move({ kind: "lend", account_id: bcp, amount: "250", partner_id: partner, date: day(40), ref: "Préstamo para el viaje" });
  await move({ kind: "lend", account_id: bcp, amount: "60", partner_id: partner, date: day(5), ref: "Entradas del concierto" });

  let recurringId: number | null = null;
  const rec = await api.post("/api/recurring", { data: {
    move: { kind: "expense", account_id: bcp, amount: "89.90", ref: "Internet", splits: [{ category_id: cat("Internet y teléfono"), amount: "89.90" }] },
    rule: { interval: "month" }, mode: "reminder" } });
  if (rec.ok()) recurringId = (await rec.json()).id;

  let loan: number | null = null;
  const l = await api.post("/api/loans", { data: { name: "Préstamo personal", bank_id: bank("Interbank"), currency: "PEN", fresh: false,
    amount: "8000", pay_account_id: bcp, day: 15, left: 18, capital: "420.00", interest: "95.00" } });
  if (l.ok()) loan = (await l.json()).id;

  await api.post("/api/tags", { data: { name: "Viaje a Cusco" } });

  let post: number | null = null;
  const month = day(0).slice(0, 7);
  const b = await api.post("/api/budget/start", { data: { month, savings: ["Fondo de emergencia"] } });
  if (b.ok()) {
    const view = await json(await api.get(`/api/budget?month=${month}`), "budget");
    const posts = view.posts as { id: number }[];
    post = posts[0]?.id ?? null;
    if (post) await api.post("/api/budget/moves", { data: { month, to_post_id: post, amount: "600" } });
  }

  return { email, cash, bank: bcp, usd, card, loan, partner, move: first, recurring: recurringId, post };
}
