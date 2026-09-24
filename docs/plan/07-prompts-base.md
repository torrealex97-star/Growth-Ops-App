# 07 — Protocolo P0 y prompts base

Cuándo cargarlo: en toda sesión con un agente de coding. Junto con el prompt de la fase (docs 08 y 09).

Jerarquía: MASTER PLAN → PROMPT GLOBAL → PROMPT DE FASE O TAREA → PROMPT ESPECIALIZADO → SKILL O SCRIPT → CÓDIGO Y TESTS. Cada nivel aporta solo el contexto necesario. Nunca un prompt gigante para desarrollar toda la app. Si un prompt de fase entra en conflicto con P0, manda la regla más específica de la fase.

## P0 — Protocolo global de ejecución (heredado por todas las fases)

**1. Preflight selectivo.** Lee solo el prompt de la fase, las secciones citadas, el AGENTS.md o CLAUDE.md aplicable y la documentación autoritativa directamente relacionada. Empieza con `git status`, `git diff` y búsquedas dirigidas (rg, find) antes de abrir archivos grandes. Conserva los cambios existentes del usuario. Antes de crear tabla, servicio, helper, skill o script, busca una abstracción equivalente. Si la tarea dura varias ventanas de contexto, mantén `.agent/STATE.md` (objetivo, decisiones vigentes, archivos relevantes, completado, restante, verificaciones); compáctalo, no lo conviertas en diario.

**2. Scope y seguridad.** Trabaja solo el scope de la fase; la deuda no bloqueante se registra como follow-up. No apliques cambios destructivos, rotaciones de credenciales ni mutaciones de producción sin autorización explícita; prepara SQL o plan revisable. Nunca imprimas secretos; service-role, claves privadas y tokens solo server-side. Toda superficie tenant-scoped nueva demuestra allow y deny; no basta con que el frontend filtre.

**2A. Preservation Gate.** Antes de tocar una funcionalidad existente: (1) documenta el CURRENT WORKING BEHAVIOR; (2) identifica consumidores y tests; (3) añade cobertura de regresión si falta; (4) aplica el cambio mínimo; (5) verifica OLD BEHAVIOR = PASS y NEW BEHAVIOR = PASS; (6) verifica DATA CONSISTENCY, PERFORMANCE REGRESSION y TENANT ISOLATION cuando apliquen. Si OLD BEHAVIOR = FAIL, no hay merge.

**3. Cambios de datos.** EXPAND → BACKFILL → VERIFY → ENFORCE → CUTOVER → CLEANUP (detalle en `01-arquitectura-datos.md` §9).

**4. Evidencia.** Cada requisito se mapea a evidencia concreta (test, query, log, captura, diff o fichero). Prueba primero lo específico y barato; termina con `npm run quality` (o el script real del repo). No declares "verificado" algo que no ejecutaste: distingue PASS, FAIL, NOT RUN y BLOCKED. La observabilidad es parte del cambio. Antes de cerrar revisa el diff completo, código muerto, imports, migraciones, tipos generados, RLS, claves de cache y documentación afectada.

**5. Salida estándar.** Qué encontraste y reutilizaste; archivos y migraciones modificados; decisiones y por qué; pruebas con resultado; evidencia de los criterios de graduación; rollback o forward-fix; riesgos y follow-ups. Sin logs masivos: resume y enlaza rutas.

**6. Skills, scripts y contexto.** Carga solo la skill necesaria. Si existe un script determinista, ejecútalo. Si una corrección se repite y queda probada, actualiza la skill o script más pequeño que la haga durable.

## Prompt global de sesión

Estás trabajando en Growth Operator OS. Prioridades: 1) correctitud; 2) seguridad y aislamiento multi-tenant; 3) preservar fuentes de verdad; 4) reutilizar arquitectura probada; 5) cambios mínimos y reversibles; 6) evidencia; 7) eficiencia de contexto.

No empieces implementando: determina qué sección del plan aplica. Aplicación existente en producción: documenta el comportamiento actual, añade regresión, cambia lo mínimo, verifica OLD y NEW; prefiere IMPROVE sobre REPLACE, EXTEND sobre REWRITE, MIGRATE GRADUALLY sobre big-bang. Consulta SOURCE_OF_TRUTH.md, MONEY.md, METRICS.md, EVENTS.md y SECURITY.md antes de tocar datos o métricas. No confíes en tenant_id enviado por el cliente. La lógica vive en Domain Services (UI, IA, API o integración → Domain Service → Repository o Connector). No crees otro event system: raw_events = entrada, canonical_events = hechos, delivery_attempts = outbox. El LLM no calcula métricas. Antes de UI busca el design system. Verifica: test dirigido → dominio → tenant isolation → integración o contrato → typecheck y lint → build. Cierre: revisa el diff buscando duplicación, dead code, debugging, hardcodes por tenant, queries sin scope, cache sin tenant, métricas duplicadas, SDK desde UI y service-role inseguro.

## Prompt orquestador de fase

Ejecuta la fase [FASE]. No empieces a programar.

1. Lee solo P0, la fase, sus secciones citadas y la documentación autoritativa afectada.
2. Reconstruye el estado real: por requisito EXISTS, PARTIAL, MISSING, LEGACY o CONFLICT (código, base y tests son la evidencia).
3. Comprueba prerrequisitos: PASS, FAIL, BLOCKED o N/A. Detente solo ante un bloqueo irreversible.
4. Plan corto por cambio: problema, código reutilizado, archivos, impacto en DB, permisos y RLS, tests, rollback.
5. Implementa incrementalmente: inspect → change → verificación dirigida.
6. Convierte cada criterio de graduación en evidencia con PASS o FAIL.
7. Ejecuta el quality gate real.
8. Responde: PHASE, STATUS (COMPLETE, PARTIAL, BLOCKED), REUSED, CHANGED, MIGRATIONS, TESTS, GRADUATION, RISKS, NEXT. No continúes a la fase siguiente.

## Prompts especializados (resumen operativo)

**Nueva feature.** Check previo: PRODUCT (usuario, problema, prioridad P0 a P4), DOMAIN (entidad canónica, Domain Service, eventos, métricas, Money y atribución afectados), TENANCY (owner, actor, permiso, tests allow y deny), DATA (busca estructuras existentes), UI (ruta, filtros, loading, empty, error, responsive, accesibilidad), ANALYTICS (evento de uso y cómo diagnosticar), TESTS, DoD.

**Auditoría de frontend y UX.** Sin rediseñar arbitrariamente. Mapea rutas, layouts, navegación, filtros, tablas, gráficos, drawers y estados. Detecta enlaces muertos, botones sin función, selectores de fecha duplicados, KPIs que no respetan la query filtrada, 0 que significa dato ausente. Mide bundles, waterfalls y N+1 antes y después. Clasifica: Critical UX bug, Data consistency bug, Design inconsistency, Performance, Accessibility, Nice-to-have. Corrige bugs y consistencia antes de pulir.

**Nueva integración.** Revisa la documentación oficial vigente (auth, tokens, webhooks y firmas, paginación, límites, timestamps, sync incremental, backfill, acciones). Manifest con capabilities reales, sin stubs. Mapea objeto externo a entidad o evento canónico. Identidad por IDs externos; nunca email como PK. Ingesta: webhook verify → raw_events → ACK → normalize; sync cursor → fetch → raw → normalize. Health completo. Tests A/B de tenant. Fixtures sanitizados y contract tests. Termina al cumplir la DoD de integración.

**Nueva métrica.** No empieces por UI. Definición de negocio (key, nombre, significado, unidad, grain, numerador, denominador, dimensiones, filtros, higherIsBetter, maturity_window, min_sample). Fuente de verdad y, si es financiera, MONEY.md. Versionado: no reinterpretes el histórico. Cálculo determinista, nunca aritmética del LLM. Golden fixture. UI, IA, export y reporte dan el mismo resultado.

**Nueva tool de IA.** Ver `04-ia-agente.md`. La tool llama Domain Service o Semantic Layer; hereda actor, tenant y permisos; devuelve evidencia; el contenido recuperado no puede modificar política ni argumentos; evals de respuesta correcta, tenant equivocado, permiso denegado, dato ausente, inyección, no-tool y timeout.

**Nueva acción de IA.** A través del Command Engine, nunca lógica directa desde el LLM. Tipo y payload tipado, riesgo 0 a 3, permisos, preview con before y after, aprobación según política. Ejecución por Domain Service o capability de conector, idempotency key obligatoria, audit, compensación si es reversible. Tests: allow, deny, duplicado, retry, fallo parcial, tenant equivocado, aprobación ausente.

**Security review.** Intenta romper el aislamiento: IDOR entre tenants, RLS ausente, mal uso de service-role, SECURITY DEFINER, tenant_id confiado desde el cliente, fugas por cache, storage, búsqueda o export, suplantación o replay de webhooks, SSRF, secretos, PII en logs y escalada de privilegios de la IA. Crea Tenant A y B e intenta acceso cruzado por URL, API, RPC, ID directo, búsqueda, export y URL de storage. Clasifica Critical, High, Medium, Low; corrige Critical y High dentro del scope cuando sea seguro y aporta evidencia.

**Performance review.** Primero mide (waterfall, bundle, tiempos de servidor, queries, N+1, índices, cache, payload, hidratación, terceros). Registra baseline, optimiza los mayores costes y mide después. No sacrifiques funcionalidad por mejoras marginales.

**Data Health review.** Audita frescura, completitud, duplicados, relaciones ausentes, registros inválidos, ambigüedad de identidad, conflictos de fuente, eventos tardíos, jobs y webhooks fallidos. Cada issue: tipo, severidad, tenant, fuente, periodo, cantidad, fecha de detección y acción de reparación. No modifica datos en silencio.

**Architecture review.** Ver `06-calidad-gobierno.md` §8.

**Bug fix.** Reproduce; captura evidencia; causa raíz; owner de dominio; ¿está en una abstracción común?; corrige el lugar más pequeño correcto; regression test; verifica otro tenant o flujo; decide si la causa merece actualizar skill, docs o test de arquitectura. Sin refactor adicional.

**Continuar tras compactación.** Lee `.agent/STATE.md`, `git status` y `git diff`; después solo los archivos indicados. Clasifica DONE, IN PROGRESS, NOT STARTED o BROKEN y sigue desde el primer paso incompleto. No reescribas código validado. Antes de terminar ejecuta lo pendiente, revisa el diff y elimina o compacta STATE.md.

**Release readiness.** Sin nuevas features. Comprueba requisitos, migraciones y backfill, RLS, tenant isolation, permisos, flags, observabilidad y alertas, estados de error, Data Health, rendimiento, responsive, analítica, tests, quality gate, docs, rollback, configuración de producción, nombres de env, crons y webhooks. Resultado: READY, READY WITH KNOWN RISK o NOT READY con bloqueos concretos. No se despliega a producción sin autorización.
