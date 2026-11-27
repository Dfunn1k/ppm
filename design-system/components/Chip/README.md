Un chip que se elige o una pastilla que informa. En el código, `Chip` (hoy `Pill` y los chips a mano).

| `kind` | Qué es | Cómo se comporta |
| --- | --- | --- |
| `filter` | Un filtro o una opción rápida («Hoy», «Cada mes», una persona) | Se toca; dice si está elegido con `aria-pressed` o, si es una opción de un grupo, como radio (`aria-checked`). Sin elegir: borde `border`. Elegido: el relleno del acento (`primary`) y un check (decisión del 26-nov, opción A). Mide 36px y se toca en 44px; letra `caption` 600 |
| `info` | Un dato corto («Por confirmar», «Disponible S/ 120») | No se toca |

- **Tono** (los que informan): neutro (`muted`), `attention` (con ícono), `income` (sobre `income-soft`) o `selected`.
- **Letra** en `caption-sm` (los que informan) o `caption` (los que se eligen), ícono en `icon-sm`, `radius-full`. El texto pasa 4.5:1 sobre su fondo.
- **No:** distinguir lo elegido solo por el color del acento, ni texto de menos de 12px.
