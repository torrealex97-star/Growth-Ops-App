# Runbook: "los números del dashboard no cuadran"

Este es el runbook con más probabilidad de necesitarse pronto — ver `Metrics Correctness: 45/100` en
`docs/PRODUCTION_READINESS.md`. Sigue este orden exacto, no saltes pasos.

## 1. Confirmar el tenant
¿La persona que reporta está mirando Evergreen o WDC? Son datos completamente aislados — un número "raro" casi
siempre es alguien comparando el tenant equivocado contra sus propias expectativas.

## 2. Confirmar el periodo exacto
- ¿Qué mes/rango exacto está mirando en cada pantalla que está comparando?
- Ojo con: un mes PARCIAL (mes en curso) comparado contra un mes COMPLETO — nunca es el mismo tipo de comparación.

## 3. Identificar la definición de la métrica en cuestión
Antes de mirar código, pregúntate: ¿"Ingresos" en esta pantalla significa `contractedRevenue` (ventas del mes,
`sale_date`) o `grossRevenue`/Cash Collected (cobros del mes, `collected_at`)? **Son fechas y conceptos distintos.**
Ver la tabla de fórmulas confirmadas en `docs/PRODUCTION_READINESS.md` sección "Metrics Correctness" — hay 2-3
fórmulas incompatibles conocidas para "ventas del mes" y "Net Revenue" entre pantallas.

## 4. Revisar la query/fórmula real
- Dashboard: `lib/analytics.ts` (`monthlyKpis`, `isActiveSale` — filtra por `status IN ('active','partial_refund')`).
- Finanzas/P&L/Cohortes: `lib/finance/pnl.ts` (`computeMonthlyPnl` — usa TODAS las ventas del mes, sin filtrar por
  status, para `contractedRevenue`).
- Analítica de ventas: fórmula propia de "Net Revenue" en `analitica/embudo/page.tsx`, distinta de las dos de arriba.

Si las dos pantallas que se están comparando usan fórmulas de módulos DISTINTOS de los de arriba, la discrepancia es
esperada hoy (bug conocido, no un incidente nuevo) — documéntalo como tal, no lo investigues como si fuera nuevo.

## 5. Revisar los source records
Si ambas pantallas deberían usar la misma fórmula y aun así difieren: compara directamente contra la tabla origen
(`sales`/`collections`) filtrando por tenant_id y el mes exacto, no confíes en el número ya agregado de ninguna
pantalla.
```sql
SELECT sum(gross_amount) FROM sales WHERE tenant_id = '<id>' AND sale_date >= '<mes>-01' AND sale_date < '<mes+1>-01';
```

## 6. Revisar caché
No hay caché en las páginas financieras (todo es query directa a Supabase al cargar) — si esto cambia en el futuro,
añadir aquí cómo invalidarla. Hoy, un número desactualizado casi nunca es un problema de caché.

## 7. Comparar Finance vs Dashboard explícitamente
Si tras 1-6 los números siguen sin cuadrar y AMBAS pantallas deberían representar lo mismo con la misma fórmula:
esto es un bug real, no un malentendido — trátalo como el hallazgo P0 ya documentado (canonicalizar fórmulas, Fase 5
de este proyecto) y no como un fix puntual aislado.

## 8. Determinar: ¿problema de datos o de cálculo?
- **Dato**: una venta/cobro concreto está mal registrado (status equivocado, importe erróneo, tenant_id equivocado).
  Se corrige el dato, no el código.
- **Cálculo**: la fórmula en sí está mal o es incoherente entre pantallas. Se corrige el código (con test de
  regresión, ver `test:metrics` en `package.json`), no el dato.

No cierres el reporte sin haber decidido explícitamente cuál de los dos fue.
