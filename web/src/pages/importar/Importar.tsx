// C7 · Importar extracto, en tres pasos: subir el Excel o CSV (y ver los extractos anteriores), decir
// qué columna es qué (la API propone o recuerda) y revisar antes de importar: cuántos son nuevos,
// cuántos ya estaban, cuántos ya se importaron y si el saldo cuadra con el del banco. Lo nuevo entra
// confirmado a Por clasificar. Por ahora, solo a cuentas de banco.
import { useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

import {
  type ImportMapping,
  type ImportResult,
  type StatementRow,
  useAccount,
  useImportPreview,
  useImportStatement,
  useMe,
  useStatements,
} from "@/api/hooks";
import { OptionList, Segmented, Sheet } from "@/components/Sheet";
import { ErrorAlert, Facts, Icon, LineField, PrimaryButton, Spinner } from "@/components/ui";
import { shortDate } from "@/lib/dates";
import { formatAmount, formatNumber, isNegative, isZero, parseAmount, symbolOf } from "@/lib/money";
import { Pill } from "@/components/Pill";

type Step = "file" | "columns" | "review";
type FieldKey = keyof ImportMapping["columns"];

const FIELDS: { key: FieldKey; name: string; help: string; more?: string }[] = [
  { key: "date", name: "Fecha", help: "Obligatoria" },
  { key: "payment_ref", name: "Descripción del banco", help: "Obligatoria", more: "Nunca cambia" },
  { key: "amount", name: "Monto", help: "Obligatorio", more: "Lo que sale, en negativo" },
  { key: "debit", name: "Cargo", help: "Lo que sale" },
  { key: "credit", name: "Abono", help: "Lo que entra" },
  { key: "operation_number", name: "N.º de operación", help: "Evita importar dos veces lo mismo" },
  { key: "balance", name: "Saldo", help: "Para comprobar que cuadre" },
];

export function Importar() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const me = useMe().data;
  const account = useAccount(id);
  const preview = useImportPreview(id);
  const save = useImportStatement(id);
  const [step, setStep] = useState<Step>("file");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [mapping, setMapping] = useState<ImportMapping | null>(null);
  const [balance, setBalance] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  if (!me || account.isPending) return <Spinner />;
  const lang = me.lang ?? "es-PE";
  const name = account.data?.account.name ?? "";

  const read = (f: File, m: ImportMapping | null, then?: Step) => {
    const value = balance.trim() ? parseAmount(balance, lang) : null;
    if (balance.trim() && value === null) return setProblem("Escribe el saldo como 1,234.50");
    setProblem(null);
    preview.mutate({ file: f, mapping: m, balance_end: value }, {
      onSuccess: (r) => { setResult(r); setMapping(r.mapping); if (then) setStep(then); },
    });
  };
  const back = step === "file" ? `/cuentas/${id}` : null;
  const label = step === "file" ? name : result?.file_name ?? "";
  const stepNo = step === "file" ? 1 : step === "columns" ? 2 : 3;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-6">
      <div className="-mx-2.5 flex items-center justify-between">
        {back ? (
          <Link to={back} aria-label="Cerrar sin importar" className="grid size-11 place-items-center rounded-full"><Icon name="close" className="text-[24px]" /></Link>
        ) : (
          <button type="button" aria-label="Volver" onClick={() => setStep(step === "review" ? "columns" : "file")}
            className="grid size-11 place-items-center rounded-full"><Icon name="arrow_back" className="text-[24px]" /></button>
        )}
        <span className="flex min-w-0 items-center gap-1.5 pr-2.5 text-label text-muted-foreground uppercase"><span className="truncate">{label}</span><Pill>{stepNo} de 3</Pill></span>
      </div>

      {step === "file" && (
        <FileStep accountId={id} pending={preview.isPending} error={preview.error?.message ?? null}
          onFile={(f) => { setFile(f); setMapping(null); setBalance(""); read(f, null, "columns"); }} lang={lang} />
      )}

      {step === "columns" && result && mapping && file && (
        <>
          <h1 className="mt-2 text-title-1">¿Qué columna es qué?</h1>
          <span className="mt-2 flex items-center gap-1.5 text-caption text-muted-foreground">
            <Icon name={result.remembered ? "history" : "auto_awesome"} className="text-[18px]" />
            {result.remembered ? "Son las columnas de la última vez con esta cuenta." : `Los encabezados están en la fila ${mapping.header_row}. Revisa lo que propusimos.`}
          </span>
          <ColumnsEditor result={result} mapping={mapping} onChange={(m) => { setMapping(m); read(file, m); }} />
          {!mapping.columns.balance && (
            <div className="mt-4">
              <LineField label={`Saldo según tu banco${result.date_to ? ` al ${shortDate(result.date_to)}` : ""}`} optional
                inputMode="decimal" placeholder="0.00" value={balance} onChange={(e) => setBalance(e.target.value)}
                hint="El archivo no lo trae. Con él comprobamos que no falte ningún movimiento." />
            </div>
          )}
          <span className="mt-5 flex justify-between border-b border-border pb-1 text-label text-muted-foreground">
            <span>Así lo leemos</span><span className="text-caption normal-case">{Math.min(result.sample.length, 3)} de {result.total_rows} filas</span>
          </span>
          {result.sample.length === 0 && (
            <span className="py-3 text-caption text-muted-foreground">Elige la fecha, la descripción y el monto para ver cómo se leen.</span>
          )}
          {result.sample.map((r, i) => (
            <div key={i} className="flex min-h-11 items-center gap-2.5 border-b border-border text-[14px] leading-5">
              <span className="w-12 flex-none text-muted-foreground tabular-nums">{shortDate(r.date)}</span>
              <span className="min-w-0 flex-1 truncate">{r.payment_ref}</span>
              <span className={`font-medium tabular-nums ${isNegative(r.amount) ? "text-expense" : "text-income"}`}>
                {isNegative(r.amount) ? "− " : "+ "}{formatNumber(r.amount.replace("-", ""), lang)}
              </span>
            </div>
          ))}
          <div className="min-h-6 flex-1" />
          {(problem || preview.error) && <div className="mb-3"><ErrorAlert>{problem ?? preview.error?.message}</ErrorAlert></div>}
          <button type="button" disabled={preview.isPending || result.sample.length === 0} onClick={() => read(file, mapping, "review")}
            className="flex h-14 w-full items-center justify-between rounded-xl bg-primary px-5 font-semibold text-primary-foreground disabled:opacity-60">
            <span>Revisar las {result.total_rows} filas</span>
            <Icon name={preview.isPending ? "progress_activity" : "arrow_forward"} className={`text-[22px] ${preview.isPending ? "animate-spin" : ""}`} />
          </button>
        </>
      )}

      {step === "review" && result && file && (
        <form className="flex flex-1 flex-col" onSubmit={(e) => {
          e.preventDefault();
          save.mutate({ file, mapping, balance_end: balance.trim() ? parseAmount(balance, lang) : null }, {
            onSuccess: (r) => navigate(r.counts.new > 0 ? `/por-clasificar?cuenta=${id}` : `/cuentas/${id}`, { replace: true }),
          });
        }}>
          <Review result={result} lang={lang} />
          <div className="min-h-6 flex-1" />
          <span className="mb-2.5 text-caption text-muted-foreground">Lo nuevo entra confirmado y va a Por clasificar. El archivo queda guardado con el extracto.</span>
          {save.error && <div className="mb-3"><ErrorAlert>{save.error.message}</ErrorAlert></div>}
          <PrimaryButton pending={save.isPending} disabled={result.counts.new + result.counts.matched === 0}>
            {result.counts.new + result.counts.matched === 0 ? "No hay nada nuevo" : result.counts.new === 1 ? "Importar 1 movimiento" : `Importar ${result.counts.new} movimientos`}
          </PrimaryButton>
        </form>
      )}
    </main>
  );
}

function FileStep({ accountId, pending, error, onFile, lang }: {
  accountId: number; pending: boolean; error: string | null; onFile: (f: File) => void; lang: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  const past = useStatements(accountId).data ?? [];
  return (
    <>
      <h1 className="mt-2 text-title-1">Importar extracto</h1>
      <p className="mt-3 text-muted-foreground">
        Descarga tus movimientos de la banca por internet en Excel o CSV y súbelos aquí. Lo que ya está en PPM no se duplica.
      </p>
      <input ref={input} type="file" accept=".xlsx,.xls,.csv,.txt" className="sr-only" aria-label="Archivo del extracto"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      <button type="button" disabled={pending} onClick={() => input.current?.click()}
        className="mt-5 flex h-[132px] flex-col items-center justify-center gap-1.5 rounded-lg border-[1.5px] border-dashed border-input-line bg-card">
        <Icon name={pending ? "progress_activity" : "upload_file"} className={`text-[32px] ${pending ? "animate-spin" : ""}`} />
        <span className="font-semibold">{pending ? "Leyendo el archivo…" : "Elegir archivo"}</span>
        <span className="text-caption text-muted-foreground">.xlsx, .xls o .csv</span>
        <span className="-mt-1.5 text-caption text-muted-foreground">Hasta 5 MB</span>
      </button>
      {error && <div className="mt-3"><ErrorAlert>{error}</ErrorAlert></div>}
      {past.length === 0 ? (
        <div className="mt-4 flex flex-col gap-2.5 rounded-lg bg-muted p-3.5 text-caption text-muted-foreground">
          <span className="flex gap-2"><Icon name="table_view" className="text-[18px] text-foreground" />
            Es tu primer extracto de esta cuenta: después de subirlo dirás qué columna es la fecha, cuál el monto y cuál la descripción. La próxima vez ya lo sabremos.</span>
          <span className="flex gap-2"><Icon name="flag" className="text-[18px] text-foreground" />
            Para que el saldo cuadre, el saldo inicial de la cuenta debe ser de antes del primer movimiento del archivo.</span>
        </div>
      ) : (
        <section aria-label="Extractos anteriores" className="mt-6 flex flex-col">
          <span className="border-b border-border pb-1 text-label text-muted-foreground">Extractos anteriores</span>
          {past.map((s) => <PastRow key={s.id} s={s} lang={lang} />)}
        </section>
      )}
    </>
  );
}

function PastRow({ s, lang }: { s: StatementRow; lang: string }) {
  const range = s.date_from && s.date_to ? `${shortDate(s.date_from)}–${shortDate(s.date_to)}` : "Sin fechas";
  const status = s.difference === null ? null : isZero(s.difference)
    ? { icon: "check_circle", text: "Cuadra", cls: "text-income" }
    : { icon: "error", text: `${isNegative(s.difference) ? "Sobran" : "Faltan"} ${formatNumber(s.difference.replace("-", ""), lang)}`, cls: "text-attention" };
  return (
    <Link to={`/extractos/${s.id}`} className="flex min-h-16 items-center gap-3 border-b border-border">
      <span className="grid size-9 flex-none place-items-center rounded-full bg-muted"><Icon name="description" /></span>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-semibold">{s.name}</span>
        <Facts className="mt-0.5" items={[["Periodo", range], ["Movimientos", String(s.lines)]]} />
      </span>
      {status && <span className={`flex items-center gap-1 text-caption font-semibold ${status.cls}`}><Icon name={status.icon} className="text-[18px]" />{status.text}</span>}
    </Link>
  );
}

function ColumnsEditor({ result, mapping, onChange }: { result: ImportResult; mapping: ImportMapping; onChange: (m: ImportMapping) => void }) {
  const [editing, setEditing] = useState<FieldKey | null>(null);
  const split = !mapping.columns.amount && (!!mapping.columns.debit || !!mapping.columns.credit);
  const [mode, setMode] = useState<"amount" | "split">(split ? "split" : "amount");
  const shown = FIELDS.filter((f) => (mode === "amount" ? f.key !== "debit" && f.key !== "credit" : f.key !== "amount"));
  const set = (key: FieldKey, column: string | null) => {
    const columns = { ...mapping.columns };
    if (column) {
      for (const k of Object.keys(columns) as FieldKey[]) if (columns[k] === column) delete columns[k];   // una columna, un campo
      columns[key] = column;
    } else delete columns[key];
    onChange({ ...mapping, columns });
  };
  const options = [{ value: "", label: "No está en el archivo" },
    ...result.headers.filter((h) => h.trim()).map((h) => ({ value: h, label: `«${h}»` }))];
  return (
    <div className="mt-3 flex flex-col">
      <Segmented label="El monto viene" size="sm" value={mode}
        onChange={(v) => {
          setMode(v as "amount" | "split");
          const columns = { ...mapping.columns };
          if (v === "amount") { delete columns.debit; delete columns.credit; } else delete columns.amount;
          onChange({ ...mapping, columns });
        }}
        options={[{ value: "amount", label: "En una columna, con signo" }, { value: "split", label: "En cargo y abono" }]} />
      {shown.map((f) => {
        const col = mapping.columns[f.key];
        return (
          <div key={f.key} className="flex min-h-[52px] items-center justify-between gap-3 border-b border-border">
            <span className="flex flex-col"><span className="font-semibold">{f.name}</span><span className="text-[12px] leading-4 text-muted-foreground">{f.help}</span>{f.more && <span className="text-[12px] leading-4 text-muted-foreground">{f.more}</span>}</span>
            <button type="button" aria-label={`${f.name}: ${col ? `columna ${col}` : "no está en el archivo"}. Cambiar`} onClick={() => setEditing(f.key)}
              className={`flex h-9 max-w-[190px] items-center gap-1 rounded-full border pr-2 pl-3 text-caption font-semibold ${col ? "border-foreground bg-card" : "border-border text-muted-foreground"}`}>
              <span className="truncate">{col ? `«${col}»` : "No está"}</span><Icon name="expand_more" className="text-[18px]" />
            </button>
          </div>
        );
      })}
      <div className="mt-3 grid grid-cols-2 gap-3">
        <Segmented label="Fecha" size="sm" value={mapping.date_format} onChange={(v) => onChange({ ...mapping, date_format: v as ImportMapping["date_format"] })}
          options={[{ value: "DD/MM/YYYY", label: "día/mes" }, { value: "MM/DD/YYYY", label: "mes/día" }]} />
        <Segmented label="Decimales" size="sm" value={mapping.decimal_separator} onChange={(v) => onChange({ ...mapping, decimal_separator: v as "." | "," })}
          options={[{ value: ".", label: "1,234.50" }, { value: ",", label: "1.234,50" }]} />
      </div>
      <Sheet title={FIELDS.find((f) => f.key === editing)?.name ?? ""} open={editing !== null} onClose={() => setEditing(null)}>
        <OptionList options={options} value={editing ? (mapping.columns[editing] ?? "") : ""}
          onPick={(v) => { if (editing) set(editing, v || null); setEditing(null); }} />
      </Sheet>
    </div>
  );
}

function Review({ result, lang }: { result: ImportResult; lang: string }) {
  const c = result.counts;
  const sym = symbolOf(result.currency);
  const groups = [
    { icon: "inbox", name: "Nuevos", help: "Entran a Por clasificar", n: c.new, attention: true },
    { icon: "link", name: "Ya están en PPM", help: "Los anotaste tú o vienen de otra cuenta tuya: se enlazan, no se duplican", n: c.matched },
    { icon: "content_copy", name: "Ya importados", help: "Vinieron en un extracto anterior: se saltan", n: c.duplicate },
    { icon: "block", name: "Sin monto", help: "No mueven dinero: se omiten", n: c.zero },
    { icon: "error", name: "Con problemas", help: "No entran", n: c.problems, attention: true },
  ].filter((g) => g.n > 0 || g.name === "Nuevos");
  const ch = result.check;
  const bal = ch.difference === null
    ? { icon: "help", title: "Sin control de saldo", text: "No escribiste el saldo de tu banco, así que no podemos comprobar que no falte nada. Puedes escribirlo en el paso anterior.", cls: "bg-muted" }
    : isZero(ch.difference)
      ? { icon: "check_circle", title: "El saldo cuadra", text: `Después de importar tendrás ${formatAmount(ch.book, sym, lang)}, lo mismo que dice tu banco${result.date_to ? ` al ${shortDate(result.date_to)}` : ""}.`, cls: "bg-[color-mix(in_srgb,var(--income)_12%,transparent)] text-income" }
      : { icon: "error", title: `${isNegative(ch.difference) ? "Sobran" : "Faltan"} ${formatAmount(ch.difference.replace("-", ""), sym, lang)}`,
          text: `Tu banco dice ${formatAmount(ch.bank!, sym, lang)} y PPM tendrá ${formatAmount(ch.book, sym, lang)}. Puede faltar un movimiento de antes del archivo o estar mal el saldo inicial. Puedes importar igual y revisarlo después.`,
          cls: "bg-attention-soft text-attention" };
  return (
    <>
      <h1 className="mt-2 text-title-1">Antes de importar</h1>
      <span className="mt-1 text-caption text-muted-foreground">
        {result.total_rows} filas{result.date_from && result.date_to ? ` del ${shortDate(result.date_from)} al ${shortDate(result.date_to)}` : ""}
      </span>
      <div className="mt-4 flex flex-col">
        {groups.map((g) => (
          <div key={g.name} className="flex min-h-16 items-center gap-3 border-b border-border">
            <span className={`grid size-9 flex-none place-items-center rounded-full ${g.attention ? "bg-attention-soft text-attention" : "bg-secondary text-secondary-foreground"}`}>
              <Icon name={g.icon} />
            </span>
            <span className="flex min-w-0 flex-1 flex-col"><span className="font-semibold">{g.name}</span><span className="text-caption text-muted-foreground">{g.help}</span></span>
            <span className="text-[20px] leading-[26px] font-semibold tabular-nums">{g.n}</span>
          </div>
        ))}
      </div>
      {result.problems.length > 0 && (
        <ul className="mt-2 flex flex-col gap-1 text-caption text-muted-foreground">
          {result.problems.slice(0, 5).map((p) => <li key={p.row}>Fila {p.row}: {p.reason}.</li>)}
          {result.problems.length > 5 && <li>… y {result.problems.length - 5} más.</li>}
        </ul>
      )}
      <div role="status" className={`mt-4 flex gap-2.5 rounded-lg p-3.5 ${bal.cls}`}>
        <Icon name={bal.icon} className="text-[22px]" />
        <span className="flex flex-col gap-0.5"><b>{bal.title}</b><span className="text-caption tabular-nums">{bal.text}</span></span>
      </div>
    </>
  );
}
