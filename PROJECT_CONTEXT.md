# Growth-Ops-App — Contexto del Proyecto

> **Fuente única de verdad** para Claude Code, Codex y Freebuff. Lee este archivo primero.
> Última actualización: 2026-09-18 (auditoría FASE 1-2 + hardening: hooks exhaustivos 49→0, 34 API routes con try/catch, **índices FK aplicados en producción — advisor 95→0**)

---

## 1. Qué es

SaaS multi-tenant de gestión de negocio para formadores/creadores de contenido (subcuentas: WDC, Evergreen plantilla). Dashboard, CRM, pipeline de ventas, comisiones, finanzas, integraciones con Meta Ads, Google, Instagram, Stripe.

**Stack:** Next.js 15 (App Router) · TypeScript · React 18 · Tailwind CSS · Supabase (Postgres 17, Auth, RLS) · Vercel · Recharts · Radix UI · Anthropic SDK · Sentry

**Multi-tenancy:** Rutas `/[tenant]/...` (dynamic segment). Cada tenant tiene sus datos aislados por RLS. Las APIs usan `[tenant]/evergreen/...`.

**Supabase:** Proyecto `rgcbveflosqgxrcqlqzv` (Growth Ops), eu-west-1. MCP conectado vía Freebuff.

---

## 2. Arquitectura de directorios

```
app/
  [tenant]/              ← Rutas principales del tenant (dashboard, crm, ventas, finanzas...)
  api/[tenant]/evergreen/ ← API routes server-side (requieren SUPABASE_SERVICE_ROLE_KEY)
  api/oauth/             ← OAuth callbacks (Google)
  api/public-contracts/  ← Contratos públicos por token
  page.tsx               ← Home: selector de subcuentas (supabase query pública)
lib/                     ← Lógica de negocio (ads, ai, auth, commissions, contacts, finanzas...)
components/              ← Componentes React por módulo (ai, crm, finanzas, sales, settings...)
supabase/migrations/     ← Migraciones SQL (timestamp prefix)
tests/                   ← Tests Node.js (test runner nativo, no Jest)
```

---

## 3. Variables de entorno

Ver `.env.local.example` para la lista completa. Resumen:

| Variable | Dónde se usa | Dónde obtenerla |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Cliente (browser) | Supabase MCP `get_project_url` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Cliente (browser) | Supabase MCP `get_publishable_keys` |
| `SUPABASE_SERVICE_ROLE_KEY` | Server (API routes) | Vercel dashboard / `vercel env pull` |
| `POSTGRES_URL` | Server (SQL directo) | Vercel dashboard |
| `ANTHROPIC_API_KEY` | Server (AI features) | Vercel dashboard |
| `CONFIG_ENC_KEY` | Server (encryption) | Vercel dashboard |
| `SEQURA_MCP_TOKEN` | Server (Sequra crons) | Caduca, regenerar periódicamente |
| `NEXT_PUBLIC_SITE_URL` | Auth callbacks | `http://localhost:3000` en dev |

**Clave:** Las `NEXT_PUBLIC_*` funcionan en cliente. Las server-side (`SUPABASE_SERVICE_ROLE_KEY`, etc.) causan 500 si faltan — los errores se manifiestan como "supabaseKey is required".

---

## 4. Convenciones del código

- **Formato:** Prettier (ya configurado). Ejecutar `npm run format` antes de commitear.
- **Lint:** ESLint via `next lint`.
- **Typecheck:** `npm run typecheck` (tsc --noEmit).
- **Tests:** `npm test` (Node.js test runner, archivos `tests/*.test.mjs`).
- **Quality gate completo:** `npm run quality` (format + lint + typecheck + test + test:metrics).
- **Helpers de formato:** Usar `formatNumber`/`formatPercent` de `@/lib/utils` (NO inline `toLocaleString`).
- **Componentes UI:** Radix UI + Tailwind. Seguir patrón existente en `components/ui/`.
- **Estado global:** React Context (`lib/tenant-context.tsx`), NO Zustand/Redux.
- **Supabase client:** `lib/supabase/client.ts` (browser) y `lib/supabase/server.ts` (server).
- **API routes:** Todas bajo `app/api/[tenant]/evergreen/...`. Usar `requireTenant()` de `lib/auth/` para validar tenant + auth.

---

## 5. Tracker de tareas

### ✅ Completado

| # | Tarea | PR/Commit | Fecha |
|---|---|---|---|
| 1 | Causa raíz y sistema de carga | `78602a8` | 09-14 |
| 2 | Rol acotado a la subcuenta | `5d7577b`, `91dd890` | 09-14 |
| 3 | Cascada de red: primeras 12 pantallas | `5d7577b`, `4679909` | 09-14 |
| 4 | `request_id` en rutas server | `1303b6f` | 09-14 |
| 5 | Limpieza con evidencia | `1303b6f`, `2045026` | 09-14 |
| 6 | Capa de consulta con datos reales | `8efb0d2` | 09-14 |
| 7 | KPI cards, brief y alertas | `2cae4e2` | 09-14 |
| 8 | Agendas: respuestas del formulario | `eddd936` | 09-14 |
| 9 | Atribución: propagar campaign/UTM | `4cf441a` | 09-14 |
| 10 | Cascada de sesión en pantallas restantes | Solo layout resuelve `getUser()` | 09-14 |
| 12 | Medir LCP / INP / CLS reales | Sentry, condicionado al DSN | 09-14 |
| 16 | 49.1 Agregados puros | main | 09-14 |
| 17 | 49.2 Lectura paginada/tenant | main | 09-14 |
| 18 | 49.3 Puente a niveles/dimensiones/objetivos | main | 09-14 |
| 19 | 49.4 Ruta `/metricas/brief` | main | 09-14 |
| 20 | 49.5 Huecos declarados (3/4) | Speed to Lead, BAMFAM, concordancia | 09-15 |
| 21 | 50.1 Cuello de botella + Business Health | `0ee2be7` | 09-14 |
| 22 | 50.2 Objetivos, previsión y capacidad | `ec3b61f` | 09-14 |
| 23 | 50.3 Alertas/notificaciones (parcial) | Motor + panel + Notif cerrados | 09-15 |
| 24 | 50.4 Growth Brief inicial del agente | `8248749` | 09-14 |
| — | Observabilidad de navegador + Sentry | error.tsx, WebVitalsReporter | 09-15 |
| — | Cierre de cascada de sesión (17 pantallas) | `useSesion()` reutilizado | 09-15 |
| — | Race condition de carga intermitente | AbortSignal en layout | 09-15 |
| — | Contexto estratégico editable | Config → Datos de empresa | 09-15 |
| — | Endurecimiento operativo + invitaciones | PR #54 | 09-15 |
| — | Data Health cross-source + golden dataset | `lib/data-health/cross-source.ts` | 09-14 |
| — | Stripe: diagnóstico + aviso pendientes | `StripePendientesAviso.tsx` | 09-14 |
| — | Funnels visuales | `FunnelChart.tsx` + API | 09-14 |
| — | Agente de IA MVP (fase 1) | PR #29 | 09-13 |
| — | Agente de IA fase 2 (tools, insights, memoria) | PR #29 | 09-13 |
| — | Gestión de socios recreada | PR #30 | 09-13 |
| — | Auditoría RLS multi-tenant (cerrada) | SQL verificado | 09-13 |
| — | Rebrand Growth Ops | PR #61 | 09-16 |
| — | CRM UX: agendas + ficha contacto | PR #62 | 09-16 |
| — | Métricas CRM unificadas | PR #63 | 09-16 |
| — | Filtros de fecha unificados | PR #64 | 09-16 |
| — | Hardening SQL: EXECUTE revocado | Migración + tests | 09-17 |
| — | Limpieza duplicados (4 archivos " 2") | Freebuff | 09-17 |
| — | PROJECT_CONTEXT.md multi-agente | `0038e9b` | 09-17 |
| — | Fix middleware: API routes devuelven 401 JSON, no redirect HTML | `97e2d75` | 09-17 |
| — | Panel respuestas formulario lee appointments.raw_payload con charts | `0558e88` | 09-17 |
| — | Dashboard: funnel realidad vs atribución + selector cuentas Meta | `c7349b8` | 09-17 |
| — | Dashboard: funnel dinámico reutilizable + filtros de atribución | `935a0bf` | 09-17 |
| — | Nomenclatura unificada: Agendas/Asistencias/Cierres | `935a0bf` | 09-17 |
| — | Endpoint funnel resiliente: try-catch por fuente individual | `6e84117` | 09-17 |
| — | CRM: calendario más amplio, sin truncar badges | `7ee9ab4` | 09-17 |
| — | AppointmentDetail: formulario grabación unificado (eliminado duplicado) | `cf6ade8` | 09-17 |
| — | Contactos unificados: merges Leads VSL + Contactos, filtros GHL, column toggle | `a469b6b` | 09-17 |
| — | Auditoría filtros de fecha: DEFAULT_PERIOD='month' en 16 páginas | `c98faea` | 09-17 |
| — | Docs: AUDIT_DATE_FILTERS.md con inventario completo | `c98faea` | 09-17 |
| — | **Multitenant: no-enumeración de subcuentas en la home** (query anon → gated por sesión + RLS) | `09dc33b` | 09-17 |
| — | **Multitenant: localStorage namespaced por tenant** (ScriptQueue, ContactsAllView + deps useEffect) | `09dc33b` | 09-17 |
| — | Multitenant: tests de aislamiento (no-enumeración + keys por tenant) | `09dc33b` | 09-17 |
| — | Calendario agendas: contenido adaptativo por altura (xs/sm/full), clamp fuera de rango, enlace muerto Leads (VSL) eliminado | `b4b44df` | 09-17 |
| — | Fix 500 actividades contacto (service-role innecesario → cliente autenticado, §16) | `1b7c017` | 09-17 |
| — | Responsive CRM: switchers con wrap, tabla de agendas con scroll horizontal | `1b7c017` | 09-17 |
| — | **Pixel first-party Fase C**: POST /api/track/[site] (public_key + origin allowlist + rate limit + raw→canónico), SDK /tracker.js, sites API, panel en Data Health con datos reales | `75ea934` | 09-17 |
| — | Dashboard: elimina bypass duplicado de period='all' (inPeriod ya cubre rango abierto) | `75ea934` | 09-17 |
| — | **Deploy producción roto desde PR #51** (9 crons > límite 2 de Hobby, 20 deploys seguidos en error) → reducido a 2 (meta-ads + reminders) | `72f4ec0` | 09-17 |
| — | Fix lint de build: comillas sin escapar en unit-economics (react/no-unescaped-entities) | `e41393c` | 09-17 |
| — | Security: migración hardening EXECUTE de 10 helpers SECURITY DEFINER + 4 triggers + 2 utilidades (advisor Supabase) | `c3ca9e8` | 09-17 |
| — | **Hardening APLICADO en producción** (28 sentencias DCL) + fix: GRANT service_role en RPCs de webhooks; verificado — RPC anon de `is_super_admin` → 401; advisor sin funciones para `anon`. **Aviso advisor restante:** leaked password protection (activar en Auth → Policies) y WARN intencional de helpers `authenticated` | `319c385` | 09-17 |
| — | **Auditoría FASE 1** (Freebuff): mapeo de arquitectura + esquema BD vía MCP Supabase — ~90 tablas `public` con RLS activo; advisor de rendimiento detecta ~95 FKs sin índice; `lib/types/database.ts` desincronizado del esquema (1 sola mención de `tenant_id` vs ~90 tablas con él; incluía campos fantasma `attribution_conflict`/`attribution_meta` retirados de la BD) | MCP Supabase (advisors) | 09-18 |
| — | **Auditoría FASE 2 — quality gate VERDE**: typecheck 0 errores · lint 0 errores (solo warnings preexistentes) · 375/375 tests · 659/659 test:metrics — nada que corregir por el compilador. Ejecutado en clon `/tmp/growthops-preview` (commit `8b1712f`; sandbox TCC §7). El gate se mantiene verde al cierre de la sesión con los cambios del working tree aplicados (sync de tipos núcleo, fix de `attribution_conflict` en `sales/update`, dead-code knip 73→32, triage de 28 warnings exhaustive-deps seguros) — pendiente de commitear | Clon local | 09-18 |
| — | **Hooks: warnings `react-hooks/exhaustive-deps` 49 → 0** — 28 seguros corregidos (deps estables `tenant`/`router`), 20 fetchers envueltos en `useCallback` con deps reales, 2 `useMemo` de afiliados resueltos, refactor de agendas (cadena `fetchData`→`handleReassignConflict`→memo estabilizada, declaraciones movidas antes del memo) | Freebuff | 09-18 |
| — | **Endurecimiento API routes: `try/catch` estándar en las 34 rutas / 56 handlers que no lo tenían** (patrón del proyecto: `console.error('[api/...]')` + `NextResponse.json` 500) — verde en clon (tsc, lint, 375/375, 659/659) y propagado al checkout principal byte a byte vía `git apply` | Freebuff | 09-18 |
| — | **Índices FK APLICADOS en producción** (migración `20260918120000`, 95/95 `CREATE INDEX IF NOT EXISTS` ejecutados y verificados en `pg_indexes`; pre-flight validó las 95 parejas tabla.columna contra las FKs reales del catálogo). **Advisor después: `unindexed_foreign_keys` 95 → 0** ✅. Conexión directa vía pooler `aws-1-eu-west-1` (el host `db.<ref>.supabase.co` no resuelve) | Freebuff + postgres.js | 09-18 |

### ❌ Pendiente

| # | Tarea | Bloqueado por | Prioridad |
|---|---|---|---|
| 11 | `any` restantes → tipado seguro | Auditoría manual | Baja |
| 13 | Decidir sobre 89% `use client` | Medir antes de migrar | Baja |
| 14 | Contexto de negocio: contenido real | Usuario llena datos | Media |
| 15 | Webhook Stripe + rotar Google Client Secret | Usuario en Vercel | Media |
| 20.4 | LTGP:CAC | Necesita margen bruto real por cliente | Baja |
| 23.4 | Anotaciones con fecha en gráficos | — | Baja |
| — | **Backfill de Stripe** (WDC) | Usuario ejecuta desde Integraciones | **Alta** |
| — | **Reconectar token Meta** (Instagram) | Usuario reconecta en Meta | **Alta** |
| — | **Sincronizar env vars server-side** | `vercel env pull` hecho; los 11 valores **Secret** de Vercel no se pueden descargar → rellenar a mano (Supabase Settings → API) | Media |
| — | **Pixel: crear primer site en producción** | Alta de site y snippet en la web real (la BD y las APIs están listas) | **Alta** |
| — | **Auditoría: verificar queries filtran por columna correcta** | Fase 3 de auditoría | Alta |
| — | ~~**Añadir índices a FKs (~95 halladas por advisor de rendimiento Supabase)**~~ **HECHO 18-sep: migración aplicada en producción (95/95), advisor `unindexed_foreign_keys` → 0.** La migración vive en `supabase/migrations/20260918120000_add_missing_fk_indexes.sql` (queda por commitear). Nota: los 95 índices nuevos figuran como `unused_index` hasta que las estadísticas acumulen tráfico — es esperado, no eliminar por eso | Resuelto | — |
| — | **Regenerar `lib/types/database.ts` con `supabase gen types typescript`** — núcleo Contact/Appointment/Sale ya alineado a mano (09-18); faltan ~80 tablas restantes con `tenant_id` | MCP Supabase / CLI | Media |
| — | **Pixel: aplicar hardening + crear primer site en producción** ~~aplicar hardening~~ | ~~Ejecutar migración c3ca9e8 en Supabase prod~~ HECHO (319c385); falta alta de site y snippet en la web real | **Alta** |
| — | **Multitenant: Agency Home + switcher robusto** | UX definida, falta implementar | Alta |
| — | **Multitenant: bloquear subcuenta archivada** (crons, logins, syncs) | RLS ya filtra, falta gate activo | Alta |
| — | **Multitenant: constraint FK cross-tenant** campaign↔ad_account | Riesgo de FK entre tenants | Media |
| — | **Dashboard: integraciones faltantes** (TikTok Ads/Org) | — | Media |
| — | Dashboard: migrar agregaciones a SQL (RPCs) | — | Media |
| — | **Activar protección contraseñas filtradas** | Auth → Policies en Supabase | Media |
| — | Fiabilidad de APIs: estados de error honestos (la capa `try/catch` ya existe en todas las rutas; falta devolver estados útiles en el cuerpo de respuesta) | — | Media |
| — | Mover agregaciones a SQL (RPCs) | — | Media |
| — | Panel "Puesta a punto" por tenant | — | Media |
| — | Agente IA fase 3 (RAG/pgvector) | Embeddings provider | Baja |
| — | Agente IA: smoke test real en navegador | Sesión admin/director | Media |
| ✅ | **7 crons retirados de vercel.json → GitHub Actions** (monthly, sequra-morosos, analyze-calls, ai-insights, meta, meta-daily, instagram) — HECHO 18-sep: workflows con `schedule` + `workflow_dispatch`, `Bearer CRON_SECRET` (secret creado en GitHub **y** Vercel production + redeploy; verificado 200 en vivo), **7/7 con dispatch en verde** (sequra-morosos falla en rojo por falta de `SEQURA_MERCHANT_REFERENCE` en producción — credencial de negocio pendiente del usuario; la tubería GHA→endpoint funciona) | Cuidado: `name:` con dos puntos SIN comillas rompe el YAML de GitHub (422 silencioso) | — |

### 🐛 Conocido (no bloqueante)

- APIs server-side en 500 local (falta `SUPABASE_SERVICE_ROLE_KEY`)
- ~~3 APIs devuelven texto de auth en body en vez de 401~~ **ARREGLADO** (`97e2d75`): middleware ahora devuelve 401 JSON para `/api/*`
- Media BD vacía para WDC (`sales` 0, `campaigns` 0, `campaign_ads` 0)
- Plan Vercel Hobby: 3 crons, `maxDuration` 60s
- Instagram: último sync falla con Meta `(#10) Application does not have permission`

---

---

## 6. Dashboard de captación — estado actual

### Arquitectura implementada (fases 1-5)

**Página:** `app/[tenant]/unit-economics/page.tsx`
**Componentes nuevos:**
- `components/os/FunnelDinamico.tsx` — UN componente, N familias (selector [Todos|VSL|DM|Webinar|Web/SEO])
- `components/os/QualificationInsights.tsx` — Panel de respuestas de formulario con charts y %
- `lib/metrics/operativo.ts` — Tipo `FunnelOperativo` compartido
- `lib/funnels/queries.ts` — Resiliente: cada fuente (CRM/Meta/GA4/VSL) se envuelve en try-catch individual

### Qué hace cada fase

| Fase | Qué implementa | Estado |
|---|---|---|
| 1 | Selector de cuentas Meta (solo las configuradas, no todas las accesibles) | ✅ |
| 2 | Funnel realidad vs atribución (nunca convierte 'no atribuible' en 0) | ✅ |
| 3 | Nomenclatura española: Agendas/Asistencias/Cierres | ✅ |
| 4 | Funnel dinámico reutilizable con selector de familia | ✅ |
| 5 | Filtros de atribución (Origen, Canal, Atribución) con progressive disclosure | ✅ |
| 6 | Pixel first-party + Data Health | Pendiente |
| 7 | Integraciones faltantes (TikTok) | Pendiente |

### Datos verificados en vivo (WDC)

- Funnel "Todos" muestra 956→559→340→27 (leads→agendas→asistencias→cierres)
- Selector de cuentas Meta funciona con nombres legibles
- Cambio de familia (VSL→Todos) restaura totales sin residuos
- Filtro "No atribuidos" no convierte nada en 0
- Panel de respuestas muestra 1326 respuestas en 5 categorías con barras y %
- 1018 tests PASS, typecheck clean

### Notas técnicas importantes

- `contacts.campaign_id` y `contact_attributions` están a 0 filas → la atribución real es 0%
- `vsl_sessions` está vacía en WDC → familias VSL devuelven `sin_datos` honesto (no 0)
- El endpoint funnel es resiliente: si falta `SUPABASE_SERVICE_ROLE_KEY`, las etapas fallan individualmente con `error_fuente`, no crashan todo
- `QualificationInsights` lee de `appointments.raw_payload` (misma fuente que el drawer de agendas), NO de `contacts.qualification`

---

## 7. Entorno de desarrollo (Freebuff)

- **Clon de trabajo:** `/tmp/growthops-preview` (necesario por sandbox TCC)
- **Servidor:** launchd job `growthops-dev`, puerto 3000
- **Node:** `/Users/[tenant]/Library/Caches/ms-playwright-go/1.57.0/node`
- **Sync:** Editar en checkout principal → copiar archivos modificados al clon → hot-reload
- **Conexión directa a Postgres:** `db.<ref>.supabase.co` no resuelve desde el sandbox (ni IPv4 ni IPv6). Usar el pooler `aws-1-eu-west-1.pooler.supabase.com:5432` con usuario `postgres.<ref>` y `ssl: 'require'` (el clúster `aws-0` rechaza el tenant: "tenant not found")
- **Run doc:** `.freebuff/run.md` con procedimientos detallados
- **Preview:** http://localhost:3000/ (verifica con `preview_evaluate` y `preview_screenshot`)

---

## 8. Git workflow

- **Remote:** `https://github.com/torrealex97-star/Growth-Ops-App.git`
- **Branch principal:** `main`
- **Último commit:** `8b1712f` — "style: formatea deuda de Prettier (29 ficheros) para desbloquear format:check del CI"
- **Historial reciente:** prettier CI verde (8b1712f) + docs crons GHA (0e8b265) + fix YAML names (13ad8e8) + workflows crons (be082ad) + caso F pixel (7b62fa8) + skills del stack (815d1c9) + is_monitoring (c90b00b) + docs crons recorte (72f4ec0)
- **Antes de push:** Ejecutar `npm run quality` completo (ahora gateado también por CI en cada push a main: format → lint → typecheck → dead-code → test → test:metrics → build)
- **Vercel:** Deploy automático al hacer push a `main` → `https://growth-ops-weld.vercel.app`

---

## 9. Handoff doc

`docs/ACTIVE_HANDOFF.md` contiene el historial detallado de todas las sesiones de Claude Code y Codex, incluyendo:
- 24 tareas del brief con estado (18 hechas, 6 pendientes/parciales)
- Auditoría de RLS multi-tenant (cerrada)
- Estado de datos reales (qué tablas tienen datos, cuáles vacías)
- Bug de sesiones y race conditions (corregido)
- Plan Vercel Hobby y sus limitaciones de crons
- Backfill de Stripe (pendiente de ejecutar por el usuario)

Leer `docs/ACTIVE_HANDOFF.md` cuando se necesite contexto histórico detallado.

---

## 10. Notas para agentes

### Claude Code
- Usa `.claude/` para configuración. Lee `PROJECT_CONTEXT.md` al inicio.
- Puede ejecutar `npm run quality` directamente (tiene Node en PATH).

### Codex
- Usa `.codex/` para configuración. Lee `PROJECT_CONTEXT.md` al inicio.
- Verificar Node disponible antes de ejecutar scripts.

### Freebuff
- Sandbox no puede leer `~/Documents` (TCC). Trabaja desde `/tmp/growthops-preview`.
- Supabase MCP disponible para queries de BD, advisors, logs de producción, esquema.
- Launchd para procesos persistentes (sobreviven reinicios).
- Usar Finder vía AppleScript para copiar archivos desde `~/Documents`.
- `PROJECT_CONTEXT.md` se actualiza con cada PR mergeado; mantenerlo como fuente única de verdad.

---

## 11. GOTCHAS de arquitectura — Crons, Vercel & GitHub Actions

### Arquitectura de Crons (límite Vercel Free)
- **Distribución:** Vercel Hobby limita a máximo 2 crons en `vercel.json` (`meta-ads`, `reminders`).
- **Delegación a GitHub Actions:** los 7 crons restantes (`monthly`, `sequra-morosos`, `analyze-calls`, `ai-insights`, `meta`, `meta-daily`, `instagram`) se disparan desde `.github/workflows/cron-*.yml` con sus horarios originales + `workflow_dispatch`.
- **Autenticación:** cada workflow hace un **GET** a la URL de producción con el header `Authorization: Bearer CRON_SECRET`; el endpoint recorre TODAS las subcuentas activas.

### Reglas críticas para evitar incidentes
1. **Redeploy obligatorio en Vercel:** tras añadir o modificar `CRON_SECRET` (o cualquier `.env`) en Vercel, ES OBLIGATORIO forzar un redeploy de producción. Sin él, los endpoints responden `401 Unauthorized` porque la función serverless mantiene el runtime antiguo (le pasó a meta-ads/reminders el 18-sep).
2. **Sintaxis YAML en GitHub Workflows:** SIEMPRE entrecomillar el campo `name` si contiene dos puntos: `name: "cron: meta"` (nunca `name: cron: meta` — rompe el parser de YAML en silencio y GitHub rechaza el `workflow_dispatch` con 422).
3. **Edición segura de `.env.local`:** al añadir variables por script (`echo "VAR=val" >> .env.local`), verificar antes que el fichero acaba en salto de línea (`\n`); si no, se fusiona con la última línea y corrompe ambas claves (ocurrió con `GHL_WEBHOOK_SECRET` el 18-sep; detectable con `grep -c '^VAR='`).
4. **Base de datos (Supabase):** `pg_cron` NO está instalado en la BD. La rotación de `CRON_SECRET` no afecta a trabajos internos de Postgres.

### Notas de verificación (18-sep)
- El secret vive coherente en 3 sitios: GitHub (secret), Vercel Production (+ redeploy) y `.env.local` local.
- Los runs "failure" de 0s en los `cron-*` son zombis del push de transición YAML: no indican fallo del endpoint.
- ~~El workflow `CI` (push a main) estuvo en rojo por `format:check` (29 ficheros sin Prettier)~~ **Resuelto 18-sep (commit `8b1712f`): CI en verde** (format + lint + typecheck + dead-code + test + test:metrics + build) — primer run verde del gate en GitHub.
