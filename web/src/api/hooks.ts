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
    mutationFn: async (name: string) => {
      const { data, error, response } = await api.POST("/partners", { body: { name } });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["partners"] }),
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
  kind?: "expense" | "income" | "transfer";
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
