# 06 — Calidad y gobierno de agentes

Cuándo cargarlo: S0, F2, F3, F4 y al abrir cualquier PR. Es la referencia de "cuándo algo está terminado".

## 1. Estrategia de testing

Pirámide: unit, domain, integración, base de datos y RLS, contrato, E2E, visual y evals de IA. Prioridad: aislamiento de tenant, dinero, identidad, atribución, webhooks, commands y métricas. No intentar E2E para absolutamente todo.

Regresión visual para pantallas críticas (Home, Funnel, Person 360, Sales, Finance, Ask, Integrations, Data Health): screenshots de referencia o estrategia equivalente, para que la IA no cambie spacing, layout, responsive, gráficos o estados sin que CI o la revisión lo detecten.

Tests de arquitectura que impidan: UI importando SDK externo, un provider escribiendo directamente en varios dominios, tabla tenant-scoped sin RLS, tool de IA accediendo a la base arbitrariamente, y métrica duplicada con fórmula distinta.

## 2. Quality gate

Antes de merge: format, lint, typecheck, knip, tests unitarios y de integración, tests de tenant, gitleaks y build (`npm run quality`). Según la fase se añaden tests de contrato, regresión visual, evals de IA y tests de migración. Nada se mergea porque "parece funcionar". El invariante de esquema debe correr en CI con credenciales y fallar cuando debe (comprobarlo).

## 3. Dependencias y repositorio

Antes de instalar una dependencia: ¿existe algo equivalente?, ¿está mantenida?, ¿qué tamaño añade?, ¿qué licencia tiene?, ¿introduce riesgo? Evitar paquetes para problemas triviales; actualizar periódicamente y vigilar vulnerabilidades. Verificar la licencia antes de incrustar código de otra app (posible AGPL en herramientas de formularios).

Estructura durable: apps/, packages/, docs/, scripts/, skills/. La IA debe encontrar rápido ARCHITECTURE.md, DATABASE.md, EVENTS.md, MONEY.md, METRICS.md, INTEGRATIONS.md, AI.md, SECURITY.md y CONVENTIONS.md. No permitir documentación duplicada y contradictoria.

## 4. Gobierno de agentes de coding

Claude Code y Codex siguen: MAP FIRST, SEARCH BEFORE READ, REUSE BEFORE CREATE, MINIMUM CHANGE, VERIFY, y actualizar conocimiento durable solo si es generalizable. Orden REUSE → EXTEND → EXTRACT → CREATE.

Skills iniciales: create-integration, create-metric, create-ai-tool, create-migration, security-review, architecture-review. Añadir create-command, create-dashboard, data-health o release-review solo cuando el workflow se haya repetido y esté probado. Los prompts por fase son temporales; las skills son procedimientos permanentes. No convertir todos los prompts en skills de golpe.

Scripts reutilizables (crear solo cuando el procedimiento esté probado y repetido; adaptar nombres al repo real): quality, test-tenant-isolation, test-rls, verify-migrations, verify-metric, integration-smoke-test, replay-events, check-data-health, check-architecture, release-check.

CLAUDE.md y AGENTS.md son mapas concisos; los procedimientos largos viven en skills, referencias y scripts; no se duplica la misma regla en varios ficheros. Si el usuario corrige algo, se modifica el lugar durable más pequeño: test, skill, script, rulebook o documento canónico, según la causa.

## 5. Definitions of Done

**Feature.** Lógica de dominio, autorización, aislamiento de tenant, base de datos, RLS si aplica, API o servidor, frontend con loading, empty y error, responsive, audit si aplica, analítica, observabilidad, tests y documentación. Checklist de PR.

**Integración.** Auth, disconnect y revoke, discovery, backfill, sync incremental, webhook cuando exista, paginación, rate limiting, idempotencia, mapeo externo, normalización, reconciliación, health, errores, aislamiento de tenant, tests y Data Health. Fixtures de payloads reales sanitizados y contract tests.

**Métrica.** Nombre, definición, grain, numerador, denominador, fuente de verdad, filtros, dimensiones, madurez, muestra mínima, lineage, confianza, tests, UI y compatibilidad con la tool de IA. UI, IA, exports y reportes devuelven el mismo resultado. Golden fixture con late events, refund, duplicado, borde de periodo, cohorte y madurez.

**Tool de IA.** Ver `04-ia-agente.md` §8.

## 6. Preguntas antes de construir una feature

¿Qué problema resuelve y para qué usuario? ¿De qué entidad canónica depende? ¿Existe un componente parecido? ¿De qué métrica depende? ¿Qué tenant scope, qué permiso, qué evento produce, qué audit necesita? ¿Cómo verificaremos que funciona y cómo sabremos si se usa? Si no hay respuesta clara, no implementar todavía.

## 7. Decision Register

Las decisiones importantes no se entierran en chats, PRs o prompts. `docs/decisions/` con ADRs ligeros (ADR-001-tenant-is-workspace, ADR-002-revenue-definition, ADR-003-show-source, ADR-004-event-correction-model…). Formato: Decision, Context, Options considered, Decision, Consequences, Date, Status (proposed, accepted, superseded). Especialmente para las decisiones pendientes del documento 00.

## 8. Revisión de arquitectura periódica

Cada 4 a 6 semanas, corta, sin features. Preguntas: qué conceptos duplicamos, qué módulo se salta los Domain Services, qué tablas nuevas no siguen el modelo, qué queries escapan del tenant scope, qué métricas tienen dos definiciones, qué integraciones crean arquitectura propia, qué código generado por IA degrada el repo, qué tecnología ya no necesitamos, qué flags pueden eliminarse, qué legacy podemos borrar. Salida pequeña: `ARCH_REVIEW_AAAA_MM.md` con KEEP, FIX NOW, BACKLOG o DELETE y evidencia.
