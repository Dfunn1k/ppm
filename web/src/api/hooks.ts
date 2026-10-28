// Lo que las pantallas le piden a la API, con TanStack Query. Ninguna pantalla llama a `api` directo.
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "./client";
import type { components } from "./schema";

export type Me = components["schemas"]["MeOut"];
export type Catalog = components["schemas"]["CatalogOut"];
type SignupIn = components["schemas"]["SignupIn"];
type LoginIn = components["schemas"]["LoginIn"];
type SetupIn = components["schemas"]["SetupIn"];
type ResetConfirmIn = components["schemas"]["ResetConfirmIn"];

/** Un error de la API con su código HTTP y el mensaje que la API ya escribió para la persona. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

function fail(response: Response, error: unknown): never {
  const detail =
    typeof error === "object" && error !== null && "detail" in error && typeof error.detail === "string"
      ? error.detail
      : response.status === 422
        ? "Revisa los datos: alguno no tiene el formato esperado."
        : "Algo salió mal. Intenta otra vez en un momento.";
  throw new ApiError(response.status, detail);
}

const ME = ["me"] as const;

/** Quién está conectado; `null` si no hay sesión. */
export function useMe() {
  return useQuery({
    queryKey: ME,
    queryFn: async (): Promise<Me | null> => {
      const { data, error, response } = await api.GET("/me");
      if (response.status === 401) return null;
      if (!data) fail(response, error);
      return data;
    },
    staleTime: 60_000,
  });
}

export function useCatalog() {
  return useQuery({
    queryKey: ["catalog"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/catalog");
      if (!data) fail(response, error);
      return data;
    },
    staleTime: Infinity,
  });
}

export function useSignup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SignupIn) => {
      const { data, error, response } = await api.POST("/auth/signup", { body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: (me) => qc.setQueryData(ME, me),
  });
}

export function useLogin() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: LoginIn) => {
      const { data, error, response } = await api.POST("/auth/login", { body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: (me) => qc.setQueryData(ME, me),
  });
}

export function useLogout() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST("/auth/logout");
      if (!response.ok && response.status !== 401) fail(response, error);
    },
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(ME, null);
    },
  });
}

/** «Guardar y empezar»: configura la cuenta, pone el saldo del efectivo y crea los bancos del paso 3.
 *  Devuelve los problemas que hubo después de configurar (la cuenta ya quedó lista igual). */
export function useFinishSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ setup, cash, banks }: { setup: SetupIn; cash: string | null; banks: components["schemas"]["BankIn"][] }) => {
      const done = await api.POST("/me/setup", { body: setup });
      if (!done.data) fail(done.response, done.error);
      const problems: string[] = [];
      if (cash) {
        const list = await api.GET("/accounts");
        const efectivo = list.data?.have.find((a) => a.kind === "cash");
        const r = efectivo
          ? await api.PUT("/accounts/{account_id}/opening", { params: { path: { account_id: efectivo.id } }, body: { amount: cash } })
          : null;
        if (!r?.data) problems.push("No pudimos guardar el saldo de tu efectivo.");
      }
      for (const bank of banks) {
        const r = await api.POST("/accounts/bank", { body: bank });
        if (!r.data) {
          const detail = r.error && typeof r.error.detail === "string" ? r.error.detail : "revisa sus datos";
          problems.push(`No pudimos crear «${bank.name}»: ${detail}.`);
        }
      }
      return { me: done.data, problems };
    },
    onSuccess: ({ me }) => {
      qc.setQueryData(ME, me);
      return qc.invalidateQueries({ queryKey: ["accounts"] });
    },
  });
}

export function useRequestReset() {
  return useMutation({
    mutationFn: async (email: string) => {
      const { error, response } = await api.POST("/auth/password-reset", { body: { email } });
      if (!response.ok) fail(response, error);
    },
  });
}

export function useConfirmReset() {
  return useMutation({
    mutationFn: async (body: ResetConfirmIn) => {
      const { error, response } = await api.POST("/auth/password-reset/confirm", { body });
      if (!response.ok) fail(response, error);
    },
  });
}

// --- Cuentas ------------------------------------------------------------------------------------

export type Overview = components["schemas"]["OverviewOut"];
export type AccountRow = components["schemas"]["AccountRowOut"];
export type AccountDetail = components["schemas"]["AccountDetailOut"];
export type Partner = components["schemas"]["PartnerOut"];
export type CashIn = components["schemas"]["CashIn"];
export type BankIn = components["schemas"]["BankIn"];
type OpeningIn = components["schemas"]["OpeningIn"];
type AccountPatch = components["schemas"]["AccountPatch"];
type CustodyIn = components["schemas"]["CustodyIn"];

const ACCOUNTS = ["accounts"] as const;

export function useAccounts() {
  return useQuery({
    queryKey: ACCOUNTS,
    queryFn: async () => {
      const { data, error, response } = await api.GET("/accounts");
      if (!data) fail(response, error);
      return data;
    },
  });
}

export function useAccount(id: number) {
  return useQuery({
    queryKey: [...ACCOUNTS, id],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/accounts/{account_id}", { params: { path: { account_id: id } } });
      if (!data) fail(response, error);
      return data;
    },
  });
}

/** Después de cambiar una cuenta, la lista y su detalle se vuelven a pedir. */
function useAccountsChanged() {
  const qc = useQueryClient();
  return (detail?: AccountDetail) => {
    if (detail) qc.setQueryData([...ACCOUNTS, detail.account.id], detail);
    return qc.invalidateQueries({ queryKey: ACCOUNTS });
  };
}

export function useCreateCash() {
  const changed = useAccountsChanged();
  return useMutation({
    mutationFn: async (body: CashIn) => {
      const { data, error, response } = await api.POST("/accounts/cash", { body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: changed,
  });
}

export function useCreateBank() {
  const changed = useAccountsChanged();
  return useMutation({
    mutationFn: async (body: BankIn) => {
      const { data, error, response } = await api.POST("/accounts/bank", { body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: changed,
  });
}

export function useSetOpening(id: number) {
  const changed = useAccountsChanged();
  return useMutation({
    mutationFn: async (body: OpeningIn) => {
      const { data, error, response } = await api.PUT("/accounts/{account_id}/opening", {
        params: { path: { account_id: id } },
        body,
      });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: changed,
  });
}

export function useUpdateAccount(id: number) {
  const changed = useAccountsChanged();
  return useMutation({
    mutationFn: async (body: AccountPatch) => {
      const { data, error, response } = await api.PATCH("/accounts/{account_id}", {
        params: { path: { account_id: id } },
        body,
      });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: changed,
  });
}

export function useArchiveAccount(id: number) {
  const changed = useAccountsChanged();
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST("/accounts/{account_id}/archive", {
        params: { path: { account_id: id } },
      });
      if (!response.ok) fail(response, error);
    },
    onSuccess: () => changed(),
  });
}

export function usePartners() {
  return useQuery({
    queryKey: ["partners"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/partners");
      if (!data) fail(response, error);
      return data;
    },
  });
}

export function useCreatePartner() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (input: string | PartnerIn) => {
      const body = typeof input === "string" ? { name: input } : input;
      const { data, error, response } = await api.POST("/partners", { body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["partners"] }),
  });
}

// --- Personas (C6) ------------------------------------------------------------------------------

export type PartnersOverview = components["schemas"]["PartnersOverviewOut"];
export type PartnerRow = components["schemas"]["PartnerRowOut"];
export type PartnerDetail = components["schemas"]["PartnerDetailOut"];
export type OpenItem = components["schemas"]["OpenItemOut"];
type PartnerIn = components["schemas"]["PartnerIn"];
type PartnerPatch = components["schemas"]["PartnerPatch"];

export function usePartnersOverview() {
  return useQuery({
    queryKey: ["partners", "overview"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/partners/overview");
      if (!data) fail(response, error);
      return data;
    },
  });
}

export function usePartner(id: number) {
  return useQuery({
    queryKey: ["partners", id],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/partners/{partner_id}", { params: { path: { partner_id: id } } });
      if (!data) fail(response, error);
      return data;
    },
    enabled: id > 0,
  });
}

export function useUpdatePartner(id: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: PartnerPatch) => {
      const { error, response } = await api.PATCH("/partners/{partner_id}", { params: { path: { partner_id: id } }, body });
      if (!response.ok) fail(response, error);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["partners"] }),
  });
}

type PartnerOpeningIn = components["schemas"]["PartnerOpeningIn"];

/** «Ya me debía» o «Ya le debía»: el saldo inicial con una persona. */
export function usePartnerOpening(id: number) {
  const changed = useMovesChanged();
  return useMutation({
    mutationFn: async (body: PartnerOpeningIn) => {
      const { data, error, response } = await api.POST("/partners/{partner_id}/opening", { params: { path: { partner_id: id } }, body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: () => changed(),
  });
}

/** Compensar o dar por perdido: es un movimiento más, y cambia saldos y listas. */
export function usePartnerAction(id: number, action: "offset" | "write-off") {
  const changed = useMovesChanged();
  return useMutation({
    mutationFn: async () => {
      const opts = { params: { path: { partner_id: id } } };
      const { data, error, response } = action === "offset"
        ? await api.POST("/partners/{partner_id}/offset", opts)
        : await api.POST("/partners/{partner_id}/write-off", opts);
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: () => changed(),
  });
}

export function useAddCustody() {
  const changed = useAccountsChanged();
  return useMutation({
    mutationFn: async (body: CustodyIn) => {
      const { error, response } = await api.POST("/custody", { body });
      if (!response.ok) fail(response, error);
    },
    onSuccess: () => changed(),
  });
}

// --- Movimientos --------------------------------------------------------------------------------

export type MoveIn = components["schemas"]["MoveIn"];
export type MoveDetail = components["schemas"]["MoveDetailOut"];
export type MoveSummary = components["schemas"]["MoveSummaryOut"];
export type Month = components["schemas"]["MonthOut"];
export type Category = components["schemas"]["CategoryOut"];
export type Categories = components["schemas"]["CategoriesOut"];
export type MonthFilters = {
  month: string;
  account_id?: number;
  category_id?: number;
  kind?: MoveSummary["kind"];
  q?: string;
  pending?: boolean;
};

const MOVES = ["moves"] as const;

export function useCategories(kind: "expense" | "income") {
  return useQuery({
    queryKey: ["categories", kind],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/categories", { params: { query: { kind } } });
      if (!data) fail(response, error);
      return data;
    },
  });
}

export type CategoryIn = components["schemas"]["CategoryIn"];

export function useCreateCategory() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: CategoryIn) => {
      const { data, error, response } = await api.POST("/categories", { body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["categories"] }),
  });
}

export type ManualAccount = components["schemas"]["ManualAccountOut"];

export function useManualAccounts() {
  return useQuery({
    queryKey: [...ACCOUNTS, "manual"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/manual-accounts");
      if (!data) fail(response, error);
      return data;
    },
  });
}

export function useMonth(filters: MonthFilters) {
  return useQuery({
    queryKey: [...MOVES, "month", filters],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/moves", { params: { query: filters } });
      if (!data) fail(response, error);
      return data;
    },
    placeholderData: (previous) => previous,   // al filtrar, se queda lo anterior mientras llega lo nuevo
  });
}

export function useMove(id: number) {
  return useQuery({
    queryKey: [...MOVES, id],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/moves/{move_id}", { params: { path: { move_id: id } } });
      if (!data) fail(response, error);
      return data;
    },
  });
}

/** Un movimiento cambia saldos, listas y las categorías más usadas: todo se vuelve a pedir. */
function useMovesChanged() {
  const qc = useQueryClient();
  return (detail?: MoveDetail) => {
    if (detail) qc.setQueryData([...MOVES, detail.summary.id], detail);
    return Promise.all([
      qc.invalidateQueries({ queryKey: MOVES }),
      qc.invalidateQueries({ queryKey: ACCOUNTS }),
      qc.invalidateQueries({ queryKey: ["categories"] }),
      qc.invalidateQueries({ queryKey: ["partners"] }),
      qc.invalidateQueries({ queryKey: ["home"] }),
      qc.invalidateQueries({ queryKey: ["cards"] }),
    ]);
  };
}

export function useSaveMove(id?: number) {
  const changed = useMovesChanged();
  return useMutation({
    mutationFn: async (body: MoveIn) => {
      const { data, error, response } = id
        ? await api.PUT("/moves/{move_id}", { params: { path: { move_id: id } }, body })
        : await api.POST("/moves", { body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: (d) => changed(d),
  });
}

export function useSetMoveState(id: number) {
  const changed = useMovesChanged();
  return useMutation({
    mutationFn: async (pending: boolean) => {
      const { data, error, response } = await api.POST("/moves/{move_id}/state", {
        params: { path: { move_id: id } },
        body: { pending },
      });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: (d) => changed(d),
  });
}

export function useDeleteMove(id: number) {
  const qc = useQueryClient();
  const changed = useMovesChanged();
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await api.DELETE("/moves/{move_id}", { params: { path: { move_id: id } } });
      if (!response.ok) fail(response, error);
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: [...MOVES, id] });
      return changed();
    },
  });
}

/** La fecha de vencimiento de una deuda: ponerla o quitarla (en una parte de cuotas, vuelve a la de la tarjeta). */
/** Corregir capital e interés de una cuota con el «Detalle plan cuotas» del estado de cuenta. */
export function useInstallmentSplit(moveId: number) {
  const changed = useMovesChanged();
  return useMutation({
    mutationFn: async ({ sequence, principal, interest }: { sequence: number; principal: string; interest: string }) => {
      const { data, error, response } = await api.PUT("/moves/{move_id}/installments/{sequence}", {
        params: { path: { move_id: moveId, sequence } },
        body: { principal, interest },
      });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: () => changed(),
  });
}

export function useSetMaturity() {
  const changed = useMovesChanged();
  return useMutation({
    mutationFn: async ({ lineId, date }: { lineId: number; date: string | null }) => {
      const { error, response } = await api.PUT("/move-lines/{line_id}/maturity", {
        params: { path: { line_id: lineId } },
        body: { date },
      });
      if (!response.ok) fail(response, error);
    },
    onSuccess: () => changed(),
  });
}

// --- Tarjetas ------------------------------------------------------------------------------------

export type CardDetail = components["schemas"]["CardDetailOut"];
export type CardIn = components["schemas"]["CardIn"];
type CardPatch = components["schemas"]["CardPatch"];
type DueDateIn = components["schemas"]["DueDateIn"];
type InstallmentsIn = components["schemas"]["InstallmentsIn"];

const CARDS = ["cards"] as const;

export function useCard(id: number) {
  return useQuery({
    queryKey: [...CARDS, id],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/cards/{card_id}", { params: { path: { card_id: id } } });
      if (!data) fail(response, error);
      return data;
    },
  });
}

/** Una tarjeta que cambia cambia también la lista de cuentas y el Inicio. */
function useCardChanged() {
  const qc = useQueryClient();
  return (detail: CardDetail) => {
    qc.setQueryData([...CARDS, detail.account.id], detail);
    return Promise.all([
      qc.invalidateQueries({ queryKey: ACCOUNTS }),
      qc.invalidateQueries({ queryKey: MOVES }),
      qc.invalidateQueries({ queryKey: ["home"] }),
    ]);
  };
}

export function useCreateCard() {
  const changed = useCardChanged();
  return useMutation({
    mutationFn: async (body: CardIn) => {
      const { data, error, response } = await api.POST("/cards", { body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: changed,
  });
}

export function useUpdateCard(id: number) {
  const changed = useCardChanged();
  return useMutation({
    mutationFn: async (body: CardPatch) => {
      const { data, error, response } = await api.PATCH("/cards/{card_id}", { params: { path: { card_id: id } }, body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: changed,
  });
}

export function useCardDueDate(id: number) {
  const changed = useCardChanged();
  return useMutation({
    mutationFn: async (body: DueDateIn) => {
      const { data, error, response } = await api.PUT("/cards/{card_id}/due-date", { params: { path: { card_id: id } }, body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: changed,
  });
}

export function useCardInstallments(id: number) {
  const changed = useCardChanged();
  return useMutation({
    mutationFn: async (body: InstallmentsIn) => {
      const { data, error, response } = await api.POST("/cards/{card_id}/installments", { params: { path: { card_id: id } }, body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: changed,
  });
}

// --- Importar extracto y Por clasificar ------------------------------------------------------------

export type ImportResult = components["schemas"]["ImportOut"];
export type ImportMapping = components["schemas"]["MappingOut"];
export type StatementRow = components["schemas"]["StatementRowOut"];
export type StatementDetail = components["schemas"]["StatementDetailOut"];
export type Unclassified = components["schemas"]["UnclassifiedOut"];
export type ClassifyIn = components["schemas"]["ClassifyIn"];

/** Lo que se manda con el archivo: el mapeo elegido (si no, el recordado o el adivinado) y el saldo del banco. */
export type ImportForm = {
  file: File;
  mapping?: ImportMapping | null;
  balance_end?: string | null;
};

const STATEMENTS = ["statements"] as const;
const UNCLASSIFIED = ["unclassified"] as const;

/** El archivo va como multipart; openapi-fetch lo deja pasar tal cual con este serializador. */
function importBody(f: ImportForm): FormData {
  const form = new FormData();
  form.append("file", f.file, f.file.name);
  if (f.mapping) {
    form.append("header_row", String(f.mapping.header_row));
    form.append("date_format", f.mapping.date_format);
    form.append("decimal_separator", f.mapping.decimal_separator);
    form.append("columns", JSON.stringify(f.mapping.columns));
  }
  if (f.balance_end) form.append("balance_end", f.balance_end);
  return form;
}

/** Leer el extracto y decir qué pasaría, sin guardar nada. */
export function useImportPreview(accountId: number) {
  return useMutation({
    mutationFn: async (f: ImportForm) => {
      const { data, error, response } = await api.POST("/accounts/{account_id}/statements/preview", {
        params: { path: { account_id: accountId } },
        body: importBody(f) as never,
        bodySerializer: (b) => b as unknown as FormData,
      });
      if (!data) fail(response, error);
      return data;
    },
  });
}

export function useImportStatement(accountId: number) {
  const changed = useMovesChanged();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (f: ImportForm) => {
      const { data, error, response } = await api.POST("/accounts/{account_id}/statements", {
        params: { path: { account_id: accountId } },
        body: importBody(f) as never,
        bodySerializer: (b) => b as unknown as FormData,
      });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: () => Promise.all([changed(), qc.invalidateQueries({ queryKey: STATEMENTS }), qc.invalidateQueries({ queryKey: UNCLASSIFIED })]),
  });
}

export function useStatements(accountId: number) {
  return useQuery({
    queryKey: [...STATEMENTS, "account", accountId],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/accounts/{account_id}/statements", {
        params: { path: { account_id: accountId } },
      });
      if (!data) fail(response, error);
      return data;
    },
  });
}

export function useStatement(id: number) {
  return useQuery({
    queryKey: [...STATEMENTS, id],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/statements/{statement_id}", {
        params: { path: { statement_id: id } },
      });
      if (!data) fail(response, error);
      return data;
    },
  });
}

/** Dónde se descarga el archivo original: un enlace del mismo origen, con la cookie de sesión. */
export function statementFileUrl(id: number) {
  return `${window.location.origin}/api/statements/${id}/file`;
}

export function useUndoStatement(id: number) {
  const qc = useQueryClient();
  const changed = useMovesChanged();
  return useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.DELETE("/statements/{statement_id}", {
        params: { path: { statement_id: id } },
      });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: () => {
      qc.removeQueries({ queryKey: [...STATEMENTS, id] });
      return Promise.all([changed(), qc.invalidateQueries({ queryKey: STATEMENTS }), qc.invalidateQueries({ queryKey: UNCLASSIFIED })]);
    },
  });
}

/** La bandeja: lo traído del banco que falta clasificar (de una cuenta o de todas). */
export function useUnclassified(accountId?: number) {
  return useQuery({
    queryKey: [...UNCLASSIFIED, accountId ?? "all"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/unclassified", {
        params: { query: accountId ? { account_id: accountId } : {} },
      });
      if (!data) fail(response, error);
      return data;
    },
  });
}

export function useClassify() {
  const qc = useQueryClient();
  const changed = useMovesChanged();
  return useMutation({
    mutationFn: async (body: ClassifyIn) => {
      const { error, response } = await api.POST("/unclassified/classify", { body });
      if (!response.ok) fail(response, error);
    },
    onSuccess: () => Promise.all([changed(), qc.invalidateQueries({ queryKey: UNCLASSIFIED }), qc.invalidateQueries({ queryKey: STATEMENTS })]),
  });
}

// --- Inicio, Mi cuenta y Apariencia -------------------------------------------------------------

export type Home = components["schemas"]["HomeOut"];
type MePatch = components["schemas"]["MePatch"];

export function useHome(month: string) {
  return useQuery({
    queryKey: ["home", month],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/home", { params: { query: { month } } });
      if (!data) fail(response, error);
      return data;
    },
    placeholderData: (previous) => previous,
  });
}

/** Cambiar nombre, tema o acento: se ve al instante y se guarda en la cuenta. */
export function useUpdateMe() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: MePatch) => {
      const { data, error, response } = await api.PATCH("/me", { body });
      if (!data) fail(response, error);
      return data;
    },
    onMutate: (body) => {
      const before = qc.getQueryData<Me | null>(ME);
      if (before) qc.setQueryData(ME, { ...before, ...Object.fromEntries(Object.entries(body).filter(([, v]) => v != null)) });
      return { before };
    },
    onError: (_e, _body, ctx) => ctx?.before && qc.setQueryData(ME, ctx.before),
    onSuccess: (me) => qc.setQueryData(ME, me),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: async (body: { current_password: string; new_password: string }) => {
      const { error, response } = await api.POST("/auth/password", { body });
      if (!response.ok) fail(response, error);
    },
  });
}

export function useLogoutAll() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async () => {
      const { error, response } = await api.POST("/auth/logout-all");
      if (!response.ok && response.status !== 401) fail(response, error);
    },
    onSuccess: () => {
      qc.clear();
      qc.setQueryData(ME, null);
    },
  });
}

// --- Tipo de cambio -----------------------------------------------------------------------------

export type UserRate = components["schemas"]["UserRateOut"];
export type AdminRates = components["schemas"]["AdminRatesOut"];
type RateIn = components["schemas"]["RateIn"];

/** El tipo de tus monedas para un día (hoy si no se dice): el de ese día o el último anterior. */
export function useRates(date?: string) {
  return useQuery({
    queryKey: ["rates", date ?? "hoy"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/rates", { params: { query: date ? { date } : {} } });
      if (!data) fail(response, error);
      return data;
    },
    staleTime: 5 * 60_000,
  });
}

export function useAdminRates() {
  return useQuery({
    queryKey: ["admin-rates"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/admin/rates");
      if (!data) fail(response, error);
      return data;
    },
  });
}

/** Un tipo nuevo cambia la sugerencia, los saldos y el Inicio de todos. */
function useRatesChanged() {
  const qc = useQueryClient();
  return () => Promise.all(["admin-rates", "rates", "accounts", "home"].map((k) => qc.invalidateQueries({ queryKey: [k] })));
}

export function useSetRate() {
  const changed = useRatesChanged();
  return useMutation({
    mutationFn: async (body: RateIn) => {
      const { data, error, response } = await api.POST("/admin/rates", { body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: changed,
  });
}

export function useImportSunat() {
  const changed = useRatesChanged();
  return useMutation({
    mutationFn: async () => {
      const { data, error, response } = await api.POST("/admin/rates/sunat");
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: changed,
  });
}

// --- Recurrentes (X1) y préstamos de banco (C4) --------------------------------------------------

export type RecurringIn = components["schemas"]["RecurringIn"];
export type RuleIn = components["schemas"]["RuleIn"];
export type RecurringRow = components["schemas"]["RecurringRowOut"];
export type RecurringDetail = components["schemas"]["RecurringDetailOut"];
export type RecurringNext = components["schemas"]["NextOut"];
export type Loan = components["schemas"]["LoanOut"];
export type LoanIn = components["schemas"]["LoanIn"];
export type PayIn = components["schemas"]["PayIn"];

const RECURRING = ["recurring"] as const;

/** Una recurrente o una cuota toca saldos, movimientos y avisos: todo se vuelve a pedir. */
function useRecurringChanged() {
  const qc = useQueryClient();
  const moves = useMovesChanged();
  return () => Promise.all([qc.invalidateQueries({ queryKey: RECURRING }), qc.invalidateQueries({ queryKey: ["loans"] }), moves()]);
}

export function useRecurringList() {
  return useQuery({
    queryKey: [...RECURRING, "list"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/recurring");
      if (!data) fail(response, error);
      return data;
    },
  });
}

export function useRecurringPending() {
  return useQuery({
    queryKey: [...RECURRING, "pending"],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/recurring/pending");
      if (!data) fail(response, error);
      return data;
    },
  });
}

export function useRecurring(id: number) {
  return useQuery({
    queryKey: [...RECURRING, id],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/recurring/{recurring_id}", { params: { path: { recurring_id: id } } });
      if (!data) fail(response, error);
      return data;
    },
  });
}

export function useSaveRecurring(id?: number) {
  const changed = useRecurringChanged();
  return useMutation({
    mutationFn: async (body: RecurringIn) => {
      if (id) {
        const { error, response } = await api.PUT("/recurring/{recurring_id}", { params: { path: { recurring_id: id } }, body });
        if (!response.ok) fail(response, error);
        return id;
      }
      const { data, error, response } = await api.POST("/recurring", { body });
      if (!data) fail(response, error);
      return data.id;
    },
    onSuccess: () => changed(),
  });
}

export function useRecurringState(id: number) {
  const changed = useRecurringChanged();
  return useMutation({
    mutationFn: async (action: "pause" | "resume" | "end") => {
      const { error, response } = await api.POST("/recurring/{recurring_id}/state", {
        params: { path: { recurring_id: id } }, body: { action },
      });
      if (!response.ok) fail(response, error);
    },
    onSuccess: () => changed(),
  });
}

export type OccurrenceChange = { occurrence: string; skip?: boolean; date?: string | null; total?: string | null; reset?: boolean };

export function useOccurrence(id: number) {
  const changed = useRecurringChanged();
  return useMutation({
    mutationFn: async ({ occurrence, reset, skip = false, ...rest }: OccurrenceChange) => {
      const body = { skip, ...rest };
      const params = { path: { recurring_id: id, occurrence } };
      const { error, response } = reset
        ? await api.DELETE("/recurring/{recurring_id}/occurrences/{occurrence}", { params })
        : await api.PUT("/recurring/{recurring_id}/occurrences/{occurrence}", { params, body });
      if (!response.ok) fail(response, error);
    },
    onSuccess: () => changed(),
  });
}

export function useReminderDone() {
  const changed = useRecurringChanged();
  return useMutation({
    mutationFn: async ({ id, occurrence }: { id: number; occurrence: string }) => {
      const { error, response } = await api.POST("/recurring/{recurring_id}/occurrences/{occurrence}/done", {
        params: { path: { recurring_id: id, occurrence } },
      });
      if (!response.ok) fail(response, error);
    },
    onSuccess: () => changed(),
  });
}

export function useLoan(id: number) {
  return useQuery({
    queryKey: ["loans", id],
    queryFn: async () => {
      const { data, error, response } = await api.GET("/loans/{account_id}", { params: { path: { account_id: id } } });
      if (!data) fail(response, error);
      return data;
    },
  });
}

export function useCreateLoan() {
  const changed = useRecurringChanged();
  return useMutation({
    mutationFn: async (body: LoanIn) => {
      const { data, error, response } = await api.POST("/loans", { body });
      if (!data) fail(response, error);
      return data.id;
    },
    onSuccess: () => changed(),
  });
}

export function usePayLoan(id: number) {
  const changed = useRecurringChanged();
  return useMutation({
    mutationFn: async (body: PayIn) => {
      const { data, error, response } = await api.POST("/loans/{account_id}/pay", { params: { path: { account_id: id } }, body });
      if (!data) fail(response, error);
      return data.id;
    },
    onSuccess: () => changed(),
  });
}
