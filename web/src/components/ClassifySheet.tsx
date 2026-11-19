// M3 · ¿En qué fue? La hoja para clasificar uno o varios movimientos traídos del banco: una
// categoría (con quién, opcional), otra cuenta tuya (una transferencia) o una persona (le presté,
// le pagué, le devolví; me pagó, me prestó, me dio para guardar). Un cobro o un pago no pasa de lo
// que se debe: si pasa, la API lo dice con sus palabras.
import { useState } from "react";

import { type Category, type ClassifyIn, useAccounts, useCategories, useClassify, useMe } from "@/api/hooks";
import { formatAmount, symbolOf } from "@/lib/money";

import { CategoryChip } from "./CategorySheet";
import { PersonPicker } from "./PersonPicker";
import { Segmented, Sheet } from "./Sheet";
import { ErrorAlert, Icon, Optional, PrimaryButton } from "./ui";

/** Lo que hace falta saber de cada movimiento para clasificarlo. */
export type ToClassify = { move_id: number; title: string; caption: string; account_id: number; currency: string; amount: string };

type Tab = "category" | "account" | "person";
type Role = NonNullable<ClassifyIn["role"]>;

const PERSON_OPTIONS: Record<"in" | "out", { role: Role; label: string; hint: string }[]> = {
  out: [
    { role: "receivable", label: "Le presté", hint: "Te deberá esto" },
    { role: "payable", label: "Le pagué lo que le debía", hint: "Hasta lo que le debes" },
    { role: "custody", label: "Le devolví o usé su plata", hint: "Hasta lo que guardas suyo" },
  ],
  in: [
    { role: "receivable", label: "Me pagó lo que me debía", hint: "Hasta lo que te debe" },
    { role: "payable", label: "Me prestó", hint: "Le deberás esto" },
    { role: "custody", label: "Me dio para guardar", hint: "Lo guardas por esa persona" },
  ],
};

export function ClassifySheet({ open, onClose, items, onDone }: {
  open: boolean;
  onClose: () => void;
  items: ToClassify[];
  onDone?: () => void;
}) {
  const me = useMe().data;
  const lang = me?.lang ?? "es-PE";
  const incoming = items.length > 0 && items.every((x) => !x.amount.startsWith("-"));
  const outgoing = items.every((x) => x.amount.startsWith("-"));
  const [tab, setTab] = useState<Tab>("category");
  const [catKind, setCatKind] = useState<"expense" | "income">(incoming ? "income" : "expense");
  const [category, setCategory] = useState<Category | null>(null);
  const [withWho, setWithWho] = useState(false);
  const [accountId, setAccountId] = useState<number | null>(null);
  const [partnerId, setPartnerId] = useState<number | null>(null);
  const [role, setRole] = useState<Role | null>(null);
  const classify = useClassify();

  const one = items.length === 1 ? items[0]! : null;
  const title = one ? one.title : `${items.length} movimientos`;
  const caption = one
    ? `${one.caption} · ${formatAmount(one.amount, symbolOf(one.currency), lang)}`
    : "Todos van al mismo lugar";

  const body: ClassifyIn | null =
    tab === "category" && category ? { move_ids: items.map((x) => x.move_id), account_id: category.id, partner_id: withWho ? partnerId : null }
      : tab === "account" && accountId ? { move_ids: items.map((x) => x.move_id), account_id: accountId }
        : tab === "person" && role && partnerId ? { move_ids: items.map((x) => x.move_id), role, partner_id: partnerId }
          : null;

  return (
    <Sheet title={title} open={open} onClose={onClose}>
      <span className="mx-3 -mt-1 text-caption text-muted-foreground tabular-nums">{caption}</span>
      <div className="mx-1 mt-3">
        <Segmented label="Qué fue" size="sm" value={tab} onChange={(v) => { setTab(v as Tab); classify.reset(); }}
          options={[{ value: "category", label: "Categoría" }, { value: "account", label: "Mis cuentas" }, { value: "person", label: "Persona" }]} />
      </div>

      <form className="mt-2 flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (body) classify.mutate(body, { onSuccess: () => { onDone?.(); onClose(); } });
        }}>
        {tab === "category" && (
          <>
            {incoming && (
              <div className="mx-1">
                <Segmented label="Entró por" size="sm" value={catKind} onChange={(v) => { setCatKind(v as "expense" | "income"); setCategory(null); }}
                  options={[{ value: "income", label: "Un ingreso" }, { value: "expense", label: "Me devolvieron un gasto" }]} />
              </div>
            )}
            <CategoryList kind={catKind} selected={category?.id ?? null} onPick={setCategory} />
            {withWho ? (
              <div className="mx-3"><PersonPicker label="Con quién" optional value={partnerId} onChange={setPartnerId} /></div>
            ) : (
              <button type="button" onClick={() => setWithWho(true)}
                className="mx-3 flex min-h-12 items-center gap-2.5 border-t border-border text-left">
                <Icon name="person" className="text-muted-foreground" />
                <span className="flex flex-1 flex-col">
                  <span className="flex justify-between gap-2 text-caption text-muted-foreground">Con quién<Optional /></span>
                  <span className="font-semibold">Nadie</span>
                </span>
                <Icon name="expand_more" className="text-muted-foreground" />
              </button>
            )}
          </>
        )}

        {tab === "account" && (
          <AccountList items={items} base={me?.currency ?? "PEN"} selected={accountId} onPick={setAccountId} />
        )}

        {tab === "person" && (
          <div className="mx-3 flex flex-col gap-3">
            {!incoming && !outgoing ? (
              <p className="text-caption text-muted-foreground">
                Elegiste plata que entró y plata que salió: con una persona, clasifícalos por separado.
              </p>
            ) : (
              <>
                <PersonPicker label="¿Con quién?" value={partnerId} onChange={setPartnerId} />
                <div role="radiogroup" aria-label="¿Qué fue?" className="flex flex-col">
                  <span className="mb-1 text-label text-muted-foreground">¿Qué fue?</span>
                  {PERSON_OPTIONS[incoming ? "in" : "out"].map((o) => (
                    <button key={o.role} type="button" role="radio" aria-checked={role === o.role} onClick={() => setRole(o.role)}
                      className={`flex min-h-14 items-center gap-3 rounded-md px-3 text-left ${role === o.role ? "bg-muted" : ""}`}>
                      <Icon name={role === o.role ? "radio_button_checked" : "radio_button_unchecked"} fill={role === o.role} className="text-[22px]" />
                      <span className="flex flex-col">
                        <span className="font-semibold">{o.label}</span>
                        <span className="text-caption text-muted-foreground">{o.hint}</span>
                      </span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        <div className="mx-1 flex flex-col gap-2">
          {classify.error && <ErrorAlert>{classify.error.message}</ErrorAlert>}
          <PrimaryButton pending={classify.isPending} disabled={!body}>
            {submitLabel(tab, category, items.length)}
          </PrimaryButton>
        </div>
      </form>
    </Sheet>
  );
}

function submitLabel(tab: Tab, category: Category | null, n: number) {
  const what = n === 1 ? "" : ` ${n}`;
  if (tab === "category") return category ? `Clasificar${what} como ${category.name}` : "Elige una categoría";
  if (tab === "account") return "Es una transferencia";
  return `Clasificar${what}`;
}

/** Las categorías por grupo, con búsqueda; la elegida lleva su check. */
function CategoryList({ kind, selected, onPick }: { kind: "expense" | "income"; selected: number | null; onPick: (c: Category) => void }) {
  const data = useCategories(kind).data;
  const [q, setQ] = useState("");
  const needle = q.trim().toLowerCase();
  const groups = (data?.groups ?? [])
    .map((g) => ({ ...g, children: g.children.filter((k) => !needle || k.name.toLowerCase().includes(needle) || g.name.toLowerCase().includes(needle)) }))
    .filter((g) => g.children.length > 0);
  return (
    <div className="flex flex-col">
      <label className="mx-1 flex h-11 items-center gap-2 rounded-md bg-muted px-3">
        <Icon name="search" className="text-muted-foreground" />
        <input aria-label="Buscar categoría" placeholder="Buscar: súper, taxi, luz…" value={q} onChange={(e) => setQ(e.target.value)}
          className="min-w-0 flex-1 border-0 bg-transparent focus:outline-none" />
      </label>
      <div role="radiogroup" aria-label="Categorías" className="mt-1 flex flex-col">
        {groups.map((g) => (
          <div key={g.id ?? g.name} className="flex flex-col">
            <span className="mx-1 mt-3 mb-0.5 flex items-center gap-2 text-label text-muted-foreground">
              <span className="size-2.5 rounded-full" style={{ background: `var(--cat-${g.color ?? 0})` }} />
              {g.name}
            </span>
            {g.children.map((k) => (
              <button key={k.id} type="button" role="radio" aria-checked={k.id === selected} onClick={() => onPick(k)}
                className={`flex min-h-[52px] items-center gap-3 rounded-md px-3 text-left ${k.id === selected ? "bg-muted" : ""}`}>
                <CategoryChip category={k} />
                <span className="flex-1 font-semibold">{k.name}</span>
                {k.id === selected && <Icon name="check_circle" fill className="text-[22px]" />}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Tus otras cuentas de dinero. Una en otra moneda no se ofrece: eso es un cambio y va en Registrar. */
function AccountList({ items, base, selected, onPick }: {
  items: ToClassify[]; base: string; selected: number | null; onPick: (id: number) => void;
}) {
  const overview = useAccounts().data;
  const own = new Set(items.map((x) => x.account_id));
  const currencies = new Set(items.map((x) => x.currency));
  const accounts = [...(overview?.have ?? []), ...(overview?.owe ?? [])]
    .filter((a) => (a.kind === "cash" || a.kind === "bank" || a.kind === "card") && !own.has(a.id));
  return (
    <div className="mx-1 flex flex-col">
      <span className="mx-2 mb-1 text-label text-muted-foreground">¿A qué cuenta tuya fue?</span>
      <div role="radiogroup" aria-label="Mis cuentas" className="flex flex-col">
        {accounts.map((a) => {
          const usable = a.currency === null || a.currency === base || [...currencies].every((c) => c === a.currency);
          const on = a.id === selected;
          return (
            <button key={a.id} type="button" role="radio" aria-checked={on} disabled={!usable} onClick={() => onPick(a.id)}
              className={`flex min-h-[60px] items-center gap-3 rounded-md px-3 text-left disabled:opacity-50 ${on ? "bg-muted" : ""}`}>
              <span className="grid size-9 flex-none place-items-center rounded-full bg-secondary text-secondary-foreground">
                <Icon name={a.icon ?? (a.kind === "card" ? "credit_card" : a.kind === "cash" ? "payments" : "account_balance")} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="font-semibold">{a.name}</span>
                <span className="text-caption text-muted-foreground">
                  {usable ? (a.subtitle ?? "") : "En otra moneda: un cambio se registra en Registrar › Transferir"}
                </span>
              </span>
              {on && <Icon name="check_circle" fill className="text-[22px]" />}
            </button>
          );
        })}
      </div>
      <p className="mx-2 mt-2 flex gap-2 text-caption text-muted-foreground">
        <Icon name="link" className="text-[18px]" />
        Cuando importes el extracto de esa cuenta, la otra mitad se enlaza sola: la transferencia queda una sola vez.
      </p>
    </div>
  );
}
