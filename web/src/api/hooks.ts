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

export function useSetup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (body: SetupIn) => {
      const { data, error, response } = await api.POST("/me/setup", { body });
      if (!data) fail(response, error);
      return data;
    },
    onSuccess: (me) => qc.setQueryData(ME, me),
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
