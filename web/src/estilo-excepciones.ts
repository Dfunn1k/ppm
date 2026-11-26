// Las excepciones del inspector de estilos (estilo.test.ts): lo que se escribe a mano a propósito,
// con su motivo. Esta lista solo puede achicarse; sumar una pide el OK de Dany (SISTEMA.md 4.2).
export type Excepcion = { archivo: string; regla: string; veces: number; motivo: string };

export const EXCEPCIONES: Excepcion[] = [
  {
    archivo: "components/GoogleButton.tsx", regla: "hex", veces: 4,
    motivo: "Los cuatro colores del logo de Google son de su marca y no cambian con el tema",
  },
  {
    archivo: "styles.css", regla: "importante", veces: 4,
    motivo: "«Reducir movimiento» tiene que ganarle a cualquier animación, venga de donde venga",
  },
];
