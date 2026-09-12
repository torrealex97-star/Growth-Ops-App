# Relevo activo

Última actualización: 2026-09-12 (Claude Code)

## Estado canónico

- Rama fuente de verdad: `main`
- Último commit en `main`: `5a04d2f` — rediseño visual del embudo de ads en Campañas (#28).
- CI de `main`: verde.
- Despliegue de Vercel: `https://growth-ops-weld.vercel.app` (proyecto `growth-ops`, team `app-b1af`).
- **PR activa sin fusionar**: #29 (`claude/handoff-update`) — validada localmente (typecheck/lint/tests/build PASS), CI en GitHub en curso al redactar esto. Contiene 3 commits: este relevo, consistencia visual en AdsTable/AdsFunnelPanel, y el MVP del agente de IA (sección 5). El siguiente asistente debe RETOMAR esta rama, no crear una nueva.

## Hecho en esta sesión (Claude Code, con acceso real a Supabase MCP)

1. **Corregido el bloqueo de migraciones** que dejó el relevo anterior: las 4 migraciones señaladas (`stripe_customers`, `contact_merge`, `fathom_meeting_id`, `campaign_targets`) fueron VERIFICADAS ausentes en el proyecto Supabase real (`rgcbveflosqgxrcqlqzv`) y APLICADAS ahí mismo (son aditivas: `CREATE TABLE`/`ADD COLUMN IF NOT EXISTS`, sin riesgo de pérdida de datos; dependían solo de funciones/tablas ya presentes — `is_admin_or_director`, `get_my_role`, `auth_tenant_ids`, `is_super_admin`, `handle_updated_at`, `tenants` — verificadas antes de aplicar). VERIFICADO tras aplicar: las 3 tablas y la columna existen; `get_advisors` (security) no muestra hallazgos nuevos atribuibles a este cambio (solo warnings preexistentes: `merge_contacts` con search_path mutable — mismo patrón que otras funciones ya en el proyecto, no se corrigió, `OUT_OF_SCOPE_FINDING`).
2. **Ampliado el diagnóstico de drift real**: `list_migrations` de Supabase solo registra 7 migraciones aplicadas de las 20 que hay en `supabase/migrations/`. Las 14 restantes están en dos categorías distintas — no asumir que "no está en el historial" = "no está en el esquema":
   - **DRIFT (probablemente ya aplicadas fuera de tracking)**: `fix_rls_p0`, `fix_rls_p0_round2`, `multi_tenant_foundation`, `multi_tenant_domain_tables`, `fix_cron_unique_constraints`, `tenant_scope_singleton_constraints`, `tenant_scope_users_rls`. Verificado parcialmente: `contacts.tenant_id` existe, `auth_tenant_ids()`/`is_admin_or_director()` existen, `contacts` tiene 3 políticas RLS. **NO se verificó exhaustivamente cada una** — sigue siendo `NOT_VERIFIED` a nivel de detalle (constraints exactos, políticas INSERT/UPDATE/DELETE completas por tabla).
   - **CONFIRMADO genuinamente ausente**: `20260911190000_drop_partners.sql` (la tabla `partners` SIGUE existiendo en producción) y `20260911200000_financial_integrity_constraints.sql` (no existe ningún constraint `UNIQUE`/anti-doble-cobro en `sales` con ese patrón de nombre). Estas dos NO se aplicaron esta sesión — son HIGH/CRITICAL reales y requieren la revisión de compatibilidad/rollback que pide `AGENTS.md` antes de tocarlas (en particular `drop_partners` es potencialmente destructivo si `partners` tiene filas con datos reales — **verificar contenido antes de aplicar**, no asumir que está vacía).
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
   - **Deliberadamente fuera de este MVP** (fase 2 explícita del propio brief, no descuido): RAG/pgvector + Knowledge Base de documentos, integración Google Drive, routing multi-proveedor (Gemini/DeepSeek — hoy solo hay credenciales de Anthropic), streaming de respuesta, Insight Engine proactivo (análisis programados/por evento), acciones de escritura, cost dashboard/budgets, evals de seguridad (prompt injection, cross-tenant) automatizados.

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
2. Revisar `drop_partners` (¿tiene `partners` filas reales?) y `financial_integrity_constraints` como cambios HIGH/CRITICAL aparte, con su propia rama — no aplicar a ciegas.
3. Verificar en detalle el resto del drift listado arriba (RLS completo por tabla) antes de declarar el multi-tenant "cerrado".
4. Auditoría/ampliación de atribución a nivel de anuncio individual (`campaign_ads`) — pendiente del rediseño de Campañas, fuera de alcance de la PR #28.
5. **PR #29 pendiente de mergear** — revisar CI y hacerlo si está verde. Después: smoke test real del agente de IA (ver punto 5 de "Hecho en esta sesión") antes de anunciarlo a los usuarios finales.
6. Fase 2 del agente de IA (si el MVP se valida bien): RAG/pgvector para Knowledge Base de documentos, Google Drive, Insight Engine proactivo — todo con su propia auditoría antes de implementar, igual que se hizo para el MVP.

## Regla de continuidad

Si existe un único PR o rama activa, continuar allí. No crear una segunda rama. Si el trabajo está validado, fusionarlo a `main`, verificar CI/despliegue y eliminar la rama antes de cerrar la sesión. Al cierre de esta sesión no queda ninguna rama `claude/*` activa sin fusionar.
