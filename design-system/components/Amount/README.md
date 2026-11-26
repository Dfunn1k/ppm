Un monto con su signo, su ícono y su símbolo. En el código, `Amount`, que usa `web/src/lib/money.ts`.

- **Recibe:** el monto, la moneda y la dirección (entra, sale, transferencia o ninguna).
- **Dirección:**
  - entra: `+`, `income` e ícono `south_west`;
  - sale: `−` (signo menos), `expense` e ícono `north_east`;
  - transferencia: sin signo, `transfer` e ícono `sync_alt`.
  - Nunca solo el color.
- **Tamaños:**
  - `display`: el monto principal de la pantalla, en Bricolage, sin ícono;
  - `display-2`: un monto grande que no es el principal;
  - `xl`: un total en una tarjeta;
  - `lg`: el destacado de una fila;
  - `row`: el de una fila.
- **Símbolo:** en una fila, tu moneda va sin símbolo y las otras con el suyo. En totales, saldos y el monto principal, siempre con símbolo.
- **Cifras tabulares**, alineado a la derecha en listas y **nunca partido en dos líneas**: si falta lugar, cede el texto de al lado.
- **No** lo abrevies (`S/ 1.2k`) salvo en los ejes de un gráfico. No uses `toFixed` ni `toLocaleString`.
- **El monto que escribes** es otra pieza, `AmountField`: `amount-input` (48px) con el símbolo en `amount-input-symbol`. Si hay un error, marca `aria-invalid` y `aria-describedby`.
