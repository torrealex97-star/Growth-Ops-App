# Relevo activo

Última actualización: 2026-09-12 (Claude Code)

## Estado canónico

- Rama fuente de verdad: `main`
- Último commit en `main`: `b6809b5` — relevo + consistencia visual en Anuncios + agente de IA MVP y fase 2 (#29, mergeada).
- CI de `main`: verde.
- Despliegue de Vercel: `https://growth-ops-weld.vercel.app` (proyecto `growth-ops`, team `app-b1af`).
- PR abiertos al redactar este relevo: ninguno. Después de mergear #29 se aplicó además, directamente sobre Supabase (sin PR de código porque la migración ya estaba en el repo desde antes, solo no aplicada): `financial_integrity_constraints`.

## Hecho en esta sesión (Claude Code, con acceso real a Supabase MCP)

1. **Corregido el bloqueo de migraciones** que dejó el relevo anterior: las 4 migraciones señaladas (`stripe_customers`, `contact_merge`, `fathom_meeting_id`, `campaign_targets`) fueron VERIFICADAS ausentes en el proyecto Supabase real (`rgcbveflosqgxrcqlqzv`) y APLICADAS ahí mismo (son aditivas: `CREATE TABLE`/`ADD COLUMN IF NOT EXISTS`, sin riesgo de pérdida de datos; dependían solo de funciones/tablas ya presentes — `is_admin_or_director`, `get_my_role`, `auth_tenant_ids`, `is_super_admin`, `handle_updated_at`, `tenants` — verificadas antes de aplicar). VERIFICADO tras aplicar: las 3 tablas y la columna existen; `get_advisors` (security) no muestra hallazgos nuevos atribuibles a este cambio (solo warnings preexistentes: `merge_contacts` con search_path mutable — mismo patrón que otras funciones ya en el proyecto, no se corrigió, `OUT_OF_SCOPE_FINDING`).
2. **Ampliado el diagnóstico de drift real**: `list_migrations` de Supabase solo registra 7 migraciones aplicadas de las 20 que hay en `supabase/migrations/`. Las 14 restantes están en dos categorías distintas — no asumir que "no está en el historial" = "no está en el esquema":
   - **DRIFT (probablemente ya aplicadas fuera de tracking)**: `fix_rls_p0`, `fix_rls_p0_round2`, `multi_tenant_foundation`, `multi_tenant_domain_tables`, `fix_cron_unique_constraints`, `tenant_scope_singleton_constraints`, `tenant_scope_users_rls`. Verificado parcialmente: `contacts.tenant_id` existe, `auth_tenant_ids()`/`is_admin_or_director()` existen, `contacts` tiene 3 políticas RLS. **NO se verificó exhaustivamente cada una** — sigue siendo `NOT_VERIFIED` a nivel de detalle (constraints exactos, políticas INSERT/UPDATE/DELETE completas por tabla).
   - **`financial_integrity_constraints` — APLICADA y VALIDADA** (tras el hallazgo de arriba): es 100% aditiva (índices + `ADD CONSTRAINT ... NOT VALID`), verificado antes de aplicar que `expenses.status`/`campaigns.status` no tenían ningún valor fuera de lista (`SELECT DISTINCT ... WHERE status NOT IN (...)` → 0 filas en ambas), así que los dos CHECK se validaron (`VALIDATE CONSTRAINT`) en el mismo paso, no se dejaron `NOT VALID` indefinidamente. `get_advisors` (security) sin hallazgos nuevos.
   - **`drop_partners` — EJECUTADA con confirmación explícita del usuario ("Si bórrala...")**: `DROP TABLE IF EXISTS public.partners;` aplicado en Supabase real. Las 3 filas que tenía (Adrián Martínez 55%, Alex 30%, Jesús Peña 15%) se perdieron de forma irreversible, tal y como se advirtió antes de ejecutar. El mismo mensaje del usuario pidió explícitamente **recrear** un lugar para gestionar socios y su % de beneficios — ver punto 7 más abajo.
3. **Backfill de ventas de Stripe (women-digital-closer)** — se resolvió el motivo por el que nunca pudo ejecutarse:
   - **Tenant correcto identificado**: es `women-digital-closer`, no `evergreen` — Claudia Martínez (`claudia.martinezf.03@gmail.com`) es miembro de `women-digital-closer`, y ese tenant no tenía NINGÚN producto.
   - **Producto creado**: `products` (`id=abbf35fa-586f-4053-a8b5-4e54f2469510`, `name='Women Digital Closer'`, `tenant_id='74c7fab3-7ea6-47ed-a8d3-97f839bab3b2'`) — nombre dado explícitamente por el usuario en esta misma sesión, no inventado.
   - **Stripe ya está configurado** para ese tenant (`integration_settings` tiene `STRIPE_SECRET_KEY` con valor, cifrado — no se leyó ni se puede leer el valor real desde SQL).
   - **`stripe_customers` sigue vacía (0 filas)** para ese tenant: el sync "Sincronizar clientes" (Integraciones → Stripe) nunca se ha ejecutado — ahora que la tabla existe, ya puede correr.
4. **PR #26, #27, #28 mergeadas** (seguridad Dependabot/Next 15, objetivos ROAS/CAC/CPL, rediseño visual de Campañas). Ver detalle en los commits de `main`.
5. **MVP del agente de IA empresarial (chat flotante)** — en PR #29, sin fusionar todavía:
   - Auditoría previa (read-only) confirmó: no existía vector store/pgvector, no había proveedor de IA abstraído (solo `@anthropic-ai/sdk` directo en `lib/ai/claude.ts` y `lib/setting-ai/core.ts`, modelos hardcodeados), no había registry de tools MCP, `canonical_events`/`analytics_*` ya existían (vacías), cron/jobs vía Vercel Cron + `pg_cron` ya existían.
   - Migración `ai_agent` (aplicada ya en Supabase real): `ai_conversations`, `ai_messages`, `ai_tool_calls`. RLS: conversación privada del usuario (`user_id = auth.uid()`) + aislamiento por tenant.
   - `lib/ai/agent/tools.ts`: 7 tools de solo lectura reutilizando cálculos canónicos existentes (`lib/ads/funnel.ts`, `lib/contact-timeline.ts`, `isActiveSale`) — nada de SQL libre ni cálculo manual de métricas por el LLM.
   - `lib/ai/agent/gateway.ts`: bucle de tool-use de Claude (máx. 4 rondas), reglas explícitas anti-alucinación/anti-injection/anti-fuga-entre-tenants en el system prompt.
   - `app/api/[tenant]/evergreen/ai/agent/route.ts`: usa el cliente AUTENTICADO del usuario (no service role) — el aislamiento lo aplican las RLS ya existentes de cada tabla de negocio, no una capa nueva.
   - `components/ai/AgentLauncher.tsx`: launcher + panel flotante (desktop) / sheet a pantalla completa (mobile), montado en `app/[tenant]/layout.tsx`.
   - **NOT_VERIFIED**: no se ha probado en navegador real (login, preguntar algo, comprobar aislamiento cruzado WDC↔Evergreen con dos usuarios reales) — sin entorno de browser en esta sesión. Antes de dar el agente por "funcionando", alguien con acceso real debe: (a) abrir el chat en cada tenant y confirmar que responde con datos de ESE tenant, (b) intentar explícitamente pedir datos del otro tenant y confirmar que se deniega, (c) revisar `ai_tool_calls` para confirmar que el log de auditoría se está poblando.
   - **Deliberadamente fuera de este MVP** (fase 3 explícita del propio brief, no descuido): RAG/pgvector + Knowledge Base de documentos, integración Google Drive, routing multi-proveedor (Gemini/DeepSeek — hoy solo hay credenciales de Anthropic), streaming de respuesta, acciones de escritura, cost dashboard/budgets, evals de seguridad (prompt injection, cross-tenant) automatizados.
6. **Fase 2 del agente de IA** (misma PR #29) — arquitectura híbrida RAG+Data+Memory+Proactive pedida por el usuario, implementada en la parte de mayor apalancamiento que no depende de RAG:
   - Descubierto al auditar: `analyzeCall()` (`lib/ai/claude.ts`) existía como código pero nunca se ejecutaba — 0 de 555 citas tenían `ai_analysis` pese a que 62 tienen transcripción. Nuevo cron `cron/analyze-calls` lo rellena en lotes de 15.
   - `lib/ai/metrics/registry.ts`: capa semántica de negocio (definición/fórmula/fuente de cada métrica canónica), consultable por tool `getMetricDefinition`.
   - Root Cause Analysis determinista: `analyzeFunnelChange`/`comparePeriods` descomponen el funnel entre dos periodos y señalan la etapa con mayor cambio — el system prompt obliga a usarlas antes de explicar por qué cambió una métrica agregada.
   - Voice of Customer / Sales Intelligence agregados: `getTopObjections`/`compareClosers`, sobre `ai_analysis` ya poblado — sin nueva llamada al LLM por consulta.
   - Memoria de negocio explícita: tabla `ai_business_facts` (hechos/hipótesis/decisiones/resultados, `outcome_of` enlaza DECISION→OUTCOME) — solo se escribe cuando el usuario confirma el hecho en su propio mensaje (regla de system prompt, no automática).
   - Insights proactivos deterministas: tabla `ai_insights` + `lib/ai/insights/detectors.ts` + cron `cron/ai-insights` — compara 7 días vs 7 anteriores con umbrales fijos (CAC +25%, ROAS -20%, show/close rate -15%). El LLM NUNCA corre en bucle vigilando el negocio; el resumen se redacta con plantilla de datos exactos. Dedup por fingerprint (tenant+tipo+semana).
   - **`cron/analyze-calls` y `cron/ai-insights` NO están en `vercel.json`** — el plan de Vercel es Hobby y ya hay 3 crons registrados; añadir más podría romper el despliegue. Hay que dispararlos manualmente con `CRON_SECRET` o configurarlos vía `pg_cron` de Supabase (mismo patrón que "Auto 30 min" de Meta) — **decisión pendiente de alguien con acceso a Vercel para confirmar el límite real del plan**.
   - **Fuera de esta fase 2** (fase 3 explícita): RAG/pgvector, Google Drive/Notion, Business Graph como grafo explícito, Creative Intelligence, Experiment Engine, Model Router multi-proveedor, Daily Executive Brief, Insight Feed completo (solo hay un indicador ligero en el chat), Business Health Score.
7. **Recreada la gestión de socios y % de beneficios** (tras ejecutar `drop_partners`, a petición explícita del usuario en el mismo mensaje de confirmación): migración `partners` (aplicada ya en Supabase real, tabla limpia — sin el `user_id` opcional sin uso que tenía la original), RLS estándar (`partners_admin_write` con `is_admin_or_director()`, `partners_select_team` con `get_my_role() IS NOT NULL`, aislamiento `RESTRICTIVE` multi-tenant). Página `app/[tenant]/settings/socios/page.tsx` (añadir/activar/desactivar/eliminar socio con nombre + % + notas, con aviso visual si el total de % activos supera 100%), con entrada nueva en el índice de settings. `get_advisors` (security) sin hallazgos nuevos atribuibles a este cambio. `typecheck`/`lint`/`next build` en limpio. Commit `016c8e5` en `claude/financial-constraints-handoff` (mismo PR #30, sin abrir rama nueva).

## Bloqueo actual (lo único que impide terminar el backfill de Stripe)

Los dos endpoints que faltan ejecutar (`POST .../settings/integraciones/stripe-customers` y `POST .../admin/backfill-stripe-sales`) exigen una sesión de Supabase Auth real de un usuario admin/director de `women-digital-closer` (`requireTenant` lee la cookie de sesión). Claude Code no tiene esas credenciales ni debe tenerlas — es una decisión de acceso, no técnica.

## Próxima acción exacta

1. Un admin/director de `women-digital-closer`, logueado en `https://growth-ops-weld.vercel.app/women-digital-closer/...`, abre la consola del navegador y ejecuta, en este orden:
   ```js
   // 1) Sincroniza clientes de Stripe (rellena stripe_customers)
   await fetch('/api/women-digital-closer/evergreen/settings/integraciones/stripe-customers', { method: 'POST' }).then(r => r.json())

   // 2) Preview del backfill (dryRun por defecto — no escribe nada)
   await fetch('/api/women-digital-closer/evergreen/admin/backfill-stripe-sales', {
     method: 'POST', headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ ownerEmail: 'claudia.martinezf.03@gmail.com', dryRun: true }),
   }).then(r => r.json())

   // 3) Solo si el preview del paso 2 es correcto: ejecuta de verdad
   await fetch('/api/women-digital-closer/evergreen/admin/backfill-stripe-sales', {
     method: 'POST', headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ ownerEmail: 'claudia.martinezf.03@gmail.com', dryRun: false }),
   }).then(r => r.json())
   ```
2. ~~Confirmar `drop_partners`~~ — hecho: ejecutado y la funcionalidad de socios recreada (punto 7 arriba). Falta: confirmar CI de PR #30 en verde y mergear cuando el usuario lo indique.
3. Verificar en detalle el resto del drift listado arriba (RLS completo por tabla) antes de declarar el multi-tenant "cerrado".
4. Auditoría/ampliación de atribución a nivel de anuncio individual (`campaign_ads`) — pendiente del rediseño de Campañas, fuera de alcance de la PR #28.
5. Smoke test real del agente de IA (ver punto 5 de "Hecho en esta sesión") antes de anunciarlo a los usuarios finales — sigue `NOT_VERIFIED`.
6. Decidir cómo disparar `cron/analyze-calls` y `cron/ai-insights` (no están en `vercel.json` por el límite del plan Hobby de Vercel) — probablemente vía `pg_cron` de Supabase, igual que "Auto 30 min" de Meta.
7. Fase 3 del agente de IA (si las fases 1-2 se validan bien): RAG/pgvector para Knowledge Base de documentos, Google Drive/Notion, Model Router multi-proveedor — todo con su propia auditoría antes de implementar, igual que se hizo para las fases anteriores.

## Regla de continuidad

Si existe un único PR o rama activa, continuar allí. No crear una segunda rama. Si el trabajo está validado, fusionarlo a `main`, verificar CI/despliegue y eliminar la rama antes de cerrar la sesión. Al cierre de esta sesión no queda ninguna rama `claude/*` activa sin fusionar.
