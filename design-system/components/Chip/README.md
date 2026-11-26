Un chip que se elige o una pastilla que informa. En el código, `Chip` (hoy `Pill` y los chips a mano).

| `kind` | Qué es | Cómo se comporta |
| --- | --- | --- |
| `filter` | Un filtro o una opción rápida («Hoy», «Este mes», una etiqueta) | Se toca; dice si está elegido con `aria-pressed`. Elegido: fondo `selected` y check. Área de 44px de alto, aunque el dibujo mida 32 |
| `info` | Un dato corto («Por confirmar», «Disponible S/ 120») | No se toca |

- **Tono:** neutro (`muted`), `attention` (con ícono), `income` (sobre `income-soft`) o `selected`.
- **Letra** en `caption-sm`, ícono en `icon-sm`, `radius-full`. El texto pasa 4.5:1 sobre su fondo.
- **No:** distinguir lo elegido solo por el color del acento, ni texto de menos de 12px.
