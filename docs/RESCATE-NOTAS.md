# Rescate del checkout `~/Documents/VIBE APPS - CODE/Alex Torre/Scalix Systems App`

**Fecha:** 2026-09-21 · **Origen:** cierre de la consolidación a una sola carpeta local
(`~/GIT HUB/Growth-Ops-App`). Esta rama existe para que retirar la carpeta antigua no destruya
nada irreversible.

## Veredicto de la auditoría (por qué NO se fusiona nada de esto a main)

El checkout estaba en `2af651a` (6 commits detrás de origin/main) con 17 ficheros modificados.
Análisis byte a byte contra `origin/main`:

- **Ya fusionados e idénticos (sin cambios reales):** `lib/ai/knowledge.ts`,
  `lib/ai/agent/gateway.ts`, `lib/ai/agent/tools.ts`, `scripts/ingestar-knowledge.mjs`,
  `app/[tenant]/settings/ai-knowledge/page.tsx`,
  `app/api/[tenant]/evergreen/ai/knowledge/route.ts`, `tests/rag-inspector.test.mjs`,
  `supabase/migrations/20260920120000_knowledge_types_filter.sql`, `PENDIENTES.md`
  (entran vía PRs #88, #92 y #95).
- **Copias ANTIGUAS de ficheros que main mejoró (incorporarlas sería una regresión):**
  - `lib/funnels/queries.ts` — el working tree **carece** del filtrado de etapas Meta por
    `campaign_funnel_assignments` que main sí tiene (commit 514dcc2 es ancestro; la copia local
    es anterior, mtime 18-sep).
  - `lib/payments/control-personas.ts` y `tests/control-pagos-personas.test.mjs` — mismo
    contenido lógico que main; solo difiere el formateo Prettier que main pasó en `61727cc`.
- **docs S0/A0/ACTIVE_HANDOFF** — idénticos a main (PRs #97–#100).

## Contenido de esta rama (solo seguridad)

- `docs/00-CONSTITUCION.md` — el draft sin trackear del checkout antiguo. Mismo contenido que la
  versión ya fusionada (PR #96): la diferencia son las líneas de relleno de las tablas Markdown
  que aplica Prettier. Se conserva por si algún matiz del borrador interesa.
- `lib/funnels/queries.ts` — copia antigua (sin filtrado por campañas asignadas).
- `lib/payments/control-personas.ts` y `tests/control-pagos-personas.test.mjs` — variantes de
  formato Prettier previas al gate.
- Este documento.

**No se abre PR a main:** no hay trabajo nuevo que fusionar. Si algún día se echa de menos algo
de aquí, se puede cherry-pickear a mano con revisión — nunca hacer merge directo de esta rama.
