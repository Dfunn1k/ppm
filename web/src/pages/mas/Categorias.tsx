// X3 · Categorías: las de gasto por grupo y las de ingreso, y crear una nueva. Una de gasto va
// dentro de un grupo, o nace con un grupo nuevo (nunca hay grupos vacíos); las de ingreso, sueltas.
// Cambiar, archivar, mover y fusionar llegan después.
import { lazy, Suspense, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router";

import { ApiError, useCategories, useCreateCategory } from "@/api/hooks";
import { CategoryChip } from "@/components/CategorySheet";
import { Segmented, SheetSelect } from "@/components/Sheet";
import { BackLink } from "@/components/PageHeader";
import { ErrorAlert, Icon, LineField, PrimaryButton, Screen } from "@/components/ui";

type Kind = "expense" | "income";
const KINDS = [{ value: "expense", label: "De gasto" }, { value: "income", label: "De ingreso" }];
const NEW_GROUP = "new";
const AllIcons = lazy(() => import("@/components/AllIcons"));   // el catálogo completo, solo si se abre
const COLORS = ["gris", "rojo", "naranja", "mostaza", "turquesa", "morado", "marrón", "verde azulado", "azul", "frambuesa", "verde", "índigo"];

// Íconos de Material Symbols con palabras para buscarlos
const ICONS: [string, string][] = [
  ["shopping_cart", "compras supermercado mercado"], ["restaurant", "restaurante comida almuerzo"],
  ["local_cafe", "café bar"], ["bakery_dining", "pan panadería"], ["local_bar", "trago bar bebida"],
  ["fastfood", "comida rápida delivery"], ["directions_bus", "bus transporte micro"],
  ["local_taxi", "taxi uber auto"], ["local_gas_station", "gasolina grifo combustible"],
  ["directions_car", "auto carro"], ["flight", "viaje avión vuelo"], ["home", "casa hogar"],
  ["key", "alquiler llave"], ["bolt", "luz electricidad servicios"], ["water_drop", "agua"],
  ["wifi", "internet wifi"], ["smartphone", "celular teléfono"], ["live_tv", "streaming tv netflix"],
  ["pets", "mascota perro gato"], ["medical_services", "veterinario médico doctor"],
  ["local_pharmacy", "farmacia medicina"], ["local_hospital", "hospital clínica salud"],
  ["vaccines", "vacuna"], ["fitness_center", "gym gimnasio deporte"], ["sports_soccer", "fútbol deporte"],
  ["spa", "spa belleza"], ["content_cut", "peluquería corte"], ["checkroom", "ropa vestir"],
  ["child_care", "bebé niño hijos"], ["school", "colegio estudios educación curso"],
  ["menu_book", "libros lectura"], ["celebration", "fiesta celebración"], ["redeem", "regalo"],
  ["volunteer_activism", "donación ayuda"], ["savings", "ahorro chanchito"],
  ["payments", "sueldo salario pago efectivo"], ["work", "trabajo freelance"], ["sell", "venta vender"],
  ["storefront", "tienda negocio"], ["trending_up", "intereses inversión"],
  ["currency_exchange", "cambio moneda"], ["account_balance", "banco"], ["receipt_long", "boleta recibo"],
  ["handshake", "trato acuerdo"], ["build", "arreglo reparación herramienta"], ["cleaning_services", "limpieza"],
  ["laptop_mac", "computadora laptop"], ["sports_esports", "juegos videojuegos"], ["music_note", "música"],
  ["movie", "cine película"], ["hotel", "hotel hospedaje"], ["beach_access", "playa vacaciones"],
  ["local_laundry_service", "lavandería"], ["shield", "seguro"], ["gavel", "trámite legal impuestos"],
  ["star", "otro favorito"], ["category", "categoría otros"],
];

export function Categorias() {
  const [params, setParams] = useSearchParams();
  const kind: Kind = params.get("tipo") === "ingreso" ? "income" : "expense";
  const data = useCategories(kind).data;
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-md flex-col px-6 pt-4 pb-28">
      <div className="-mx-2.5 flex min-h-control items-center">
        <BackLink to="/mas" label="Volver a Más" />
      </div>
      <h1 className="mt-1 text-title-hero">Categorías</h1>
      <div className="mt-4">
        <Segmented label="Tipo" value={kind} options={KINDS} size="sm"
          onChange={(v) => setParams(v === "income" ? { tipo: "ingreso" } : {}, { replace: true })} />
      </div>
      <Link to={`/mas/categorias/nueva${kind === "income" ? "?tipo=ingreso" : ""}`}
        className="mt-3 flex h-12 items-center justify-center gap-1.5 rounded-xl border border-dashed border-input-line font-semibold">
        <Icon name="add" />
        {kind === "income" ? "Nueva categoría de ingreso" : "Nueva categoría de gasto"}
      </Link>
      <ul className="mt-1 flex flex-col">
        {data?.groups.map((g) => (
          <li key={g.id ?? g.name} className="flex flex-col border-b border-border py-2.5">
            <span className="flex items-center gap-3">
              <CategoryChip category={{ icon: g.icon ?? (g.id === null ? "category" : null), color: g.color }} />
              <span className="flex flex-1 flex-col">
                <span className="font-semibold">{g.name}</span>
                <span className="text-caption text-muted-foreground">
                  {kind === "income" ? "Van sueltas, sin grupos" : g.children.length === 1 ? "1 categoría" : `${g.children.length} categorías`}
                </span>
              </span>
            </span>
            <span className="mt-2 ml-12 flex flex-wrap gap-1.5">
              {g.children.map((k) => (
                <span key={k.id} className="flex h-7 items-center gap-1 rounded-full bg-muted pr-2.5 pl-1.5 text-caption">
                  <span style={{ color: `var(--cat-${k.color ?? 0})` }}><Icon name={k.icon ?? "category"} size="sm" /></span>
                  {k.name}
                </span>
              ))}
            </span>
          </li>
        ))}
      </ul>
      <p className="mt-3 text-caption text-muted-foreground">
        Por ahora solo se crean. Cambiar, archivar, mover y fusionar llegan después.
      </p>
    </main>
  );
}

export function NuevaCategoria() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [kind, setKind] = useState<Kind>(params.get("tipo") === "ingreso" ? "income" : "expense");
  const groups = (useCategories("expense").data?.groups ?? []).filter((g) => g.id !== null);
  const create = useCreateCategory();

  const [name, setName] = useState("");
  const [parent, setParent] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");
  const [q, setQ] = useState("");
  const [icon, setIcon] = useState<string | null>(null);
  const [all, setAll] = useState(false);
  const [color, setColor] = useState<number | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const income = kind === "income";
  const chosenParent = parent ?? (groups[0] ? String(groups[0].id) : NEW_GROUP);
  const fresh = !income && chosenParent === NEW_GROUP;
  const group = groups.find((g) => String(g.id) === chosenParent);
  const ownColor = !income && !fresh ? color : color ?? (income ? 10 : 0);
  const shown = { icon: icon ?? (fresh || income ? null : group?.icon) ?? "category", color: ownColor ?? group?.color ?? 0 };
  const needle = q.trim().toLowerCase();
  const icons = ICONS.filter(([n, words]) => !needle || words.includes(needle) || n.includes(needle)).map(([n]) => n);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setProblem(null);
    if (!name.trim()) return setProblem("Ponle un nombre");
    if (fresh && !groupName.trim()) return setProblem("Ponle un nombre al grupo");
    if ((income || fresh) && !icon) return setProblem("Elige un ícono");
    try {
      await create.mutateAsync({
        kind,
        name: name.trim(),
        parent_id: income || fresh ? null : Number(chosenParent),
        group: fresh ? groupName.trim() : null,
        icon,
        color: ownColor,
      });
      navigate(income ? "/mas/categorias?tipo=ingreso" : "/mas/categorias", { replace: true });
    } catch {
      // el mensaje sale de la mutación
    }
  };

  const preview = income ? "Ingreso, sin grupo"
    : fresh ? `Gasto dentro de ${groupName.trim() || "un grupo nuevo"}, que es nuevo`
    : `Gasto dentro de ${group?.name ?? ""}${ownColor === null ? ", con el color del grupo" : ""}`;

  return (
    <Screen className="pt-4">
      <div className="-mx-2.5 flex min-h-control items-center justify-between">
        <Link to={income ? "/mas/categorias?tipo=ingreso" : "/mas/categorias"} aria-label="Cerrar sin crear"
          className="grid size-11 place-items-center rounded-full">
          <Icon name="close" size="md" />
        </Link>
      </div>
      <form noValidate onSubmit={save} className="flex flex-1 flex-col">
        <h1 className="mt-1 text-title-hero">Nueva categoría</h1>
        <div className="mt-4 flex flex-col gap-4">
          <Segmented label="Tipo" value={kind} options={KINDS} size="sm"
            onChange={(v) => { setKind(v as Kind); setColor(null); }} />
          <LineField label="Nombre" autoComplete="off" value={name} onChange={(e) => setName(e.target.value)} />
          {income ? (
            <p className="-mt-2 text-caption text-muted-foreground">Las de ingreso van sueltas: no tienen grupo.</p>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <SheetSelect label="¿Dentro de qué grupo?" value={chosenParent} onChange={(v) => { setParent(v); setColor(null); }}
                  options={[...groups.map((g) => ({ value: String(g.id), label: g.name })), { value: NEW_GROUP, label: "Un grupo nuevo" }]} />
                <span className="text-caption text-muted-foreground">
                  {fresh ? "Se crea el grupo con esta como su primera categoría. El ícono y el color van al grupo y ella los hereda."
                    : "Solo aparecen los grupos sin movimientos propios: un grupo que ya tiene gastos no puede tener categorías adentro."}
                </span>
              </div>
              {fresh && (
                <LineField label="Nombre del grupo" autoComplete="off" value={groupName} onChange={(e) => setGroupName(e.target.value)} />
              )}
            </>
          )}

          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold">Ícono</span>
            <label className="flex h-control items-center gap-2 rounded-md bg-muted px-3 focus-within:outline-2 focus-within:outline-offset-2 focus-within:outline-ring">
              <Icon name="search" className="text-muted-foreground" />
              <input aria-label="Buscar ícono" placeholder="Buscar: perro, gym, bebé…" value={q} onChange={(e) => setQ(e.target.value)}
                className="min-w-0 flex-1 border-0 bg-transparent focus:outline-none" />
            </label>
            <div role="radiogroup" aria-label="Ícono" className="grid grid-cols-6 gap-1.5 narrow:grid-cols-5">
              {icons.map((n) => (
                <button key={n} type="button" role="radio" aria-label={n} aria-checked={n === icon} onClick={() => setIcon(n)}
                  className={`grid h-control place-items-center rounded-md ${n === icon ? "" : "border border-border"}`}
                  style={n === icon ? { background: `var(--cat-${shown.color})`, color: "var(--on-category)" } : undefined}>
                  <Icon name={n} size="md" />
                </button>
              ))}
              {icons.length === 0 && <span className="col-span-7 py-2 text-caption text-muted-foreground">No hay íconos con «{q}».</span>}
            </div>
            {icon && !ICONS.some(([n]) => n === icon) && (
              <span className="flex items-center gap-2 text-caption text-muted-foreground">
                Elegiste <span className="grid size-8 place-items-center rounded-md" style={{ background: `var(--cat-${shown.color})`, color: "var(--on-category)" }}>
                  <Icon name={icon} /></span> del catálogo completo
              </span>
            )}
            {all ? (
              <Suspense fallback={<span className="py-2 text-caption text-muted-foreground">Cargando los íconos…</span>}>
                <span className="mt-2 text-caption font-semibold">Todos los íconos</span>
                <AllIcons value={icon} onPick={setIcon} tint={shown.color} />
              </Suspense>
            ) : (
              <button type="button" onClick={() => setAll(true)}
                className="flex h-control items-center justify-center gap-1.5 rounded-md border border-border text-caption font-semibold">
                <Icon name="apps" size="sm" />Ver todos los íconos
              </button>
            )}
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-caption font-semibold">Color</span>
            <div role="radiogroup" aria-label="Color" className="flex flex-wrap items-center gap-2">
              {!income && !fresh && (
                <button type="button" role="radio" aria-checked={color === null} onClick={() => setColor(null)}
                  className={`hit-area h-8 rounded-full px-2.5 text-caption-sm leading-4 font-semibold ${color === null ? "border-2 border-foreground" : "border border-border"}`}>
                  El del grupo
                </button>
              )}
              {COLORS.map((label, i) => (
                <button key={label} type="button" role="radio" aria-label={label} aria-checked={ownColor === i} onClick={() => setColor(i)}
                  className={`hit-area size-8 rounded-full ${ownColor === i ? "ring-2 ring-foreground ring-offset-2 ring-offset-background" : ""}`}
                  style={{ background: `var(--cat-${i})` }} />
              ))}
            </div>
          </div>

          <div role="status" className="flex items-center gap-3 rounded-xl bg-muted px-3 py-2.5">
            <CategoryChip category={shown} />
            <span className="flex flex-col">
              <span className="font-semibold">{name.trim() || "Nueva categoría"}</span>
              <span className="text-caption text-muted-foreground">{preview}</span>
            </span>
          </div>
        </div>
        <div className="min-h-6 flex-1" />
        {(problem || create.error) && (
          <div className="mb-4">
            <ErrorAlert>{problem ?? (create.error instanceof ApiError ? create.error.message : "No se pudo crear")}</ErrorAlert>
          </div>
        )}
        <PrimaryButton pending={create.isPending}>Crear categoría</PrimaryButton>
      </form>
    </Screen>
  );
}
