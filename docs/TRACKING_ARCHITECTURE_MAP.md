# Fase A — Mapa del sistema de tracking existente

Reconocimiento previo a escribir código, según el orden `READ → MAP → IDENTIFY CANONICAL PATH →
EXTEND`. Estado a fecha del commit que introduce este documento. Todo lo de aquí está **inspeccionado
en código y verificado contra la base de producción** (`rgcbveflosqgxrcqlqzv`), no inferido.

## Resumen en una línea

El modelo canónico **ya existe y está bien diseñado**; lo que no existe es la tubería que lo llena.
Las cinco tablas del pipeline tienen 0 filas.

---

## EXISTING — lo que hay y funciona

### Modelo canónico (tablas, con RLS correcta)

| Tabla | Filas hoy | Para qué |
|---|---|---|
| `canonical_events` | 0 | Evento normalizado de negocio |
| `analytics_touchpoints` | 0 | Touchpoints de atribución |
| `identity_matches` | 0 | Resolución de identidad con confianza |
| `delivery_attempts` | 0 | Intentos de entrega a destinos |
| `contact_attributions` | 0 | First/last touch por contacto |

`canonical_events` ya trae: `tenant_id, event_id, event_name, occurred_at, received_at, source,
schema_version, idempotency_key, visitor_id, session_id, touchpoint_id, contact_id, appointment_id,
sale_id, revenue, currency, consent_snapshot, properties (jsonb), processing_status,
rejection_reason`.

`analytics_touchpoints` ya trae: `channel, source, medium, campaign, ad_set, ad, creative,
landing_url, referrer, click_id_type, click_id, capture_method, observation_type, consent_snapshot,
raw_payload`.

`identity_matches` ya trae: `method, confidence (numeric), reason, status, evidence, reviewed_by,
reviewed_at` — es decir, el §31 (DETERMINISTIC / HIGH_CONFIDENCE / AMBIGUOUS / UNMATCHED) **cabe sin
migración estructural**.

`delivery_attempts` ya trae: `destination, status, http_status, latency_ms, attempt_number,
last_error, next_retry_at, response_summary, sent_at` — el §46 y el §47 (backoff, dead letter)
**caben sin migración estructural**.

### RLS — patrón canónico, reutilizable tal cual

Las cuatro tablas llevan el mismo trío verificado:

- `*_read` PERMISSIVE SELECT: `get_my_role() = ANY (admin, director, manager, marketing, adscripcion)`
- `*_tenant_isolation` **RESTRICTIVE FOR ALL**: `tenant_id IN (SELECT auth_tenant_ids()) OR is_super_admin()`
- Sin política de INSERT/UPDATE → **solo `service_role` escribe**. Es lo correcto para un pipeline de
  ingesta y satisface el §99.

`auth_tenant_ids()` es SETOF uuid, se usa como `IN (SELECT ...)`, nunca como array.

### Endpoint de ingesta

`POST /api/{tenant}/evergreen/tracking/events` (80 líneas). Hace bien:

- Validación Zod estricta del contrato completo.
- Resolución de tenant por slug verificando `status = 'active'`.
- **Upsert idempotente** con `onConflict: 'tenant_id,source,idempotency_key'`,
  `ignoreDuplicates: true`, y devuelve `duplicate: true` + 200 en vez de 201.

### Funnels

- `lib/funnels/definitions.ts` — 4 familias (vsl, webinar, profile, web_seo) con etapas que declaran
  `source`, `counts: 'personas' | 'eventos'` y `drilldown`. El §41 (counting unit) y el §67
  (drilldown) ya están contemplados en el tipo.
- `lib/funnels/event-map.ts` — mapeo `familia.etapa → [event_name]` persistido en
  `integration_settings` bajo `FUNNEL_EVENT_MAP`, **configurado por el usuario**, porque
  `canonical_events.event_name` es texto libre. Sin mapear, la etapa sale `no_configurada`, nunca 0.
- `lib/funnels/types.ts` — distingue hueco de cero (`FunnelSource`), que es la regla de AGENTS.md.

### Otras piezas reutilizables

- `lib/webhooks/verifySecret.ts` — HMAC + `timingSafeEqual` con comprobación previa de longitud.
- `app/api/[tenant]/evergreen/webhooks/calendly/route.ts` — verificación de firma correcta, sirve de
  patrón para el `SourceAdapter.verifyRequest()` del §19.
- `integration_sync_runs` (46 filas) + `recordSyncRun()` + `SyncBusyError` — observabilidad de
  sincronizaciones ya operativa.
- `lib/dates/business.ts` — `businessToday()`, `businessYm()` sobre `Europe/Madrid`. Es el helper
  canónico del §0; hay que extenderlo con rangos, no crear otro.
- `lib/contacts/resolve.ts` + RPC `contacts_get_or_create` — get-or-create atómico con
  `pg_advisory_xact_lock`, sigue `merged_into`. Es el identity engine del §30, ya existe.
- `lib/fathom/match.ts` + `fathom_match_review` (178 filas) — el patrón "ante la duda, encola" del
  §31, ya implementado y en uso.

---

## MISSING — lo que el brief pide y no existe

| # brief | Falta | Impacto |
|---|---|---|
| §10, §15, §16 | **Concepto de `site` + public write key + domain allowlist** | Bloquea el píxel entero. Ver "BROKEN" |
| §3, §28 | **Capa RAW** (payload original, replay, reparación de parser) | Sin ella no hay replay ni corrección de parser a posteriori |
| §8 | **Persistencia de rechazos** | Hoy un payload inválido devuelve 422 y no deja rastro |
| §22, §25 | **Webhook de Stripe** | No existe ninguno. Todo Stripe es pull (backfill/cron) |
| §17, §18 | Rate limiting y clasificación de bots | — |
| §26 | Checkpoints de ingesta (cursor, resumible) | Un timeout de Vercel pierde el progreso |
| §44–§52 | Destination engine y adapters (Meta CAPI, Google, TikTok) | `delivery_attempts` existe pero nadie escribe en ella |
| §55 | Config de destinos por tenant | — |
| §69 | `earliest/latest_available` vs `_ingested` por fuente | "Desde el lanzamiento" puede mentir |
| §70 | Job de reconciliación (webhooks perdidos) | — |
| §27 | Colas | No hay `pgmq` ni `pg_cron`. Habrá que batear con Vercel cron + checkpoints |

### Nota sobre los crons

`vercel.json` declara **9 crons** y el plan es **hobby**. Cualquier fase que necesite un cron nuevo
compite por ese presupuesto. Hay que consolidar en un despachador antes que añadir el décimo.

---

## BROKEN — lo que existe pero no puede funcionar como está

### 1. El píxel no puede usar el endpoint de ingesta (P0, bloquea Fase C)

`POST /tracking/events` se autentica con `Authorization: Bearer ${TRACKING_INGEST_KEY}`, un **secreto
compartido** que vive en `integration_settings` y está declarado `required` en el catálogo.

Un script servido a un navegador **no puede sostener un secreto**. Publicarlo en `px.js` lo expone a
cualquiera que abra las herramientas de desarrollo, y con él se puede escribir en el tenant.

El §15 ya define la salida correcta: `data-key` es una **PUBLIC WRITE KEY** — identifica tenant/site
y concede ingesta acotada, nunca lectura. Eso exige lo que el §16 pide y hoy no existe: entidad
`site`, clave pública por site, allowlist de dominios, rate limit y límite de tamaño de payload.

`TRACKING_INGEST_KEY` debe **seguir existiendo** para ingesta server-to-server (el camino de
confianza), pero no puede ser el camino del navegador.

### 2. `processing_status` no lo avanza nadie

El endpoint escribe `processing_status: 'received'` y ahí se queda. No hay normalizador, ni identity
stitch, ni delivery. El estado existe como columna pero no como máquina de estados.

### 3. Data Health lee una sola métrica real

`settings/data-health/route.ts` consulta `canonical_events` solo para el recuento de recibidos. El
match rate y el delivery rate que pide el §57 **no salen de `identity_matches` ni de
`delivery_attempts`**. Con las tablas a 0, la pantalla no puede distinguir hoy "sano" de "vacío".

### 4. Sin webhook de Stripe, la ingesta económica es manual

Las ventas solo entran cuando una persona pulsa el importador. El §25 exige backfill **y** webhook
continuo, separados. Hoy solo existe el backfill.

---

## Camino canónico a extender (no duplicar)

```
SOURCE
  ├─ navegador  → px.js → POST /tracking/events (public key)   ← FALTA la auth pública
  └─ servidor   → webhook adapter → verifyRequest → parse      ← FALTA registry + Stripe
       ↓
RAW INGESTION                                                   ← FALTA entera
       ↓
VALIDATION (Zod ya existe) → rechazo persistido                 ← FALTA persistir
       ↓
NORMALIZATION (versionada)                                      ← FALTA
       ↓
canonical_events  ← EXISTE (vacía)
       ↓
identity: contacts_get_or_create + identity_matches             ← motor EXISTE, falta el enlace
       ↓
analytics_touchpoints → contact_attributions                    ← EXISTEN (vacías)
       ↓
delivery_attempts → DestinationAdapter                          ← tabla EXISTE, adapters FALTAN
       ↓
lib/funnels/* → UI                                              ← EXISTE, sin datos que leer
```

**La regla operativa**: ninguna pantalla consulta la fuente directamente saltándose
`canonical_events`. Todo lo que hoy lo hace (Meta, Calendly, Stripe → dashboards) se mantiene, pero
lo nuevo entra por aquí.

---

## Orden confirmado

El del §107, con una corrección: la Fase B debe resolver **primero** la clave pública y la entidad
`site`, porque la Fase C (píxel) está bloqueada por ella.

| Fase | Contenido | Estado |
|---|---|---|
| A | Mapa del sistema existente | ✅ este documento |
| B | Sites + public key + allowlist + capa RAW + rechazos + constraints | siguiente |
| C | Píxel first-party `page_view` | bloqueada por B |
| D | Stripe authoritative (webhook + firma), sobre el backfill ya existente | |
| E | Identity stitch anon → conocido | |
| F | Touchpoints + first/last click | |
| G | Destination engine + Meta CAPI | |
| H | Funnel visual | |
| I | Calendly/GHL/formularios | |
| J | Resto de destinos y proveedores | |
