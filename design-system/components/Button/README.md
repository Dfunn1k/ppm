Un botón. En el código, `Button` (hoy `PrimaryButton`), con sus variantes en `cva`.

| Variante | Cuándo | Cómo se ve |
| --- | --- | --- |
| `primary` | La única acción principal de la pantalla («Registrar gasto», «Continuar») | 56px de alto, `radius-lg` (14px), fondo `primary` y texto `primary-foreground` en `body-strong`, el texto a la izquierda y `arrow_forward` a la derecha |
| `secondary` | Una acción de apoyo («Filtrar», «Elegir cuáles») | Contorno de 1px en `border`, fondo `card`, texto en `body-sm` 600 |
| `ghost` | Salir sin hacer nada («Cancelar») | Solo texto, subrayado, sin fondo |
| `destructive` | Borrar o archivar | Fondo `destructive`, texto `destructive-foreground`. Pide confirmación en una hoja |

- **Tamaños:** `md` de 56px (el principal) y `sm` de 44px (dentro de una tarjeta o una fila). Nunca menos de 44px.
- **Estados:**
  - hover (solo con mouse): se oscurece apenas;
  - presionado: fondo más oscuro, sin moverse;
  - foco: anillo de 2px en `ring` separado 2px;
  - deshabilitado: opacidad 50 % y, si no es obvio, una ayuda que dice por qué;
  - guardando (`pending`): el círculo que gira en lugar de la flecha, mismo ancho, con `aria-busy`.
- **El texto dice lo que pasa** al tocarlo. El aviso de después lo repite en pasado.
- Un botón de solo ícono es `IconButton`: 44×44px y su nombre accesible obligatorio.
- **No:** un botón principal hecho a mano, dos botones principales en una pantalla, el texto centrado en el principal.
