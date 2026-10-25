import { expect, test } from "vitest";

import { passwordHint } from "./CrearCuenta";

test("la ayuda de la contraseña cuenta lo que falta", () => {
  expect(passwordHint(0)).toEqual({ ok: false, text: "Al menos 8 caracteres" });
  expect(passwordHint(5)).toEqual({ ok: false, text: "Faltan 3 caracteres" });
  expect(passwordHint(7)).toEqual({ ok: false, text: "Falta 1 caracter" });
  expect(passwordHint(8).ok).toBe(true);
});
