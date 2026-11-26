El círculo de la izquierda de una fila. En el código, `Avatar`, que reúne a `CategoryChip`, `MoveIcon` y el `Avatar` de personas.

| `kind` | Fondo | Contenido |
| --- | --- | --- |
| `category` | `cat-N` (el color de la categoría) | El ícono de la categoría en `on-category` (ver CategoryChip) |
| `account` | `secondary` | El ícono del tipo de cuenta en `secondary-foreground` |
| `person` | `muted` | Las iniciales en `caption-sm` |
| `status` | `muted` o `attention-soft` | Un ícono de estado (por clasificar, saldo inicial) |

- **Tamaños:** `md` de 40px en las filas y `sm` de 24px para una persona dentro de un texto. El ícono va en `icon` (20px). El tamaño va en la variante, nunca en `style`.
- **Es decorativo** (`aria-hidden`): lo que significa lo dice el texto de la fila.
