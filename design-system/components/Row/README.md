La fila de una lista: algo a la izquierda, título y subtítulo, y algo a la derecha. En el código, `Row`. `MoveLine`, `NoticeItem`, `DebtCard` y las filas de cuentas se arman encima.

| Variante | Opciones |
| --- | --- |
| `size` | `sm` 52px (una línea: ajustes, el menú Más), `md` 60px (dos líneas con ícono: movimientos, cuentas), `option` 56px (la opción de una hoja) |
| `leading` | `Avatar` (categoría, cuenta, persona o estado), un ícono suelto o nada |
| `trailing` | `Amount`, `chevron_right`, un interruptor, el check de lo elegido o un texto corto |
| `as` | Enlace (lleva a otra pantalla), botón (abre una hoja o elige) o fila quieta |
| `selected` | En una hoja: fondo `selected` y `check_circle` relleno. En la lista del escritorio: `mark-selected` y `aria-current` |

- **El título** va en `body-strong` y se corta con «…»; **el subtítulo**, en `caption`. Sin «·» como conector: usa `Status`, `Facts` o una frase.
- **Estados:**
  - hover (mouse): fondo `muted`;
  - presionado: `muted` más oscuro;
  - foco: el anillo alrededor de la fila;
  - cargando: `BoneRow` con la misma forma.
- **Accesibilidad:** la fila entera es el área que se toca. Un solo elemento enfocable por fila; si hay una segunda acción, va en ⋮. Nada que se toque dentro de otra cosa que se toca.
