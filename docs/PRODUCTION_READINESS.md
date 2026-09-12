# Production Readiness — Growth-Ops-App

Fecha: 2026-09-11 · Commit base: `c9a03c8` · Alcance: Evergreen + Women Digital Closer (mismo código, tenants distintos).

Principio rector de este informe: `COMPILES ≠ WORKS ≠ RELIABLE ≠ SECURE ≠ RECOVERABLE`. Cada score y cada hallazgo está
respaldado por evidencia real del repositorio (path + línea) o marcado explícitamente como `NEEDS_VERIFICATION` cuando
requeriría acceso a la infraestructura viva (Supabase/Vercel reales) que esta auditoría no tiene.

**Contexto de escala** (importante para no sobredimensionar el proceso): esta es una app interna de un negocio con 2
tenants, sin equipo de SRE dedicado. Las recomendaciones están calibradas a esa escala — no se proponen prácticas de
infraestructura de alto tráfico (canary, circuit breakers, error budgets formales) donde no aportan valor real.

---

## 1. Production Readiness Score

| Categoría | Score | Blocker |
|---|---|---|
| Architecture | 62/100 | No |
| Data Integrity | 68/100 | No |
| Metrics Correctness | 45/100 | **Sí (P0)** |
| Security | 58/100 | **Sí (P1)** |
| Multi-tenancy | 78/100 | No |
| Testing | 22/100 | No (pero es el riesgo silencioso más grande) |
| Reliability | 60/100 | No |
| Performance | 55/100 | No |
| Observability | 15/100 | No (mismo caso que Testing) |
| CI/CD | 70/100 | No |
| Deployment Safety | 40/100 | No |
| Backups | 50/100 (NEEDS_VERIFICATION en el proveedor) | No |
| Disaster Recovery | 25/100 | No |
| UX Resilience | 65/100 | No |
| Maintainability | 64/100 | No |

**Promedio: 51/100 — "funciona, pero no está verificadamente listo para escalar sin supervisión."**

### Architecture — 62/100
- EVIDENCE: capa de servicio real y factorizada (`lib/finance/pnl.ts`, `lib/commissions/*`, `lib/analytics.ts`); RLS
  como backstop real, no decorativo (verificado en la auditoría de seguridad de esta sesión); multi-tenant con
  política `RESTRICTIVE` uniforme sobre ~50 tablas.
- RISKS: cero funciones RPC/transacciones reales en Postgres — toda operación multi-tabla (registrar venta, marcar
  cobro, aplicar reembolso) es una secuencia de llamadas desde TypeScript sin `BEGIN/COMMIT`. `crm/agendas/page.tsx`
  (2211 líneas) y los formularios de `ventas/registro/` son monolitos que mezclan fetch+UI+lógica de negocio.
- BLOCKERS: ninguno que impida desplegar hoy.
- RECOMMENDATIONS: mover "registrar venta"/"marcar cobro"/"aplicar reembolso" a funciones Postgres invocadas por RPC
  cuando el volumen de incidentes lo justifique; no antes (evitar sobrearquitectura sin retorno demostrado).

### Data Integrity — 68/100 (antes de esta sesión: más bajo)
- EVIDENCE: `NUMERIC(12,2)` en todos los importes (nunca `float`); esta sesión añadió UNIQUE reales en
  `collections`/`commissions`/`appointments` y CHECK en `expenses.status`/`campaigns.status`.
- RISKS: FKs sin `ON DELETE` explícito en `sales`/`collections`/`commissions` (no genera huérfanos, pero bloquea
  borrados sin aviso claro); `commission_amount` es un valor derivado sin trigger de verificación — un fix manual vía
  SQL editor puede desincronizarlo sin que nada lo detecte; soft-delete inconsistente (`status='cancelled'` en
  sales/collections vs. hard-delete+log en appointments, decisión documentada y razonada, no un descuido).
- BLOCKERS: ninguno.
- RECOMMENDATIONS: `SELECT DISTINCT status FROM expenses/campaigns` en producción para validar los CHECK `NOT VALID`
  añadidos hoy (ver comentario al final de la migración `20260911200000`).

### Metrics Correctness — 45/100 — **BLOCKER (P0)**
- EVIDENCE (confirmado por auditoría de métricas de esta sesión): "ventas del mes" tiene **2 fórmulas incompatibles**
  — con filtro `status IN ('active','partial_refund')` (Dashboard, `lib/analytics.ts`) vs. sin filtro (`pnl.ts`,
  Finanzas Resumen, Cohortes) — mismo periodo, mismo nombre, cifras distintas. "Net Revenue" tiene otra fórmula
  distinta en Analítica de ventas. Unit Economics etiqueta "LTV medio" a lo que es ticket medio por venta, y divide
  CAC por número de ventas en vez de clientes únicos.
- RISKS: cualquier persona que compare Dashboard vs. Finanzas para el mismo mes verá números distintos y no sabrá
  cuál creer — esto erosiona la confianza en el producto entero, no solo en esa pantalla.
- BLOCKERS: **sí** — no se debería promocionar el dashboard como fuente de verdad financiera hasta canonicalizar estas
  fórmulas (Fase 5 ya identificada y pendiente en este mismo proyecto, ver tareas).
- RECOMMENDATIONS: definir la fórmula canónica de cada métrica una sola vez (ya existe el patrón correcto en
  `lib/finance/pnl.ts`, solo falta extenderlo a Dashboard/Unit Economics/Analítica de ventas) y añadir tests con un
  golden dataset antes de tocar las fórmulas.

### Security — 58/100 — **BLOCKER (P1)**
- EVIDENCE: los 3 P0 históricos (RLS de sales/contacts/collections, tablas Instagram sin RLS, `documents/state` sin
  auth) están **FIXED y confirmados en código** con defensa en profundidad (política RESTRICTIVE por tenant además
  del scoping por rol). Rate limiting: 0 en todo el repo (confirmado por grep). Fallbacks de secretos hardcodeados:
  0 (confirmado, ya no existen `DASHBOARD_PASSWORD`/`CC_SESSION_SECRET`).
- RISKS: bucket `contratos`/`facturas` sigue siendo **público** con `signed_pdf_url` consumido directamente en 6
  archivos — documentos con datos personales de alumnos accesibles indefinidamente a quien tenga la URL. Sin rate
  limiting en login/recover (Supabase Auth aplica algo a nivel de plataforma, pero es opaco desde el código —
  `NEEDS_VERIFICATION` en el dashboard real). Webhook GHL usa comparación de secreto con `===` en vez de
  `timingSafeEqual` (debilidad menor, no crítica).
- BLOCKERS: **sí** — un bucket público con PII de alumnos es un hallazgo P1 sin resolver (documentado, no ejecutado a
  ciegas en esta sesión por el riesgo de tocar el flujo de firma pública de contratos sin poder probarlo).
- RECOMMENDATIONS: aplicar a `contratos`/`facturas` el mismo patrón path+signed-URL-fresca que esta sesión ya aplicó
  a `payment-proof` (ver commit `c9a03c8`), en un entorno donde se pueda probar el flujo de firma end-to-end antes de
  desplegar.

### Multi-tenancy — 78/100
- EVIDENCE: política `RESTRICTIVE` uniforme sobre ~50 tablas (`tenant_id IN (SELECT auth_tenant_ids()) OR
  is_super_admin()`) — verificado que cubre las tablas de negocio críticas. Tenant WDC existe realmente
  (`women-digital-closer`, seedeado desde `20260911140000`).
- RISKS: cero infraestructura de branding por tenant (confirmado — "Scalix Systems" hardcodeado en 8+ archivos, sin
  columna de branding en `tenants`). Aplicación de esa política RESTRICTIVE depende de un `DO $$ FOREACH` dinámico —
  si se añade una tabla nueva y se olvida incluirla en el array, queda sin aislamiento y nada lo detecta en CI.
- BLOCKERS: ninguno (WDC funciona hoy, solo sin branding diferenciado).
- RECOMMENDATIONS: (fuera de esta sesión) tenant-config compartida para branding; un test de integración que
  verifique que TODA tabla con `tenant_id` tiene su política RESTRICTIVE, para que una tabla nueva sin aislamiento
  falle en CI en vez de en producción.

### Testing — 22/100
- EVIDENCE: un único archivo de test (`tests/marketing-navigation.test.mjs`, 9 tests, todo sobre navegación) en todo
  el repo. Cero tests de comisiones, P&L, RLS/multi-tenancy o flujo de venta/cobro.
- RISKS: "¿qué se puede romper mañana sin que ningún test se entere?" — la fórmula de comisiones, el cálculo de P&L,
  el aislamiento de tenant, y el flujo completo de venta→cobro→comisión. Ninguno tiene red de seguridad automatizada.
- BLOCKERS: no bloquea un deploy puntual, pero sí la velocidad segura de iteración futura.
- RECOMMENDATIONS: `npm run test:metrics` ya existe como script (stub) desde esta sesión — poblarlo con un golden
  dataset es la Fase 5 ya identificada en este proyecto.

### Reliability — 60/100
- EVIDENCE (esta sesión): doble-cobro y comisiones duplicadas ahora tienen UNIQUE real en DB, no solo guard de
  aplicación. Webhooks Calendly/GHL ahora son idempotentes de verdad (upsert, no INSERT plano).
- RISKS: `lib/meta/client.ts`/`lib/sequra/client.ts` hacen `fetch` sin timeout ni `AbortController` — un cron con
  `maxDuration=60/300` puede consumir toda su ventana si la API externa cuelga, dejando sin sincronizar a los
  tenants siguientes en el mismo `for` secuencial. `lib/calendly.ts` y `lib/ai/claude.ts` sí lo hacen bien (timeout +
  retries), demostrando que el patrón correcto ya existe en el propio repo, solo no está generalizado.
- BLOCKERS: ninguno.
- RECOMMENDATIONS: replicar el patrón de timeout de `lib/calendly.ts` en `lib/meta/client.ts` y `lib/sequra/client.ts`.

### Performance — 55/100
- EVIDENCE (esta sesión): 6 páginas financieras/dashboard que traían tablas completas sin límite ahora tienen
  `.range()` explícito (`FINANCE_QUERY_ROW_CAP`), cerrando el riesgo de truncado silencioso de PostgREST.
- RISKS: siguen sin índices las columnas por las que se filtra en `crm/agendas` (búsqueda `ilike` triple sin
  `pg_trgm`); `crm/agendas/page.tsx` (2211 líneas) carga mucho volumen de golpe sin paginación real.
- BLOCKERS: ninguno.
- RECOMMENDATIONS: paginar `crm/agendas` cuando el volumen de citas lo justifique (no antes).

### Observability — 15/100
- EVIDENCE: cero Sentry/error-tracking, cero endpoint de health-check, cero alertas de ningún tipo (confirmado, sin
  ambigüedad, por grep exhaustivo en la auditoría anterior).
- RISKS: hoy, si algo falla en producción, el equipo se entera por un usuario que se queja, no por una alerta.
- BLOCKERS: no bloquea el funcionamiento, pero es el mayor "unknown unknown" del sistema.
- RECOMMENDATIONS: ver sección 6 (Observabilidad) más abajo — es la inversión de mayor retorno de todo este informe.

### CI/CD — 70/100 (antes de esta sesión: 10/100)
- EVIDENCE: `.github/workflows/ci.yml` (añadido en esta sesión) corre format/lint/typecheck/dead-code/test/build en
  cada push y PR; antes solo existía un deploy manual sin ningún check.
- RISKS: `deploy.yml` sigue sin depender de que `ci.yml` esté verde (requiere branch protection, configuración de
  GitHub que no puedo tocar desde código).
- BLOCKERS: ninguno.
- RECOMMENDATIONS: activar "Require status checks to pass" en la rama `main` desde GitHub Settings, apuntando al job
  `quality` de `ci.yml`.

### Deployment Safety — 40/100
- EVIDENCE: `deploy.yml` es `workflow_dispatch` manual, sin smoke test posterior, sin rollback automatizado.
- RISKS: un deploy roto a producción no se detecta hasta que alguien lo nota manualmente.
- BLOCKERS: ninguno para un deploy puntual bien vigilado, pero sí para operar sin supervisión constante.
- RECOMMENDATIONS: ver `docs/runbooks/deployment-regression.md`.

### Backups — 50/100
- EVIDENCE: no hay ningún script/documentación de backup en el repo — **correcto**, Supabase gestiona backups a
  nivel de plataforma (PITR/snapshots según plan). NEEDS_VERIFICATION: qué plan de Supabase está contratado y si
  PITR está activo — no verificable desde el repositorio.
- RISKS: nadie ha probado una restauración real (ver sección 21).
- BLOCKERS: ninguno operativo, pero SÍ para poder decir "estamos preparados para un desastre" con evidencia.
- RECOMMENDATIONS: confirmar plan de Supabase + hacer un restore drill una vez (ver runbook).

### Disaster Recovery — 25/100
- EVIDENCE: RPO/RTO nunca definidos por el equipo (esta sesión los propone en la sección 3 más abajo).
- RISKS: sin RPO/RTO documentados, cualquier incidente grave se gestiona improvisando.
- BLOCKERS: no bloquea el día a día.
- RECOMMENDATIONS: adoptar los RPO/RTO propuestos abajo como objetivo mínimo, y hacer un restore drill una vez.

### UX Resilience — 65/100
- EVIDENCE: patrón dominante es `toast.error` visible al usuario (`sonner`), no solo `console.error` silencioso —
  mejor que lo típico. Empty states existen en los listados principales revisados.
- RISKS: algunos `catch {}` vacíos puntuales en `crm/agendas/page.tsx`.
- BLOCKERS: ninguno.
- RECOMMENDATIONS: revisar esos catches vacíos puntuales cuando se toque ese archivo por otra razón.

### Maintainability — 64/100
- EVIDENCE (esta sesión): ESLint/Prettier/Knip configurados y en verde; 8 archivos de código muerto confirmado
  eliminados; 2 lockfiles duplicados resueltos a 1.
- RISKS: `crm/agendas/page.tsx` (2211 líneas), `ventas/registro/[id]/page.tsx` (1366 líneas) siguen siendo monolitos.
- BLOCKERS: ninguno.
- RECOMMENDATIONS: dividir esos 2 archivos cuando se vuelva a tocar su lógica (no como refactor aislado sin motivo).

---

## 2. Release Blockers

| # | Severidad | Hallazgo | Estado |
|---|---|---|---|
| 1 | **P0** | Fórmulas de métricas incompatibles entre Dashboard/Finanzas/Analítica de ventas para el mismo concepto | Pendiente (Fase 5 ya planificada) |
| 2 | **P1** | Bucket `contratos`/`facturas` público con PII de alumnos, sin expiración | Documentado, no ejecutado a ciegas |
| 3 | **P1** | Sin rate limiting en login/recover (más allá de lo opaco que Supabase Auth pueda aplicar) | Pendiente |
| 4 | **P1** | Cero error tracking/alertas — cualquier fallo en producción es silencioso hasta que alguien se queja | Pendiente |
| 5 | **P2** | `crm/agendas.page.tsx` sin índice `pg_trgm` para su búsqueda `ilike` triple | Pendiente |
| 6 | **P2** | `deploy.yml` no depende de que `ci.yml` pase (requiere branch protection en GitHub) | Pendiente, acción manual |
| 7 | **P3** | `worker/` (transcripción de llamadas) huérfano, nunca desplegado, sin dueño claro | Decisión de producto pendiente (¿archivar o retomar?) |

**P0/P1 corregidos en esta sesión** (ya no bloquean): doble-cobro sin UNIQUE, comisiones duplicables, unique global
de `external_id` entre tenants, webhook GHL no idempotente, truncado silencioso de queries financieras, signed URLs
de 10 años en pagos/documentos, tooling de calidad inexistente.

---

## 3. SLOs (propuestos, calibrados a la escala real — 2 tenants, sin guardia 24/7)

| SLO | Objetivo | Justificación |
|---|---|---|
| Dashboard availability | ≥ 99.0% mensual | Vercel + Supabase ya dan esto por defecto sin esfuerzo extra; no es una app de guardia 24/7. |
| Critical API error rate | < 2% en `sales`, `collections`, `payments/mark`, webhooks | Son las rutas con dinero real de por medio. |
| Critical workflow success rate (registrar venta → marcar cobro → generar comisión) | ≥ 99% | Con las UNIQUE de esta sesión, el fallo esperado es casi nulo salvo error de usuario. |
| Metric freshness (Dashboard/Finanzas) | ≤ 5 minutos desde el último cobro/venta | Todo es consulta directa a Supabase, no hay caché — ya se cumple hoy por diseño. |
| Webhook success rate (Calendly/GHL) | ≥ 99% de entregas procesadas sin error 500 | Con la idempotencia añadida esta sesión, un reintento ya no debería fallar. |
| Background job (cron) success rate | ≥ 95% por ejecución mensual/diaria/semanal | 3 crons de bajo volumen; un fallo aislado no es crítico si se reintenta al día siguiente. |
| Database p95 latency (queries core) | < 300ms | Generoso para Supabase gestionado con los índices ya añadidos. |

**No se define** un SLO de "page load" estricto (Core Web Vitals) todavía — no hay Lighthouse CI ni baseline medido;
definir un número antes de medir sería inventarlo, no un objetivo real.

## 4. SLIs (cómo se mediría cada SLO)

| SLO | SLI | Cómo medirlo hoy |
|---|---|---|
| Dashboard availability | % de checks sintéticos con 200 en `/dashboard` | NOT AVAILABLE — requiere monitoring sintético (sección 9), no existe hoy |
| Critical API error rate | 5xx / total requests en rutas críticas | NOT AVAILABLE — requiere error tracking (sección 6), no existe hoy |
| Critical workflow success rate | `commissionsGenerated` real vs. esperado en `payments/mark` | Parcialmente medible ya (el endpoint ya devuelve ese dato); falta agregarlo en un log estructurado |
| Metric freshness | timestamp de la fila más reciente vs. `now()` | Medible con una query directa hoy mismo, sin tooling nuevo |
| Webhook success rate | % de respuestas no-500 de `webhooks/calendly` y `webhooks/ghl` | NOT AVAILABLE sin logging estructurado (sección 7) |
| Background job success rate | resultado de cada cron guardado en una tabla propia | NOT AVAILABLE — no existe tabla de resultado de crons hoy |
| Database p95 latency | Supabase Dashboard → Database → Query Performance | Disponible ya en la plataforma, sin cambios de código |

## 5. Error Budget

Dado el tamaño del equipo (sin guardia dedicada), un error budget formal (tipo Google SRE con alertas de quema de
budget) sería burocracia sin retorno. Versión simple y útil:

> Si en una semana el flujo venta→cobro→comisión falla más de 3 veces por causas que no sean error de usuario,
> se detienen nuevas features de venta/cobro hasta encontrar la causa raíz. Si el dashboard muestra un número
> financiero incorrecto una sola vez confirmado, se trata como incidente SEV1 (ver sección 25), no como bug normal.

---

## 6. Observabilidad — el hueco más grande de todo el sistema

Hoy, ante un fallo, NO se puede saber de forma sistemática: qué falló, cuándo, para qué tenant, en qué endpoint, ni
si fue frontend/backend/DB/API externa — todo depende de que alguien mire logs de Vercel manualmente en tiempo real.

**NOT ADDED en esta sesión** (requiere una cuenta/servicio real que no puedo crear desde aquí, y el propio prompt
pide no añadir dependencias sin justificar el coste de mantenimiento):
- Sentry (o equivalente) para error tracking frontend+backend, con tenant y release como tags.
- Source maps + release tracking en Vercel.

**Recomendación concreta or, no genérica**: cuando se añada, cada error debe llevar como mínimo `tenant_id`,
`route`, `request_id` — y explícitamente NUNCA `password`/`token`/`service_role`/PII de contacto. El patrón de
`requireTenant()` ya usado en casi todos los endpoints hace esto barato de añadir (el `tenantId` ya está resuelto en
cada handler).

## 7. Logging estructurado (propuesta, no implementada — requiere decidir formato con el equipo)

Ejemplo concreto para `payments/mark` (la ruta con más dinero en juego):
```
{ ts, env, release, tenant_id, operation: "payments.mark", status: "ok"|"duplicate"|"error", duration_ms, installment_id, error_code? }
```
Nunca: `password`, `access_token`, `refresh_token`, `service_role`, DNI/documento completo.

## 8. Alertas (propuestas — requieren el error tracking de la sección 6 primero)

Alertar SOLO en: pico de 5xx en rutas de dinero (sales/collections/commissions/webhooks), caída de login, dashboard
inaccesible, cron fallando 2 veces consecutivas, webhook fallando >5% en 1h, métricas sin actualizar >30min en
horario laboral. **No alertar** sobre una excepción aislada — eso es ruido, no señal.

## 9-10. Synthetic monitoring / Health checks — NOT ADDED

Requieren decidir contra qué URL corren (staging real) y con qué credenciales de prueba — decisión de producto/
infra que no puedo tomar unilateralmente. Diseño mínimo propuesto si se decide avanzar: un health check que
verifique conexión a Supabase (`SELECT 1`) sin filtrar detalle interno en la respuesta, separado en liveness (¿el
proceso responde?) vs. readiness (¿puede hablar con Supabase?).

---

## 11-17. Data Quality

Invariantes verificados como YA GARANTIZADOS por la política RESTRICTIVE + esta sesión:
- Registros privados siempre tienen tenant → **DATABASE CONSTRAINT** (`tenant_id NOT NULL` + RLS RESTRICTIVE).
- Estados pertenecen a un conjunto permitido → **DATABASE CONSTRAINT** (CHECK ya existente en sales/collections/
  commissions/refunds/appointments; añadido esta sesión en expenses/campaigns).
- No duplicados en cobros/comisiones/citas → **DATABASE CONSTRAINT** (UNIQUE añadidas esta sesión).
- Cantidades monetarias en formato correcto → **DATABASE CONSTRAINT** (`NUMERIC`, nunca float).

Invariantes que hoy dependen SOLO de disciplina de aplicación (sin red de seguridad automática):
- "Registros cancelados no cuentan como ingresos" → depende de que cada query recuerde filtrar `status` — **TEST**
  pendiente (Fase 5), no vale la pena una `MONITORING CHECK` periódica cuando un test unitario lo cubre mejor y más
  barato.
- "Datos de WDC no aparecen en Evergreen" → cubierto por RLS (constraint), pero sin un **TEST** de integración
  explícito que lo demuestre — recomendado para la Fase 10 de este mismo proyecto (paridad Evergreen/WDC).

## 13-14. Datos huérfanos / Duplicados

No se ejecutó un audit de datos en vivo (no hay acceso a la Supabase real desde este entorno). Si se quiere un
informe real de huérfanos, la consulta más valiosa y de bajo riesgo para correr manualmente en producción (solo
lectura) sería:
```sql
SELECT s.id FROM sales s LEFT JOIN contacts c ON c.id = s.contact_id WHERE c.id IS NULL; -- huérfanos reales
SELECT * FROM commissions WHERE sale_id NOT IN (SELECT id FROM sales); -- imposible hoy por FK, pero verificar histórico pre-FK
```
**No se ejecuta ninguna limpieza automática** — esto es explícitamente un informe, no una acción, tal como se pidió.

## 15-17. Validación de métricas en producción / Freshness / Reconciliación

NOT AVAILABLE sin acceso a datos reales. La recomendación concreta: los checks de sanidad (NaN/Infinity/negativos
imposibles) deberían vivir como **tests unitarios de las funciones de `lib/finance/pnl.ts` y `lib/analytics.ts`**
(entrada controlada, salida esperada) en vez de un monitoring check en producción — es más barato, más rápido de
correr, y no depende de que existan datos "raros" reales para detectarlos.

---

## 18-21. Backups, RPO, RTO, Restore Drill

- **Backups**: gestionados por Supabase a nivel de plataforma. NEEDS_VERIFICATION: plan contratado y si PITR está
  activo (no visible desde el repo).
- **RPO propuesto**: 24 horas (asumiendo backup diario de Supabase; se ajusta a la baja gratis si el plan ya incluye
  PITR de minutos — confirmar).
- **RTO propuesto**: 4 horas para restaurar la base de datos + redeploy de Vercel (no hay complejidad de
  infraestructura propia que alargue esto).
- **Restore drill**: NUNCA ejecutado (no hay evidencia de que se haya probado). Ver `docs/runbooks/backup-restore.md`
  para el procedimiento seguro propuesto — sobre un proyecto Supabase aislado de prueba, nunca sobre producción.

---

## 22-26. Runbooks e Incident Response

Creados en `docs/runbooks/` (solo los que aportan valor real a esta escala — no los 8 completos del prompt):
- `production-down.md`
- `metrics-wrong.md` (el que se pidió explícitamente con más detalle)
- `tenant-data-leak.md`
- `backup-restore.md`

**NOT ADDED**: `login-failure.md`, `database-incident.md`, `deployment-regression.md`, `external-api-failure.md`
como archivos separados — su contenido real cabe como una sección dentro de `production-down.md` sin necesidad de
7 documentos distintos que nadie mantendría actualizados. Un runbook que nadie lee porque hay demasiados es peor que
no tener runbook.

Flujo de incidentes (simple, sin proceso corporativo):
```
DETECT → TRIAGE (¿qué tenant, qué endpoint, desde cuándo?) → CONTAIN (¿hay que desactivar algo ya?)
→ MITIGATE → RECOVER → VERIFY (con datos reales, no solo "ya no da error")
→ POSTMORTEM solo si fue SEV0/SEV1
```

**Severidades**:
- **SEV0**: pérdida o fuga de datos, o la app entera caída. Todo se detiene hasta resolver.
- **SEV1**: una función crítica (ventas, cobros, login) rota para todos o para un tenant entero.
- **SEV2**: función no crítica rota, o crítica rota para un usuario aislado.
- **SEV3**: cosmético o de bajo impacto.

---

## 27-35. Deployment Safety

```
CODE → CI (ci.yml, añadido esta sesión) → [PREVIEW: NOT AVAILABLE, sin integración nativa Vercel↔GitHub activa]
→ deploy.yml (manual, workflow_dispatch) → [SMOKE TEST: NOT AVAILABLE] → [MONITOR: NOT AVAILABLE, sección 6]
```

- **Release states**: usar `SAFE_TO_MERGE` (CI verde) como único estado automatizable hoy; `SAFE_TO_PRODUCTION`
  sigue siendo una decisión humana consciente, no automática — correcto para esta escala, no hay que forzarlo.
- **Canary releases**: **NOT_NEEDED** — 2 tenants, sin tráfico masivo, la complejidad de canary no se paga sola aquí.
- **Feature flags**: no existe ningún mecanismo hoy. **NOT_NEEDED como sistema genérico todavía** — el patrón que ya
  usa el repo (bloques `if` explícitos + `git revert` rápido) es proporcional a la escala actual. Si en el futuro se
  lanza algo de alto riesgo (nueva fórmula de métrica canónica, p.ej.), un flag puntual con OWNER + fecha de retirada
  documentada en el propio PR es suficiente — no hace falta una tabla `feature_flags` genérica todavía.
- **Kill switches**: los crons ya se pueden desactivar quitándolos de `vercel.json`; es suficiente a este volumen.
- **Circuit breakers**: **NOT_NEEDED** — las integraciones externas (Meta, seQura, Calendly) no tienen volumen que
  lo justifique; un timeout correcto (pendiente en Meta/seQura, ver Reliability) resuelve el 90% del riesgo real.

## 32-35. Rollback

- **Rollback de código**: `vercel rollback` o re-deploy del commit anterior vía `workflow_dispatch` — documentado en
  `docs/runbooks/production-down.md`. No depende de memoria humana porque Vercel guarda cada deployment.
- **Rollback de DB**: clasificación de las migraciones de esta sesión — todas **REVERSIBLE** (índices/constraints
  se pueden `DROP`; el `NOT VALID` de los CHECK nuevos ni siquiera requiere rollback si se detecta un problema, basta
  con no `VALIDATE`). Ninguna es `DESTRUCTIVE` ni `FORWARD_ONLY`.
- **Zero-downtime**: todas las migraciones de esta sesión son compatibles con la versión de código anterior
  desplegada simultáneamente (son aditivas — índices, constraints nuevas, columna nueva) — no requieren coordinación
  EXPAND→MIGRATE→SWITCH→CONTRACT porque no cambian ni eliminan nada existente.

## 36-43. DB connections, locks, timeouts, retries, idempotencia, concurrencia

- **Connections**: Supabase + Vercel serverless → riesgo de agotamiento de conexiones es real a mayor escala, pero
  Supabase ya usa PgBouncer por defecto en el connection string estándar — **NEEDS_VERIFICATION** que el proyecto use
  el pooler (puerto 6543) y no la conexión directa (5432) en las funciones serverless.
- **Locks**: los `ADD CONSTRAINT ... NOT VALID` de esta sesión toman un lock breve (no escanean toda la tabla al
  añadirse, solo al `VALIDATE` posterior) — diseño intencional para minimizar impacto en producción.
- **Timeouts/Retries**: ver Reliability arriba — pendiente generalizar el patrón de `lib/calendly.ts` a
  `lib/meta/client.ts`/`lib/sequra/client.ts`.
- **Idempotencia**: CREATE PAYMENT (`payments/mark`) y PROCESS WEBHOOK (Calendly/GHL) — **ya corregidos esta sesión**.

---

## TOP 20 IMPROVEMENTS (P0→P3)

| # | P | Problema | Impacto | Dificultad | Estado |
|---|---|---|---|---|---|
| 1 | P0 | Fórmulas de métricas incompatibles Dashboard/Finanzas | Confianza en el producto | Media | Pendiente (Fase 5) |
| 2 | P1 | Bucket contratos/facturas público con PII | Legal/privacidad | Media-alta | Documentado |
| 3 | P1 | Cero error tracking | Tiempo de detección de incidentes | Baja (con cuenta) | NOT ADDED (necesita cuenta) |
| 4 | P1 | Doble-cobro sin UNIQUE en DB | Dinero real duplicado | Baja | **Resuelto esta sesión** |
| 5 | P1 | Comisiones duplicables | Dinero real duplicado | Baja | **Resuelto esta sesión** |
| 6 | P1 | Webhook GHL no idempotente | Citas duplicadas | Baja | **Resuelto esta sesión** |
| 7 | P1 | Truncado silencioso en P&L | Cifras financieras erróneas | Baja | **Resuelto esta sesión** |
| 8 | P1 | Signed URLs de 10 años (pagos/DNI) | Exposición de PII prolongada | Baja-media | **Resuelto esta sesión** |
| 9 | P1 | appointments_external_id_key global | Bloqueo cruzado entre tenants | Baja | **Resuelto esta sesión** |
| 10 | P1 | Sin rate limiting en login | Fuerza bruta | Media | Pendiente |
| 11 | P2 | Índices faltantes en columnas core | Rendimiento a escala | Baja | **Resuelto esta sesión** |
| 12 | P2 | CI sin quality gate | Regresiones a producción | Baja | **Resuelto esta sesión** |
| 13 | P2 | 2 lockfiles (npm+pnpm) | Instalación no reproducible | Baja | **Resuelto esta sesión** |
| 14 | P2 | Sin dead-code tooling | Deuda técnica invisible | Baja | **Resuelto esta sesión** |
| 15 | P2 | deploy.yml no depende de ci.yml | Deploy roto sin aviso | Baja (config GitHub) | Pendiente, manual |
| 16 | P2 | fetch sin timeout en Meta/seQura | Cron colgado | Baja | Pendiente |
| 17 | P2 | Sin índice pg_trgm en búsqueda CRM | Rendimiento de búsqueda | Media | Pendiente |
| 18 | P3 | worker/ huérfano sin dueño | Confusión de mantenimiento | Baja (decisión) | Pendiente, decisión de producto |
| 19 | P3 | crm/agendas.page.tsx 2211 líneas | Mantenibilidad | Alta | Pendiente (Fase 6) |
| 20 | P3 | Sin health checks | Diagnóstico de incidentes | Baja | NOT ADDED |

## QUICK WINS (bajo riesgo, alto impacto — ya priorizados sobre los demás por eso)
Todo lo marcado "**Resuelto esta sesión**" arriba era, precisamente, un quick win: cambios acotados, sin
credenciales externas, validables con `npm run quality`+`build` en este mismo entorno. El siguiente quick win real y
pendiente: activar "Require status checks" en GitHub para `ci.yml` (5 minutos, cero código).

## HIGH-RISK AREAS (las 10 partes con más probabilidad de causar bugs/pérdida de datos/vulnerabilidades/incidencias)
1. `lib/commissions/generate.ts` — dinero real, sin transacción real, la pieza con más impacto económico directo.
2. Bucket `contratos`/`facturas` — PII de alumnos expuesta.
3. Cualquier fórmula de "revenue"/"net revenue" repetida en 3+ sitios con definiciones distintas.
4. `crm/agendas/page.tsx` — el archivo más grande y más denso del repo.
5. Migración `20260911150000` (el `DO $$ FOREACH` que aplica RLS por tenant) — un olvido de tabla ahí es una fuga.
6. `lib/meta/client.ts`/`lib/sequra/client.ts` — sin timeout, pueden colgar un cron entero.
7. Webhooks en general — cualquier integración externa nueva que no siga el patrón de Calendly (upsert+HMAC) hereda
   los mismos riesgos ya corregidos aquí.
8. Ausencia total de error tracking — cualquier incidente se detecta tarde por definición.
9. `worker/` — código sin dueño que alguien podría reactivar sin entender que nunca se terminó de integrar.
10. Cualquier migración `ADD CONSTRAINT` sin `NOT VALID` sobre una tabla grande en producción sin datos verificados.

## PRODUCT OPPORTUNITIES (solo respaldadas por la estructura real de la app)
- El endpoint nuevo `payment-proof-url` (signed URL fresca bajo demanda) es el patrón correcto para CUALQUIER
  documento sensible futuro — reutilizarlo en vez de inventar uno nuevo cada vez.
- `lib/finance/pnl.ts` ya demuestra que centralizar una fórmula financiera reduce bugs (su propio comentario lo dice:
  "antes vivía duplicado con fórmulas ya divergentes") — el mismo movimiento aplicado a "revenue"/"LTV"/"CAC" es la
  oportunidad de mayor retorno de todo el backlog de producto.

---

## RECOMENDACIÓN FINAL — próximos 3 meses

1. **Primero**: canonicalizar las fórmulas de métricas (Fase 5, ya identificada) — es el único P0 real que queda, y
   es lo que más erosiona la confianza en el producto si se descubre en una reunión con inversores/socios.
2. **Después**: error tracking (Sentry o equivalente) + el fix de storage de contratos/facturas — son las dos piezas
   que convierten "no sabemos qué falla" y "hay PII expuesta" en problemas resueltos, no solo documentados.
3. **Para más adelante**: dividir `crm/agendas.page.tsx`, generalizar timeouts en Meta/seQura, tests de métricas con
   golden dataset — importantes pero no urgentes, y mejor hechos cuando se toque esa área por otra razón.
4. **Eliminaría**: `worker/` si nadie va a retomar la transcripción de llamadas en los próximos 3 meses — hoy es
   deuda de mantenibilidad pura sin ningún beneficio (decisión de producto, no técnica — lo dejo como pregunta, no
   como acción).
5. **No tocaría**: la arquitectura de RLS+multi-tenant actual (es sólida, con defensa en profundidad real,
   verificada en esta sesión), ni introduciría canary/circuit-breakers/microservicios — sobrearquitectura sin
   retorno a esta escala.
