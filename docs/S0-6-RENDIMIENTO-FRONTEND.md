# S0.6 — Baseline de rendimiento y frontend

Fase: **S0 tramo 2**, ítem S0.6 (`docs/plan/08-fases-s0-f4.md`). Fecha: 2026-09-22.

El plan pide auditar filtros, fechas, navegación, botones, responsive, estados de carga, error y
vacío, y tiempos de carga y de consulta; y **guardar el baseline** para que una regresión material no
pase sin explicación.

Medido sobre producción (`pg_stat_statements`, `EXPLAIN ANALYZE` con el rol real de la app,
catálogo de índices y políticas) y sobre el código de las 97 páginas. La base entera ocupa **24 MB**:
nada de lo que sigue es un problema de volumen de datos.

## 1. Baseline de consultas (producción, acumulado hasta el 22-sep)

Las diez consultas de la app que más tiempo suman. `ms medio` es lo que tarda una lectura típica.

| Tabla                 | Llamadas | ms medio | ms máx | Total |
| --------------------- | -------- | -------- | ------ | ----- |
| `appointments`        | 1.507    | **104**  | 1.525  | 157 s |
| `contacts`            | 391      | **147**  | 1.209  | 57 s  |
| `appointments` + join | 90       | **573**  | 885    | 52 s  |
| `appointments`        | 561      | 90       | 647    | 50 s  |
| `campaign_daily`      | 269      | 182      | 517    | 49 s  |
| `appointments`        | 159      | 290      | 2.461  | 46 s  |
| `contacts`            | 232      | 101      | 279    | 23 s  |
| `campaigns`           | 269      | 64       | 178    | 17 s  |
| `fathom_match_review` | 264      | 64       | 176    | 17 s  |

`appointments` tiene **593 filas**. Que una lectura de 593 filas tarde 104 ms de media —y hasta
2,5 s— no lo explica el tamaño.

## 2. Por qué: las reglas de acceso se evalúan fila por fila

Misma consulta (`appointments` de una subcuenta, 100 primeras por fecha), mismo momento, caché
caliente:

| Cómo                                     | Tiempo      |
| ---------------------------------------- | ----------- |
| Con las reglas de acceso (rol de la app) | **20,9 ms** |
| Sin ellas (rol de servicio)              | **0,66 ms** |
| Diferencia                               | **×30**     |

El plan de ejecución lo dice: recorrido completo de la tabla y, **por cada fila**, llamadas a
`is_admin_or_director()`, `my_data_scope()` e `is_my_collaborator_row(contact_id)`. La última hace su
propia consulta a otras dos tablas. 593 filas → cientos de consultas internas para devolver 100.

Hay además **348 políticas** en el esquema. En **77 combinaciones de tabla y operación hay más de una
política permisiva** (155 políticas implicadas), y todas se evalúan aunque una ya dé acceso. En
`appointments`: `appointments_all` (permisiva, todas las operaciones) + `appointments_select_scope`
(permisiva, lectura) + `appointments_tenant_isolation` (restrictiva). Por eso la condición de arriba
repite `is_admin_or_director()` dos veces. El advisor de Supabase cuenta 307 casos porque además
multiplica por rol; medido por tabla y operación son 77.

**El arreglo conocido** (y el que recomienda Supabase) es envolver esas llamadas en un subselect —
`(select public.is_admin_or_director())`— para que se evalúen **una vez por consulta** en vez de una
vez por fila. No cambia a quién deja ver qué: las funciones no dependen de la fila. Las que sí
dependen (`is_my_collaborator_row(contact_id)`) no se pueden sacar, pero dejan de ser lo primero que
se ejecuta.

**No está aplicado**: tocar 348 políticas es una migración con alcance de seguridad y necesita su
propia revisión. Propuesta en §5.

## 3. Índices

- **99 índices sin uso registrado** (`idx_scan = 0`): `canonical_events` tiene 10,
  `analytics_touchpoints` 4, `knowledge_chunks` 3. En tablas casi vacías es esperable —el índice no se
  usa porque no hay datos—, así que no se borra nada todavía: se vuelve a medir cuando haya volumen.
- **8 claves foráneas sin índice** (`appointments`, `contact_attributions`, `email_events`,
  `email_templates`, `collaborator_profiles`, `campaign_funnel_assignments`, `meta_custom_funnels`,
  `social_raw_payloads`). Hoy no se nota; con volumen, cada borrado o join las paga.
- **1 índice duplicado** en `campaign_funnel_assignments`.
- Dos índices únicos **ignoran la subcuenta** (`campaigns`, `ig_media`) — ya recogido en S0.7 §3.3.

## 4. Frontend

Auditadas las 97 páginas; 74 leen datos en el navegador.

### 4.1 Un fallo de lectura se pintaba como 0 € (P2) — **arreglado**

**9 pantallas** convertían el error en lista vacía (`salesRes.data || []`), 43 veces en total. Si la
consulta falla, el panel enseña **0 €** como si no hubiera ventas. Es la regla de la casa —_un hueco
no es un cero_— rota justo donde más cara sale: dinero.

Arreglado en las tres que más pesan —**panel principal, resumen financiero y métricas/KPIs**— con un
ayudante común (`lib/supabase/resultado.ts`) que devuelve el primer error del grupo de consultas, un
aviso en pantalla con reintento, y `tests/pantallas-hueco-no-es-cero.test.mjs` para que no vuelva.

Quedan con el mismo patrón, para la siguiente pasada: gestoría, ranking, atribución, cohortes,
actividad (P3 — las tres primeras muestran importes; las otras, recuentos).

### 4.2 Estados de carga y de vacío

- **Carga:** las pantallas con datos tienen esqueleto o indicador. No se encontró ninguna que se
  quede en blanco sin avisar.
- **Vacío:** el aviso de "hay clientes de Stripe esperando" (S0.4) es el buen ejemplo: explica por qué
  está vacío y a dónde ir. La mayoría de las tablas vacías dicen solo "no hay datos", que es correcto
  pero no orienta. No es un fallo; queda como mejora de F8.
- **Error:** 11 páginas con datos no tienen NINGÚN manejo de error (ni `catch`, ni aviso). Las de
  dinero ya están cubiertas por §4.1; el resto queda listado arriba.

### 4.3 Lo que no se ha medido

**Tiempos de carga de página en producción.** Los registros de ejecución de Vercel agotaron el límite
del plan al consultarlos, y medir desde fuera exige sesión. Queda pendiente y es lo primero que hay
que instrumentar en F8: sin eso, "la app va lenta" no se puede contrastar. Lo que sí está medido es
la mitad que más pesa hoy: la base de datos.

## 5. Qué se lleva cada fase

| Hallazgo                                                            | Prio | Destino                                               |
| ------------------------------------------------------------------- | ---- | ----------------------------------------------------- |
| Fallo de lectura pintado como 0 € (3 pantallas de dinero)           | P2   | **Arreglado aquí**                                    |
| Mismo patrón en 6 pantallas más                                     | P3   | Siguiente pasada de frontend                          |
| Reglas de acceso evaluadas por fila (×30 en cada lectura)           | P3   | **F7**, migración propia y revisada (propuesta en §2) |
| 77 combinaciones tabla/operación con políticas permisivas solapadas | P3   | F7, junto a lo anterior                               |
| 8 claves foráneas sin índice, 1 índice duplicado                    | P3   | F7                                                    |
| 99 índices sin uso                                                  | P4   | Volver a medir con volumen real antes de tocar        |
| Sin medición de tiempos de carga de página                          | P3   | F8 (instrumentar)                                     |

## 6. Cómo repetir la medición

`scripts/rendimiento-baseline.sql` trae las cinco consultas usadas aquí: top de consultas por tiempo
total, comparación con y sin reglas de acceso, índices sin uso, claves foráneas sin índice y
políticas solapadas. Ejecutar de nuevo tras cualquier cambio dice si la cifra mejoró o empeoró.
