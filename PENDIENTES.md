# PENDIENTES — IA WINNERS OS

> Doc vivo de tareas pendientes. Última actualización: 2026-07-01.
> App en producción: https://iawinners-app.vercel.app · Deploy: `vercel --prod --yes`

---

## 🔴 Bloqueantes / infra a montar

- [ ] **Worker de transcripción → desplegar a Railway.**
  Código listo en `worker/` (poll Supabase → descarga Drive → ffmpeg 16kHz mono troceado → Groq Whisper → Claude → guarda + tareas). Sin límite de duración.
  Falta: crear servicio en Railway (`railway init --workspace <?>` + `railway up` desde `worker/`), setear env (`NEXT_PUBLIC_SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `GROQ_API_KEY`, `ANTHROPIC_API_KEY`, opcional `GOOGLE_SERVICE_ACCOUNT_JSON`, `POLL_INTERVAL_MS`).
  Decidir workspace de Railway (hay varios; CLI logueado como info@creatuagente.io).
- [ ] **Google service account (opcional pero recomendado)** para transcribir grabaciones de Drive **privadas** sin compartirlas a mano. Crear en Google Cloud, activar Drive API, compartir la carpeta de grabaciones con el email del SA, y meter el JSON en `GOOGLE_SERVICE_ACCOUNT_JSON` del worker. Sin esto, los archivos deben ser "Cualquiera con el enlace".

## 📄 Contratos de equipo (firma digital — ya en producción)

Feature completo y desplegado: Config → Datos de empresa, plantillas (pega texto → IA inserta variables), rol seleccionable, el firmante completa DNI/dirección al firmar, PDF firmado guardado en Supabase Storage (bucket `contratos`) y descargable. Pendiente solo:
- [x] **Envío automático por email (Resend) — ACTIVO.** `RESEND_API_KEY` + `RESEND_FROM=IA WINNERS <app@iawinners.com>` en Vercel (Production). Dominio `iawinners.com` verificado en Resend (DNS en Cloudflare). Invitaciones, recovery y contratos se envían por email automáticamente. Key de tipo "solo envío" (no gestiona dominios por API).
- [ ] **Poner el CIF/razón social reales** en Config → Datos de empresa (ahora placeholder `B-00000000`).
- [~] **Secretos en `.env.local` local** — restaurados 4/5 críticos (18-sep) y verificados con smoke (`scripts/env-smoke.mjs`, sin imprimir valores):
  - [x] `SUPABASE_SERVICE_ROLE_KEY` + `POSTGRES_URL` — recuperados del runtime de Edge Functions de Supabase (función efímera, retirada después). Formato nuevo `sb_secret_`.
  - [x] `GHL_WEBHOOK_SECRET` — del registro del proyecto (`iawinners-ghl-secret-2026`); smoke: 401 con secreto malo, pasa auth con el bueno.
  - [x] `TRACKING_INGEST_KEY` — auto-emitida (la ruta legacy de ingesta la acepta); smoke: 401 mal / auth OK buena.
  - [ ] **NO restaurar a ciegas `CONFIG_ENC_KEY`** — inventar un valor rompe el descifrado de los secretos ya cifrados en la BD (`enc:v1:` en `integration_settings`: Meta, Google OAuth…). O se recupera el original o se planifica rotación re-cifrando.
  - [ ] Claves de terceros sin registro (repegarlas a mano del dashboard del proveedor; producción las tiene): `ANTHROPIC_API_KEY`, `GROQ_API_KEY` (solo worker), `CALENDLY_API_TOKEN`, `SEQURA_MCP_TOKEN`.
  - Nota: 7 placeholders más (`SUPABASE_SECRET_KEY`, `JWT_SECRET`, `POSTGRES_*` variantes, `*_SESSION_SECRET`) no los usa el código — cosméticos.
  - Nota: el checkout principal `~/Documents/…` necesita copia manual de estas 4 claves (el sandbox no puede leer/escribir sus ficheros `.env*`).

## 🟡 Datos a alimentar para que las métricas salgan reales

- [ ] **`event_type` (Demo / Sales Call) en las agendas** — sin marcarlo, el doble embudo de "Métricas ventas" no separa Demo vs Sales Call. Que GHL lo mande o marcarlo a mano.
- [ ] **KPIs diarios del equipo** — el dashboard de **Prospección** se nutre de "KPI Diario". Si el equipo no lo rellena, sale vacío.
- [ ] **`campaign_id` en leads/citas** — el embudo de marketing (Unit Economics) atribuye por ahí. Enlazar campañas (webhook GHL o asignación manual).

## 🔒 Seguridad

- [ ] **Inserts de cuotas silenciosos en otro punto** (`app/api/[tenant]/evergreen/payments/mark` y `complete-reservation` ya comprueban error; revisar los `.insert(` del resto de rutas server-side — patrón: supabase-js **no lanza** en fallo, devuelve `{ error }`). El caso crítico (registro de ventas) ya corregido el 18-sep.
- [ ] **Audit log de DDL aplicado a mano**: la columna `flagged_delinquent` existía en prod sin su migración en el repo — hubo cambios aplicados fuera de git. Inventariar el esquema real vs. migraciones del repo (columnas extra = migraciones perdidas).
- [ ] **Rotar claves compartidas por chat** (todas están en `.env.local` + Vercel): `ANTHROPIC_API_KEY`, `GROQ_API_KEY`, token Management de Supabase (`sbp_…`).
- [ ] **Cambiar `GHL_WEBHOOK_SECRET`** por uno más fuerte (ahora `iawinners-ghl-secret-2026`) — actualizar en Vercel y en GHL a la vez.

## ⚙️ Automatizaciones pendientes (Anexo A3)

Crons ya hechos: `cron/monthly` (sueldos + gastos recurrentes) y `cron/reminders` (marca cuotas vencidas).
Faltan como automatización con aviso real (necesitan canal: WhatsApp/email/Slack):
- [ ] Alerta de impago (Pago atrasado ≥3 días → aviso admin + WhatsApp alumno)
- [ ] Alerta de vencimiento de acceso (email renovación + tarea al closer)
- [ ] Lead no contactado >2h → aviso al setter
- [ ] No-show → crear follow-up + secuencia
- [ ] Onboarding incompleto >7 días → aviso CSM
- [ ] Engagement bajo >14 días → tarea de reactivación
- [ ] **Sync pasarela de pago (Stripe/PayPal)** → actualizar pagos automáticamente

## ✅ Verificaciones en vivo (probar con datos reales)

- [ ] **Webhook real desde GHL** — configurar los 3 workflows (lead opt-in / cita agendada / cambio de estado) con Datos personalizados + cabecera `x-ghl-secret`, y pulsar Test.
- [ ] Flujo de **devolución** (ventana 15 días → resta comisiones y facturación).
- [ ] **Morosidad**: marcar pagada/moroso y ver que cuadra.
- [ ] Transcripción end-to-end con una grabación real (audio ≤25MB o vía worker).

## 💳 Sistema de pagos — refinar
- [ ] **Sequra**: recibimos 70% por adelantado, pero las cuotas Sequra generadas son para MONITORIZAR impago del alumno con Sequra (no son cash nuestro). Hoy se tratan como cobros normales → refinar para no doble-contar el cash.
- [ ] **Reserva "completar pago"**: hoy la reserva de 300€ se mete a mano como `reservation_amount` en el alta. Falta el flujo de registrar una reserva y luego "completar pago" reutilizándola.
- [ ] **UI de planes de pago** en Configuración → Productos (editar method/fee_percent/cash_collection_ratio sin SQL).

## 💡 Mejoras futuras / ideas

- [ ] Notificaciones push (definir canal) para las alertas de A3.
- [ ] Chat IA en prod (requiere que `ANTHROPIC_API_KEY` real siga válida).
- [ ] UI para registrar actividad en la tabla `activities` (hoy Prospección usa KPIs diarios).
- [ ] Revisar métrica a métrica contra el Google Sheets antiguo por si falta algún ratio concreto.

---
### Hecho recientemente (para contexto)
Arquitectura por departamentos + RBAC · webhook GHL (matching por ID, customData) · IA facturas + análisis de llamadas (Groq+Claude) · Morosidad + rol Cobros · gastos recurrentes/sueldos (crons) · devoluciones · agendas (calendario + duración + métricas equipo + análisis IA) · biblioteca de facturas · dashboards del sheet antiguo (Company, Calls_Sales, Marketing funnel, Prospección, CSM, Leaderboards por rol) · recuperación de contraseña + invitaciones.
