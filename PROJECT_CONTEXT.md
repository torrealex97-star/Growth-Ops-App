# Growth-Ops-App — Contexto del Proyecto

> **Fuente única de verdad** para Claude Code, Codex y Freebuff. Lee este archivo primero.
> Última actualización: 2026-09-17 (post auditoría filtros fecha + contactos unificados)

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
| — | **Pixel: aplicar hardening + crear primer site en producción** ~~aplicar hardening~~ | ~~Ejecutar migración c3ca9e8 en Supabase prod~~ HECHO (319c385); falta alta de site y snippet en la web real | **Alta** |
| — | **Multitenant: Agency Home + switcher robusto** | UX definida, falta implementar | Alta |
| — | **Multitenant: bloquear subcuenta archivada** (crons, logins, syncs) | RLS ya filtra, falta gate activo | Alta |
| — | **Multitenant: constraint FK cross-tenant** campaign↔ad_account | Riesgo de FK entre tenants | Media |
| — | **Dashboard: integraciones faltantes** (TikTok Ads/Org) | — | Media |
| — | Dashboard: migrar agregaciones a SQL (RPCs) | — | Media |
| — | **Activar protección contraseñas filtradas** | Auth → Policies en Supabase | Media |
| — | Fiabilidad de APIs: estados de error honestos | — | Media |
| — | Mover agregaciones a SQL (RPCs) | — | Media |
| — | Panel "Puesta a punto" por tenant | — | Media |
| — | Agente IA fase 3 (RAG/pgvector) | Embeddings provider | Baja |
| — | Agente IA: smoke test real en navegador | Sesión admin/director | Media |
| ✅ | **7 crons retirados de vercel.json → GitHub Actions** (monthly, sequra-morosos, analyze-calls, ai-insights, meta, meta-daily, instagram) — HECHO 18-sep: workflows con `schedule` + `workflow_dispatch`, `Bearer CRON_SECRET` (secret creado en GitHub **y** Vercel production + redeploy; verificado 200 en vivo), 2 dispatches de prueba en verde | Cuidado: `name:` con dos puntos SIN comillas rompe el YAML de GitHub (422 silencioso) | — |

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
- **Node:** `/Users/alextorre/Library/Caches/ms-playwright-go/1.57.0/node`
- **Sync:** Editar en checkout principal → copiar archivos modificados al clon → hot-reload
- **Run doc:** `.freebuff/run.md` con procedimientos detallados
- **Preview:** http://localhost:3000/ (verifica con `preview_evaluate` y `preview_screenshot`)

---

## 8. Git workflow

- **Remote:** `https://github.com/torrealex97-star/Growth-Ops-App.git`
- **Branch principal:** `main`
- **Último commit:** `72f4ec0` — "fix: reduce crons de vercel.json a 2 (limite del plan Hobby) que rompia todos los deploys de produccion desde el PR 51"
- **Historial reciente:** fix crons Hobby (72f4ec0) + fix lint build (e41393c) + hardening aplicado (319c385) + pixel first-party (75ea934) + auditoría multitenant (09dc33b) + calendario agendas (b4b44df)
- **Antes de push:** Ejecutar `npm run quality` completo
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
