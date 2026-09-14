# Fase 2 — Mapa de métricas comerciales

`MÉTRICA → FÓRMULA → NUMERADOR → DENOMINADOR → FUENTE → CAMPO FECHA → CAMPO OWNER`, obligatorio antes
de construir el dashboard. Cada fila lleva un veredicto **verificado contra producción**, no inferido.

Universo medido: 559 citas, 27 ventas, 48 cobros, 1.787 filas de `campaign_daily`, 4 usuarios.

## El hallazgo que condiciona todo

**Las columnas para medir la ejecución comercial existen y están vacías.** De 559 citas:

| Campo | Cobertura |
|---|---|
| `offered` | **0 / 559** |
| `result` | **0 / 559** |
| `closer_id` | **0 / 559** |
| `setter_id` | **0 / 559** |
| `followup_stage` | **0 / 559** |
| `qualification` | **0 / 559** |
| `grade`, `pipe_value` | **0 / 559** |
| `sales.closer_id` / `setter_id` | **0 / 27** |

No es que falte el esquema: falta que alguien rellene el dato. Eso mueve cinco métricas de la cadena
de gerencia a `NOT_TRACKED` — no a 0%, que sería mentir.

Y los estados de cita son `scheduled (272)`, `cancelled (213)`, `confirmed (71)`, `show (3)`. Solo
**3** citas están marcadas como asistidas.

---

## Nivel 1 — Cadena de gerencia

| Métrica | Fórmula | Fuente | Campo fecha | Veredicto |
|---|---|---|---|---|
| **Agendas** | `count(appointments)` | `appointments` | `appointment_datetime` | ✅ **REAL** — 559 |
| **Coste / agenda** | `spend / agendas` | `campaign_daily` + `appointments` | `date` / `appointment_datetime` | ⚠️ **PARCIAL** — el gasto es real; **"cualificada" no tiene dato** (`qualification` 0/559), así que se publica como *Coste por agenda* y la variante cualificada queda `NOT_TRACKED` |
| **Speed to Lead** | `mediana(primer contacto − lead creado)` | — | — | ❌ **NOT_TRACKED** — no existe timestamp de primer contacto humano. `last_contacted_at` está a 0/559 |
| **Show Rate** | `asistidas / agendadas elegibles` | `appointments` | `appointment_datetime` | ⚠️ **PARCIAL** — ver abajo |
| **Pitch Rate** | `ofertas / asistidas` | `appointments.offered` | — | ❌ **NOT_TRACKED** — `offered` 0/559 |
| **Close Rate (ofertas)** | `ventas / ofertas` | `sales` + `offered` | `sale_date` | ❌ **NOT_TRACKED** — depende de `offered` |
| **Close Rate (asistidas)** | `ventas / asistidas` | `sales` + `appointments` | `sale_date` | ⚠️ **PARCIAL** — depende de la definición de asistida |
| **Cash Collected** | `sum(collections.gross_amount)` | `collections` | `collected_at` | ✅ **REAL** — 21.984,05 € |

### Show Rate — hay que elegir definición y decirla

`status = 'show'` solo cubre 3 citas, así que usarlo daría un 0,5% falso. Dos definiciones
defendibles con los datos que hay:

1. **Por evidencia de llamada**: `fathom_meeting_id is not null` → **107** citas. Es prueba de que la
   llamada ocurrió y se grabó. Suelo firme, pero solo cubre lo que Fathom capturó.
2. **Por fecha pasada y no cancelada**: **329** citas. Cubre todo el histórico, pero asume que lo que
   no se canceló se celebró — lo cual infla el numerador con los no-shows silenciosos.

**Decisión aplicada**: numerador = evidencia de llamada (1), con la (2) mostrada aparte como cota
superior. Denominador = agendadas no canceladas (`559 − 213 = 346`). Mezclarlas en una sola tasa daría
un número que nadie puede reproducir.

---

## Nivel 2 — Financiero

| Métrica | Fórmula | Veredicto |
|---|---|---|
| **Contracted Revenue** | `sum(sales.gross_amount)` | ✅ **REAL** — 44.078 € |
| **Cash Collected** | `sum(collections.gross_amount)` | ✅ **REAL** — 21.984,05 € |
| **Cash Collection Ratio** | `cash / contracted` | ✅ **REAL** — 49,9 % |
| **AOV** | `contracted / ventas` | ✅ **REAL** — 1.632,52 € |
| **PIF %** | `ventas cobradas al 100% el día del cierre / ventas` | ✅ **CALCULABLE** desde `collections` |
| **Outstanding** | `contracted − cash` por venta | ✅ **CALCULABLE** — 22.093,95 € |
| **Cancelaciones de venta** | `sales.status in (refunded, cancelled…)` | ✅ **REAL** — 0 hoy |

Revenue ≠ Cash quedó separado en el commit anterior y se mantiene como invariante con test.

**No confundir**: `cancelled (213)` son cancelaciones de **reunión**, no de venta. Son dos universos y
no se mezclan (§22).

---

## Nivel 3 — Equipo

| Métrica | Veredicto |
|---|---|
| **Closer Scorecard** | ❌ **IMPOSIBLE HOY** — `closer_id` 0/559 en citas y 0/27 en ventas. No hay a quién atribuir nada |
| **Setter metrics** | ❌ **IMPOSIBLE HOY** — `setter_id` 0/559 |
| **BAMFAM** | ❌ **NOT_TRACKED** — `needs_followup` y `followup_stage` a 0 |

Se construye la scorecard con su capa de datos y su estado `NOT_TRACKED` visible, para que el día que
haya ownership funcione sin tocar UI. Lo que no se hace es inventar un reparto de ventas entre los 4
usuarios para que la tabla tenga filas.

---

## Qué desbloquea qué

La Fase 3 (campos manuales mínimos en Agenda) no es un extra: es lo que convierte
`NOT_TRACKED → REAL` en cinco métricas de la cadena.

| Al marcar en la agenda… | Se desbloquea |
|---|---|
| Asistió | Show Rate firme, Close Rate sobre asistidas |
| Oferta presentada | Pitch Rate, Close Rate sobre ofertas |
| Resultado | Cancelaciones comerciales, calidad de pipeline |
| Seguimiento agendado | BAMFAM |
| Closer asignado | **Toda** la scorecard y las métricas de equipo |

Speed to Lead y "agenda cualificada" necesitan además un timestamp de primer contacto y un criterio
de cualificación declarado; ninguno de los dos se puede derivar de lo que hay.

---

## Regla de implementación (§39)

Una sola capa canónica. Ninguna pantalla recalcula una métrica con su propia fórmula: misma métrica +
mismo periodo + mismos filtros = mismo resultado. El periodo sale de `lib/filters/period.ts` y las
fronteras de día de `lib/dates/business.ts` (`Europe/Madrid`), nunca de `toISOString()`.

`NULL ≠ 0` (§52): los estados son `REAL`, `PARTIAL`, `NOT_TRACKED`, `NOT_CONNECTED`, `ERROR`. Un
hueco nunca se pinta como cero.
