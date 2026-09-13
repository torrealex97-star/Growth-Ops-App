# Relevo activo

Última actualización: 2026-09-13 (Claude Code)

## CIERRE DE SESIÓN 2026-09-13 — estado real y qué decide quién

Rama: `claude/financial-constraints-handoff` (PR #30). Árbol limpio, todo empujado, CI verde en cada
commit. Nada quedó a medias: la fase J no se empezó **a propósito**, porque va en PR aparte.

### Fases del brief

| Fase | Qué                                    | Estado                                       |
| ---- | -------------------------------------- | -------------------------------------------- |
| A    | Desbloquear #30                        | ✅ migraciones aplicadas, historial reparado |
| B    | UX de Configuración                    | ✅                                           |
| C    | Capa canónica de funnels               | ✅                                           |
| D    | GA4 (OAuth + sync)                     | ✅ código; **sin ejecutar contra Google**    |
| E    | Sección Funnels                        | ✅                                           |
| F    | CRM → Agenda, ficha, Fathom            | ✅                                           |
| G    | Grabaciones (testimonios ya existía)   | ✅                                           |
| H    | Facturas por Gmail                     | ✅ código; **sin ejecutar contra Gmail**     |
| I    | Stripe (informe) y diagnóstico de Meta | ✅                                           |
| J    | Aprovisionador de subcuentas           | ✅ MVP, en rama aparte (ver abajo)           |

### Dos ramas, no una

- `claude/financial-constraints-handoff` → **PR #30** (abierto, CI verde, sin conflictos). Fases A-I,
  más dos cosas añadidas después de cerrarlo la primera vez: la pantalla que resuelve la cola de
  Fathom (CRM › Llamadas sin atribuir) y el mapeo de eventos de landing/VSL (`/funnels/eventos`), que
  era el único bloqueo que quedaba en Funnels y no necesitaba ninguna decisión tuya.
- `claude/app-continuation-lpbupf` → **fase J**, sin PR abierto todavía. Sale de la punta de #30
  porque depende de los únicos por subcuenta sobre `slug` que van ahí: sin ellos, cada subcuenta nueva
  chocaría en los slugs naturales. Fusionar #30 primero.

### Lo que NO está verificado, y hay que saberlo antes de fusionar

Ninguna pantalla nueva se ha abierto con una sesión real y datos, y ninguna integración se ha
ejecutado contra su API. En este entorno no hay credenciales de la app (solo acceso administrativo
por MCP a Supabase). Lo que sí está probado: la lógica pura con tests, y el comportamiento de cada
tabla contra Postgres real vía dry-run.

En concreto siguen sin probar de punta a punta: el flujo OAuth de Google, el sync de GA4, el buzón de
Gmail, el informe de Stripe, la subida de grabaciones (usa `crypto.subtle`) y la pantalla de Funnels.

### Decisiones que son del usuario, no mías

1. **Rotar el Client Secret de Google.** Se pegó en un chat, así que ya no es secreto. Generar uno
   nuevo y pegarlo en Configuración → Integraciones → Google (ahí se cifra). No lo guardé yo porque
   `CONFIG_ENC_KEY` es un placeholder en este entorno y habría quedado ilegible para la app.
2. **Frecuencia de Meta.** Los crons ya están programados en `vercel.json`, pero a diario. Para
   recuperar los 30 minutos del diseño original: habilitar `pg_cron` + `pg_net` en producción, o
   pagar Vercel Pro. Ninguna la decido yo. Ver `DIAGNOSTICO_SINCRONIZACIONES.md`.
3. **`reels` y `youtube-backfill`** siguen sin programar a propósito: una genera borradores que hay
   que revisar, la otra consume cupo de la API de YouTube.
4. **Registrar en lote los pagos `registrable`** del informe de Stripe. Requiere asignar producto y
   plan de pago, y eso escribe en la tabla de la que salen facturación y comisiones.
5. **Pantalla para resolver `fathom_match_review`.** Los casos dudosos se anotan bien; resolverlos hoy
   requiere tocar la tabla a mano. Deliberadamente no construí una pantalla vacía.
6. **Mapeo de eventos de landing/VSL.** `canonical_events.event_name` es texto libre. Hay que listar
   los nombres que llegan de verdad y que el usuario diga cuál es cada etapa. **No inventar un
   vocabulario**: esas etapas de Funnels salen hoy como "fuente sin configurar", que es la verdad.

### Disciplina que conviene mantener

Once migraciones aplicadas hoy, **cada una con dry-run previo** (`BEGIN`/`ROLLBACK` probando el
COMPORTAMIENTO, no solo que la DDL compile) y verificación posterior. Varias cazaron fallos reales
antes de tocar producción: un mensaje de error mal formado, un id de destino nulo, un unique que
habría sido global. No aplicar migraciones sin ese paso.

Y la regla que atraviesa todo lo de hoy: **un hueco no es un cero**. Un fallo de fuente, una fuente
sin configurar y un cero medido son tres cosas distintas, y la UI tiene que distinguirlas.

## Qué se está haciendo ahora y qué sigue (2026-09-13)

**La hoja de ruta viva está en `docs/ROADMAP_MVP.md`.** Ahí está el estado de cada fase, las
decisiones ya tomadas por el usuario y lo que sigue bloqueado esperándole. Criterio acordado:
**MVP funcional de todo antes que una sola cosa perfecta**, con el avance reportado en cada PR.

Avance de esta sesión, todo sobre `claude/financial-constraints-handoff` (PR #30):

| Commit    | Qué                                                                                                   |
| --------- | ----------------------------------------------------------------------------------------------------- |
| `8e20a44` | P0: `cron/monthly` dejaba a una sesión escribir gastos en TODAS las subcuentas + tests de aislamiento |
| `f4f028a` | Fase B de UX: Configuración a un solo nivel, negocio fuera de Integraciones, Auditoría dentro         |
| (este)    | Fase C: capa canónica `lib/funnels/` con tests, sin UI todavía                                        |

**Próximo paso para quien recoja el relevo (Codex incluido):** fase J — el aprovisionador de
subcuentas, **en PR aparte** como pidió el usuario. Ojo con un fallo que ya bloqueaba esto y se
corrigió hoy: tres tablas tenían un único GLOBAL sobre `slug`, así que cada subcuenta nueva chocaba
con los slugs de las demás. Ver `ROADMAP_MVP.md` §3.3.

Pendiente que NO es código y necesita decisión del usuario: pantalla para registrar en lote los pagos
`registrable` del informe de Stripe (asignando producto y plan), habilitar `pg_cron` + `pg_net` si se
quiere la frecuencia original de Meta, y rotar el Client Secret de Google.

Lo aplicado hoy en producción son **once migraciones**, cada una con dry-run previo
(`BEGIN`/`ROLLBACK` probando el COMPORTAMIENTO, no solo que la DDL compile) y verificación posterior.
Mantén esa disciplina: varias cazaron fallos reales antes de tocar nada.

Antes de eso, si hay tiempo: la **pantalla para resolver la cola `fathom_match_review`**. El sync ya
anota los casos dudosos correctamente, pero resolverlos hoy requiere tocar la tabla a mano.

Si tocas el sync de Fathom: la decisión de emparejamiento NO va ahí, va en `lib/fathom/match.ts`
(función pura, 10 tests). **Nunca escribas una transcripción en más de una cita**: eso es lo que
hacía antes y duplicaba llamadas. Ver `ROADMAP_MVP.md` §3.2.

Si vas a tocar Funnels: lee antes `ROADMAP_MVP.md` §3.1, que dice exactamente qué etapas tienen
datos reales y cuáles salen como "fuente sin configurar" y por qué. **No inventes nombres de evento
para `canonical_events`**: es texto libre y el mapeo tiene que elegirlo el usuario.

Regla que no se negocia en nada de esto: una métrica **nunca** colapsa a 0 por un fallo de fuente.
`lib/funnels/types.ts` distingue `ok` / `sin_datos` / `error_fuente`, y la UI tiene que distinguir
los tres. Los tests de `tests/metrics/funnels.test.mjs` lo fijan.

## Estado canónico (2026-09-13)

- **PR #30 ABIERTO y NO fusionable todavía.** Rama activa: `claude/financial-constraints-handoff`.
- **PR #29 ya fusionado** en `main` (`b6809b5`).
- Trabajo en curso sobre los P0/P1 de la revisión de #30. Ver "Pendientes bloqueantes" al final.

### Corrección de una afirmación errónea que estaba en este documento

Se afirmó aquí y en varios commits que **el plan Hobby de Vercel "solo permite 3 crons"** y que por
eso no se registraban los dos jobs de IA. **Eso era falso** y llevó a construir un panel manual como
sustituto de algo que sí se podía programar. Los dos jobs ya están en `vercel.json` con horarios
separados (04:00 y 05:00 UTC).

Lo que sí está verificado del proyecto real, y lo que no:

| Dato                                  | Estado                                                              |
| ------------------------------------- | ------------------------------------------------------------------- |
| Plan del equipo                       | VERIFICADO: `hobby` (vía `list_teams`)                              |
| Logs de runtime (24h)                 | VERIFICADO: 99× 200 y 1× 502. **Ningún 504** entre los principales  |
| Nº máximo de crons del plan           | NO VERIFICADO — las herramientas de doc no devuelven esa tabla      |
| Fluid Compute activo/inactivo         | NO VERIFICADO — no expuesto por las herramientas disponibles        |
| Límite efectivo de `maxDuration`      | NO VERIFICADO — 60s es un valor conservador, no un techo medido     |
| `CRON_SECRET` en Production y Preview | NO VERIFICADO — no hay herramienta para listar variables de entorno |

`maxDuration` se deja en 60s por prudencia: el bucle se autolimita por presupuesto de tiempo y
reporta cuántas llamadas quedan, así que un techo mayor solo haría que cada pasada avance más,
nunca que se corte a medias.

## Estado canónico (2026-09-13)

- **PR #30 ABIERTO y NO fusionable todavía.** Rama activa: `claude/financial-constraints-handoff`.
- **PR #29 ya fusionado** en `main` (`b6809b5`).
- Trabajo en curso sobre los P0/P1 de la revisión de #30. Ver "Pendientes bloqueantes" al final.

### Corrección de una afirmación errónea que estaba en este documento

Se afirmó aquí y en varios commits que **el plan Hobby de Vercel "solo permite 3 crons"** y que por
eso no se registraban los dos jobs de IA. **Eso era falso** y llevó a construir un panel manual como
sustituto de algo que sí se podía programar. Los dos jobs ya están en `vercel.json` con horarios
separados (04:00 y 05:00 UTC).

Lo que sí está verificado del proyecto real, y lo que no:

| Dato                                  | Estado                                                              |
| ------------------------------------- | ------------------------------------------------------------------- |
| Plan del equipo                       | VERIFICADO: `hobby` (vía `list_teams`)                              |
| Logs de runtime (24h)                 | VERIFICADO: 99× 200 y 1× 502. **Ningún 504** entre los principales  |
| Nº máximo de crons del plan           | NO VERIFICADO — las herramientas de doc no devuelven esa tabla      |
| Fluid Compute activo/inactivo         | NO VERIFICADO — no expuesto por las herramientas disponibles        |
| Límite efectivo de `maxDuration`      | NO VERIFICADO — 60s es un valor conservador, no un techo medido     |
| `CRON_SECRET` en Production y Preview | NO VERIFICADO — no hay herramienta para listar variables de entorno |

`maxDuration` se deja en 60s por prudencia: el bucle se autolimita por presupuesto de tiempo y
reporta cuántas llamadas quedan, así que un techo mayor solo haría que cada pasada avance más,
nunca que se corte a medias.

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
   - **`drop_partners` — EJECUTADA con confirmación explícita del usuario ("Si bórrala...")**: `DROP TABLE IF EXISTS public.partners;` aplicado en Supabase real. Las 3 filas que tenía (Socio A 55%, Socio B 30%, Socio C 15%) se perdieron de forma irreversible, tal y como se advirtió antes de ejecutar. El mismo mensaje del usuario pidió explícitamente **recrear** un lugar para gestionar socios y su % de beneficios — ver punto 7 más abajo.
3. **Backfill de ventas de Stripe (women-digital-closer)** — se resolvió el motivo por el que nunca pudo ejecutarse:
   - **Tenant correcto identificado**: es `women-digital-closer`, no `evergreen` — La closer principal (`[tenant]`) es miembro de `women-digital-closer`, y ese tenant no tenía NINGÚN producto.
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

8. **Verificación integral post-implementación del agente de IA + cierre de huecos** (PR #30). Lo que se VERIFICÓ de verdad (código + Supabase real + Vercel): aislamiento por tenant correcto (RLS `own-user` + `RESTRICTIVE` por tenant en las 5 tablas `ai_*` y en `partners`; `ai_messages.tenant_id` nunca difiere del de su conversación — 0 filas); las tools reciben el `tenant_id` resuelto en servidor, nunca del modelo; sin SQL libre; métricas reutilizando `lib/ads/funnel.ts`/`lib/analytics.ts` (cero fórmulas propias); sin duplicados reales en `contacts`/`sales`/`appointments` (el único "duplicado" de agenda era un reschedule legítimo: dos `external_id` distintos de Calendly, uno cancelado); `appointments_tenant_external_id_key` activo (existe como UNIQUE INDEX, no como constraint — `pg_constraint` no lo ve, `pg_indexes` sí); SHA de producción de Vercel = HEAD de `main`.
   - **Bug real encontrado y corregido**: ni `cron/analyze-calls` ni `cron/ai-insights` tenían forma de ejecutarse en producción (no están en `vercel.json`, no hay `pg_cron` — el esquema `cron` no existe en el proyecto — y solo aceptaban `CRON_SECRET`). Resultado medido: 0 de 62 transcripciones analizadas y `ai_insights` vacía, así que `getTopObjections`/`compareClosers`/`getRecentInsights` no tenían nada que devolver. Ahora ambas rutas aceptan sesión de admin/director y hay un panel **Motor de IA** en `settings/data-health` para lanzarlos y ver cuántas llamadas quedan.
   - **Plan de Vercel confirmado `hobby`** (vía `list_teams`): por eso NO se añaden crons a `vercel.json` (ya tiene 3) y por eso `analyze-calls` baja de `maxDuration` 120s → 60s, con el bucle autolimitado por presupuesto de tiempo (45s) — antes pedía una ventana que el plan no concede y el lote de 15 llamadas se cortaba a medias.
   - **Bug real corregido**: el badge de insights del launcher contaba los de `status='new'` y nada los marcaba nunca como vistos → el aviso se quedaba clavado para siempre. Nuevo `PATCH` en la ruta del agente + marcado al abrir el panel.
   - **Tracking de coste, que no existía**: migración `ai_usage_tracking` (aplicada en Supabase real) añade modelo, tokens de entrada/salida/caché, `cost_usd` y `latency_ms` a `ai_messages`, y ahora sí se rellena `ai_tool_calls.latency_ms`. Tarifas centralizadas en `lib/ai/pricing.ts` (Sonnet 5 $2/$10, Haiku 4.5 $1/$5 por millón, verificadas en la doc oficial); `cost_usd` queda NULL si el modelo no está tarifado, en vez de falsear un 0.
   - **NO verificado** (sin navegador ni credenciales reales en la sesión): respuestas del agente end-to-end, aislamiento cruzado WDC↔Evergreen con dos sesiones reales, UI en móvil, accesibilidad, y fallback de proveedor. `.env.local` del repo son **placeholders** (`placeholder.supabase.co`), no credenciales: el acceso real a producción desde la sesión es solo SQL vía MCP.
   - **Bloqueado por credenciales, no por código**: RAG/Knowledge Base necesita un proveedor de _embeddings_ (Anthropic no ofrece embeddings API; no hay claves de Voyage/OpenAI en el proyecto) y el Model Router multi-proveedor necesita más de un proveedor configurado. Mientras eso no exista, media fase 3 no se puede construir de forma honesta.

## Bloqueo actual (lo único que impide terminar el backfill de Stripe)

Los dos endpoints que faltan ejecutar (`POST .../settings/integraciones/stripe-customers` y `POST .../admin/backfill-stripe-sales`) exigen una sesión de Supabase Auth real de un usuario admin/director de `women-digital-closer` (`requireTenant` lee la cookie de sesión). Claude Code no tiene esas credenciales ni debe tenerlas — es una decisión de acceso, no técnica.

## Próxima acción exacta

1. Un admin/director de `women-digital-closer`, logueado en `https://growth-ops-weld.vercel.app/women-digital-closer/...`, abre la consola del navegador y ejecuta, en este orden:
   ```js
   // 1) Sincroniza clientes de Stripe (rellena stripe_customers)
   await fetch('/api/women-digital-closer/evergreen/settings/integraciones/stripe-customers', { method: 'POST' }).then(
     (r) => r.json()
   )

   // 2) Preview del backfill (dryRun por defecto — no escribe nada)
   await fetch('/api/women-digital-closer/evergreen/admin/backfill-stripe-sales', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ ownerEmail: 'closer@ejemplo.com', dryRun: true }),
   }).then((r) => r.json())

   // 3) Solo si el preview del paso 2 es correcto: ejecuta de verdad
   await fetch('/api/women-digital-closer/evergreen/admin/backfill-stripe-sales', {
     method: 'POST',
     headers: { 'Content-Type': 'application/json' },
     body: JSON.stringify({ ownerEmail: 'closer@ejemplo.com', dryRun: false }),
   }).then((r) => r.json())
   ```
2. ~~Confirmar `drop_partners`~~ — hecho: ejecutado y la funcionalidad de socios recreada (punto 7 arriba). Falta: confirmar CI de PR #30 en verde y mergear cuando el usuario lo indique.
3. ~~Verificar en detalle el resto del drift de RLS~~ — **HECHO y PASS**. Verificado por SQL contra la base real, no por nombre de migración: de TODAS las tablas con `tenant_id`, ninguna tiene RLS desactivada y ninguna carece de política de aislamiento por tenant salvo `tenant_members`, que es correcta por diseño (no puede usar `auth_tenant_ids()` porque esa función lee de ella misma — recursión infinita; su escritura exige `is_tenant_admin(tenant_id)` en `USING` **y** `WITH CHECK`, así que no hay camino de auto-escalada a otro tenant, y el `SELECT` es `user_id = auth.uid() OR is_tenant_admin(tenant_id)`). Además: 0 filas con `tenant_id` NULL en las 8 tablas de negocio core (`contacts`, `sales`, `appointments`, `campaigns`, `collections`, `commissions`, `expenses`, `contact_attributions`). El multi-tenant se puede declarar cerrado a nivel de RLS.
4. ~~Auditoría de atribución a nivel de `campaign_ads`~~ — **no hay nada que auditar todavía**: `campaign_ads` tiene 0 filas. Ver el punto siguiente.
   4b. **BLOQUEANTE DE PRODUCTO (no de código): media base de datos está vacía.** Recuento real: `contacts` 943, `appointments` 555 (62 con transcripción) — pero `sales` 0, `collections` 0, `campaigns` 0, `contact_attributions` 0, `campaign_ads` 0, `campaign_daily` 0. Consecuencias medidas, no teóricas:
   - Todas las preguntas de dinero al agente (ingresos, ROAS, CAC, CPL, rendimiento por campaña, close rate) no tienen datos detrás. Mitigado en código para que no mienta (tool `getDataCoverage` + `aviso_datos` + regla de system prompt: un 0 de fuente vacía nunca se presenta como resultado del negocio), pero el dato sigue sin existir.
   - `detectAnomalies` NO puede generar ningún insight: cada umbral necesita CAC/ROAS/show rate/close rate, y todos derivan de `campaigns` y `sales`. Con ambas vacías, siempre devuelve 0 anomalías. Por eso `ai_insights` está vacía — no es un fallo del detector.
   - Lo que desbloquea esto es exactamente el backfill de Stripe (puebla `sales`/`collections`) y la sincronización de Meta Ads (puebla `campaigns`). Hasta entonces, el agente solo puede responder de verdad sobre contactos, citas y transcripciones.
5. Smoke test real del agente de IA (ver punto 5 de "Hecho en esta sesión") antes de anunciarlo a los usuarios finales — sigue `NOT_VERIFIED`.
6. Decidir cómo disparar `cron/analyze-calls` y `cron/ai-insights` (no están en `vercel.json` por el límite del plan Hobby de Vercel) — probablemente vía `pg_cron` de Supabase, igual que "Auto 30 min" de Meta.
7. Fase 3 del agente de IA (si las fases 1-2 se validan bien): RAG/pgvector para Knowledge Base de documentos, Google Drive/Notion, Model Router multi-proveedor — todo con su propia auditoría antes de implementar, igual que se hizo para las fases anteriores.

## Regla de continuidad

Si existe un único PR o rama activa, continuar allí. No crear una segunda rama. Si el trabajo está validado, fusionarlo a `main`, verificar CI/despliegue y eliminar la rama antes de cerrar la sesión. Al cierre de esta sesión no queda ninguna rama `claude/*` activa sin fusionar.

## Pendientes bloqueantes de PR #30 (2026-09-13)

Requieren acción tuya, no son cosas que pueda cerrar solo:

1. **Aplicar dos migraciones nuevas** (el MCP de Supabase pide reautenticación, no he podido):
   - `20260913100000_storage_tenant_policies.sql` — buckets privados + políticas por `tenant_id/`.
   - `20260913110000_partners_profit_guard.sql` — trigger del 100% + `WITH CHECK` explícito.
2. **Reparar el historial de migraciones** — plan completo y verificado en
   `docs/MIGRATION_RECONCILIATION.md`. No ejecutado: espera confirmación explícita.
3. **Decidir sobre el shader WebGL**: separarlo a su propio PR, o mantenerlo aquí añadiendo
   fallback sin WebGL, control real de reduced-motion y pruebas en iOS/Safari/móvil.

Pendiente de trabajo mío, no bloqueado: el aprovisionador de subcuentas en un clic
(`/platform/tenants` + `POST /api/platform/tenants` + blueprint versionado), que va en **PR aparte**
una vez cerrados los P0 de #30.
