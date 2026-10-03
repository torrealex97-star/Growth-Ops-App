# PENDIENTES — [tenant] OS

## Actualización de entrega — 2026-10-01

Arranca el ciclo **S1** (auditoría MVP profesional de punta a punta, petición explícita del usuario).
Detalle completo en `docs/S1-MVP-READINESS-2026-10-01.md` — no se duplica aquí. Resumen:

- [x] Fase 0 (baseline + skills + revalidación del ledger P1/P2 de S0-8): quality gate en verde
      (1202/1205 tests, 3 fallos son de red al sandbox, no bugs reales); P0 = 0 confirmado.
- [x] Revalidado: el P2 "índices únicos sin tenant_id (campaigns, ig_media)" de S0-8 **ya estaba
      resuelto** desde el 14-sep — el ledger de S0-8 quedó desactualizado en ese punto.
- [x] El "barrido completo del patrón de escrituras sin comprobar error" que esta misma sección
      daba por pendiente **ya estaba cerrado** desde el 28-sep (PR #268, 29 tests de regresión
      P0/P1/P2 en `tests/p{0,1,2}-escrituras-sin-comprobar-error.test.mjs`) — corregido aquí.
- [ ] Único ítem de código genuinamente abierto del ledger de S0-8 que no depende de Alex: CAS en
      firma concurrente de contratos — pero necesita decidir antes la semántica de doble submit
      (ver 🧱 Deuda técnica más abajo), no es código libre para tocar ya.
- [ ] Bloqueos externos sin cambios desde S0-8 (siguen siendo de Alex, no de código): retención F6,
      Instagram/Meta, rotar `RESEND_API_KEY`, UTMs/setter en GHL, `CRON_SECRET` en Preview, decisión
      A5 de refunds (`MONEY.md`).
- [x] Las 3 rutas "afiliados" (`afiliados/registro`, `marketing/afiliados/afiliados`,
      `settings/afiliados`) se leyeron y **no son duplicación**: configuración del programa →
      formulario público de alta → panel de gestión de los ya dados de alta. Nada que tocar.
- [x] Fases 4 (marketing/funnel), 6 (finanzas/comisiones), 7 (colaboradores) y 8 (integraciones/Data
      Health) auditadas sin bugs de código nuevos — todo lo revisado ya estaba bien construido.
- [x] Fase 5 (CRM/setting/sales): 1 hueco real cerrado — Data Health no contaba ventas sin
      `setter_id`; añadido `integrity.salesWithoutSetter` (mismo patrón que `leadChannelGaps`).
- [ ] **ACCIÓN REQUERIDA — conciliación Stripe↔cobros en un tenant con datos de producción:** varios
      pagos de Stripe `succeeded` recientes sin cobro interno (`collections`) correspondiente. El
      control que ya existe en Data Health (`pagosSinCobro`) lo detecta correctamente; falta que
      alguien lo revise y los registre (o confirme que no son de una venta de la app). Mientras tanto
      el Cash Collected de Finanzas para ese tenant está subestimado. Detalle identificable (qué
      tenant, qué pagos) comunicado aparte — no se reproduce aquí (`docs/SECURITY_PRIVACY.md` §2).
- [ ] **Hueco real confirmado — no existe un Action Center unificado** (Fase 9 del encargo): hoy hay
      dos piezas correctas pero parciales (kanban de tareas genérico en `/tasks` + alertas de
      métricas con scope por rol en el Header), no el panel único con 9 tipos de item
      (TASK/ALERT/DATA ISSUE/FOLLOW-UP/APPROVAL/OPPORTUNITY/REMINDER/AI INSIGHT/SYSTEM) que pide el
      encargo. NO se construye en esta fase de hardening — es feature nueva, necesita decisión de
      diseño. Detalle en `docs/S1-MVP-READINESS-2026-10-01.md` §6.7.
- [ ] **Hallazgo real de Fase 10 (UX/UI) — Skeleton/EmptyState existen pero casi no se usan:**
      `components/ui/skeleton.tsx` dice en su propio comentario que se construyó para sustituir los
      `animate-pulse` sueltos de una auditoría anterior, pero solo 1 fichero lo importa — hay 52
      ficheros con el patrón suelto sin migrar. `components/ui/empty-state.tsx` igual: solo 1
      fichero lo usa, hay 49 con texto de "sin datos" escrito a mano. No se migra en esta sesión
      (52+49 ficheros sin poder verificar visualmente el resultado es demasiado riesgo a ciegas) —
      queda como tarea acotada para cuando haya verificación visual. Detalle en
      `docs/S1-MVP-READINESS-2026-10-01.md` §6.8.
- [x] Fase 11 (Accesibilidad) y Fase 12 (Performance): intentadas por código. Accesibilidad sin
      resultado fiable (necesita axe-core/navegador, no se inventa un hallazgo). Performance sin
      N+1 en las rutas interactivas muestreadas (closer-conflicts, contacts/[id], sales/[id]).
      Detalle en §6.8.
- [x] **Cerrado — "Medir LCP/INP/CLS: instrumentado por Codex, falta leer datos reales".** El MCP
      de Sentry reconectó en esta sesión: proyecto real es `javascript-nextjs` en la org `scalix-52`
      (no `scalix-systems`). Últimos 30 días: LCP p75 1,97s (Bueno, <2.5s), INP p75 72ms (Bueno,
      <200ms), CLS con 48 muestras pero el agregado no se pudo extraer (revisar directamente en
      Sentry). Muestra pequeña (37-68 datos), no hay tendencia todavía, pero los valores reales son
      buenos. Detalle en `docs/S1-MVP-READINESS-2026-10-01.md` §6.8.
- [ ] Fases 13-14 (smoke test visual, regresión final) requieren navegador con sesión autenticada o
      capturas — no se pueden avanzar leyendo solo código sin inventar verificaciones que no se
      hicieron. Pendientes de esa entrada.

## Actualización de entrega — 2026-09-28

Este bloque actualiza únicamente dashboards y registro de cobros; el inventario histórico inferior no se ha revalidado completo. Estado y criterios de aceptación en [ACTIVE_HANDOFF](docs/ACTIVE_HANDOFF.md).

- [x] PR #284 fusionado (`5b74885`): tres desgloses financieros circulares, bandeja Stripe en Ventas y notificaciones, registro transaccional e idempotente con revisión humana.
- [x] CI del head final: calidad, build, secretos y Smoke E2E aprobados; SQL probado con datos sintéticos y UI local inspeccionada sin registrar cobros reales.
- [ ] Confirmar producción READY para el merge o descendiente y verificar el flujo publicado. Última consulta: Vercel PENDING.
- [ ] Completar prueba de registro de pago y permisos por rol en QA; no confundir inspección visual con alta real comprobada.
- [ ] Confirmar otras fuentes automáticas de cobro antes de ampliar la bandeja (actualmente solo Stripe).
- [ ] Completar paginación/aislamiento del Registro de ventas y auditoría de Cobros, Morosidad y Conciliación.
- [ ] Completar atribución, cohortes y diagnósticos conforme a los contratos canónicos, antes de comparar benchmarks.
- [ ] Verificar responsive de dashboards. Clientes/retención aplazados por el usuario.


> ## Estado de consolidación (2026-09-22)
>
> `origin/main` está publicado en `c2c3e6a33a847b9d3220b9783a01106dc87f73c8` mediante la PR #173, que actualizó este handoff y este backlog. Las PR #171 y #172 también están fusionadas; sus checks de código fueron verdes. La PR #173 solo cambió documentación y no generó workflow nuevo por `paths-ignore`; Supabase Preview quedó omitido. El checkout compartido conserva WIP no publicado; no tratarlo como desplegado ni mezclarlo sin PR atómico.
>
> ### Acciones que corresponden al usuario
>
> - [ ] Ejecutar en QA el dry-run `BEGIN … ROLLBACK` de la revocación de `EXECUTE` de `cleanup_custom_field_values()`: probar limpieza por trigger y rechazo de RPC directa.
> - [ ] Aplicar migraciones solo mediante el flujo aprobado, registrando la versión en `schema_migrations`; nunca desde un checkout con WIP.
> - [ ] Rotar credenciales que hayan aparecido en chats o historiales y actualizar únicamente los proveedores/Vercel correspondientes; no copiarlas al repositorio.
> - [ ] Reconectar y autorizar las integraciones externas que dependen de una acción del propietario (Meta/Instagram, Google/YouTube, TikTok, Hotmart, GHL, Calendly y proveedores de pago) y ejecutar después un smoke real por proveedor.
> - [ ] Completar los workflows reales de GHL para leads, citas y cambios de estado, incluyendo la cabecera secreta, y verificar acta en BD + cita en Agendas.
> - [ ] Instalar el pixel/snippet en la web real y configurar UTMs/campaign en las fuentes para que los embudos tengan atribución real.
> - [ ] Decidir retención legal/de negocio de raw events, transcripciones y hechos financieros antes de graduar privacidad/F6.
> - [ ] Resolver decisiones financieras explícitas: tratamiento de cuotas de proveedores de pago, completar reservas y cualquier backfill que requiera elegir producto/plan.
>
> ### Trabajo que debe hacer Claude/otro agente desde `origin/main`
>
> - [ ] Auditar cada bloque local de Hotmart, inbox social, TikTok, VSL, YouTube OAuth, facturas IA, comisiones batch, contratos adjuntos y colaboradores; publicar solo lo que tenga diff, tests, migraciones y CI verificables.
> - [ ] Completar el tipado de clientes Supabase y el auditor de columnas fantasma en CI antes de aceptar nuevas queries.
> - [ ] Revisar drift esquema↔migraciones, RLS y funciones `SECURITY DEFINER` con dry-run funcional.
> - [ ] Eliminar ramas, worktrees y artefactos ya fusionados solo después de demostrar que no contienen trabajo único.
>
> Doc vivo de tareas pendientes. Última actualización: 2026-09-22.
> App en producción: https://growth-ops-weld.vercel.app · Deploy por PR (protección de rama: CI required en main — nada se pushea directo).
> Contribuir: rama → PR → CI verde (format/lint/typecheck/tests/build/gitleaks) → merge squash.

---

## 🔴 Bloqueantes / infra a montar

- [ ] **Worker de transcripción → desplegar a Railway.**
      Código listo en `worker/` (poll Supabase → descarga Drive → ffmpeg 16kHz mono troceado → Groq Whisper → Claude → guarda + tareas). Sin límite de duración.
      Falta: crear servicio en Railway (`railway init --workspace <?>` + `railway up` desde `worker/`), setear env (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, opcional `GOOGLE_SERVICE_ACCOUNT_JSON`, `POLL_INTERVAL_MS`).
      Decidir workspace de Railway (hay varios; CLI logueado como info@creatuagente.io).
- [ ] **Google service account (opcional pero recomendado)** para transcribir grabaciones de Drive **privadas** sin compartirlas a mano. Crear en Google Cloud, activar Drive API, compartir la carpeta de grabaciones con el email del SA, y meter el JSON en `GOOGLE_SERVICE_ACCOUNT_JSON` del worker. Sin esto, los archivos deben ser "Cualquiera con el enlace".

## 📄 Contratos de equipo (firma digital — ya en producción)

Feature completo y desplegado: Config → Datos de empresa, plantillas (pega texto → IA inserta variables), rol seleccionable, el firmante completa DNI/dirección al firmar, PDF firmado guardado en Supabase Storage (bucket `contratos`) y descargable. Pendiente solo:

- [x] **Envío automático por email (Resend) — ACTIVO.** `RESEND_API_KEY` + `RESEND_FROM (ver Vercel)` en Vercel (Production). Dominio `[tenant]` verificado en Resend (DNS en Cloudflare). Invitaciones, recovery y contratos se envían por email automáticamente. Key de tipo "solo envío" (no gestiona dominios por API).
- [ ] **Poner el CIF/razón social reales** en Config → Datos de empresa (ahora placeholder `B-00000000`).
- [~] **Secretos en `.env.local` local** — restaurados 4/5 críticos (18-sep) y verificados con smoke (`scripts/env-smoke.mjs`, sin imprimir valores):
  - [x] `SUPABASE_SERVICE_ROLE_KEY` + `POSTGRES_URL` — recuperados del runtime de Edge Functions de Supabase (función efímera, retirada después). Formato nuevo `sb_secret_`.
  - [x] `GHL_WEBHOOK_SECRET` — del registro del proyecto (`[tenant]`); smoke: 401 con secreto malo, pasa auth con el bueno.
  - [x] `TRACKING_INGEST_KEY` — auto-emitida (la ruta legacy de ingesta la acepta); smoke: 401 mal / auth OK buena.
  - [ ] **NO restaurar a ciegas `CONFIG_ENC_KEY`** — inventar un valor rompe el descifrado de los secretos ya cifrados en la BD (`enc:v1:` en `integration_settings`: Meta, Google OAuth…). O se recupera el original o se planifica rotación re-cifrando.
  - [ ] Claves de terceros sin registro (repegarlas a mano del dashboard del proveedor; producción las tiene): `ANTHROPIC_API_KEY`, `GROQ_API_KEY` (solo worker), `CALENDLY_API_TOKEN`, `SEQURA_MCP_TOKEN`.
  - [ ] **`SEQURA_MERCHANT_REFERENCE` no existe en producción** (descubierto 18-sep): el cron `sequra-morosos` responde 500 `Falta configurar SEQURA_MERCHANT_REFERENCE` — el workflow de GHA está bien (auth OK, endpoint ejecutó) pero la credencial de negocio (merchant reference de Sequra, p. ej. "mi-negocio") nunca se cargó en Vercel ni en `.env.local`. Pedirla al dashboard/proveedor de Sequra y cargarla en Vercel Production + redeploy. Integraciones tampoco la exige (solo `SEQURA_MCP_TOKEN`) — añadir al catálogo.
  - Nota: 7 placeholders más (`SUPABASE_SECRET_KEY`, `JWT_SECRET`, `POSTGRES_*` variantes, `*_SESSION_SECRET`) no los usa el código — cosméticos.
  - Nota: el checkout principal `~/Documents/…` necesita copia manual de estas 4 claves (el sandbox no puede leer/escribir sus ficheros `.env*`).

## 🟡 Datos a alimentar para que las métricas salgan reales

- [~] **Instalar el snippet del pixel en la web real** — caso F verificado end-to-end el 18-sep: site `wdc-landing` creado (activo, orígenes: womendigitalclosers.com + localhost), evento del navegador → `raw_events` (normalized) → `canonical_events` → visible en Data Health (3 eventos, 0 errores). **Fix incluido**: el índice único de `canonical_events` era parcial y el upsert del ingest fallaba con 42P10 en silencio (raws atascados); convertido en índice completo (mismas garantías: NULL nunca colisiona) + replay de los atascados. Falta: pegar `<script defer src="https://growth-ops-weld.vercel.app/tracker.js" data-site="gop_pk_efec…"></script>` en el `<head>` de womendigitalclosers.com y (opcional) wirear `window.gop('lead')` / `window.gop('purchase')` en los formularios de la web.

- [ ] **`event_type` (Demo / Sales Call) en las agendas** — sin marcarlo, el doble embudo de "Métricas ventas" no separa Demo vs Sales Call. Que GHL lo mande o marcarlo a mano.
- [ ] **KPIs diarios del equipo** — el dashboard de **Prospección** se nutre de "KPI Diario". Si el equipo no lo rellena, sale vacío.
- [ ] **`campaign_id` en leads/citas** — el embudo de marketing (Unit Economics) atribuye por ahí. Enlazar campañas (webhook GHL o asignación manual).

## 🔒 Seguridad

- [x] **01-oct: RPC `attribute_ghl_contacts_for_collaborator` explotable sin sesión — CERRADO.** Era `SECURITY DEFINER` ejecutable por `anon`/`authenticated` sin verificar quién llama; con el `tenant_id` (público) y el código de otro colaborador (público por diseño) cualquiera podía robar atribución de comisiones vía `/rest/v1/rpc/` directo, sin pasar por la app. Migración `20261001170000` aplicada en producción (REVOKE a `anon`/`authenticated`, `service_role` conserva acceso); verificado que solo se llama internamente vía `PERFORM` desde otros triggers, nada roto. Mismo REVOKE aplicado a 5 triggers relacionados por higiene. Detalle en `docs/S1-MVP-READINESS-2026-10-01.md` §6.1.

- [~] **Inserts de cuotas silenciosos en otro punto** — REVISIÓN 26-sep (Freebuff): el patrón contado a fondo son **~92 escrituras** `await` sin comprobar `{ error }` en `app/api`+`lib`. Corregidos los más caros (DELETE de cobro/comisiones en `collections/[id]`, las 3 escrituras de cuota en `payments/mark`, upsert de `users` con rollback en `afiliados/registro`, audit_logs de cambios de cobro) y **26-sep: webhook GHL completo** (updates de citas/contacto/lead_status, insert y update de `contact_attributions`, audit_logs de citas y cierre del sobre: ya no responden `ok` con la escritura sin aplicar — `fix/ghl-webhook-silent-writes`). **27-sep: crons `monthly`/`reminders` fail-ruidoso** (PR #238): las lecturas de equipo/plantillas/comisiones y la aprobación de comisiones ya verifican `{ error }`, presupuesto de tiempo y run en rojo si una subcuenta falla — `fix/cron-monthly-reminders-silent-writes`. **27-sep: `sales/delete` compensable y `commissions/future` verificadas** (PR #239): snapshot de auditoría íntegro, borrado del dinero con restauración inversa y las 7 lecturas con guard. **27-sep: `resolverScopeColaborador` fail-closed y motor de comisiones fail-ruidoso** (PR #249): `resolverScopeColaborador` devolvía `{tipo:'none'}` (sin restricción) ante un error de BD — ahora `{tipo:'error'}` degrada a "colaborador sin contactos" en vez de exponer datos de otros reps; `commissions/future` oculta los tramos también en estado de error; `repNetCash`/`loadTramoContext` ya no tragan errores de `collections`/`refunds`/`sales_tramos_config` por dentro. **27-sep: `collections/approve-review` recuperable** (PR #245): la venta se lee antes de mutar el cobro, y si `generateCommissionsForCollection` falla tras limpiar `needs_commission_review`, se revierte el flag en vez de dejar el cobro "aprobado" sin comisión y sin vía de reintento. **27-sep: webhook Calendly + pixel de tracking** (PR #251): el `UPDATE` de estado de cita en cancelación/reprogramación devuelve 500 si falla (Calendly reintenta), y los `audit_logs`/`contacts.update` secundarios ya no se pierden en silencio (logueados). **Queda:** barrido del resto del patrón (recuento exacto pendiente — quedan candidatos en `stripe/route.ts` ya revisados como falso positivo intencional, y otros ficheros de `app/api` sin auditar todavía). Criterio: cualquier escritura de dinero/estado de negocio verifica y fail ruidoso; audit_logs de dinero nunca fire-and-forget; en webhooks, un fallo de estado devuelto como error HTTP hace que GHL/Stripe reintenten la entrega.
- [ ] **Audit log de DDL aplicado a mano**: la columna `flagged_delinquent` existía en prod sin su migración en el repo — hubo cambios aplicados fuera de git. Inventariar el esquema real vs. migraciones del repo (columnas extra = migraciones perdidas).
- [ ] **Rotar claves compartidas por chat** (todas están en `.env.local` + Vercel): `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, token Management de Supabase (`sbp_…`).
- [ ] **Cambiar `GHL_WEBHOOK_SECRET`** por uno más fuerte (ahora `[tenant]`) — actualizar en Vercel y en GHL a la vez.

## ⚙️ Automatizaciones pendientes (Anexo A3)

Crons ya hechos: `cron/monthly` (sueldos + gastos recurrentes) y `cron/reminders` (marca cuotas vencidas).
Faltan como automatización con aviso real (necesitan canal: WhatsApp/email/Slack):

**Decisión de Alex (27-sep): DEPRIORIZADO, no tocar código todavía.** Para el tramo que llega al
alumno (WhatsApp de impago, email de renovación...) hay que dejarlo todo listo para conectar el
día que se decida el canal, pero implementarlo hoy no es prioridad. Cuando se retome: construir la
detección (lógica pura, sin canal) primero — igual que `cron/reminders` ya marca cuotas vencidas sin
enviar nada — y separar esa detección del envío real, para que activar el canal sea enchufar un
adapter, no reescribir la lógica de negocio. No crear tablas ni cron nuevos hasta esa decisión.

- [ ] Alerta de impago (Pago atrasado ≥3 días → aviso admin + WhatsApp alumno)
- [ ] Alerta de vencimiento de acceso (email renovación + tarea al closer)
- [ ] Lead no contactado >2h → aviso al setter
- [ ] No-show → crear follow-up + secuencia
- [ ] Onboarding incompleto >7 días → aviso CSM
- [ ] Engagement bajo >14 días → tarea de reactivación
- [x] **Sync pasarela de pago (Stripe)** — HECHO 19-sep: espejo `stripe_payments` con cron (`cron-stripe-payments`), `stripe_fee` poblado del `balance_transaction` real (69/69 pagos WDC, incluidos refunded) y reconciliación idempotente (`POST /sales/reconcile-all`). Base de comisiones NETA de fee de pasarela para TODO el equipo (migración `20260919100000`): 49/49 comisiones cuadradas al céntimo (~1.258 € de fees fuera de comisión).
- [ ] PayPal: mismo patrón que Stripe cuando haya cuenta que integrar.

## ✅ Verificaciones en vivo (probar con datos reales)

- [ ] **Webhook real desde GHL** — configurar los 3 workflows (lead opt-in / cita agendada / cambio de estado) con Datos personalizados + cabecera `x-ghl-secret`, y pulsar Test.
- [ ] Flujo de **devolución** (ventana 15 días → resta comisiones y facturación).
- [ ] **Morosidad**: marcar pagada/moroso y ver que cuadra.
- [ ] Transcripción end-to-end con una grabación real (audio ≤25MB o vía worker).

## 💳 Sistema de pagos — refinar

- [ ] **Sequra**: recibimos 70% por adelantado, pero las cuotas Sequra generadas son para MONITORIZAR impago del alumno con Sequra (no son cash nuestro). Hoy se tratan como cobros normales → refinar para no doble-contar el cash.
- [ ] **Reserva "completar pago"**: hoy la reserva de 300€ se mete a mano como `reservation_amount` en el alta. Falta el flujo de registrar una reserva y luego "completar pago" reutilizándola.
- [~] **UI de planes de pago** en Configuración → Productos: `cash_collection_ratio` y `fee_percent` editables sin SQL (fee_percent = 19-sep, referencia pública de la comisión de plataforma para cobros manuales → base neta). Falta: editar `method` desde la UI.

## 🧠 Sistema de conocimiento (skills + RAG) — nuevo 19-sep

Hecho: skills canónicas `.claude/skills/sales-engineering.md` (§1-7) y `.claude/skills/marketing-and-copywriting.md` (§1-6) · system prompts en `src/prompts/` · esquemas RAG en `docs/rag_*_knowledge_schema.json` · reglas obligatorias en CLAUDE.md (PR #71) · tabla `knowledge_chunks` con pgvector + RPC `match_knowledge_chunks` (RLS admin-only, sin ciclos) · tool `searchKnowledge` del agente + contexto RAG en su system prompt · endpoint `/api/[tenant]/evergreen/ai/knowledge` · ingesta idempotente sembrada (88 filas, PR #73).
Pendiente:

- [x] **Pipeline de embeddings** (hecho): `gemini-embedding-001` de Google (gratis, multilingüe) recortado a 1536 dims — misma columna `vector(1536)`, sin migración. Clave `GEMINI_API_KEY` en Vercel + ingesta sembrada; la RPC `match_knowledge_chunks` fusiona semántica+léxica con RRF y degrada a léxica sin clave. Re-ingesta tras editar skills: `GEMINI_API_KEY=… POSTGRES_URL=<pooler-ipv4> node scripts/ingestar-knowledge.mjs` (idempotente).
- [x] **Inspector de conocimiento en UI admin** (hecho): Configuración › Conocimiento IA (`/settings/ai-knowledge`) — buscador conectado a `/ai/knowledge` con filtro por categoría **y por tipo** (guion/fórmula/framework/secuencia/checklist), visor de chunks con badges de tipo y tags, e **indicador de rama** (Semántica + léxica vs Solo léxica) para detectar una clave de embeddings caída.
- [x] **Metadatos enriquecidos + filtro por tipo en el RAG** (hecho, 20-sep): ingesta asigna `type` (script/formula/framework/sequence/checklist, enums de los esquemas RAG; swipe→script) y `tags` de rol a cada chunk; RPC con `p_types` (firma de 6 args, la de 5 conservada como envoltorio para no romper callers ni schema cache); `searchKnowledge`/tool del agente (`types` en el schema de la tool, con guía de cuándo usarlo) y endpoint con validación; el contexto del agente muestra el tipo de cada fragmento. Re-ingesta necesaria tras mergear para poblar los metadatos.
- [ ] **Re-ingesta tras editar skills**: `POSTGRES_URL=<pooler-ipv4> node scripts/ingestar-knowledge.mjs` (ON CONFLICT actualiza; ver run doc para el pooler IPv4).
- [x] **Alta de colaboradores encadena el contrato de equipo** (hallazgo E2E 19-sep, resuelto): la ruta admin de Colaboradores y el registro público de afiliados crean y envían el contrato automáticamente vía `lib/contracts/team-contract.ts` (helper compartido con la ruta manual de Contratos › Equipo, con dedup idempotente y el % del alta mandando en las condiciones). Estado `pending_contract` hasta que el colaborador FIRMA — la firma (public-contracts/sign) lo activa a `active`.

## 🧱 Deuda técnica (nuevo 20-sep)

- [ ] **Tipar los clientes de Supabase** (`lib/supabase/client.ts` y `lib/supabase/server.ts` con el genérico `Database` de `lib/types/database-generated.ts`): hoy las queries NO se validan en compilación — las columnas fantasma pasan tsc y tests (así entraron `calendly_event_id` y `appointments.start_time`; 5 queries rotas corregidas el 20-sep, PR #89). Requiere barrido previo de casts `as` y payloads dinámicos que hoy silencian desfases; mientras no esté hecho, verificar toda columna nueva de query contra el esquema vivo (information_schema vía pooler) o contra `database-generated.ts`.
- [ ] **Auditoría de columnas fantasma como test de CI**: el parser estático (selects/eq/order/or/inserts vs information_schema) ya demostró valor (5 queries rotas + el caso `calendly_event_id`); falta versionarlo en `scripts/` y gatearlo en el workflow. Límite conocido del parser: payloads por variable (no literales) no son verificables estáticamente — el tipado del punto anterior cubre ese hueco.
- [ ] **Inventario esquema vs migraciones del repo** (relacionado, ya apuntado en 🔒 Seguridad): la auditoría de columnas cubre código→BD; el drift inverso (columnas en BD sin migración en el repo, tipo `flagged_delinquent`) sigue abierto.
- [x] **Reubicar `tests/canonical/` dentro de los globs de `npm test`** — CERRADO 28-sep (PR #274): reubicados a `tests/`, suite 1089→1127 tests; la regresión de cash canónico (refunds `processed` vs `pending`/`rejected`) ya corre en CI.
- [ ] **Contratos: firma concurrente sin CAS** (auditoría FASE A, requiere decisión del responsable de contratos — impacto jurídico/financiero): dos firmas con el mismo token pueden pisar PDF/hash (el UPDATE final no condiciona por el estado leído y el storage sube con `upsert: true`); en firma de alumno el evento a GHL se emite antes del UPDATE. Decidir primero la semántica de doble submit; después, CAS (`WHERE estado = estado_leido`).
- [ ] **Onboarding de alumno sin outbox** (FASE A, coordinar con carril F1): fallo de GHL deja contrato firmado con `accesos_enviados_at: null` y sin reintento automático (el 409 impide volver a firmar); fallo del UPDATE tras GHL aceptado produce evento repetible sin dedupe visible. El patrón es el mismo del AGENTS.md: efecto externo irreversible ⇒ claim/outbox antes de ejecutar.
- [ ] **Webhook GHL: `JSON.parse` válido pero no-objeto lanza 500 antes de guardar el sobre** (FASE A, carril F1 de Claude Code): coordinar; test con cuerpo `null`/`[]`.
- [ ] **Refunds acumulados y clawback** (FASE A, decisión A5 de Alex en `docs/MONEY.md`): `refunds/create` no consulta refunds previos (dos parciales válidos pueden superar lo cobrado) y sin idempotency key; el clawback limita cada fila contra SU positiva, no el total del participante. NO tocar hasta la decisión.
- [ ] **Semántica ante refunds `pending`/`rejected` en el cash canónico** (`lib/canonical/cash.ts`): `repNetCash` ya filtra `processed` (PR #269) y los tests de paridad (#273) ya corren en CI desde la PR #274; falta la decisión de semántica cuando existan filas en esos estados.
- [x] **Ignored Build Step de Vercel para pushes docs-only** — YA ACTIVO Y VERIFICADO (28-sep): existía desde el 27-sep (`ignoreCommand` en `vercel.json`, arreglado en `76e9b99` para que también aplicara en producción). Los deployments docs-only **sí se CREAN** (el ignore se evalúa al llegar su turno, no al crear) y luego se autocancelan — se ven como CANCELED en la lista, pero el log de events lo prueba: «The deployment was canceled because the Ignored Build Step command returned exit code 0». No confundir con los CANCELED del branch queue (varios cancelados a la vez cuando arranca el más nuevo). Coste real de un push docs-only: ~8 s de slot, no un build entero.

## 💡 Mejoras futuras / ideas

- [ ] Notificaciones push (definir canal) para las alertas de A3.
- [ ] Chat IA en prod (requiere que `ANTHROPIC_API_KEY` real siga válida).
- [ ] UI para registrar actividad en la tabla `activities` (hoy Prospección usa KPIs diarios).
- [ ] Revisar métrica a métrica contra el Google Sheets antiguo por si falta algún ratio concreto.

---

### Hecho recientemente (para contexto)

**28-sep (tarde)**: **cierre FASE A + desbloqueo de producción** — presupuesto real del sync Stripe (#277), builds de Vercel desbloqueados (#280; producción congelada desde las 06:26Z por 5× `BUILD_EXCEEDED_MAXIMUM_TIME` en el typecheck), logo de la marca anterior borrado y 404 verificado en producción, y el doc `docs/DECISIONES-PENDIENTES-ALEX.md` con las 3 decisiones que quedan (A5, firma concurrente, outbox).
**28-sep**: **auditoría FASE A cerrada salvo decisiones de negocio** (PRs #269/#270/#272/#273): ver CHANGELOG y sección FASE A de `docs/ACTIVE_HANDOFF.md` — las reglas de código nuevas están en `AGENTS.md` («Reglas de código aprendidas a golpes»), las deudas abiertas en la sección 🧱 de arriba.
**26-sep**: informe de auditoría estática FASE A (solo lectura, sin reproducir HTTP/DB): consolidado en `docs/ACTIVE_HANDOFF.md` con su estado de cierre.
**22-sep**: **Smoke E2E en CI con Playwright** (commit `70021b8`): job `e2e` tras quality — reservas end-to-end (diálogo → wizard con plan preseleccionado → cobro → detalle → visible en Reservas) y ficha de contacto (Información por defecto, persistencia de custom fields, filtro por campo) contra tenant QA `qa-e2e` provisionado idempotentemente (`scripts/e2e/setup-tenant.mjs`, password solo en secret `E2E_PASSWORD`). Lección clave: rotar la contraseña del usuario QA invalida sus sesiones (session_not_found) — fixtures UNA vez, antes del login, nunca en los specs.
**20-sep**: **auditoría de columnas fantasma** — 5 queries rotas corregidas (PR #89): dashboard del colaborador sin citas/revenue (`start_time`/`amount`), audit de documentos que nunca se registró en `audit_logs` (columnas inexistentes tragadas por try/catch), backfill Stripe roto (`users.tenant_id`) · fix `calendly_event_id` en unit-economics (PR #86: el Funnel del negocio quedaba vacío en silencio) · cadena del `provider_message_id` de Resend + webhook idempotente con exención de middleware (PR #79/#82). Hallazgo estructural: clientes de Supabase sin tipar → nueva sección 🧱 Deuda técnica.
**19-sep**: skills ventas/marketing + system prompts + esquemas RAG + reglas CLAUDE.md (#71) · protección de rama main con CI required (#70) · RAG: knowledge_chunks + tool searchKnowledge + endpoint + ingesta (#73) · fee_percent en UI de planes (base neta de comisiones) · sync Stripe con stripe_fee real + reconcile-all verificado al céntimo.
Anteriores: Arquitectura por departamentos + RBAC · webhook GHL (matching por ID, customData) · IA facturas + análisis de llamadas (Groq+Claude) · Morosidad + rol Cobros · gastos recurrentes/sueldos (crons) · devoluciones · agendas (calendario + duración + métricas equipo + análisis IA) · biblioteca de facturas · dashboards del sheet antiguo (Company, Calls_Sales, Marketing funnel, Prospección, CSM, Leaderboards por rol) · recuperación de contraseña + invitaciones.
