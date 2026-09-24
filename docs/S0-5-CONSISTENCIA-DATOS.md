# S0.5 — Baseline de consistencia de datos

Fase: **S0 tramo 2**, ítem S0.5 (`docs/plan/08-fases-s0-f4.md`). Fecha: 2026-09-21.

Método: consultas de solo lectura a producción (`rgcbveflosqgxrcqlqzv`). No se modificó nada.
Este documento **no contiene datos personales**: solo recuentos e importes agregados.

El plan pide, por métrica: **SOURCE, EXPECTED, ACTUAL y DIFFERENCE**. La fuente de verdad la fija
`docs/SOURCE_OF_TRUTH.md`, que para cash declara **primary: Stripe**, fallback manual.

## 1. Cash cobrado — no cuadra

|                |                                                                |
| -------------- | -------------------------------------------------------------- |
| **Métrica**    | Cash collected, histórico completo                             |
| **Source**     | Stripe (primary, `stripe_payments` con `status = 'succeeded'`) |
| **Expected**   | **27.029,46 €** en 59 pagos                                    |
| **Actual**     | **23.981,05 €** en 49 cobros (`collections`)                   |
| **Difference** | **−3.048,41 €**                                                |

La diferencia no es un desajuste de redondeo ni de fechas. Se descompone en dos causas distintas,
ambas con impacto real en dinero.

### 1.1 P1 — 12 pagos de Stripe sin cobro registrado: 5.095,41 €

Pagos `succeeded` en Stripe que no tienen ninguna fila en `collections` con su `payment_id` ni su
`charge_id` como `payment_reference`.

| Mes         | Pagos  | Importe        | Con cliente conocido |
| ----------- | ------ | -------------- | -------------------- |
| 2026-04     | 1      | 748,50 €       | 1                    |
| 2026-05     | 2      | 1.247,50 €     | 2                    |
| 2026-07     | 1      | 748,50 €       | 1                    |
| 2026-08     | 2      | 1.048,50 €     | 0                    |
| **2026-09** | **6**  | **1.302,41 €** | 2                    |
| **Total**   | **12** | **5.095,41 €** | 6                    |

**No es deuda histórica: es un problema vivo.** La mitad de los casos son de septiembre, el último
del día 19. El desajuste se está ampliando solo.

Consecuencias, por orden de gravedad:

1. **Comisiones no generadas.** Una comisión nace de un cobro (`generateCommissionsForCollection`).
   Sin cobro registrado, nadie cobró su parte de esos 5.095,41 €.
2. **Cash collected infravalorado** en todo el panel, la analítica y las respuestas del agente.
3. **Unit economics distorsionadas**: el CAC se calcula contra un cash que no es el real.

La causa no se determina desde los datos: puede ser que el registro del cobro sea manual y a veces
no se haga, que el `payment_reference` se guarde con otro formato, o que la conciliación
(`lib/finance/stripeReconciliation.ts`) exista pero no se ejecute.

**Causa (S0.4, 2026-09-21).** El sync funciona. El cobro se registra a mano y por lotes (mediana 33
días de retraso), y el único aviso miraba clientes en vez de pagos: no veía la segunda cuota de
quien ya tiene venta ni los pagos sin cliente en Stripe. Ninguno de los 12 trae correo (el sync solo
leía `receipt_email`, vacío en los 59 pagos). Arreglado el aviso (`pago_stripe_sin_cobro`,
`cobro_de_pago_devuelto`) y el correo; **registrar los 12 sigue siendo una decisión humana**.

### 1.2 P1 — un cobro de 50 € contra un pago que Stripe devolvió

Hay **1 cobro de 50,00 €** cuya referencia apunta a un pago con `status = 'refunded'` en el espejo
de Stripe. Y `refunds` tiene **0 filas**.

Es decir: el dinero volvió al cliente, la app lo sigue contando como cobrado, y la comisión que
generó ese cobro no se ha revertido. Es pequeño en importe y grande en lo que revela — **el camino
de devolución no está cerrado**: Stripe sabe de la devolución y la app no se entera.

## 2. Lo que sí cuadra

Conviene dejarlo escrito para no volver a auditarlo:

| Comprobación                                                | Resultado                       |
| ----------------------------------------------------------- | ------------------------------- |
| Cobros con referencia de Stripe que no existen en el espejo | **0**                           |
| Pares cobro↔pago con importe distinto                       | **0** — ni un céntimo de desvío |
| Comisiones ligadas a un cobro inexistente                   | **0**                           |
| Referencias de pago duplicadas entre cobros                 | **0**                           |

Que los importes casen al céntimo en los 47 pares conciliados es una señal buena: cuando el cobro se
registra, se registra bien. El problema está en los que **no** se registran.

## 3. Otras cifras del periodo

| Concepto                            | Filas | Importe     |
| ----------------------------------- | ----- | ----------- |
| Ventas (todas, y todas activas)     | 28    | 46.075,00 € |
| Cobros                              | 49    | 23.981,05 € |
| Comisiones                          | 49    | 2.272,29 €  |
| Devoluciones                        | **0** | 0,00 €      |
| Cobros por medio distinto de Stripe | 1     | 1.997,00 €  |

`refunds` a 0 con una devolución real confirmada en Stripe (§1.2) es un indicador de que esa tabla
no se está usando, no de que no haya devoluciones.

## 4. Qué se lleva cada fase

| Hallazgo                                             | Prioridad | Destino                                                       |
| ---------------------------------------------------- | --------- | ------------------------------------------------------------- |
| 12 pagos de Stripe sin cobro: 5.095,41 €             | **P1**    | S0.4 — hay que encontrar la causa antes de tocar métricas     |
| Cobro de 50 € contra pago devuelto; `refunds` vacía  | **P1**    | S0.4                                                          |
| Cash collected difiere según se mire Stripe o la app | **P1**    | F3 y `MONEY.md`: la cifra oficial tiene que nombrar su fuente |

**Ninguna de las tres se arregla en este documento.** S0.5 es un baseline: mide y deja constancia.
El plan es explícito — _"no construir analytics nuevos sobre definiciones que aún no cuadran"_.

## 5. Cómo reproducir esto

Las consultas viven en `scripts/consistencia-cash.sql`. Ejecutarlas de nuevo tras cualquier cambio
en la conciliación dice si la diferencia se cierra o se ensancha.
