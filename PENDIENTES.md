# PENDIENTES — [tenant] OS

> Doc vivo de tareas pendientes. Última actualización: 2026-09-20.
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

- [ ] **Inserts de cuotas silenciosos en otro punto** (`app/api/[tenant]/evergreen/payments/mark` y `complete-reservation` ya comprueban error; revisar los `.insert(` del resto de rutas server-side — patrón: supabase-js **no lanza** en fallo, devuelve `{ error }`). El caso crítico (registro de ventas) ya corregido el 18-sep.
- [ ] **Audit log de DDL aplicado a mano**: la columna `flagged_delinquent` existía en prod sin su migración en el repo — hubo cambios aplicados fuera de git. Inventariar el esquema real vs. migraciones del repo (columnas extra = migraciones perdidas).
- [ ] **Rotar claves compartidas por chat** (todas están en `.env.local` + Vercel): `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, token Management de Supabase (`sbp_…`).
- [ ] **Cambiar `GHL_WEBHOOK_SECRET`** por uno más fuerte (ahora `[tenant]`) — actualizar en Vercel y en GHL a la vez.

## ⚙️ Automatizaciones pendientes (Anexo A3)

Crons ya hechos: `cron/monthly` (sueldos + gastos recurrentes) y `cron/reminders` (marca cuotas vencidas).
Faltan como automatización con aviso real (necesitan canal: WhatsApp/email/Slack):

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

## 💡 Mejoras futuras / ideas

- [ ] Notificaciones push (definir canal) para las alertas de A3.
- [ ] Chat IA en prod (requiere que `ANTHROPIC_API_KEY` real siga válida).
- [ ] UI para registrar actividad en la tabla `activities` (hoy Prospección usa KPIs diarios).
- [ ] Revisar métrica a métrica contra el Google Sheets antiguo por si falta algún ratio concreto.

---

### Hecho recientemente (para contexto)

**20-sep**: **auditoría de columnas fantasma** — 5 queries rotas corregidas (PR #89): dashboard del colaborador sin citas/revenue (`start_time`/`amount`), audit de documentos que nunca se registró en `audit_logs` (columnas inexistentes tragadas por try/catch), backfill Stripe roto (`users.tenant_id`) · fix `calendly_event_id` en unit-economics (PR #86: el Funnel del negocio quedaba vacío en silencio) · cadena del `provider_message_id` de Resend + webhook idempotente con exención de middleware (PR #79/#82). Hallazgo estructural: clientes de Supabase sin tipar → nueva sección 🧱 Deuda técnica.
**19-sep**: skills ventas/marketing + system prompts + esquemas RAG + reglas CLAUDE.md (#71) · protección de rama main con CI required (#70) · RAG: knowledge_chunks + tool searchKnowledge + endpoint + ingesta (#73) · fee_percent en UI de planes (base neta de comisiones) · sync Stripe con stripe_fee real + reconcile-all verificado al céntimo.
Anteriores: Arquitectura por departamentos + RBAC · webhook GHL (matching por ID, customData) · IA facturas + análisis de llamadas (Groq+Claude) · Morosidad + rol Cobros · gastos recurrentes/sueldos (crons) · devoluciones · agendas (calendario + duración + métricas equipo + análisis IA) · biblioteca de facturas · dashboards del sheet antiguo (Company, Calls_Sales, Marketing funnel, Prospección, CSM, Leaderboards por rol) · recuperación de contraseña + invitaciones.
