# Codex — Growth-Ops-App

Lee `PROJECT_CONTEXT.md` en la raíz del repo para el estado completo del proyecto.

## Quick start
```bash
npm run quality   # format + lint + typecheck + test + test:metrics
npm run dev       # next dev en localhost:3000
```

## Convenciones clave
- Helpers de formato: `formatNumber`/`formatPercent` de `@/lib/utils` (NO inline `toLocaleString`)
- API routes: `app/api/[tenant]/evergreen/...` con `requireTenant()` de `lib/auth/`
- Tests: `tests/*.test.mjs` con Node.js test runner nativo
- Multi-tenancy: Rutas `[tenant]/...` con RLS en Supabase
