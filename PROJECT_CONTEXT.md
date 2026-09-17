# Growth-Ops-App — Contexto del Proyecto

> **Fuente única de verdad** para Claude Code, Codex y Freebuff. Lee este archivo primero.
> Última actualización: 2026-09-17

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

## 5. Estado actual (2026-09-17)

### ✅ Funcionando
- Dashboard con funnel, KPIs, gráfico 6 meses, ranking equipo, atribución leads
- CRM + pipeline Kanban de seguimiento (leads reales de WDC)
- Selector de subcuentas (Evergreen plantilla + Women Digital Closer)
- Login con sesión (Alex Torre · Administrador)
- Sidebar completo: CRM, Métricas, Ventas, Instagram, Alumnos, Finanzas, Morosidad...
- Auditoría visual del 15-sep implementada (funnel arriba, ConnectedFunnel compartido)

### ⚠️ Conocido
- **APIs server-side en 500** cuando faltan env vars server-side (local sin `vercel env pull`)
  - Rutas afectadas: `suggestions`, `commissions/future`, `integrations`, `meta/spend-range`
  - Causa: `SUPABASE_SERVICE_ROLE_KEY` no está en `.env.local` local
  - En Vercel producción: funciona correctamente
- **3 APIs responden con texto de auth en body** en vez de 401/redirect (ruta de error de `requireTenant`)
- **4 archivos duplicados limpiados** este hilo (FinanceCharts 2, ConnectedFunnel 2, system 2, DASHBOARD_VISUAL_AUDIT 2)
- **Vercel CLI** instalado globalmente (v59.20.0), auth guardada en `~/.vercel/`

### 🔒 Seguridad (advisors Supabase)
- 10 funciones `SECURITY DEFINER` ejecutables por `authenticated` (helpers RLS — hardening pendiente)
- Protección de contraseñas filtradas desactivada (activar en Auth → Policies)

---

## 6. Próximos pasos (priorizados)

1. **Sincronizar env vars completas** — `vercel env pull` para que las APIs server funcionen en local
2. **Hardening SQL** — Revocar EXECUTE público de las 10 funciones SECURITY DEFINER
3. **Fiabilidad de APIs** — Estados de error honestos (distinguir "cero real" de "no pude cargar")
4. **Mover agregaciones a SQL (RPC)** — Las vistas traen ~50K filas al navegador; RPCs de resumen en Postgres
5. **Panel "Puesta a punto"** — Checklist de configuración por tenant (Meta Ads, objetivos, formularios)

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
- **Último commit:** `74ac2d2` — "fix: route tenant AI through configured provider (#60)"
- **Historial:** PRs mergeados (#58, #59, #60) — mantener flujo de PRs para cambios significativos
- **Antes de push:** Ejecutar `npm run quality` completo

---

## 9. Notas para agentes

### Claude Code
- Usa `.claude/` para configuración. Lee `PROJECT_CONTEXT.md` al inicio.
- Puede ejecutar `npm run quality` directamente (tiene Node en PATH).

### Codex
- Usa `.codex/` para configuración. Lee `PROJECT_CONTEXT.md` al inicio.
- Verificar Node disponible antes de ejecutar scripts.

### Freebuff
- Sandbox no puede leer `~/Documents` (TCC). Trabaja desde `/tmp/growthops-preview`.
- Supabase MCP disponible para queries de BD, advisors, logs de producción.
- Launchd para procesos persistentes (sobreviven reinicios).
- Usar Finder vía AppleScript para copiar archivos desde `~/Documents`.
