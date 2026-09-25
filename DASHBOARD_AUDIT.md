# Auditoría de dashboards y métricas

Fecha: 2026-09-25. Base de código: `7a150cc`. Rama: `codex/dashboard-metric-audit`.

**Estado: EN CURSO; no es una certificación de todos los dashboards.** Inspección de código, consultas de producción de solo lectura, prueba de permisos bajo rol autenticado y reproducciones con datos sintéticos. El navegador llega al login: faltan sesión de administrador, recorrido visual, interacciones y contraste de roles en UI. No se validaron exports, drawers, mobile ni cambio de tenant en navegador. No se ha cambiado ningún dato de negocio ni aplicado migraciones.

Este documento es apto para el repositorio: no contiene identificadores, importes, personas ni cifras de negocio reales. La evidencia agregada de producción se comunicó privadamente en la sesión. Los ejemplos numéricos siguientes son sintéticos. Las observaciones SQL son una instantánea, no una monitorización continua.

## Regla de diagnóstico obligatoria

1. Definición. 2. Fuente. 3. Completitud. 4. Periodo. 5. Maduración. 6. Asignación. 7. Cálculo. 8. KPI/benchmark.

Un benchmark externo nunca demuestra por sí solo un error ni un problema comercial. Si algún paso no está validado, el diagnóstico comercial es **UNKNOWN**; se puede documentar por separado un bug demostrado. No hay ningún hallazgo clasificado como REAL BUSINESS KPI PROBLEM en esta auditoría.

Referencias: skills del proyecto `.agents/skills/marketing-and-copywriting/SKILL.md` (medición y atribución), `.agents/skills/sales-engineering/SKILL.md` (agendas, asistencias, cierres y muestras), `docs/METRICS.md`, `docs/SALES_METRICS_MAP.md`, `docs/MONEY.md`, `lib/metrics/definiciones.ts`. Las skills orientan el diagnóstico; no autorizan sustituir silenciosamente una definición canónica del producto.

## Convenciones de evidencia

- **C**: código inspeccionado; comportamiento deducido, sin afirmar que la pantalla se probó.
- **D**: consulta de producción de solo lectura; sin exportar filas personales.
- **R**: reproducción ejecutada con entradas sintéticas en funciones reales.
- **T**: test por script canónico del repositorio.
- **B pendiente**: no hay validación visual autenticada.
- `Parcial` en completitud significa que hay datos, pero no está acreditada la cobertura histórica esperada.
- Categorías: A cálculo; B fuente; C histórico; D integración; E configuración; F asignación; G filtrado; H atribución; I duplicación; J negocio fuera de KPI; K insuficiencia; L representación; M desconocido. Seguridad se señala aparte como P0.

## Hallazgos con evidencia y alcance

### F01 — P0: colaborador puede leer datos ajenos (C, D)

Las políticas `sales_select_scope` y equivalentes permiten scope `team`. Se ejecutó una transacción de solo lectura con claims de un colaborador activo, `SET LOCAL ROLE authenticated` y `ROLLBACK`: ventas visibles exceden las atribuidas por `is_my_collaborator_sale`; también son legibles citas y pagos Stripe del equipo. Esto incumple el requisito explícito de colaborador solo propio. No se ha probado acceso a otro tenant con ese usuario.

`stripe_payments_select_team` permite miembros del tenant o el helper global de dirección; no se observó política restrictiva de aislamiento en esa tabla. En sales/contacts/appointments/collections sí existen políticas restrictivas: no afirmar ausencia general de RLS. Aun con RLS, pertenecer a varios tenants no reemplaza `.eq('tenant_id', tenantId)` para mostrar exclusivamente el seleccionado. `lib/collaborators/scope.ts` y filtros de UI no constituyen una barrera suficiente.

### F02 — P0: endpoints privilegiados sin scope de rol (C)

`app/api/[tenant]/evergreen/funnels/route.ts` requiere pertenencia al tenant, después agrega mediante service role sin limitar colaborador. `app/api/[tenant]/evergreen/vsl/metrics/[slug]/route.ts` usa SQL privilegiado tras comprobar tenant, y devuelve también detalles de leads. Falta prueba HTTP autenticada por rol; la ruta de autorización observada no satisface el requisito solo propio. No se ha intentado extraer datos de otro tenant.

### F03 — P1: reservas abiertas cuentan como ventas en algunos módulos (A/B; C,D,R)

`lib/metrics/agregados.ts` excluye `esReservaAbierta`, conforme a MONEY D8. `lib/analytics.ts:isActiveSale` comprueba solo estado; `monthlyKpis` y consumidores no reciben los datos de reserva necesarios. Ejemplo ejecutado: reserva activa de 50 unidades → agregados: 0 ventas; monthlyKpis: 1 venta y 50 contratados. Hay reservas abiertas reales. Afecta conteo, ticket, CAC y comparaciones entre módulos; no cambiar el motor de comisiones ya corregido por otro agente.

### F04 — P1: moneda omitida en cash canónico (A/B; C,D,R)

`lib/canonical/cash.ts:StripePaymentRow` no transporta moneda y la consulta de unit-economics tampoco. Existen pagos en una moneda distinta de la base. Ejemplo sintético ejecutado: pago de 300 USD produce 300 en la suma sin conversión. MONEY D2 exige FX a la fecha del hecho; falta decidir proveedor/documentación FX. No inferir una tasa ni tratar paridad como válida.

### F05 — P1: cash y refunds no comparten contrato temporal entre pantallas (A/B/G; C,D,R)

Dashboard/Brief/P&L usan collections; unit-economics mezcla Stripe y collections. Una diferencia entre ambas tablas no prueba por sí sola un error: faltan conciliación por referencia, fallback manual, estados, fees y moneda. `canonicalCash` resta el refunded_amount al pago de su periodo original; MONEY D5 requiere fecha del refund. Reproducción: refund de 100 ocurrido ahora, asociado a cobro antiguo ausente del lote actual → canonicalCash devuelve refunds=0. No hay filas internas de refunds en la instantánea consultada; el riesgo se demostró sintéticamente.

`calcularAgregados` acepta cobro is_confirmed=true sin exigir status collected. Reproducción: cobro pending de 100 se incluye. No se encontraron filas actuales afectadas por ese caso. No presentar el resultado sintético como pérdida real.

### F06 — P1: filtros del resumen excluyen población y comparación (G; C)

`app/[tenant]/dashboard/page.tsx`: filteredSales aplica sale_date del periodo; filteredCollections exige además venta en filteredSaleIds. Por tanto, cash del mes excluye pagos del mes de ventas previas: mezcla actividad con cohorte. `cur` y `prev` ejecutan monthlyKpis sobre las mismas filas ya recortadas al periodo actual, eliminando normalmente el mes anterior. Rangos multimes usan solo ym del inicio para cards; serie de seis meses usa igualmente filas recortadas. Requiere corregir conjuntos y periodo comparable conjuntamente, no solo cambiar la etiqueta.

### F07 — P1: funnel combina poblaciones no enlazadas (H/G; C,D)

`lib/funnels/queries.ts:crmStages` usa contactos, citas y ventas de todo el tenant por fechas de actividad, mientras Meta sí aplica familias de campañas. Igualdad de unidades no demuestra pertenencia a la misma cohorte. Las ventas apenas están enlazadas a citas en los datos inspeccionados. No interpretar los conectores como conversiones causales ni pérdidas demostradas. Separar actividad operacional de cohorte atribuible y mostrar sin atribuir.

`lib/ads/funnel.ts` denomina conversión VSL a agendas/leads sin fuente de sesiones de vídeo: semántica ambigua, no engagement medido.

### F08 — P1: diagnóstico KPI antes de validar calidad/madurez (A/K/L; C,D)

`app/api/[tenant]/evergreen/metricas/brief/route.ts` compone diagnóstico/health y posteriormente avisos de calidad. `lib/metrics/medidas.ts` marca valor no nulo como dato ok y basa confianza en muestra. `lib/metrics/definiciones.ts` contiene contrato de madurez, pero no se hallaron consumidores de su evaluación fuera del propio módulo. Las notas de asistencia provisional no se seleccionan en consulta para bloquear valoración. No mostrar HEALTHY/OUTSIDE KPI antes de superar las siete comprobaciones previas.

La capacidad semanal se compara con agendas de un rango arbitrario y las metas mensuales con presets de diferente duración: normalizar grano antes de etiquetar cumplimiento.

### F09 — P1: cohortes sin madurez y clientes contados como ventas (A/L; C)

`app/[tenant]/finanzas/analitica/cohortes/page.tsx`: clients aumenta por fila de venta, no cliente único. Celdas 30/60/90/180 se colorean contra umbrales aunque la cohorte no haya alcanzado esa edad. Denominador excluye ventas inactivas pero el recorrido de cobros no usa el mismo conjunto, lo que puede incluir cash de ventas excluidas. No se han validado visualmente los colores ni los importes renderizados.

### F10 — P1: Ask/AI no reproduce la semántica de las pantallas (B/G; C)

`lib/ai/agent/tools.ts:getBusinessOverview/getFunnel/getCampaignPerformance` filtran campañas por start_date, después usan acumulados; esto no mide actividad diaria del periodo como campaign_daily. Ventas usan isActiveSale y límites de filas sin prueba de completitud. **SEMANTIC LAYER GAP**: mismos nombres pueden devolver conceptos distintos en UI y Ask.

Bug adicional acotado: query contacts con HEAD devolvía count pero se leía data.length → null incluso con contactos. Corregido en esta rama para preservar count (incluido 0 y null); test de regresión demuestra los dos fallos antes del cambio. El total conserva su semántica histórica; no se ha convertido en nuevos contactos del periodo.

### F11 — P2: asignación/asistencia incompletas (F/K; D)

Se comprobaron citas y ventas sin setter, ventas sin appointment_id, citas sin closer y notas de asistencia provisional. Las notas no equivalen necesariamente al estado actual: no afirmar que toda fila anotada sigue marcada show. No atribuir automáticamente por nombre, por proximidad de fecha ni por benchmark. Requiere mapping confirmado y evidencia de asistencia; de momento ratios por setter y conversiones enlazadas UNKNOWN.

### F12 — P2: histórico esperado desconocido y sincronizaciones heterogéneas (C/D/E/K/M; D)

Se consultaron límites de fechas y logs de contactos/citas/ventas/cobros/Stripe/Meta/Instagram/atribución/eventos. Primer registro y primer log disponible no demuestran inicio del negocio ni backfill completo. Falta la fecha esperada por fuente/cuenta. VSL y conversaciones orgánicas no tienen sesiones/conversaciones en la instantánea: no se puede diagnosticar abandono ni conversión. Instagram explica limitación de acceso a conversaciones; no fabricar DMs.

Los jobs de una fuente tienen estados distintos: GHL-citas y el job agregado de Meta presentaban timeout reciente, mientras jobs de Meta específicos y otras fuentes tenían éxitos recientes. No declarar rota toda la integración ni usar documentación de tokens caducados como estado actual sin verificar.

### F13 — P1: errores de lectura pueden convertirse en cero financiero (B/K; C)

Resumen, cohortes, proyección y reparto de socios contienen consumo data ?? [] sin propagar todos los errores de consulta. Ante una lectura parcial, beneficio/reparto puede parecer válido. No se reprodujo una caída real: defecto de manejo de error demostrado en código. Los límites de filas también requieren comprobación de paginación; `.range(0,49999)` no acredita por sí solo que el servidor entregue todo. No se ha demostrado truncamiento real con la cantidad actual.

### F14 — P2: ventanas y semántica de fechas (G; C)

Analytics usa resta de N días con extremos inclusivos en presets cortos; algunos nombres año/trimestre representan ventanas móviles. Hay filtros timestamptz con límites UTC y helpers locales/Madrid, además de finales 23:59:59 que omiten fracciones. Centralizar frontera semiabierta en timezone de negocio. Booking se mide frecuentemente por appointment_datetime (fecha de cita) y no booked_at: decidir nombres y evitar cambiar historia silenciosamente.

### F15 — P2: proyección/morosidad necesitan universos explícitos (G/L; C)

Proyección incluye cuotas no collected sin excluir expresamente canceladas ni monitoring; comprobar contrato antes de sumar deuda exigible. Morosidad aplica mes a due_date, de modo que vencidas antiguas pueden quedar fuera. Mostrar deuda total vencida y calendario del periodo como universos distintos, o etiquetar exactamente el filtro.

### F16 — P2: atribución y filtros parciales (G/H; C)

La RPC de atribución es histórica, sin fechas; touchRows está limitado y el filtro de periodo opera en otros bloques. Los totales históricos no deben presentarse como respuesta del periodo seleccionado. Marketing requiere comprobar propagación de cuenta/campaña al panel diario y conciliación del sin atribuir; aún no se ha probado el control en navegador.

### F17 — P2: Data Health evalúa atribución con un campo no consultado (A/B; C)

`app/api/[tenant]/evergreen/settings/data-health/route.ts` selecciona campaigns `id,synced_at` pero calcula conAtribucion mediante `c.name`. Al no seleccionar name, la comparación con utm_campaign no puede reconocer las campañas atribuidas por nombre. El control puede emitir falsos huecos de atribución. No significa que toda atribución real sea correcta: corregir la selección y después revisar homónimos/IDs. Positivo: la ruta sí limita roles y tenant, y distingue errores de lectura en controles cruzados.

### F18 — P2: delivery/bajas tiene métricas operativas, no retención acreditada (G/K/L; C)

`drops/page.tsx` calcula recuperación de solicitudes, no retención de alumnos; n=0 se convierte en 0%. La card thisMonth intersecta mes actual con cualquier periodo seleccionado. Export usa filteredItems, tabla visibleItems (la búsqueda no viaja al export). CSM y bajas leen tablas sin tenant explícito y convierten errores en listas vacías. Students excluye método reserva sin consultar aquí su finalización: revisar transición con matrícula real. No se ha probado LTV, resultado del alumno ni retención por cohorte.

## Contratos críticos y decisión de representación

| Métrica | Definición / numerador / denominador | Tiempo y fuente | Scope y visual recomendada |
|---|---|---|---|
| Leads nuevos | contactos únicos no fusionados; no confundir contactos importados con llegada | first_seen_at; fallback first_contact_at, luego created_at con confianza explícita | tenant + persona/canal; card y serie; cobertura del fallback visible |
| Agendas | explicitar citas previstas vs nuevas reservas; cancelaciones separadas | appointment_datetime para agenda del día; booked_at para captación de agendas si disponible | tabla por estado + serie; no conectar cohortes sin ID |
| Show rate | asistencias / agendas elegibles conforme definición canónica; pendientes y futuras separadas | fecha cita; madurez de estado y evidencia | ratio + n/N; sin benchmark si provisional |
| Close rate | cierres / asistencias (o llamadas cualificadas si contrato aprobado) | distinguir actividad de cohorte enlazada | tabla por closer + n/N, no pie |
| Ventas | ventas válidas excluyendo reservas abiertas; clientes únicos son otra métrica | sale_date, sales + payment_plans | card + drilldown; total operativo conserva sin atribuir |
| Contracted Revenue | suma contratada válida; no Cash ni billed/recognized | sale_date | card y serie, moneda base acreditada |
| Cash / Net Cash | pagos válidos deduplicados; refunds por ocurrencia; fees según MONEY | paid_at/collected_at y fecha refund; Stripe + manual validado | serie y conciliación por referencia; partial si falla fuente |
| CPL / CAC | gasto / leads; gasto / clientes nuevos únicos con scope explícito | campaign_daily y población atribuible o blended declarada | ratio + denominador y gasto; no dividir poblaciones distintas |
| ROAS / MER | revenue o cash declarado / gasto del mismo scope; no intercambiar atribuible y total | periodo y FX consistentes | card + desglose; no benchmark hasta calidad completa |
| Retención/LTV | cohortes clientes, ventana madura, pagos netos y delivery enlazados | faltan verificaciones para contrato implementado | cohortes; celdas inmaduras N/A, nunca rojo automático |
| Comisiones | estados earned/pending/approved/paid/reversed del motor; D8/D9 | base y fecha según motor, no fórmula paralela UI | tabla y totales por estado/persona |

## Matriz principal (inspección de código; B pendiente)

Rutas relativas a `/<tenant>`. ¿Correcto? se refiere al contrato inspeccionado, no certifica el render final.

| Screen | Metric | Definition | Source | Correct? | Data Complete? | UI Appropriate? | Finding | Action |
|---|---|---|---|---|---|---|---|---|
| dashboard | ventas, contratado, cash, variación | actividad del periodo y comparación equivalente | analytics + sales/collections | No | Parcial | Pendiente | F03,F05,F06 | separar conjuntos y fuente |
| analitica | ratios, gasto, salud | diagnóstico sujeto a calidad y madurez | Brief/metrics | Parcial | No acreditada | Pendiente | F08,F14 | gates antes de KPI |
| analitica/embudo | etapas y conversiones | cohorte compatible o actividad rotulada | CRM + métricas | Parcial | No | Pendiente | F07,F11 | n/N, madurez, sin atribuir |
| analitica/ranking | ventas, cash por persona | atribución al dueño real | analytics | Parcial | No setters | Pendiente | F03,F06,F11 | tabla con muestra y sin asignar |
| analitica/actividad; actividad | actividad declarada y ventas | separar manual de hechos canónicos | reports + sales | Parcial | No acreditada | Pendiente | F01,F11 | rotular origen, scope servidor |
| unit-economics | cash, CAC, ticket, funnel | población/moneda/fecha compatibles | canonicalCash + sales/appointments | No | Parcial | Pendiente | F03–F07 | moneda, refunds, reservas |
| marketing/adquisicion/campanas | gasto, CPC, CTR, CPL, ROAS | gasto diario y atribución explícita | campaign_daily/campaigns | Parcial | Histórico desconocido | Pendiente | F07,F12,F16 | probar cuenta/campaña/fechas |
| marketing/adquisicion/atribucion | atribuido, first/last touch | no sustituir total operacional | RPC + contact_attributions | Parcial | Parcial | Pendiente | F16 | fechas y sin atribuir |
| funnels; funnels/eventos | etapa, caída, conversión | misma población enlazada | Meta + crmStages | No como cohorte | Parcial | Pendiente | F02,F07 | separar actividad y cohorte |
| marketing/adquisicion/vsl | plays, watch, leads | tracking first party; seek no es tiempo visto | video sessions + SQL | Parcial | Sin sesiones | Pendiente | F02,F12 | scope, n=0 unknown, CTA/QoE |
| instagram (crecimiento/reels/captacion) | alcance, seguidores, contenido | snapshots/API según disponibilidad | Instagram daily/media | Parcial | Histórico desconocido | Pendiente | F12 | cobertura y periodo visibles |
| instagram/conversaciones | conversaciones/DMs | solo API autorizada | integración limitada | No evaluable | Sin conversaciones | Pendiente | F12 | mantener explicación limitación |
| marketing/afiliados | ventas, comisiones, campañas | ledger/atribución propia | scoped queries | Parcial | No acreditada | Pendiente | F01 | verificar todos los roles |
| crm/contactos; detalle/Person360 | contactos y timeline | fecha llegada, deduplicación, pertenencia | contacts/timeline | Parcial | Faltan enlaces | Pendiente | F01,F11 | revisar permisos y drilldown |
| crm/agendas; seguimiento; fathom-revision | agendas, show, seguimiento | evidencia y estado maduro | appointments/Fathom | Parcial | No | Pendiente | F01,F11 | resolver provisionales |
| ventas/registro; detalle; reservas | ventas/reservas/cobros | D8, cash separado | sales/plans/collections | Parcial | Enlaces parciales | Pendiente | F01,F03 | reserva no equivale venta |
| ventas/pagos | cobro y pendiente por venta | cohorte sale_date y cash histórico declarados | sales/collections/installments | Parcial | No acreditada | Pendiente | F01,F05 | scope y semántica del filtro |
| comisiones; colaborador | earned/pending/paid/future | motor D8/D9, solo propios | commissions + profiles | Parcial | Asignación incompleta | Pendiente | F01,F11 | no duplicar motor; probar rol |
| finanzas/analitica/resumen;pnl | cash, gastos, beneficio | MONEY, fuente y periodo homogéneos | collections/refunds/expenses | Parcial | No acreditada | Pendiente | F03,F05,F13 | errores explícitos, reconciliar |
| finanzas/analitica/cohortes | clientes, recuperación 30–180 | clientes únicos y ventana madura | sales/collections | No | Parcial | Pendiente | F09 | madurez y mismo universo |
| finanzas/analitica/proyeccion | cobros/gastos esperados | deuda exigible, no monitoring | installments/commissions | Parcial | No acreditada | Pendiente | F13,F15 | estados y failure mode |
| finanzas/morosidad | vencido, pendiente | deuda total vs vencimientos del mes | installments/Sequra | Parcial | No acreditada | Pendiente | F15 | separar periodos/universos |
| finanzas/cobros (cobros/conciliacion/devoluciones) | cobro, matching, refunds | ocurrencia y deduplicación | Stripe/collections/refunds | Parcial | Conciliación pendiente | Pendiente | F04,F05 | conciliar sin borrar |
| finanzas/gastos-facturas | gastos/facturas | fechas, estado y moneda acreditados | expenses/invoices | Pendiente | Pendiente | Pendiente | área activa de otro agente | inspección adicional sin editar |
| finanzas/socios | beneficio distribuible propio | motor P&L + participación | API socios | Parcial | No acreditada | Pendiente | F13 | conserva scope propio; errores |
| students/producto; csm-events; drops | alumnos, delivery, bajas | únicos, reservas completadas, cohortes | sales/CSM | Pendiente | Pendiente | Pendiente | F18; filtro reserva requiere revisión | no concluir retención/LTV |
| recursos/testimonios/grabaciones | resultados y material | resultados verificados, no vanity | recursos | Pendiente | Pendiente | Pendiente | inventario de código | revisión UI/drilldowns |
| settings/data-health; integraciones | frescura, cobertura, mapping | por job/cuenta y ventana esperada | sync_runs + configuración | Parcial | Inicio esperado ausente | Pendiente | F12,F17 | cubrir toda cadena de fuentes |
| setting-ai; kpi/templates | simulación y objetivos | separar entrenamiento de hechos | simulador/config | Pendiente | No aplica/pendiente | Pendiente | no es performance productiva | comprobar etiquetas y acceso |
| Ask/AI | resumen, campañas, contactos | misma métrica/periodo que UI | agent/tools | No; count corregido | Parcial | Pendiente | F10 | capa semántica compartida |

## Cobertura browser pendiente y criterio de cierre

No se ha recorrido la app autenticada. Inventario por rutas y código no sustituye sidebar, tabs, drawers, modales, exportación ni permisos observados. Completar por cada fila:

1. Admin: captura desktop y mobile/tablet, pregunta principal resuelta en menos de diez segundos, unidades, leyenda, contraste, overflow y estados vacío/error/loading.
2. Mes actual por defecto o justificación. Probar hoy, mes, periodo custom sin filas y dos periodos equivalentes. Capturar cards, chart, tabla y export con idéntico scope.
3. Cuenta/campaña/persona/oferta/funnel: comprobar cada control, drilldown y paginación. Total operativo = atribuido + sin atribuir cuando corresponde.
4. Colaborador, closer, setter, socio y dirección existentes: mismos pasos y solicitudes directas; lectura ajena denegada en servidor, no solo oculta.
5. Switch tenant en usuario multitenant: ninguna fila/serie/cache del anterior. No crear usuarios ni conceder roles para hacer la prueba.
6. Casos sintéticos en entorno de pruebas: reserva abierta/completada, pago de venta antigua, refund posterior, moneda distinta, n=0/1, cohorte inmadura, API caída, duplicado de referencia. Comparar UI/API/AI/export.

## Scorecard provisional

PARTIAL en visual significa **pendiente de revisión autenticada**, no una valoración estética intermedia. FAIL se apoya en hallazgo concreto; no implica que todas las métricas de esa pantalla fallen.

| Screen | Data correctness | Business usefulness | Visual clarity | Filter consistency | Tenant/permission |
|---|---|---|---|---|---|
| Dashboard | FAIL | PARTIAL | PARTIAL | FAIL | FAIL (colaborador) |
| Analytics/Brief | FAIL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Embudo/Ranking | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Unit economics | FAIL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Campañas/Atribución | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Funnels | FAIL (como cohorte) | PARTIAL | PARTIAL | FAIL (población) | FAIL (scope API) |
| VSL | PARTIAL | PARTIAL | PARTIAL | PARTIAL | FAIL (scope API) |
| Instagram | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| CRM/Ventas/Colaborador | PARTIAL | PARTIAL | PARTIAL | PARTIAL | FAIL (RLS comprobada) |
| Comisiones | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Finanzas resumen/P&L | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Cohortes | FAIL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Proyección/Morosidad | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Socios | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL (scope código correcto) |
| Delivery/Recursos | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Data Health/Integraciones | PARTIAL | PARTIAL | PARTIAL | PARTIAL | PARTIAL |
| Ask/AI | FAIL | PARTIAL | PARTIAL | FAIL | PARTIAL |

## Lo demostrado y lo que no

Positivo: existe vocabulario financiero documentado; exclusión de reservas en agregados y reglas D8/D9 en motor de comisiones; scopes explícitos en Instagram, afiliados y socio propio; advertencias de fuente vacía en AI; fuente de leads distingue fecha histórica e importación; suite canónica de métricas inicial 719/719.

No probado: cobertura histórica completa, igualdad de cada cifra renderizada entre módulos, experiencia móvil, exports, todos los roles, LTV/retención/delivery y ausencia de duplicados global. No hay base para declarar negocio sano o fuera de KPI. No se ha detectado que un benchmark demuestre un error de negocio.

Plan operativo: [DASHBOARD_CORRECTION_PLAN.md](DASHBOARD_CORRECTION_PLAN.md). Coordinación: [docs/ACTIVE_HANDOFF.md](docs/ACTIVE_HANDOFF.md), sección CODEX — DASHBOARD & METRIC AUDIT.
