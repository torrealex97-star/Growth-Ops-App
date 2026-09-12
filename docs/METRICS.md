# Métricas canónicas — fuente de verdad

Este documento existe porque, antes de la Fase 5, la misma etiqueta ("ventas del
mes", "Net Revenue") tenía fórmulas distintas en pantallas distintas para el mismo
periodo. Cualquier pantalla nueva que muestre una de estas métricas debe reutilizar
la función/tabla indicada aquí — no reimplementar el cálculo.

## 1. Ventas activas (`isActiveSale`)

- **Definición**: una venta cuenta como negocio real si `status` está en
  `ACTIVE_SALE_STATUSES = ['active', 'partial_refund']`.
- **Excluye**: `refunded`, `chargeback`, `cancelled`.
- **Fuente**: `lib/analytics.ts` — `ACTIVE_SALE_STATUSES`, `isActiveSale(sale)`.
- **Consumido por**: `monthlyKpis`, `revenueByMonth`, `teamRanking`,
  `attributionBySource`, `targetValueBetween` (todos en `lib/analytics.ts`),
  `computeMonthlyPnl` (`lib/finance/pnl.ts`), Dashboard (`myFijo`), Finanzas ›
  Analítica › Resumen, Finanzas › Analítica › Cohortes, Unit Economics.
- **Regla**: cualquier query que alimente estas funciones/pantallas debe pedir
  `status` en el `select()` de Supabase. Omitirlo hace que `isActiveSale` evalúe
  `false` para toda la fila (no lanza error — hay que vigilarlo a mano).

## 2. Contracted Revenue ("ventas del mes")

- **Fórmula**: `Σ gross_amount` de ventas con `isActiveSale(s)` y
  `sale_date` en el mes `ym`.
- **Fuente de verdad**: `computeMonthlyPnl().contractedRevenue`
  (`lib/finance/pnl.ts`) y `monthlyKpis()` (`lib/analytics.ts`) — mismo filtro,
  dos consumidores.
- **Pantallas**: Dashboard, Finanzas › P&L, Finanzas › Gestoría, Finanzas ›
  Analítica › Resumen, Finanzas › Analítica › Cohortes (columna "Contratado").

## 3. Gross Revenue / Cash Collected

- **Fórmula**: `Σ gross_amount` de `collections` con `status = 'collected'` y
  `collected_at` en el mes.
- **No filtra por `isActiveSale`**: un cobro es un hecho de caja ya ocurrido;
  si la venta asociada se reembolsa después, eso se refleja en `refunds`, no
  reescribiendo el cobro histórico.
- **Fuente**: `computeMonthlyPnl().grossRevenue`.

## 4. Net Revenue (P&L) — Finanzas

- **Fórmula**: `Gross Revenue − Refunds − Discounts` (se restan una sola vez
  aquí; no se vuelven a restar en OpEx ni en ningún otro punto del pipeline).
- **Fuente**: `computeMonthlyPnl().netRevenue`.
- **Pantallas**: Finanzas › P&L, Finanzas › Gestoría, Finanzas › Analítica ›
  Resumen.
- **OJO — no confundir con "Cobros comisionables"** (sección 5): son métricas
  distintas que antes de la Fase 5 compartían el nombre "Net Revenue" en
  pantallas distintas, lo cual era la confusión original que motivó esta
  canonicalización.

## 5. "Cobros comisionables" — Analítica de ventas (embudo)

- **Fórmula**: `Σ (commissionable_amount || gross_amount)` de `collections`
  del periodo, sobre base comisionable (neto de fees/impuestos de la
  pasarela, pero **sin restar** `refunds`).
- **Fuente**: `app/[tenant]/analitica/embudo/page.tsx` (`netRevenue` en el
  código; renombrado en la UI a "Cobros comisionables" tras la Fase 5).
- **Por qué existe como métrica separada**: mide calidad de lead / eficiencia
  de comisión por canal en el momento del cobro, no resultado contable del
  periodo. Se mantiene el cálculo (es válido para ese propósito) — solo se
  corrigió el nombre para dejar de colisionar con la sección 4.
- **Ratios derivados**: "Cobros/LSC" (÷ Live Sales Calls), "Cobros/BSC"
  (÷ Booked Sales Calls).

## 6. CAC y LTV — Unit Economics

- **Clientes**: **contactos únicos** (`contact_id` distinto) con al menos una
  venta activa (`isActiveSale`) atribuida al canal — no número de filas de
  venta. Un mismo contacto con 2 ventas activas en el mismo canal cuenta como
  1 cliente.
- **CAC** = `adspend del canal / clientes únicos del canal`.
- **LTV medio** = `facturación activa (Σ gross_amount, isActiveSale) / clientes
únicos totales`.
- **Fuente**: `app/[tenant]/unit-economics/page.tsx` (`buildChannelRows`,
  cálculo de `totals`).
- **Periodo**: acumulado histórico total, **no filtrado por mes** — la tabla
  `campaigns` almacena adspend/impresiones/clicks/leads como acumulado desde
  el origen, no por día. No comparar estos números contra un mes concreto de
  otra pantalla (aviso visible en la propia página).

## 7. Cohortes de cobro (30/60/90/180 días)

- **Contratado**: igual que la sección 2 (`isActiveSale`, por mes de
  `sale_date`).
- **% cobrado a Nd**: `Σ gross_amount` de `collections` con
  `status = 'collected'` y `collected_at − sale_date ≤ N días`, dividido entre
  "Contratado" de esa cohorte.
- **Fuente**: `app/[tenant]/finanzas/analitica/cohortes/page.tsx`
  (`buildCohorts`).
- **OUT_OF_SCOPE_FINDING (no corregido en Fase 5)**: la columna "Clientes"
  cuenta filas de venta, no contactos únicos — si un contacto tiene 2+ ventas
  en el mismo mes de cohorte, se cuenta 2 veces. Mismo tipo de bug que se
  corrigió en Unit Economics (sección 6), pero aquí solo afecta a una columna
  informativa, no a un ratio de negocio (CAC/LTV), por lo que se deja
  documentado en vez de tocarlo fuera del alcance pedido.

## 8. MER / ROAS

- No existe una función canónica única todavía para estas dos — pendiente de
  revisión en una fase posterior si se detecta divergencia entre pantallas
  (no se encontró ninguna en esta fase).

## Reglas para no romper esto otra vez

1. Si una pantalla nueva necesita "ventas del mes" / "clientes" / "revenue",
   importa la función de `lib/analytics.ts` o `lib/finance/pnl.ts` — no
   reimplementes el filtro de status a mano.
2. Si necesitas una métrica que suena igual a una de las de arriba pero es
   conceptualmente distinta (otra base, otro periodo, otro propósito), dale
   un nombre distinto en la UI. No fuerces la fusión de dos conceptos solo
   porque compartían etiqueta.
3. Cualquier `select()` de Supabase que alimente `isActiveSale` debe incluir
   `status` explícitamente.
4. Los tests dorados en `tests/metrics/` (`npm run test:metrics`) fijan el
   comportamiento esperado de `computeMonthlyPnl` y de la lógica de clientes
   únicos — si cambias una fórmula de esta lista, actualiza también el test y
   este documento en el mismo commit.
