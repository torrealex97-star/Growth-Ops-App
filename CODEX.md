# Codex — growth-ops-app

Lee `PROJECT_CONTEXT.md` en la raíz del repo para el estado completo del proyecto.

## Quick start
```bash
npm run quality   # format + lint + typecheck + test + test:metrics
npm run dev       # next dev en localhost:3000
```

## Skills del proyecto
Las skills del repo (ventas, marketing, supabase, apify, visualización, testing, oauth…) viven
en `.agents/skills/<nombre>/SKILL.md` (canónico y versionado). `.claude/skills/` son symlinks
al mismo contenido. Codex lee esos ficheros directamente — lee `SKILL.md` de la skill
aplicable ANTES de tocar su dominio (ventas/crm → `sales-engineering`; landings/VSL/copy →
`marketing-and-copywriting`; ver lista completa en `PROJECT_CONTEXT.md` §2).

## Convenciones clave
- **Privacidad (obligatorio):** nada de tenants, personas o credenciales en commits — ni en docs,
  comentarios ni "solo en privado". Placeholders neutros y procedimiento en `docs/SECURITY_PRIVACY.md`
- Helpers de formato: `formatNumber`/`formatPercent` de `@/lib/utils` (NO inline `toLocaleString`)
- API routes: `app/api/[tenant]/evergreen/...` con `requireTenant()` de `lib/auth/`
- Tests: `tests/*.test.mjs` con Node.js test runner nativo
- Multi-tenancy: Rutas `[tenant]/...` con RLS en Supabase
