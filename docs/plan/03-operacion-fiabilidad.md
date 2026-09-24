# 03 — Operación y fiabilidad

Cuándo cargarlo: A0, F-1, F1, F2, F6, F8 y cualquier tarea de infraestructura, entornos, jobs, integraciones o Data Health.

La aplicación no se considera terminada porque funcione en desarrollo: debe operar meses con datos reales, varias integraciones y errores parciales sin intervención manual constante.

## 1. Observabilidad

Todo flujo importante se diagnostica sin abrir la base de datos.

| Área          | Debe permitir conocer                                         |
| ------------- | ------------------------------------------------------------- |
| Frontend      | errores JS, crashes, Web Vitals, navegación lenta             |
| Backend       | errores por endpoint, latencia, timeouts                      |
| Integraciones | última sync, duración, filas importadas, errores, rate limits |
| Webhooks      | recibidos, procesados, duplicados, fallidos, replays          |
| Jobs          | pendientes, en ejecución, fallidos, retrasados                |
| Base de datos | queries lentas, locks, crecimiento, conexiones                |
| IA            | modelo, latencia, tokens, coste, tool calls, errores          |
| Commands      | propuesto, aprobado, ejecutado, fallido                       |
| Email         | enviado, entregado, bounce, error                             |
| Data Quality  | identidades ausentes, atribución ausente, datos obsoletos     |

Logs estructurados con: request_id, correlation_id, organization_id, tenant_id, actor_id, integration_id, job_id, command_id, event_id, severity y timestamp. Nunca secretos ni PII innecesaria. Existe Sentry.

## 2. SLOs iniciales

Lecturas normales p95 < 1,5 s; dashboards agregados p95 < 3 s; cambio de tenant sin mostrar datos del tenant anterior; ACK de webhook < 2 s; procesamiento de webhook < 60 s; frescura de sync crítica < 15 min cuando el proveedor lo permita; jobs fallidos con alerta automática; regresión significativa de errores de frontend con alerta. Disponibilidad de la aplicación principal: 99 % mensual (unas 7 horas de margen al mes). No se sube a 99,9 % (unos 43 minutos) hasta que existan alertas de caída y una persona de guardia; con Vercel Hobby, crons en GitHub Actions y una sola persona, ese objetivo sería incumplible. El SLO de disponibilidad solo se mide desde que existan alertas. Los SLO pueden cambiar con datos reales, pero deben existir.

## 3. Backups y recuperación

Documentar qué se copia, cada cuánto, cuánto se conserva, quién puede restaurar y dónde se guardan. Cobertura: Postgres, Storage, configuración crítica, templates y metadata de integraciones. Los secretos tienen su propio mecanismo de recuperación.

Un backup nunca restaurado no es un backup comprobado: backup → entorno temporal → restore → checks → validar datos → destruir entorno, periódicamente. Objetivo inicial RPO ≤ 24 h y RTO ≤ 4 h; mejorar solo si el negocio lo justifica.

## 4. Entornos y releases

LOCAL, STAGING y PRODUCTION separados de forma inequívoca: proyecto Supabase, credenciales, webhooks, URLs, storage, cron/jobs, configuración de IA y callbacks de integraciones. Nunca datos reales de clientes indiscriminados en local o staging.

Flujo: branch → PR → CI → preview → staging → verificación → main → producción. No aplicar en producción cambios manuales que no existan después en código o migraciones (la deriva actual entre historial de Supabase y repo es un incumplimiento de esto).

## 5. Migraciones y feature flags

Patrón EXPAND → BACKFILL → VERIFY → ENFORCE → CUTOVER → CLEANUP (ver `01-arquitectura-datos.md` §9).

Feature flags: una capa sencilla (feature, enabled, tenant_id u organization_id, rollout, configuración) con alcance interno, tenant específico, grupo pequeño o todos. Útil para nuevas integraciones, acciones de IA, métricas nuevas, tracking, betas y rediseños. No construir una plataforma compleja si una tabla resuelve la necesidad.

## 6. Lifecycle de tenant

Estados: provisioning, active, suspended, archived, deleting, deleted. Provisioning configura settings, roles, permisos, defaults de métricas, funnels, email, flags, rutas de storage y contexto de audit, sin copiar datos de otro tenant. Suspensión impide acciones y jobs que no deban continuar. Archivado no elimina de inmediato. Eliminación sigue un procedimiento controlado conforme a privacidad y retención. Existen `lib/tenants/provision.ts` y `blueprint.ts` (no revisados en detalle).

## 7. Lifecycle de integración

Estados: not_configured, connecting, connected, degraded, reauth_required, rate_limited, error, disabled. Cada integración responde: si funciona, cuándo sincronizó, cuánto trajo, si hay backlog, si el token expira, qué error existe y si puede repararse.

## 8. Data Health como producto central

Sección de primera clase. Detecta: integraciones stale, webhooks fallidos, jobs atrasados, identity matches ambiguos, pagos o citas sin contacto, contactos duplicados, UTMs, source o campaña ausentes, eventos inválidos, métricas sin datos suficientes y diferencias entre fuentes. La IA consulta Data Health antes de emitir conclusiones fuertes ("el close rate parece haber bajado un 18 %, pero faltan datos de GHL desde hace 7 horas").

Cada issue: issue_type, severity, tenant, source, affected_period, affected_count, detected_at, repair_action. Data Health no modifica datos en silencio; las reparaciones pasan por jobs o commands auditables.

Diagnóstico por dato: de dónde vino, cuándo llegó, qué integración lo creó, qué evento lo produjo, qué normalizer lo procesó y qué fuente de verdad ganó. Herramientas internas: replay de webhook, retry de sync, recalcular métrica, inspeccionar lineage, identidad y evento.

## 9. Runbooks e incidentes

Runbooks ejecutables por alguien que no escribió la feature: GHL no sincroniza, fallo del webhook de Stripe, token de Meta expirado, fallo del proveedor de IA, migración fallida, backlog de cola, fallo de entrega de email, sospecha de fuga entre tenants, secreto filtrado, caída de producción, restauración de backup.

Severidad: SEV1 fuga entre tenants, pérdida grave o caída total; SEV2 módulo crítico roto; SEV3 degradación parcial o de integración; SEV4 bug menor. Todo SEV1 y SEV2 genera un postmortem breve: qué ocurrió, impacto, causa, detección, corrección, prevención.

## 10. Coste, rendimiento y escala

Coste por tenant: base de datos, storage, ancho de banda, tokens de IA, embeddings, transcripción, emails, jobs y APIs de terceros. No hace falta facturarlo todavía, pero antes de productizar hay que conocer coste por workspace, por usuario activo y por pregunta de IA.

Presupuestos de rendimiento (valores concretos según mediciones reales): no aumentar el bundle principal sin explicación, no introducir queries costosas sin índice o justificación, no cargar datasets ilimitados, no encadenar N llamadas para un dashboard.

Escala: no introducir ClickHouse ni Kafka prematuramente. Indicadores para decidir si Postgres deja de bastar: volumen de eventos, latencia de queries, CPU de la base, crecimiento de almacenamiento, throughput de cola y coste de agregación de dashboards. Solo entonces evaluar warehouse, OLAP o stream processing.

## 11. Crons

`vercel.json` tiene 2 crons por el límite de Vercel Hobby; 9 jobs más corren desde GitHub Actions, que puede retrasar o saltarse ejecuciones. Cada job debe ser idempotente y existir una alerta si no completa en su ventana. Valorar un cron despachador único o subir de plan si F1 y F2 añaden jobs. Existe `worker/`.
