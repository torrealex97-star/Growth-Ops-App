# Registro de cambios — Growth Ops App

> Aquí se anota **cada cambio que se sube a producción**. Formato sencillo:
> una línea por cambio, agrupado por fecha. Lo más nuevo, arriba.
>
> Etiquetas: `[nuevo]` funcionalidad, `[fix]` corrección, `[mejora]` cambio a algo existente.

---

## Sin publicar (pendiente de confirmar)

<!-- Añade aquí lo que está pendiente de confirmar -->

- `[nuevo]` **Conversaciones desde GHL conectadas a perfiles**: nueva pestaña "GHL" en Setting AI › Conversaciones — pull bajo demanda de `GET /conversations/search` + mensajes de la API v2 (2021-07-28) con deadline en todas las llamadas, snapshot stale en `integration_settings` (misma mecánica que Instagram) y vinculación de cada conversación con el perfil del CRM (`contacts`) por `ghl_contact_id` → email → teléfono (solo lectura; sin match se muestra "Sin perfil", nunca se fuerza). La bandeja unificada de GHL trae SMS, Facebook, Instagram, WhatsApp y email aunque los canales directos no estén conectados.

- `[fix]` **Presupuesto real del sync de pagos Stripe (PR #277)**: el deadline (30 s cron / 45 s manual) solo gobernaba la paginación — el bucle de fees (secuencial, hasta 20 s por llamada) y el upsert iban después sin presupuesto: con historial grande la función moría sin escribir la página leída y el reintento empezaba de cero (worst-case medido: 2.000 pagos ≈ 400 s solo de fees). Ahora el bucle de fees consulta el reloj antes de cada llamada, el dinero se persiste antes del corte, `truncated` + `fees_pendientes` se declaran, un fee fallido ya no pisa el fee bueno del espejo y los fees ya presentes no se re-piden (inmutables: 0 llamadas en el caso común).
- `[fix]` **Builds de Vercel desbloqueados (PR #280)**: 5 deployments production expiraron el 28-sep (`BUILD_EXCEEDED_MAXIMUM_TIME`) colgados en el typecheck — ESLint 9 (#262) + Tailwind 4 (#263) dispararon una carga de tipos que solo cabe en el runner de CI con 6 GB de heap; producción estuvo congelada desde las 06:26Z. La build de Vercel salta typecheck/eslint (`process.env.VERCEL` en `next.config.js`) y CI de GitHub sigue siendo el gate de cada SHA. Verificado: deployment READY en ~7 min.
- `[mejora]` **Limpieza de assets**: `public/brand/iawinners-logo.png` (1,47 MB, 0 referencias en código, resto de la marca anterior) eliminado del repo y fuera de producción (404 verificado tras desplegar).

- `[fix]` **SeQura fail-closed (PR #273)**: un listado ilegible o truncado ya no da por recuperados a TODOS los morosos ausentes — lanza y el cron reintenta; `marcarRecuperados` extraída como función pura y los errores dejan de tragarse.
- `[fix]` **Segunda tanda P1 (PR #271, carril Claude Code)**: reprogramación de Calendly 500, cancelación+reprogramación de citas, webhook de onboarding, `audit_logs` en complete-reservation/sales/students/course-access/documents/override y checks del backfill de YouTube.
- `[fix]` **Tanda dinero (PR #269)**: el alta de venta consume el booleano de `recordCollection` (estado parcial, acceso bloqueado si el cobro falló, toast honesto); `repNetCash` solo resta refunds `processed`; `collections/record` fail-ruidoso si falla el count previo (no reenvía `venta.registrada`); `appointments/create` valida que el contacto es del tenant.
- `[fix]` **Efectos externos (PR #270)**: cron Reels con presupuesto real (45 s) y esqueletos persistidos antes del bucle; backfill de YouTube con claim atómico `pending→uploading` (fin de las re-publicaciones dobles).
- `[mejora]` **UX/estados (PR #272)**: home con error explícito y reintento, Setting-AI tolera storage caído, devoluciones/follow-ups sin loaders eternos, ContactForm resincroniza por valores, P&L/cohortes/proyección/gestoría declaran la fuente ilegible en vez de pintar sumas parciales.
- `[mejora]` `AGENTS.md`: nuevas reglas de código de la auditoría FASE A — helpers UTC de fechas solo-día, comprobación `{ error }` de supabase-js, claim atómico antes de efectos irreversibles, presupuesto de cron ≪ `maxDuration`, consumo de booleanos de helpers de escritura y estados de error honestos en UI.
- `[mejora]` Escalado de dependencias (carril Claude Code): ESLint 9 flat config (#262), Tailwind 4.3.3 (#263), recharts 3.10.1 (#261).
- `[mejora]` **Tests canónicos en CI (PR #274)**: los 3 ficheros de `tests/canonical/` no encajaban en los globs de `npm test` ni `test:metrics` (no se ejecutaban desde que se crearon); reubicados a `tests/` — suite 1089→1127 tests.

- `[mejora]` **Fiabilidad CI/ops (PR #214)**: el login E2E del global-setup reintenta una segunda vez y deja captura + errores de consola en `test-results/` si falla del todo (fin del flake del 25-sep que tumbó CI de `main`); el cron `calendly-ghl` baja su presupuesto de 35+25 s a 20+18 s para dejar colchón bajo el corte de 60 s de Vercel (504 `FUNCTION_INVOCATION_TIMEOUT` del 25-sep).
- `[mejora]` `AGENTS.md`: nuevas reglas aprendidas el 25-sep — suites solo por los scripts canónicos de `package.json` (los specs E2E no son `node:test`), prohibido fusionar linajes sin merge-base (caso PR #210), presupuestos de cron muy por debajo del `maxDuration` de Vercel, y la fila del tablero como contrato de relevo de trabajo sin commitear.

---

## 2026-09-11 — Limpieza a instancia propia + fixes de seguridad P0

- `[mejora]` Eliminado el stack legacy [tenant] / Lanzamiento / Cold Calling / Sorteo
  (Google Sheets + Postgres crudo) — queda solo el sistema Evergreen.
- `[fix]` RLS: cerrado el hueco por el que cualquier usuario autenticado podía leer
  todas las ventas/contactos/cobros de la empresa vía Supabase directo (política
  `collections_select_team` duplicada anulaba el scoping); `data_scope` ahora es
  `'own'` por defecto en vez de `'team'`.
- `[fix]` RLS habilitado en `positive_notes` (antes sin política, dependía solo de
  que la API no se saltara — ahora también protegido a nivel de base de datos).
- `[fix]` Añadida autenticación a `documents/state` (filtraba números de documento
  de identidad sin login), `documents/verify`, `vsl/videos` y `vsl/upload`.
- `[fix]` Enlace roto `/evergreen/retention` eliminado del menú.
- `[mejora]` Conectado a Supabase y Vercel propios (proyecto nuevo, sin datos de
  [tenant] / [tenant]).

---

## 2026-07-24 — Fix cash collected Sequra + WIP acumulada

- `[fix]` **Cash Collected de ventas Sequra**: el alta registraba las cuotas esperadas
  pero no el adelanto comisionable que recibimos de la financiera, así que la venta
  sumaba a facturación pero 0 € a Cash Collected hasta marcarla a mano. Ahora el
  adelanto se registra como cobro al instante (con comisionable explícito para no
  re-aplicar el ratio del plan). Regularizadas en producción las 2 ventas afectadas.
- `[nuevo]` **Reels del día**: bandeja diaria de borradores de reel minados de la
  competencia (cron + endpoints service-role) y vista en Contenido.
- `[nuevo]` **Setting-AI**: chat/crítico/mejora/simulación/autotrain para afinar prompts.
- `[nuevo]` **Plantillas de contrato en PDF** + validación de ID.
- `[mejora]` **VSL**: toggles de autoplay con sonido y reinicio al desmutear.
- `[mejora]` Ajustes varios en agendas, contratos, leads, integraciones y permisos.

---

## 2026-07-13 — Baseline + entorno de staging

- Estado inicial del repositorio con todo el trabajo acumulado (afiliados, contratos,
  carruseles, cualificación de contactos, onboarding, migraciones v37–v40, etc.).
- Repo privado en GitHub (`(repo anterior, reemplazado 2026-09-19)`) con ramas `main` y `staging`.
- **Entorno de staging montado y verificado**: `<proyecto>-staging.vercel.app` con BBDD Supabase
  aislada (`xryk…`, eu-central-1), esquema al día, roles sembrados y usuario admin de QA
  (`[tenant]`). Ver `docs/FLUJO-DEPLOY.md`.
- Punto de partida para el flujo staging → producción.
