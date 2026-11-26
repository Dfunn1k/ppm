Un botón. En el código, `Button` (y `PrimaryButton` y `PrimaryLink`, que son su variante principal), con sus variantes en `cva`.

| Variante | Cuándo | Cómo se ve |
| --- | --- | --- |
| `primary` | La única acción principal de la pantalla («Registrar gasto», «Continuar») | 56px de alto, `radius-lg` (14px), fondo `primary` y texto `primary-foreground` en `body-strong`, el texto a la izquierda y `arrow_forward` a la derecha |
| `secondary` | Una acción de apoyo («Cerrar sesión», «Traer de SUNAT ahora») | Contorno de 1px en `input-line` (3:1, se ve en claro y en oscuro), fondo `card`, texto en `body` 600 al centro y, si lleva ícono, a la izquierda (`start`) |
| `ghost` | Salir sin hacer nada («Cancelar», «Volver») | Solo texto en `primary-strong`, `body-sm` 600, subrayado, sin fondo, en el tamaño `sm` |
| `destructive` | Borrar o archivar | Fondo `destructive`, texto `destructive-foreground`, el texto a la izquierda y el ícono de lo que hace a la derecha. Pide confirmación en una hoja |

- **Tamaños:** `md` de 56px (el principal, y el de contorno a lo ancho) y `sm` de 44px (dentro de una tarjeta, un aviso o una fila, al lado de otro botón o al inicio de la línea). Nunca menos de 44px.
- **Estados:**
  - hover (solo con mouse): se oscurece apenas;
  - presionado: fondo más oscuro, sin moverse;
  - foco: anillo de 2px en `ring` separado 2px;
  - deshabilitado: opacidad 50 % y, si no es obvio, una ayuda que dice por qué;
  - guardando (`pending`): el círculo que gira en lugar de la flecha (o del ícono de la izquierda, con `start`), mismo ancho, con `aria-busy`.
- **El texto dice lo que pasa** al tocarlo. El aviso de después lo repite en pasado.
- Un botón de solo ícono es `IconButton`: 44×44px y su nombre accesible obligatorio.
- **No:** un botón hecho a mano (decisión «Botones y pastillas», 26-nov), dos botones principales en una pantalla, el texto centrado en el principal o en el de borrar.
