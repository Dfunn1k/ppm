La cabecera de una pantalla a la que entras: flecha, título y acciones. En el código, `PageHeader`, que reemplaza a `FormHeader`, `ReportHeader` y `StepHeader`.

- **`back`:** a dónde vuelves. Es un enlace (`arrow_back`, `icon-md`, área de 44px) y su nombre accesible es «Volver a <lugar>». Si cierra algo en lugar de volver, es un botón con ×. En un panel de escritorio no se muestra, porque la lista está al lado.
- **`eyebrow` (opcional):** la etiqueta de arriba del título, en `label` («AHORROS EN SOLES»). No repite a dónde vuelves.
- **`title`:** en `title-hero`, como `<h1>`. Baja solo a 36px por debajo de 360px. Sin punto final.
- **`actions`:** a la derecha, en `IconButton` (⋮, editar).
- Las pestañas de abajo no usan `PageHeader`: llevan su etiqueta chica y el dato grande (regla de títulos, 13-nov).
