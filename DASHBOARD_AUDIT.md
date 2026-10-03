# Auditoría de dashboards y métricas

Fecha: 2026-09-25. Base de código: `7a150cc`. Rama: `codex/dashboard-metric-audit`.

**Estado: EN CURSO; no certificada.** Código, SQL de producción de solo lectura, RLS autenticada y recorrido admin real. Se revisaron visualmente los paneles principales y se probaron filtros/tabs concretos (registro abajo). Faltan mobile, exports completos, roles y varias rutas. Los fixes de esta rama tienen quality/build locales, pero no están desplegados. No se modificaron datos de negocio ni migraciones. La sesión admin fue recuperada tras un fallo de «Ver como»; no repetir esa acción durante la revisión.

Este documento es apto para el repositorio: no contiene identificadores, importes, personas ni cifras de negocio reales. La evidencia agregada de producción se comunicó privadamente en la sesión. Los ejemplos numéricos siguientes son sintéticos. Las observaciones SQL son una instantánea, no una monitorización continua.

## Estado de los hallazgos a 3-oct (reconciliado contra `main`)

Base: `98b2c89`. **Método y límite:** cada fila se contrastó con el CÓDIGO de `main` y con las PRs fusionadas; no se re-midió producción (sin credenciales de BD en esta sesión). «Cerrado» = hay arreglo fusionado con regresión; «parcial» = se corrigió una parte y la otra consta abierta; «sin verificar» = no se revisó en esta pasada, no se da por bueno.

| Hallazgo                                              | Prio | Estado        | Evidencia / qué falta                                                                                                                                                      |
| ----------------------------------------------------- | ---- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F01 colaborador lee datos ajenos (RLS)                | P0   | **ABIERTO**   | Ninguna migración de RLS desde el 25-sep. #304 cierra OTRO agujero (RPC de atribución), no este. Requiere migración + dry-run `BEGIN…ROLLBACK` + confirmación del usuario. |
| F02 endpoints privilegiados sin scope de rol          | P0   | Cerrado       | #219 (`requirePantalla` + lista de personas del VSL solo a quien ve contactos).                                                                                            |
| F03 reservas abiertas cuentan como ventas             | P1   | Cerrado       | #221 (`cuentaComoVenta`) en Dashboard, ranking, P&L, objetivos e IA.                                                                                                       |
| F04 moneda omitida en cash                            | P1   | **ABIERTO**   | `lib/canonical/cash.ts` sigue sin transportar moneda. Además **BUSINESS_DECISION**: proveedor de FX (MONEY D2).                                                            |
| F05 cash/refunds sin contrato temporal común          | P1   | Parcial       | Se descartan estados de Stripe no liquidados (28-sep). Fecha de refund por ocurrencia: sin verificar.                                                                      |
| F06 filtros del resumen / comparación                 | P1   | Cerrado       | `tests/metrics/dashboard-period-finance.test.mjs`.                                                                                                                         |
| F07 funnel mezcla poblaciones no enlazadas            | P1   | Parcial       | `compute.ts` bloquea con `poblacion_no_enlazada`. Falta separar actividad de cohorte y mostrar «sin atribuir».                                                             |
| F08 diagnóstico antes de los gates de calidad/madurez | P1   | **ABIERTO**   | `evaluarDefinicion` sigue sin consumidores fuera de su módulo.                                                                                                             |
| F09 cohortes sin madurez, ventas como clientes        | P1   | Cerrado       | «En maduración» y clientes únicos en `lib/finance/cohortes.ts`.                                                                                                            |
| F10 Ask/IA ≠ pantallas                                | P1   | Parcial       | Conteo (#218), predicado de venta (#221), registro de fuentes. Falta paridad del periodo de campañas.                                                                      |
| F11 asignación / asistencia incompletas               | P2   | USER_ACTION   | Mapeo de setters y confirmar asistencias provisionales.                                                                                                                    |
| F12 histórico esperado desconocido                    | P2   | USER_ACTION   | Fecha inicial esperada por fuente.                                                                                                                                         |
| F13 errores de lectura como cero financiero           | P1   | Parcial       | Resumen y P&L propagan error. **Cohortes sigue con `data ?? []`**; proyección y socios sin verificar.                                                                      |
| F14 ventanas y semántica de fechas                    | P2   | **ABIERTO**   | Sin helper de zona horaria de negocio en `lib/filters/period.ts`.                                                                                                          |
| F15 proyección / morosidad                            | P2   | Sin verificar | No revisado en esta pasada.                                                                                                                                                |
| F16 atribución con filtros parciales                  | P2   | **ABIERTO**   | Sin cambios detectados.                                                                                                                                                    |
| F17 Data Health compara por un campo no consultado    | P2   | Cerrado       | #220.                                                                                                                                                                      |
| F18 bajas = recuperación, no retención                | P2   | **ABIERTO**   | Sin cambios detectados.                                                                                                                                                    |
| F19 selector de subcuenta no acota consultas          | P0   | Parcial       | Cerrado en Dashboard, Unit Economics y 4 pantallas de Finanzas (#218). **Abierto**: CRM, alumnos, contenido, selectores y vistas guardadas.                                |
| F20 CTR ÷ 100                                         | P1   | Cerrado       | #218.                                                                                                                                                                      |
| F21 «Ver como» bloquea el retorno                     | P2   | **ABIERTO**   | Solo hubo restyling (#248); la cookie HttpOnly sigue sin tratarse.                                                                                                         |
| F22 ausencia de muestra como rendimiento cero         | P2   | **ABIERTO**   | Corregido el show rate de agendas (#223); CSM, onboarding y VSL siguen.                                                                                                    |
| F23 Data Health afirma rotura por silencio            | P2   | Parcial       | La etiqueta pasó a «sin recepciones»; falta separar firma / HTTP / ausencia esperada.                                                                                      |
| F24 funnel ilegible con primera etapa a cero          | P2   | Cerrado       | #220.                                                                                                                                                                      |
| F25 VSL: HTTP 400 en Funnels                          | P2   | Cerrado       | #220.                                                                                                                                                                      |

### Hallazgos nuevos (observados en la app en vivo el 25-sep; revalidar antes de actuar)

| Id  | Prio | Estado                | Detalle                                                                                                                                                                                                                                   |
| --- | ---- | --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| F26 | P1   | Cerrado (#223)        | % de asistencia dividía entre TODAS las agendas: cada cita sin marcar contaba como ausencia.                                                                                                                                              |
| F27 | P2   | Cerrado (#222)        | Stripe aparecía «Sin configurar» por faltar el secreto del webhook mientras sincronizaba; las claves de lectura y de webhook iban mezcladas.                                                                                              |
| F28 | P2   | Cerrado (#222)        | La tarjeta de Meta mezclaba dos ejecuciones distintas (última pasada correcta + incidencia de otro job).                                                                                                                                  |
| F29 | P3   | Cerrado (#316)        | Pestañas «Sin atribuir» (CRM) y «Grabaciones» (Recursos) ausentes de su tira; «1 eventos»; Testimonios culpaba al filtro estando vacío.                                                                                                   |
| F30 | P3   | **ABIERTO**           | Cola de llamadas sin atribuir: renderiza todas de golpe (177 filas, ~90 KB, ~20 s hasta ser usable). Falta paginar.                                                                                                                       |
| F31 | P3   | **ABIERTO**           | Contactos renderiza ~1.300 enlaces sin paginar.                                                                                                                                                                                           |
| F32 | P2   | **BUSINESS_DECISION** | Tabla «Atribución de leads» del dashboard suma leads de todo el histórico y divide ventas del periodo entre ellos para el «% conv.». El código lo documenta como intencionado; mezclar ambas preguntas en una fila es decisión del dueño. |
| F33 | P1   | **USER_ACTION**       | Integraciones muestra Meta «conectada pero sin sincronizar». Tras la regla D10 (sin cuenta seleccionada ya no se sincroniza «todas»), comprobar que esté elegida la cuenta publicitaria: sin ella no entra gasto ni hay CAC/ROAS reales.  |
| F34 | P3   | **ABIERTO**           | Webhook de onboarding: «Sin configurar / se rechazan con 401» y a la vez «Último evento: hace 1 d». Una de las dos líneas es falsa.                                                                                                       |

**Lo que sigue sin poder responderse hoy:** de qué setter vino cada venta (F11); si falta histórico de Meta o simplemente no se usaba antes (F12); el rendimiento por colaborador con garantía de aislamiento (F01).

## Regla de diagnóstico obligatoria

1. Definición. 2. Fuente. 3. Completitud. 4. Periodo. 5. Maduración. 6. Asignación. 7. Cálculo. 8. KPI/benchmark.

Un benchmark externo nunca demuestra por sí solo un error ni un problema comercial. Si algún paso no está validado, el diagnóstico comercial es **UNKNOWN**; se puede documentar por separado un bug demostrado. No hay ningún hallazgo clasificado como REAL BUSINESS KPI PROBLEM en esta auditoría.

Referencias: skills del proyecto `.agents/skills/marketing-and-copywriting/SKILL.md` (medición y atribución), `.agents/skills/sales-engineering/SKILL.md` (agendas, asistencias, cierres y muestras), `docs/METRICS.md`, `docs/SALES_METRICS_MAP.md`, `docs/MONEY.md`, `lib/metrics/definiciones.ts`. Las skills orientan el diagnóstico; no autorizan sustituir silenciosamente una definición canónica del producto.

## Convenciones de evidencia

- **C**: código inspeccionado; comportamiento deducido, sin afirmar que la pantalla se probó.
- **D**: consulta de producción de solo lectura; sin exportar filas personales.
- **R**: reproducción ejecutada con entradas sintéticas en funciones reales.
- **T**: test por script canónico del repositorio.
- **B**: pantalla autenticada observada; los controles concretos probados se enumeran abajo. No equivale a certificar todos los estados.
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

`app/[tenant]/finanzas/analitica/cohortes/page.tsx`: clients aumenta por fila de venta, no cliente único. Celdas 30/60/90/180 se colorean contra umbrales aunque la cohorte no haya alcanzado esa edad. Denominador excluye ventas inactivas pero el recorrido de cobros no usa el mismo conjunto, lo que puede incluir cash de ventas excluidas. El navegador confirmó celdas coloreadas en ventanas todavía inmaduras; no constituye prueba de recuperación final.

### F10 — P1: Ask/AI no reproduce la semántica de las pantallas (B/G; C)

`lib/ai/agent/tools.ts:getBusinessOverview/getFunnel/getCampaignPerformance` filtran campañas por start_date, después usan acumulados; esto no mide actividad diaria del periodo como campaign_daily. Ventas usan isActiveSale y límites de filas sin prueba de completitud. **SEMANTIC LAYER GAP**: mismos nombres pueden devolver conceptos distintos en UI y Ask.

Bug adicional acotado: query contacts con HEAD devolvía count pero se leía data.length → null incluso con contactos. Corregido en esta rama para preservar count (incluido 0 y null); test de regresión demuestra los dos fallos antes del cambio. El total conserva su semántica histórica; no se ha convertido en nuevos contactos del periodo.

### F11 — P2: asignación/asistencia incompletas (F/K; D)

Se comprobaron citas y ventas sin setter, ventas sin appointment_id, citas sin closer y notas de asistencia provisional. Las notas no equivalen necesariamente al estado actual: no afirmar que toda fila anotada sigue marcada show. No atribuir automáticamente por nombre, por proximidad de fecha ni por benchmark. Requiere mapping confirmado y evidencia de asistencia; de momento ratios por setter y conversiones enlazadas UNKNOWN.

### F12 — P2: histórico esperado desconocido y sincronizaciones heterogéneas (C/D/E/K/M; D)

Se consultaron límites de fechas y logs de contactos/citas/ventas/cobros/Stripe/Meta/Instagram/atribución/eventos. Primer registro y primer log disponible no demuestran inicio del negocio ni backfill completo. Falta la fecha esperada por fuente/cuenta. VSL y conversaciones orgánicas no tienen sesiones/conversaciones en la instantánea: no se puede diagnosticar abandono ni conversión. Instagram explica limitación de acceso a conversaciones; no fabricar DMs.

Los jobs de una fuente tienen estados distintos: GHL-citas y el job agregado de Meta presentaban timeout reciente, mientras jobs de Meta específicos y otras fuentes tenían éxitos recientes. No declarar rota toda la integración ni usar documentación de tokens caducados como estado actual sin verificar.

### F13 — P1: errores de lectura pueden convertirse en cero financiero (B/K; C)

P&L, cohortes, proyección y reparto de socios contienen consumo data ?? [] sin propagar todos los errores de consulta. Ante una lectura parcial, beneficio/reparto puede parecer válido. El resumen financiero SÍ usa primerError/errorCarga: se excluye de este hallazgo. No se reprodujo una caída real: defecto de manejo de error demostrado en código. Los límites de filas también requieren comprobación de paginación; `.range(0,49999)` no acredita por sí solo que el servidor entregue todo. No se ha demostrado truncamiento real con la cantidad actual.

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

| Métrica            | Definición / numerador / denominador                                                         | Tiempo y fuente                                                                             | Scope y visual recomendada                                           |
| ------------------ | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Leads nuevos       | contactos únicos no fusionados; no confundir contactos importados con llegada                | first_seen_at; fallback first_contact_at, luego created_at con confianza explícita          | tenant + persona/canal; card y serie; cobertura del fallback visible |
| Agendas            | explicitar citas previstas vs nuevas reservas; cancelaciones separadas                       | appointment_datetime para agenda del día; booked_at para captación de agendas si disponible | tabla por estado + serie; no conectar cohortes sin ID                |
| Show rate          | asistencias / agendas elegibles conforme definición canónica; pendientes y futuras separadas | fecha cita; madurez de estado y evidencia                                                   | ratio + n/N; sin benchmark si provisional                            |
| Close rate         | cierres / asistencias (o llamadas cualificadas si contrato aprobado)                         | distinguir actividad de cohorte enlazada                                                    | tabla por closer + n/N, no pie                                       |
| Ventas             | ventas válidas excluyendo reservas abiertas; clientes únicos son otra métrica                | sale_date, sales + payment_plans                                                            | card + drilldown; total operativo conserva sin atribuir              |
| Contracted Revenue | suma contratada válida; no Cash ni billed/recognized                                         | sale_date                                                                                   | card y serie, moneda base acreditada                                 |
| Cash / Net Cash    | pagos válidos deduplicados; refunds por ocurrencia; fees según MONEY                         | paid_at/collected_at y fecha refund; Stripe + manual validado                               | serie y conciliación por referencia; partial si falla fuente         |
| CPL / CAC          | gasto / leads; gasto / clientes nuevos únicos con scope explícito                            | campaign_daily y población atribuible o blended declarada                                   | ratio + denominador y gasto; no dividir poblaciones distintas        |
| ROAS / MER         | revenue o cash declarado / gasto del mismo scope; no intercambiar atribuible y total         | periodo y FX consistentes                                                                   | card + desglose; no benchmark hasta calidad completa                 |
| Retención/LTV      | cohortes clientes, ventana madura, pagos netos y delivery enlazados                          | faltan verificaciones para contrato implementado                                            | cohortes; celdas inmaduras N/A, nunca rojo automático                |
| Comisiones         | estados earned/pending/approved/paid/reversed del motor; D8/D9                               | base y fecha según motor, no fórmula paralela UI                                            | tabla y totales por estado/persona                                   |

## Matriz principal (código; cobertura browser detallada más abajo)

Rutas relativas a `/<tenant>`. ¿Correcto? se refiere al contrato inspeccionado, no certifica el render final.

| Screen                                             | Metric                              | Definition                                      | Source                             | Correct?            | Data Complete?          | UI Appropriate? | Finding                               | Action                          |
| -------------------------------------------------- | ----------------------------------- | ----------------------------------------------- | ---------------------------------- | ------------------- | ----------------------- | --------------- | ------------------------------------- | ------------------------------- |
| dashboard                                          | ventas, contratado, cash, variación | actividad del periodo y comparación equivalente | analytics + sales/collections      | No                  | Parcial                 | Pendiente       | F03,F05,F06                           | separar conjuntos y fuente      |
| analitica                                          | ratios, gasto, salud                | diagnóstico sujeto a calidad y madurez          | Brief/metrics                      | Parcial             | No acreditada           | Pendiente       | F08,F14                               | gates antes de KPI              |
| analitica/embudo                                   | etapas y conversiones               | cohorte compatible o actividad rotulada         | CRM + métricas                     | Parcial             | No                      | Pendiente       | F07,F11                               | n/N, madurez, sin atribuir      |
| analitica/ranking                                  | ventas, cash por persona            | atribución al dueño real                        | analytics                          | Parcial             | No setters              | Pendiente       | F03,F06,F11                           | tabla con muestra y sin asignar |
| analitica/actividad; actividad                     | actividad declarada y ventas        | separar manual de hechos canónicos              | reports + sales                    | Parcial             | No acreditada           | Pendiente       | F01,F11                               | rotular origen, scope servidor  |
| unit-economics                                     | cash, CAC, ticket, funnel           | población/moneda/fecha compatibles              | canonicalCash + sales/appointments | No                  | Parcial                 | Pendiente       | F03–F07                               | moneda, refunds, reservas       |
| marketing/adquisicion/campanas                     | gasto, CPC, CTR, CPL, ROAS          | gasto diario y atribución explícita             | campaign_daily/campaigns           | Parcial             | Histórico desconocido   | Pendiente       | F07,F12,F16                           | probar cuenta/campaña/fechas    |
| marketing/adquisicion/atribucion                   | atribuido, first/last touch         | no sustituir total operacional                  | RPC + contact_attributions         | Parcial             | Parcial                 | Pendiente       | F16                                   | fechas y sin atribuir           |
| funnels; funnels/eventos                           | etapa, caída, conversión            | misma población enlazada                        | Meta + crmStages                   | No como cohorte     | Parcial                 | Pendiente       | F02,F07                               | separar actividad y cohorte     |
| marketing/adquisicion/vsl                          | plays, watch, leads                 | tracking first party; seek no es tiempo visto   | video sessions + SQL               | Parcial             | Sin sesiones            | Pendiente       | F02,F12                               | scope, n=0 unknown, CTA/QoE     |
| instagram (crecimiento/reels/captacion)            | alcance, seguidores, contenido      | snapshots/API según disponibilidad              | Instagram daily/media              | Parcial             | Histórico desconocido   | Pendiente       | F12                                   | cobertura y periodo visibles    |
| instagram/conversaciones                           | conversaciones/DMs                  | solo API autorizada                             | integración limitada               | No evaluable        | Sin conversaciones      | Pendiente       | F12                                   | mantener explicación limitación |
| marketing/afiliados                                | ventas, comisiones, campañas        | ledger/atribución propia                        | scoped queries                     | Parcial             | No acreditada           | Pendiente       | F01                                   | verificar todos los roles       |
| crm/contactos; detalle/Person360                   | contactos y timeline                | fecha llegada, deduplicación, pertenencia       | contacts/timeline                  | Parcial             | Faltan enlaces          | Pendiente       | F01,F11                               | revisar permisos y drilldown    |
| crm/agendas; seguimiento; fathom-revision          | agendas, show, seguimiento          | evidencia y estado maduro                       | appointments/Fathom                | Parcial             | No                      | Pendiente       | F01,F11                               | resolver provisionales          |
| ventas/registro; detalle; reservas                 | ventas/reservas/cobros              | D8, cash separado                               | sales/plans/collections            | Parcial             | Enlaces parciales       | Pendiente       | F01,F03                               | reserva no equivale venta       |
| ventas/pagos                                       | cobro y pendiente por venta         | cohorte sale_date y cash histórico declarados   | sales/collections/installments     | Parcial             | No acreditada           | Pendiente       | F01,F05                               | scope y semántica del filtro    |
| comisiones; colaborador                            | earned/pending/paid/future          | motor D8/D9, solo propios                       | commissions + profiles             | Parcial             | Asignación incompleta   | Pendiente       | F01,F11                               | no duplicar motor; probar rol   |
| finanzas/analitica/resumen;pnl                     | cash, gastos, beneficio             | MONEY, fuente y periodo homogéneos              | collections/refunds/expenses       | Parcial             | No acreditada           | Pendiente       | F03,F05,F13                           | errores explícitos, reconciliar |
| finanzas/analitica/cohortes                        | clientes, recuperación 30–180       | clientes únicos y ventana madura                | sales/collections                  | No                  | Parcial                 | Pendiente       | F09                                   | madurez y mismo universo        |
| finanzas/analitica/proyeccion                      | cobros/gastos esperados             | deuda exigible, no monitoring                   | installments/commissions           | Parcial             | No acreditada           | Pendiente       | F13,F15                               | estados y failure mode          |
| finanzas/morosidad                                 | vencido, pendiente                  | deuda total vs vencimientos del mes             | installments/Sequra                | Parcial             | No acreditada           | Pendiente       | F15                                   | separar periodos/universos      |
| finanzas/cobros (cobros/conciliacion/devoluciones) | cobro, matching, refunds            | ocurrencia y deduplicación                      | Stripe/collections/refunds         | Parcial             | Conciliación pendiente  | Pendiente       | F04,F05                               | conciliar sin borrar            |
| finanzas/gastos-facturas                           | gastos/facturas                     | fechas, estado y moneda acreditados             | expenses/invoices                  | Pendiente           | Pendiente               | Pendiente       | área activa de otro agente            | inspección adicional sin editar |
| finanzas/socios                                    | beneficio distribuible propio       | motor P&L + participación                       | API socios                         | Parcial             | No acreditada           | Pendiente       | F13                                   | conserva scope propio; errores  |
| students/producto; csm-events; drops               | alumnos, delivery, bajas            | únicos, reservas completadas, cohortes          | sales/CSM                          | Pendiente           | Pendiente               | Pendiente       | F18; filtro reserva requiere revisión | no concluir retención/LTV       |
| recursos/testimonios/grabaciones                   | resultados y material               | resultados verificados, no vanity               | recursos                           | Pendiente           | Pendiente               | Pendiente       | inventario de código                  | revisión UI/drilldowns          |
| settings/data-health; integraciones                | frescura, cobertura, mapping        | por job/cuenta y ventana esperada               | sync_runs + configuración          | Parcial             | Inicio esperado ausente | Pendiente       | F12,F17                               | cubrir toda cadena de fuentes   |
| setting-ai; kpi/templates                          | simulación y objetivos              | separar entrenamiento de hechos                 | simulador/config                   | Pendiente           | No aplica/pendiente     | Pendiente       | no es performance productiva          | comprobar etiquetas y acceso    |
| Ask/AI                                             | resumen, campañas, contactos        | misma métrica/periodo que UI                    | agent/tools                        | No; count corregido | Parcial                 | Pendiente       | F10                                   | capa semántica compartida       |

## Cobertura browser real y pendientes — actualización de relevo

| Pantalla                                     | Observado / probado                                         | Pendiente o hallazgo                                                                                                          |
| -------------------------------------------- | ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Dashboard                                    | desktop, Hoy y restaurar mes; cards, funnel, ranking, tabla | mezcla de tenant F19; cash/cohorte F06; atribución histórica no cambia                                                        |
| Unit economics                               | desktop, filtro Solo anuncios/Todos                         | funnel inferior mezcla históricos con periodo, ratios >100%; F04–F08                                                          |
| Embudo / ranking                             | desktop; tablas y advertencia de mapping                    | denominadores distintos entre paneles; selector redundante; roles pendientes                                                  |
| Actividad analítica                          | abrir KPI de hoy                                            | modal sin formulario de rol; carga final del resto pendiente                                                                  |
| Campañas                                     | Meta/Campañas, Hoy/Mes, CSV pulsado                         | contenido del archivo no validado; CTR F20; cuenta/campaña pendientes                                                         |
| Atribución                                   | desktop, cobertura y tablas                                 | históricos frente a filtro de periodo F16                                                                                     |
| VSL                                          | desktop, estado sin sesiones                                | cero y «Sin caídas relevantes» sin muestra F22                                                                                |
| Instagram                                    | Reels/Crecimiento/Captación/Conversaciones                  | limitación API visible; cobertura de comparación 30 días no acreditada                                                        |
| Finanzas resumen / P&L                       | desktop; resumen cambiar mes y restaurar                    | importes coinciden entre ambos, pero no con dashboard; F03–F05/F19                                                            |
| Cohortes / proyección / morosidad            | desktop y estados vacíos                                    | madurez F09; ausencia de cuotas no equivale ausencia de deuda                                                                 |
| Ventas registro / detalle / reservas / pagos | desktop; Ver abre detalle de venta                          | reservas como activas, pagos históricos bajo filtro mensual; no cambios financieros                                           |
| Comisiones                                   | desktop y Futuras                                           | estados ledger explícitos; controles de carga ocupan jerarquía principal; no modificar carril ajeno                           |
| Agendas                                      | Calendario/Métricas equipo/Tabla                            | cierres cero frente a ventas existentes por enlaces ausentes; históricos por pestaña                                          |
| Contactos                                    | lista desktop                                               | contaminación tenant; ficha no confirmada                                                                                     |
| Colaboradores                                | listado/KPIs/campañas                                       | atribución estructurada y ledger visibles; contrato impide dashboard personal                                                 |
| Alumnos                                      | desktop y screenshot                                        | fila ajena al tenant; onboarding vacío, porcentajes sin muestra                                                               |
| CSM / bajas                                  | lectura de cards/estados vacíos                             | ratios 0% y grado 0 sin muestra; recuperación no es retención                                                                 |
| Cobros / conciliación / devoluciones         | tablas y avisos                                             | conciliación identifica fees/refunds/enlaces pendientes; devoluciones internas vacías; no se ejecutó cotejo                   |
| Gastos                                       | desktop/screenshot                                          | gráfico con etiquetas recortadas; gasto Meta contable difiere diario (temporalidad/sync por comprobar); área ajena sin editar |
| Data Health                                  | estado jobs, fuentes, webhooks, identidad                   | transporte vs dato diferenciados; inactividad por sí sola no demuestra webhook roto F23                                       |
| Setting AI                                   | entrenamiento vacío                                         | simulación diferenciada de hechos; no ejecutar conversaciones que generen coste                                               |
| Contenido                                    | tabla vacía y filtros                                       | selector de editores incluye usuarios globales; no metricar rendimiento desde vacío                                           |
| Settings / usuarios                          | navegación admin                                            | fallo de retorno Ver como F21; sesión recuperada, no volver a impersonar                                                      |
| Funnels                                      | desktop y móvil 390×844; fuente VSL HTTP 400                | barras estrechas y texto oculto F24; consulta REST F25                                                                        |

**Sin completar:** funnels/eventos, socios, Brief, integraciones, recursos/testimonios/grabaciones, Person360 y seguimiento/Fathom; revisión mobile/tablet; todos los exports, custom ranges, paginación, cuenta/campaña/oferta, cambio real de tenant y UI de todos los roles. No inventar PASS. La matriz/scorecard original sigue provisional: esta tabla especifica qué dejó de estar pendiente.

**Roles:** admin observado; colaborador probado por RLS previamente. UI de colaborador bloqueada por contrato pendiente: no firmar ni saltar gate. Closer/setter/socio no probados en UI. No crear privilegios para auditar.

### F19 — P0: el tenant seleccionado no acota consultas de paneles (C,D,B,T)

Un admin con acceso amplio ve una venta de otra subcuenta sumada en dashboard/finanzas/unit-economics pero no en registro de ventas. SQL por tenant confirma origen de la diferencia. También aparece en alumnos; contactos y selectores muestran filas globales. No confundir acceso amplio autorizado del admin con datos correctos del tenant seleccionado.

**Fix acotado local:** `.eq('tenant_id', tenantId)` en las consultas iniciales de dashboard, unit-economics y finanzas resumen/P&L/cohortes/proyección. Usuarios por `tenant_members!inner` (FK comprobada). Reconsultar al cambiar tenant y proteger respuestas tardías con guard existente. Test ejecuta expresiones reales con cliente Supabase instalado y HTTP sintético permisivo para dos tenants. No sustituye test RLS ni browser del build corregido. CRM/alumnos/contenido quedan para el carril de producto; saved views escritura y scope de APIs necesitan revisión aparte.

### F20 — P1: CTR de tabla dividido por 100 (A; C,B,T)

La tabla formatea clicks/impressions directamente con `%`; la vista Meta expresa porcentaje. Corregido factor 100 preservando null si denominador cero. Fixture 28 clicks/1000 impressions → 2.8%, 0/1000→0%, 0/0→null. No cambia qué tipo de click selecciona cada fuente.

### F21 — P2: Ver como puede bloquear el retorno y el login (C,B)

El gate de contrato se renderiza antes del banner de retorno. La salida existente responde OK pero escribe cookie auth HttpOnly, incompatible con el cliente browser que debe guardar la sesión. Después la UI volvió al login y rechazó acceso a la subcuenta. Se observó únicamente metadata de cookie, se eliminó solo la cookie defectuosa de ese origen; usuario inició sesión y dashboard admin volvió a cargar. No se leyeron credenciales, ni se cambiaron roles/contratos. **Workaround aplicado al navegador; bug de código NO corregido.** Próximo fix: cookies mediante adaptador SSR canónico, limpieza de chunks anteriores y banner/retorno disponible en gate; pruebas con sesión grande y contrato pendiente. No quitar HttpOnly indiscriminadamente al ticket de impersonación.

### F22 — P2: ausencia de muestra presentada como rendimiento cero (K/L; B,C)

CSM muestra show/success=0% y grado=0 sin eventos; onboarding muestra 0% sin enviados; VSL dice «Sin caídas relevantes» sin sesiones. Mostrar sin muestra/no disponible, denominador y motivo. No concluir deterioro ni salud.

### F23 — P2: Data Health afirma rotura por silencio de webhook (L/M; B)

Superar un umbral de horas sin eventos no prueba por sí solo que el proveedor debiera haber enviado un evento. Rotular «sin recepciones, requiere comprobar» y contrastar logs de entrega/configuración. Separar falta de firma, fallo HTTP confirmado y ausencia de actividad esperada. No disparar sync ni alterar credenciales para simular evidencia.

## Validación de los safe fixes

Quality local: format PASS, lint PASS con warnings existentes, typecheck PASS, unit 902 PASS / 3 SKIP / 0 FAIL, métricas 729 PASS / 0 FAIL. Build de producción PASS. Knip ejecutado, backlog informativo existente, sin borrados. Sin E2E ni verificación visual del build nuevo; producción conserva código anterior. No afirmar desplegado.

## Scorecard provisional

PARTIAL en visual significa cobertura parcial; consultar registro browser anterior para distinguir observado de pendiente. FAIL se apoya en hallazgo concreto; no implica que todas las métricas de esa pantalla fallen.

| Screen                    | Data correctness    | Business usefulness | Visual clarity | Filter consistency | Tenant/permission               |
| ------------------------- | ------------------- | ------------------- | -------------- | ------------------ | ------------------------------- |
| Dashboard                 | FAIL                | PARTIAL             | PARTIAL        | FAIL               | FAIL (colaborador)              |
| Analytics/Brief           | FAIL                | PARTIAL             | PARTIAL        | PARTIAL            | PARTIAL                         |
| Embudo/Ranking            | PARTIAL             | PARTIAL             | PARTIAL        | PARTIAL            | PARTIAL                         |
| Unit economics            | FAIL                | PARTIAL             | PARTIAL        | PARTIAL            | PARTIAL                         |
| Campañas/Atribución       | PARTIAL             | PARTIAL             | PARTIAL        | PARTIAL            | PARTIAL                         |
| Funnels                   | FAIL (como cohorte) | PARTIAL             | PARTIAL        | FAIL (población)   | FAIL (scope API)                |
| VSL                       | PARTIAL             | PARTIAL             | PARTIAL        | PARTIAL            | FAIL (scope API)                |
| Instagram                 | PARTIAL             | PARTIAL             | PARTIAL        | PARTIAL            | PARTIAL                         |
| CRM/Ventas/Colaborador    | PARTIAL             | PARTIAL             | PARTIAL        | PARTIAL            | FAIL (RLS comprobada)           |
| Comisiones                | PARTIAL             | PARTIAL             | PARTIAL        | PARTIAL            | PARTIAL                         |
| Finanzas resumen/P&L      | PARTIAL             | PARTIAL             | PARTIAL        | PARTIAL            | PARTIAL                         |
| Cohortes                  | FAIL                | PARTIAL             | PARTIAL        | PARTIAL            | PARTIAL                         |
| Proyección/Morosidad      | PARTIAL             | PARTIAL             | PARTIAL        | PARTIAL            | PARTIAL                         |
| Socios                    | PARTIAL             | PARTIAL             | PARTIAL        | PARTIAL            | PARTIAL (scope código correcto) |
| Delivery/Recursos         | PARTIAL             | PARTIAL             | PARTIAL        | PARTIAL            | PARTIAL                         |
| Data Health/Integraciones | PARTIAL             | PARTIAL             | PARTIAL        | PARTIAL            | PARTIAL                         |
| Ask/AI                    | FAIL                | PARTIAL             | PARTIAL        | FAIL               | PARTIAL                         |

## Lo demostrado y lo que no

Positivo: existe vocabulario financiero documentado; exclusión de reservas en agregados y reglas D8/D9 en motor de comisiones; scopes explícitos en Instagram, afiliados y socio propio; advertencias de fuente vacía en AI; fuente de leads distingue fecha histórica e importación; suite canónica de métricas inicial 719/719.

No probado: cobertura histórica completa, igualdad de cada cifra renderizada entre módulos, experiencia móvil, exports completos, todos los roles, LTV/retención/delivery y ausencia de duplicados global. No hay base para declarar negocio sano o fuera de KPI. No se ha detectado que un benchmark demuestre un error de negocio.

Plan operativo: [DASHBOARD_CORRECTION_PLAN.md](DASHBOARD_CORRECTION_PLAN.md). Coordinación: [docs/ACTIVE_HANDOFF.md](docs/ACTIVE_HANDOFF.md), sección CODEX — DASHBOARD & METRIC AUDIT.

## Última revisión tras guardar la rama

### F24 — P2: funnel ilegible si la primera etapa vale cero (C,B)

Desktop y móvil muestran las barras como cápsulas estrechas con etiquetas ocultas, aunque etapas CRM posteriores tengan datos. `components/os/FunnelChart.tsx:anchos` toma la primera etapa usable incluso si es 0; al ser falsy devuelve ancho 1 para TODAS las etapas. La barra usa overflow-hidden y contiene el texto. Próximo AUTO_FIX: separar etiqueta/número de la anchura, definir geometría honesta con primera etapa cero y no atribuir caídas causales a poblaciones no enlazadas. Test con [0,0,null,120,50,20] y n=0 completo; revisar desktop/móvil/reduced-motion. No implementado.

### F25 — P2: fuente VSL falla en Funnels (C,B)

UI muestra HTTP 400, correctamente distinto de cero. `lib/funnels/queries.ts:countVslSessions` construye `not.<columna>=is.null`; el operador debe estar en el valor del filtro, no en el nombre de columna. Hipótesis de causa muy concreta por código, pendiente de reproducir respuesta REST sanitizada y verificar esquema/fechas antes de corregir. No afirmar fallo del tracking ni eliminar aviso. AUTO_FIX pequeño + test de URL y respuesta count, sin tocar sesiones reales.

**Responsive parcial:** Funnels y cabecera/filtros de unit-economics revisados a 390×844. Unit-economics no desborda documento (390/390); ocupa casi todo el primer viewport con filtros. No se verificó todavía el funnel inferior ni todas sus tablas en móvil. Viewport restaurado al finalizar. Resto de responsive sigue pendiente.

## Revisión transversal de términos y fórmulas — 28-sep

Petición: una misma métrica debe conservar significado y cálculo en toda la app, incluida IA, objetivos y exportaciones. Estado: inventario de contradicciones inspeccionado en código, **no cerrado ni certificado**. Base: `eb29384`. No se han cambiado importes ni registros de negocio.

### Contradicciones comprobadas

| KPI / superficie                         | Evidencia en código                                                                                                                                                                   | Resolución necesaria                                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Cash Collected, métricas globales        | `lib/canonical/cash.ts` consolida Stripe y libro interno, deduplica y resta devoluciones; Unit Economics usa `cash.net`                                                               | Mantener fuentes y deduplicación compartidas, con fecha del hecho y estado elegible explícitos                                             |
| Cash Collected, diagnóstico/IA/objetivos | `lib/metrics/agregados.ts` suma `gross_amount` de cobros confirmados; `lib/ai/metrics/registry.ts` describe solo collections; `lib/analytics.ts` objetivos suma collections collected | No renombrar sin migrar el contrato de fuentes, devoluciones y población autorizada. No sumar Stripe a objetivos personales sin atribución |
| Gestoría                                 | UI y CSV llaman «Facturación / Cash Collected» a suma de collections collected                                                                                                        | Separar facturación contratada de cobros brutos registrados; conservar P&L y conciliación                                                  |
| Alta de cobro                            | «Cash collected neto» muestra bruto menos fee                                                                                                                                         | Etiquetar importe tras comisión de pasarela; no es el Cash Collected de negocio (MONEY D4)                                                 |
| CAC                                      | Registro, IA y agregados dividen entre ventas; Unit Economics divide entre contactos únicos compradores del periodo                                                                   | Confirmar clientes nuevos vs compradores únicos. No llamar CAC al coste por venta; recompras y falta de historia deben quedar explícitas   |
| Cash ROAS                                | Registro exige cobro atribuible a anuncios; agregados divide todo cash entre gasto                                                                                                    | Exigir atribución o distinguir rendimiento global; no aplicar objetivos de ROAS atribuido al cociente global                               |
| Show Rate                                | Skill: asistidas/agendadas; registro: asistidas/no canceladas; agregados: asistidas/(asistidas+no-show)                                                                               | Distinguir tasa observada de cohortes maduras; alinear fórmula publicada y denominador real, mostrar cobertura                             |
| Pitch / Offer Rate                       | Registro: ofertas/asistidas; motor usa solo llamadas con oferta marcada                                                                                                               | Declarar denominador observado y cobertura; ausencia de marcado no es negativa                                                             |
| Close Rate                               | Skill marketing usa llamadas cualificadas; ventas usa live; registro distingue llamadas/ofertas                                                                                       | Mantener variantes con nombre y denominador explícitos, ventas y llamadas vinculadas de la misma población                                 |
| Documentación                            | `docs/METRICS.md` describe CAC histórico y Cash bruto interno; página ya tiene periodo y consolidación; MONEY y módulo cash añaden reglas distintas                                   | Actualizar desde contrato acordado y comportamiento probado, sin convertir documentación antigua en prueba de corrección                   |
| Términos secundarios                     | «Primer contacto» en resumen vs Speed to Lead; ayudas «Cash neto»; variantes de capitalización y ROAS sin base indicada                                                               | Unificar etiquetas después de comprobar semántica; no reemplazos globales de texto como «primer contacto» en atribución                    |

### Contrato de aceptación

- Reutilizar `lib/metrics/registro.ts` y `lib/metrics/definiciones.ts`; no crear otro diccionario paralelo.
- Cada KPI identifica unidad, numerador, denominador, fuente, fecha de corte, exclusiones, atribución, madurez y estado de completitud.
- Mismo KPI + misma población autorizada + mismo filtro = mismo valor en tarjeta, serie, exportación, objetivo e IA.
- Bruto, neto de devoluciones, neto de fees, neto de IVA y base comisionable no son intercambiables.
- Regresiones con cliente que recompra, reserva abierta, venta anterior cobrada hoy, devolución posterior, pago duplicado, fuente caída, cita futura y marcado incompleto.
- Ningún benchmark permite saltarse definición, fuente, completitud, periodo, madurez, asignación y cálculo.

### Siguiente paso

Usar SOURCE_OF_TRUTH, METRICS y MONEY existentes; la solicitud de redefinir CAC se retiró al localizar el contrato. Corregir helpers y registros contra ellos, migrar consumidores por familia y ejecutar pruebas de igualdad entre superficies y recorrido autenticado. Mantener visible que el trabajo global está pendiente; las correcciones de etiquetas de Unit Economics no lo sustituyen.

### Ajustes contra los contratos existentes (sin redefinir métricas)

La referencia omitida en el primer intento era `docs/SOURCE_OF_TRUTH.md`; su registro ejecutable es `lib/sources/registry.ts`. Se retiró ese intento sin publicar código. La propuesta de CAC por primeras compras queda descartada: `METRICS.md` §6 define contactos únicos con venta activa.

Implementado en el lote actual:

- Agregados de CAC cuentan contactos únicos; identidad incompleta devuelve ausencia explicada. Query solicita `contact_id`.
- Agregados y series reutilizan `isActiveSale`; las reservas abiertas quedan fuera de la serie igual que del total (MONEY D8).
- IA consulta SOURCE_REGISTRY para nombres, fuente y fórmula; CAC consulta el registro métrico alineado con METRICS §6.
- Cash canónico y serie descartan estados no liquidados de Stripe, sin suprimir cobros internos confirmados por una referencia a un intento pendiente.
- Nombres de caja consistentes; gestoría identifica libro interno bruto y el alta de cobro distingue importe tras fee.
- Cuatro regresiones de paridad: cliente repetido, reserva/devolución parcial, fuente IA compartida y pago pendiente.

Pendiente de resolución completa (no ocultar ni certificar): agregados/objetivos aún consumen libro interno frente a caja consolidada; denominadores de tasas publicados y cobertura; periodo histórico descrito en METRICS frente a filtros actuales. Los contratos de dinero abiertos no se eligen por cuenta del agente.
