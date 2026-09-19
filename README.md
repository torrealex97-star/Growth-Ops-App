# Growth Ops

**Sistema operativo de crecimiento multi-tenant**: CRM, ventas, marketing, finanzas y analítica en una sola aplicación Next.js, donde cada empresa trabaja en su propia **subcuenta aislada** dentro de la misma plataforma.

[![CI](https://github.com/torrealex97-star/Growth-Ops-App/actions/workflows/ci.yml/badge.svg)](https://github.com/torrealex97-star/Growth-Ops-App/actions/workflows/ci.yml)

> 🔒 **Privacidad por diseño.** Este repositorio es **la herramienta**, no los datos. No contiene — ni debe contener nunca — información de ningún negocio que use la plataforma: clientes, emails, marcas, métricas o credenciales viven exclusivamente en la base de datos y variables de entorno de cada operador. Ver [Seguridad y privacidad](#seguridad-y-privacidad).

---

## Qué es

Plataforma de operaciones para negocios de venta consultiva (closers, admisiones, marketing de resultados) que necesita gobernar **todo el funnel en un único lugar**:

```
Lead → Agenda → Show → Oferta → Venta → Cobro → Entrega
```

Cada subcuenta (tenant) tiene sus propios usuarios, roles, contactos, pipelines, integraciones, dashboards y branding — aislados a nivel de base de datos.

## Arquitectura multi-tenant

- **Aislamiento por RLS**: cada tabla conoce su `tenant_id` y las políticas de Row Level Security de Postgres garantizan que ninguna consulta cruce subcuentas, cualquiera que sea la ruta de acceso.
- **Router por slug**: `app/[tenant]/…` sirve la app completa por subcuenta; la home pública es el selector de subcuentas.
- **Invariante verificado**: la suite de tests incluye una comprobación automática contra el esquema vivo (OpenAPI de PostgREST) de que **ninguna tabla puede nacer fuera de una subcuenta**.
- **58 migraciones SQL versionadas** en `supabase/migrations/` — el esquema completo se reconstruye desde cero con `supabase db push`.

## Módulos

| Área | Incluye |
|---|---|
| **CRM y actividad** | Leads y contactos canónicos (dedupe por email/teléfono), pipeline, actividades, cohorts, merge de duplicados |
| **Ventas** | Funnel de llamadas (booked → show → oferta → cierre), registro de ventas por producto con override auditado, contratos con firma pública y generación de PDF |
| **Marketing** | Campañas, dashboard de Meta Ads con normalizador de `actions[]` (0 ≠ NULL), afiliados y colaboradores con comisiones, Instagram, primer `tracker.js` first-party embebible |
| **Finanzas** | Cobros y conciliación, cash canónico con dedupe multi-fuente (Stripe primario), P&L, unit economics, comisiones |
| **Analítica** | Dashboards con estado Target vs Actual, KPIs configurables por scope, control de calidad de datos (atribución, duplicados, huérfanos), auditoría |
| **Producto y clientes** | Productos y precios, alumnos/entregables, retención, eventos CSM |
| **IA** | Agente interno con memoria e insights, detección de anomalías y seguimiento de uso |

## Integraciones

Supabase (Postgres + Auth + RLS) · Meta Ads (Insights API) · Stripe · Google Calendar / Sheets (OAuth) · Fathom (meetings) · GA4 · Resend (email) · Vercel Blob · Sentry · Anthropic (agente IA).

Toda credencial vive en las variables de entorno del despliegue o cifrada por tenant en la base de datos — jamás en el código.

## Stack

- **Next.js 15 (App Router) + React 18 + TypeScript**
- **Tailwind CSS + Radix UI** (patrón shadcn) y **Recharts** para visualizaciones
- **Supabase** (Postgres, Auth, Storage, RLS como capa de seguridad primaria)
- **Tests nativos con `node:test`** + invariantes multitenant contra el esquema real
- **GitHub Actions** como quality gate en cada push y PR
- Despliegue en **Vercel**

## Arranque rápido

Requisitos: **Node 24** y una cuenta de [Supabase](https://supabase.com).

```bash
# 1. Clonar e instalar
git clone https://github.com/torrealex97-star/Growth-Ops-App.git
cd Growth-Ops-App
npm ci

# 2. Configurar entorno
cp .env.local.example .env.local
#    Rellena las variables con los valores de TU proyecto de Supabase
#    (los obtienes en tu dashboard de Supabase o tu gestor de contraseñas).

# 3. Crear el esquema en tu proyecto
npx supabase db push        # aplica las 58 migraciones de supabase/migrations/
npm run tipos:bd            # regenera los tipos de BD desde TU esquema

# 4. Arrancar
npm run dev                 # http://localhost:3000
```

> ⚠️ Los valores de `.env.local` son **tuyos y de tu despliegue**. Nunca los commitees: la configuración de CI/Vercel usa placeholders y secrets del repositorio, no valores reales.

### Scripts útiles

| Comando | Qué hace |
|---|---|
| `npm run quality` | Gate completo: format + lint + typecheck + tests + métricas |
| `npm run dev` / `build` | Desarrollo / build de producción |
| `npm run test` · `npm run test:metrics` | Suite unitaria · invariante de métricas y esquema |
| `npm run tipos:bd` | Regenera `lib/types/database-generated.ts` desde el esquema |
| `npm run dead-code` | Detección de código muerto con knip |

## CI

Cada push y PR ejecuta, en paralelo y con build condicionado a que lo anterior pase:

1. **Format · Lint · Typecheck · Dead-code · Tests** (incluye el invariante multitenant contra el esquema vivo)
2. **Secretos (gitleaks, historial completo)** — escanea *todos* los commits con `--redact`; la configuración en `.gitleaks.toml` solo permite los fixtures falsos de test
3. **Build** de producción con placeholders de entorno

El repositorio tiene además **secret scanning + push protection** activados: un secreto filtrado no llega a entrar.

## Seguridad y privacidad

- [`SECURITY.md`](SECURITY.md) — cómo reportar vulnerabilidades de forma **privada** (por favor, no abras issues públicas con hallazgos de seguridad).
- [`docs/SECURITY_PRIVACY.md`](docs/SECURITY_PRIVACY.md) — reglas del proyecto sobre qué nunca se commitea: credenciales (también las de staging), datos de negocio, identidad de personas, infraestructura de tenants. La herramienta no sabe — ni debe saber — de qué empresa son los datos que guarda.
- **Contribuciones**: si tu PR incluye ejemplos, usa placeholders neutros (`tu-proyecto`, `Academia Demo`, `closer@ejemplo.com`). El job de gitleaks y la revisión lo verifican.

## Estructura del repositorio

```
app/                  Next.js App Router ([tenant]/ por subcuenta, api/, embed/, firma pública)
components/           Componentes UI y de dashboard
lib/                  Lógica de dominio, clientes (Supabase, Meta, Stripe…), tipos generados
supabase/migrations/  Esquema SQL versionado (RLS, constraints, índices)
tests/                Suites node:test + invariantes de métricas y multitenancy
scripts/              Utilidades de desarrollo y migración
docs/                 Documentación operativa (incluye SECURITY_PRIVACY.md)
```

## Documentación clave

- [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — estado del proyecto y decisiones
- [`AGENTS.md`](AGENTS.md) · [`CLAUDE.md`](CLAUDE.md) — convenciones para agentes y desarrolladores
- [`CHANGELOG.md`](CHANGELOG.md) — historial de cambios

---

Sin licencia de uso — todos los derechos reservados.
