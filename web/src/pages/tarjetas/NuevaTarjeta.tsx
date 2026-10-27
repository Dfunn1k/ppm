// C5 · Tarjeta de crédito: sus datos, el corte y la línea, y lo que toca pagar según el último
// estado de cuenta (en soles y en dólares). Lo comprado después del corte se registra como gastos;
// las cuotas que faltan, después, en «Cuotas de antes de PPM».
import { useState } from "react";
import { useNavigate } from "react-router";

import { type CardIn, useCatalog, useCreateCard, useMe } from "@/api/hooks";
import { RateField, useRateInput } from "@/components/RateField";
import { Segmented, SheetSelect } from "@/components/Sheet";
import { ErrorAlert, LineField, PrimaryButton, Screen, Spinner } from "@/components/ui";
import { shortDate, todayISO } from "@/lib/dates";
import { formatAmount, multiply, parseAmount, symbolOf } from "@/lib/money";
import { FormHeader } from "@/pages/cuentas/Nueva";
import { AmountField } from "@/pages/cuentas/CuentaForm";

const BRANDS = ["Visa", "Mastercard", "Amex", "Diners"] as const;
type Brand = (typeof BRANDS)[number];

/** El último corte en o antes de hoy, con las reglas de la base: corte 31 en febrero es el 28. */
function lastClosing(day: number, today: string): string {
  const [y, m, d] = today.split("-").map(Number) as [number, number, number];
  const clamp = (yy: number, mm: number) => Math.min(day, new Date(Date.UTC(yy, mm, 0)).getUTCDate());
  if (clamp(y, m) <= d) return `${y}-${String(m).padStart(2, "0")}-${String(clamp(y, m)).padStart(2, "0")}`;
  const [py, pm] = m === 1 ? [y - 1, 12] : [y, m - 1];
  return `${py}-${String(pm).padStart(2, "0")}-${String(clamp(py, pm)).padStart(2, "0")}`;
}

export function NuevaTarjeta() {
  const navigate = useNavigate();
  const me = useMe().data;
  const banks = useCatalog().data?.banks ?? [];
  const create = useCreateCard();
  const [typedName, setTypedName] = useState<string | null>(null);
  const [bankId, setBankId] = useState("");
  const [brand, setBrand] = useState<Brand>("Visa");
  const [last4, setLast4] = useState("");
  const [closingDay, setClosingDay] = useState("");
  const [limit, setLimit] = useState("");
  const [pen, setPen] = useState("");
  const [usd, setUsd] = useState("");
  const [due, setDue] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const base = me?.currency ?? "PEN";
  const other = me?.currencies.find((c) => c !== base) ?? null;
  const rate = useRateInput(other ?? base, base, todayISO(), "sell");
  if (!me?.currency) return <Spinner />;

  const lang = me.lang ?? "es-PE";
  const bank = banks.find((b) => String(b.id) === bankId);
  const name = typedName ?? [brand, bank?.name].filter(Boolean).join(" ");
  const day = Number(closingDay);
  const validDay = Number.isInteger(day) && day >= 1 && day <= 31;
  const corte = validDay ? lastClosing(day, todayISO()) : null;
  const usdValue = other ? parseAmount(usd || "0", lang) : "0.00";
  const hasUsd = usdValue !== null && Number(usdValue) > 0;

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!name.trim()) return setProblem("Ponle un nombre, como Visa BBVA");
    if (last4 && !/^\d{4}$/.test(last4)) return setProblem("Los últimos 4 son cuatro dígitos");
    if (!validDay) return setProblem("El día de corte va del 1 al 31");
    const credit = parseAmount(limit || "", lang);
    if (credit === null || Number(credit) < 0) return setProblem("Escribe la línea de crédito, como 5,000.00");
    const penValue = parseAmount(pen || "0", lang);
    if (penValue === null || usdValue === null) return setProblem("Escribe los montos como 1,234.50");
    if (hasUsd && !(Number(rate.value) > 0)) return setProblem("Escribe el tipo de cambio, como 3.762");
    if (due && corte && due <= corte) return setProblem(`La fecha de pago va después del corte (${shortDate(corte)})`);
    const to_pay: CardIn["to_pay"] = [{ currency: base, amount: penValue, rate: null }];
    if (other && hasUsd) to_pay.push({ currency: other, amount: usdValue, rate: rate.value.trim() });
    create.mutate(
      { name: name.trim(), closing_day: day, credit_limit: credit, bank_id: bank ? bank.id : null, brand,
        last4: last4 || null, to_pay, date_due: due || null },
      { onSuccess: (d) => navigate(`/tarjetas/${d.account.id}`, { replace: true }) },
    );
  };

  return (
    <Screen className="pt-4">
      <FormHeader back="/cuentas/nueva" label="Tarjeta de crédito" />
      <form noValidate onSubmit={submit} className="mt-1 flex flex-1 flex-col">
        <LineField label="Nombre" placeholder="Visa BBVA" value={name} maxLength={80} onChange={(e) => setTypedName(e.target.value)}
          className="h-12 font-display text-[30px] leading-9 font-extrabold tracking-[-0.02em]" />

        <div className="mt-4 grid grid-cols-2 gap-4">
          <SheetSelect label="Banco" sheetTitle="Elige el banco" value={bankId} onChange={setBankId}
            options={banks.map((b) => ({ value: String(b.id), label: b.name }))} />
          <LineField label="Últimos 4 (opcional)" inputMode="numeric" maxLength={4} value={last4}
            onChange={(e) => setLast4(e.target.value.replace(/\D/g, ""))} className="tracking-[0.08em] tabular-nums" />
        </div>
        <div className="mt-4">
          <Segmented label="Marca" size="sm" value={brand} onChange={(v) => setBrand(v as Brand)}
            options={BRANDS.map((b) => ({ value: b, label: b }))} />
        </div>
        <div className="mt-4 grid grid-cols-[112px_1fr] gap-4">
          <LineField label="Día de corte" inputMode="numeric" maxLength={2} placeholder="20" value={closingDay}
            onChange={(e) => setClosingDay(e.target.value.replace(/\D/g, ""))} className="tabular-nums" />
          <LineField label={`Línea de crédito (${symbolOf(base)})`} inputMode="decimal" placeholder="5,000.00" value={limit}
            onChange={(e) => setLimit(e.target.value)} className="tabular-nums" />
        </div>
        <span className="mt-1.5 text-caption text-muted-foreground">Los dos están en tu estado de cuenta. El corte cierra cada ciclo.</span>

        <span className="mt-5 border-b border-border pb-1 text-label text-muted-foreground">Tu último estado de cuenta</span>
        <div className="mt-3">
          <AmountField label="¿Cuánto toca pagar?" symbol={symbolOf(base)} value={pen} onChange={(e) => setPen(e.target.value)} />
        </div>
        <div className={`mt-3 grid items-end gap-4 ${other ? "grid-cols-2" : "grid-cols-1"}`}>
          {other && (
            <LineField label={`Y en ${other === "USD" ? "dólares" : other} (${symbolOf(other)})`} inputMode="decimal" placeholder="0.00"
              value={usd} onChange={(e) => setUsd(e.target.value)} className="tabular-nums" />
          )}
          <LineField label="Pagar hasta (opcional)" type="date" min={corte ?? undefined} value={due} onChange={(e) => setDue(e.target.value)} />
        </div>
        {other && hasUsd && (
          <div className="mt-3">
            <RateField input={rate} currency={other} side="sell"
              aside={Number(rate.value) > 0 && (
                <>
                  <span className="text-caption text-muted-foreground">Son</span>
                  <span className="font-semibold">{formatAmount(multiply(usdValue!, rate.value), symbolOf(base), lang)}</span>
                </>
              )} />
          </div>
        )}
        <span className="mt-2 text-caption text-muted-foreground">
          Queda como lo que debías {corte ? `al corte del ${shortDate(corte)}` : "al último corte"}. Lo que compraste después,
          regístralo como gastos; las cuotas que faltan, agrégalas luego en la tarjeta.
        </span>

        <div className="min-h-6 flex-1" />
        <div className="flex flex-col gap-3">
          {(problem || create.error) && <ErrorAlert>{problem ?? create.error?.message}</ErrorAlert>}
          <PrimaryButton pending={create.isPending}>Crear tarjeta</PrimaryButton>
        </div>
      </form>
    </Screen>
  );
}
