// C5 · Cuenta de banco o efectivo. El mismo formulario sirve en «Nueva cuenta» y en el paso 3
// de la configuración: quien lo usa decide qué hacer con lo que devuelve.
import { zodResolver } from "@hookform/resolvers/zod";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import type { BankIn, CashIn } from "@/api/hooks";
import { rateHint, useSuggestedRate } from "@/components/RateField";
import { Segmented, SheetSelect } from "@/components/Sheet";
import { ErrorAlert, Icon, LineField, PrimaryButton } from "@/components/ui";
import { DateField } from "@/components/DateSheet";
import { todayISO } from "@/lib/dates";
import { CURRENCY_NAME, parseAmount, symbolOf } from "@/lib/money";

export type Bank = { id: number; name: string; cci_code: string | null };

function schema(kind: "bank" | "cash", base: string, banks: Bank[]) {
  return z
    .object({
      name: z.string().trim().min(1, { error: "Ponle un nombre" }).max(80, { error: "Usa 80 caracteres o menos" }),
      currency: z.string(),
      bankId: z.string(),
      accKind: z.enum(["savings", "checking"]),
      amount: z.string(),
      rate: z.string(),
      date: z.string(),
      accNumber: z.string(),
      cci: z.string(),
    })
    .superRefine((v, ctx) => {
      if (parseAmount(v.amount || "0") === null)
        ctx.addIssue({ code: "custom", path: ["amount"], message: "Escribe un monto como 1,234.50" });
      if (v.currency !== base) {
        const rate = v.rate.trim();
        if (!/^\d{1,6}(\.\d{1,6})?$/.test(rate) || Number(rate) <= 0)
          ctx.addIssue({ code: "custom", path: ["rate"], message: "Escribe el tipo de cambio, como 3.443" });
      }
      if (kind !== "bank") return;
      const bank = banks.find((b) => String(b.id) === v.bankId);
      if (!bank) ctx.addIssue({ code: "custom", path: ["bankId"], message: "Elige el banco" });
      if (v.accNumber.trim() && !/^[0-9 -]{6,30}$/.test(v.accNumber.trim()))
        ctx.addIssue({ code: "custom", path: ["accNumber"], message: "Solo dígitos y guiones" });
      const cci = v.cci.replace(/\D/g, "");
      if (v.cci.trim() && cci.length !== 20)
        ctx.addIssue({ code: "custom", path: ["cci"], message: "El CCI tiene 20 dígitos" });
      else if (cci && bank?.cci_code && !cci.startsWith(bank.cci_code))
        ctx.addIssue({
          code: "custom",
          path: ["cci"],
          message: `Ese CCI no es de ${bank.name}: los de ${bank.name} empiezan con ${bank.cci_code}`,
        });
    });
}

type Values = z.infer<ReturnType<typeof schema>>;

export function CuentaForm({ kind, base, currencies, banks, lang, submitLabel, pending, error, onSubmit }: {
  kind: "bank" | "cash";
  base: string;
  currencies: string[];
  banks: Bank[];
  lang: string;
  submitLabel: string;
  pending?: boolean;
  error?: string | null;
  onSubmit: (body: BankIn | CashIn) => void;
}) {
  const [dateOpen, setDateOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const form = useForm<Values>({
    resolver: zodResolver(schema(kind, base, banks)),
    defaultValues: {
      name: "",
      currency: base,
      bankId: "",
      accKind: "savings",
      amount: "",
      rate: "",
      date: todayISO(),
      accNumber: "",
      cci: "",
    },
  });
  const { errors } = form.formState;
  const [currency, bankId, accKind, date] = useWatch({ control: form.control, name: ["currency", "bankId", "accKind", "date"] });
  const foreign = currency !== base;
  // El tipo de SUNAT del día del saldo, mientras la persona no escriba otro
  const suggestion = useSuggestedRate(currency, base, dateOpen ? date : todayISO());
  useEffect(() => {
    if (suggestion.value && !form.getFieldState("rate").isDirty) form.setValue("rate", suggestion.value);
  }, [suggestion.value, form]);

  const submit = form.handleSubmit((v) => {
    const opening = {
      amount: parseAmount(v.amount || "0", lang)!,
      date: dateOpen ? v.date : null,
      rate: foreign ? v.rate.trim() : null,
    };
    const common = { name: v.name.trim(), currency: v.currency, opening };
    if (kind === "cash") return onSubmit(common);
    onSubmit({
      ...common,
      bank_id: Number(v.bankId),
      acc_kind: v.accKind,
      acc_number: v.accNumber.trim() || null,
      cci: v.cci.replace(/\D/g, "") || null,
    });
  });

  const chip = "flex h-9 items-center gap-1 rounded-full border border-border px-3 text-caption font-semibold";

  return (
    <form noValidate onSubmit={submit} className="flex flex-1 flex-col">
      <LineField
        label="Nombre"
        placeholder={kind === "bank" ? "Cuenta digital BCP" : "Billetera"}
        error={errors.name?.message}
        className="h-[52px] font-display text-[30px] leading-9 font-extrabold tracking-[-0.02em]"
        {...form.register("name")}
      />

      {kind === "bank" && (
        <div className="mt-5 grid grid-cols-2 gap-4">
          <SheetSelect
            label="Banco"
            sheetTitle="Elige el banco"
            value={bankId}
            onChange={(v) => form.setValue("bankId", v, { shouldValidate: form.formState.isSubmitted })}
            error={errors.bankId?.message}
            options={banks.map((b) => ({
              value: String(b.id),
              label: b.name,
              hint: b.cci_code ? `El CCI empieza con ${b.cci_code}` : undefined,
            }))}
          />
          <Segmented
            label="Tipo"
            size="sm"
            value={accKind}
            onChange={(v) => form.setValue("accKind", v as Values["accKind"])}
            options={[
              { value: "savings", label: "Ahorros" },
              { value: "checking", label: "Corriente" },
            ]}
          />
        </div>
      )}

      {currencies.length > 1 && (
        <div className="mt-5">
          <Segmented
            label="Moneda"
            value={currency}
            onChange={(v) => form.setValue("currency", v)}
            options={currencies.map((c) => ({ value: c, label: `${CURRENCY_NAME[c] ? CURRENCY_NAME[c][0]!.toUpperCase() + CURRENCY_NAME[c].slice(1) : c} · ${symbolOf(c)}` }))}
          />
        </div>
      )}

      <div className="mt-6">
        <AmountField
          label={kind === "bank" ? "¿Cuánto tiene hoy?" : "¿Cuánto hay hoy?"}
          symbol={symbolOf(currency)}
          hint={kind === "bank" ? "Lo que diga hoy la app de tu banco. Queda como saldo inicial." : "Queda como saldo inicial."}
          error={errors.amount?.message}
          {...form.register("amount")}
        />
      </div>

      {foreign && (
        <div className="mt-4">
          <LineField
            label="Tipo de cambio"
            inputMode="decimal"
            hint={rateHint("buy", suggestion.date, currency)}
            error={errors.rate?.message}
            {...form.register("rate")}
          />
        </div>
      )}

      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" aria-expanded={dateOpen} onClick={() => setDateOpen(!dateOpen)} className={chip}>
          <Icon name="event" className="text-[18px]" />
          {dateOpen ? `Al ${date.split("-").reverse().join("/")}` : "Hoy · otra fecha"}
        </button>
        {kind === "bank" && (
          <button type="button" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)} className={chip}>
            <Icon name="tag" className="text-[18px]" />
            Número y CCI
          </button>
        )}
      </div>
      {dateOpen && (
        <div className="mt-3">
          <DateField label="Saldo al día" max={todayISO()} value={date} onChange={(v) => form.setValue("date", v)} />
        </div>
      )}
      {kind === "bank" && moreOpen && (
        <div className="mt-3 flex flex-col gap-3">
          <LineField label="Número de cuenta (opcional)" inputMode="numeric" className="font-mono text-[15px]"
            error={errors.accNumber?.message} {...form.register("accNumber")} />
          <LineField label="CCI (opcional, 20 dígitos)" inputMode="numeric" className="font-mono text-[15px]"
            error={errors.cci?.message} {...form.register("cci")} />
        </div>
      )}

      <div className="min-h-6 flex-1" />
      <div className="flex flex-col gap-3">
        {error && <ErrorAlert>{error}</ErrorAlert>}
        <PrimaryButton pending={pending}>{submitLabel}</PrimaryButton>
      </div>
    </form>
  );
}

/** El monto grande: el símbolo de la moneda delante y cifras tabulares. */
export function AmountField({ label, symbol, hint, error, ...props }: React.ComponentProps<"input"> & {
  label: string;
  symbol: string;
  hint?: string;
  error?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="flex flex-col gap-0.5 text-caption font-semibold">
        {label}
        <span className={`flex items-baseline gap-2 border-b-2 ${error ? "border-destructive" : "border-input-line"}`}>
          <span aria-hidden="true" className="text-[22px] leading-7 font-semibold text-muted-foreground">{symbol}</span>
          <input
            inputMode="decimal"
            placeholder="0.00"
            aria-description={`En ${symbol}`}
            aria-invalid={error ? true : undefined}
            className="h-[52px] min-w-0 flex-1 border-0 bg-transparent p-0 text-[34px] leading-10 font-semibold tracking-[-0.02em] text-foreground tabular-nums"
            {...props}
          />
        </span>
      </label>
      {error ? (
        <span className="flex items-center gap-1 text-caption text-destructive">
          <Icon name="error" className="text-[18px]" />
          {error}
        </span>
      ) : (
        hint && <span className="text-caption text-muted-foreground">{hint}</span>
      )}
    </div>
  );
}
