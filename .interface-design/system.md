# Growth Ops — dashboards

Dirección acordada el 2026-09-15: dashboards oscuros con tarjetas suaves, gráficos redondeados y jerarquía de datos clara. Finanzas usa una composición de cuatro KPI junto a dos anillos, evolución y detalle debajo.

- Proyecto: `torrealex97-star/Growth-Ops-App`.
- App confirmada por el usuario: https://growth-ops-weld.vercel.app.
- No usar los dominios IA Winners que figuran en documentos heredados como destino de esta app.
- Inter para UI; Space Grotesk (`font-display`) para titulares y cifras principales.
- Base de espaciado 4px; separación 16–24px; paneles 20px de padding, radio 16px.
- `dashboard-card` centraliza superficie y borde tenue. `dashboard-surface` acota el ajuste de tonos a dashboards y conserva modo claro.
- Marca heredada de `--brand-*`: rosa WDC, azul Evergreen. Colores de estado conservan su significado.
- Barras con extremos superiores redondeados, curvas suaves y rejilla recesiva. No inventar series ni conversiones para decorar.
- Los anillos representan solo partes positivas de un mismo total; los ajustes negativos se muestran como desglose textual.
- Mantener etiquetas, filtros, permisos y fórmulas existentes. Los gráficos financieros ofrecen tabla de importes.
- Recharts existente; sin añadir otra librería de gráficos o animación para este cambio.

- Entrada de paneles: 240ms, 6px vertical, ease-out; gráficos 280ms. Solo con `prefers-reduced-motion: no-preference`.
- Revisiones siempre sobre las rutas reales de Growth Ops y sus datos; no presentar fixtures como entregable.
