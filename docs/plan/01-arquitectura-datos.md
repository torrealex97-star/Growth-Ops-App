# 01 — Arquitectura y datos

Cuándo cargarlo: F0 a F4, F7, F8 y cualquier tarea que toque tenancy, identidad, eventos, conectores, métricas o dinero.

## 1. Capas

```
EXPERIENCE    UI por tenant · Agente (Ask) · Weekly Brief
INTELLIGENCE  Métricas · Cuello de botella · Evidencia · Atribución · Knowledge
SEMÁNTICA     Registro de métricas + registro de fuentes + funnels por configuración
MODELO        contacts · appointments · sales · collections · canonical_events · identity_matches
DATA CORE     raw_events (inbox) → normalización → canonical_events → delivery_attempts (outbox)
FUENTES       GHL (webhook) · Calendly · Meta · Stripe · Sequra · Fathom · IG · webinar · CSV/Sheets
ACCIONES      commands → autorización → preview → aprobación → ejecución → audit
```

El agente no es el cerebro: lo son el modelo de negocio, el modelo económico, la capa semántica y el motor de cuello de botella. Cada fuente es upstream de la app (webhook, sync o import); el sistema de registro es la app, salvo lo que el registro de fuentes declare como primary.

## 2. Tenancy y consolidado (F0, se ejecuta justo antes de F8)

- tenant equivale a Workspace (venture o cliente). No se renombran migraciones ni el invariante de CI.
- Se añade `organizations` por encima. La organización de Scalix agrupa sus ventures.
- La vista de organización lee solo `org_metric_snapshots` (agregados sin PII ni IDs de persona). Prohibido cualquier join a nivel persona entre tenants.
- El consolidado tiene dos modos nombrados: bruto (100 % del venture) y atribuible (valor × participation_pct). La cifra oficial es una decisión pendiente; si no está decidida, ninguno se etiqueta como oficial.
- Una misma persona puede ser lead en dos ventures con socios distintos: el cruce a nivel persona queda bloqueado salvo base legal y acuerdo entre socios.

```sql
create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  base_currency char(3) not null default 'EUR',
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);
alter table tenants
  add column organization_id uuid references organizations(id),   -- nullable durante la migración
  add column kind text check (kind in ('own_venture','client')),
  add column participation_pct numeric(5,2) check (participation_pct between 0 and 100);

create table org_metric_snapshots (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id),
  tenant_id uuid not null references tenants(id),
  metric_key text not null, metric_version int not null,
  period_start date not null, period_end date not null, grain text not null,
  value_gross numeric, value_attributable numeric, currency char(3),
  generated_at timestamptz not null default now(),
  unique (tenant_id, metric_key, metric_version, period_start, period_end)
);
```

El invariante de esquema debe romper si una tabla nueva tenant-scoped no tiene RLS ni política. `organizations` es la segunda tabla raíz sin tenant_id, con excepción declarada. Fixtures sintéticos Tenant A y B desde F-1.

## 3. Identidad (F7)

Base: `contacts` con email y phone nullables, `email_normalized` y `phone_normalized`, `ghl_contact_id`, `instagram` (texto), `merged_into`, la función `contacts_get_or_create` con bloqueo consultivo y el único parcial por (tenant_id, email_normalized). `identity_matches` existe (0 filas).

```sql
alter table contacts add column lifecycle text not null default 'identified'
  check (lifecycle in ('handle_only','identified','customer','erased'));

create table contact_identities (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  contact_id uuid not null references contacts(id),
  type text not null,   -- ig_igsid, ig_username, tiktok_username, calendly_invitee, stripe_customer, anonymous_id
  value_normalized text not null,
  trust text not null check (trust in ('strong','weak')),
  provider text, first_seen_at timestamptz, last_seen_at timestamptz,
  unique (tenant_id, type, value_normalized)
);
create table merge_log (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  survivor uuid not null, absorbed uuid not null,
  moved jsonb, merged_at timestamptz default now(), merged_by uuid
);
```

Confianza: email y teléfono (strong, normalizados); IDs de proveedor y `ig_igsid` (strong); username de IG o TikTok (weak, mutable, nunca clave de merge); `anonymous_id` (contextual).

Orden de matching en `contacts_get_or_create`: identidad de proveedor → email normalizado → teléfono normalizado → vínculo vía contacto de GHL. Nunca se fusiona por handle solo ni entre plataformas. `identity_matches` es la cola de candidatos (score, motivo, estado). Todo merge es reversible y queda en `merge_log`.

`handle_only` cuenta como lead solo según la business_definition del funnel A; no se redefine "lead" globalmente. El email llega al agendar y la persona pasa a `identified`.

## 4. Eventos (F1)

Base: `raw_events` (processing_status, normalizer_version, correlation_id, único parcial por tenant, source y source_event_id) → `canonical_events` (mismo único, occurred_at, processed_at, raw_event_id) → `delivery_attempts` (único por tenant, destino y evento). El nombre del evento es texto libre y no hay vocabulario declarado.

Reglas:

- raw_events es el inbox y delivery_attempts el outbox. No se crean `webhook_inbox` ni `domain_outbox`.
- Los hechos canónicos son inmutables; las proyecciones (contacts, appointments, collections) sí pueden corregirse de forma idempotente. Una corrección es un evento `*.corrected` que referencia al original.
- Las métricas usan `occurred_at` y toleran llegadas tardías y desordenadas.
- `properties` no lleva PII ni cuerpos de mensaje. El texto vive en messages, transcripciones y notas, con `contact_id`.
- Si el proveedor no da id de evento, `source_event_id` es una fingerprint determinista documentada.
- Vocabulario declarado: tabla `event_types (name, family, schema_version, description, is_active)`. El mapeo por tenant (`FUNNEL_EVENT_MAP` en integration_settings) sigue como configuración.

Taxonomía adicional. Funnel A: `dm.started`, `dm.qualified`, `dm.booking_link_sent`, `message.first_response`. Funnel B: `webinar.registered`, `webinar.attended` (minutos vistos), `application.submitted`. Comunes: `appointment.booked|rescheduled|canceled|showed|no_show`, `opportunity.won|lost`, `payment.succeeded|failed|installment_due`, `refund.created`, `dispute.opened`.

Pipeline GHL: verificar firma o secreto → persistir raw → ACK rápido → normalizador versionado → canonical → proyecciones. Replay por source, tenant, rango y versión de normalizador; reanudable, idempotente y con dry-run. Cutover con shadow mode o flag; no se retira el path directo hasta demostrar convergencia.

## 5. Conectores (F2)

Base: `integration_sync_runs`, health e historial, catálogo de integraciones, comprobación de salud con llamada real, verificación de secreto de webhook. Sin interfaz común.

```ts
interface Connector {
  manifest: { provider; version; auth_mode; supported_objects; capabilities; webhook; sync_modes }
  authorize?()
  refreshCredentials?()
  revoke?()
  discover()
  backfill(range)
  incrementalSync(cursor)
  ingestWebhook?(req) // verifica firma, escribe en raw_events, responde 2xx rápido
  normalize(raw) // puro respecto a payload + mapping/version; sin llamadas externas ocultas
  reconcile(window)
  healthCheck()
  executeAction?(cmd) // capability opcional, idempotente por command_id; marca origin/correlation
}
```

Capability-based: un conector read-only no implementa acciones. Toda escritura saliente lleva origin para evitar bucles de webhook. Secretos de webhook fuertes y rotables, con ventana de solape entre secreto viejo y nuevo.

| Fuente                   | Papel actual y siguiente paso                                                                                          |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| GHL                      | Webhook entrante (lead, agenda, estado) con secreto compartido; webhook saliente de onboarding. Pasarlo por raw_events |
| Calendly                 | Cliente de la Scheduling API para crear reservas. Valorar webhooks si el plan lo permite                               |
| Meta Ads, Instagram, GA4 | Syncs diarios. Instagram por mensaje no existe: ig_conversations_daily es agregado                                     |
| Stripe, Sequra           | Espejo de pagos, clientes y morosidad. Cash sin API entra por registros manuales                                       |
| Fathom                   | Grabaciones y emparejamiento con citas; verificar contact_id en transcripciones                                        |
| Webinar                  | Plataforma por definir; necesita minutos vistos por persona                                                            |
| TikTok DM                | Según fuentes de terceros, sin API pública general de mensajes directos: import manual o intermediario                 |
| Skool                    | Sin API pública oficial ni webhooks generales: no basar capacidades críticas en scraping                               |

Contrato de calidad por integración (§53): required y optional fields, schema version, dedup key, timestamps y frescura esperada; una desviación aparece en Data Health.

## 6. Semántica y cuello de botella (F3, F4)

Base: `DefinicionMetrica` con higherIsBetter obligatorio, targetType, tolerancia, dataSource y fallbackDataSource; `EstadoDato`, `Fiabilidad`; registro de fuentes (primary, fallbacks, dedupKey, manualOverride, resolveByPriority con conflicto registrado); FUNNEL_DEFS (vsl, webinar, profile, web_seo); `lib/metrics/cuello-botella.ts`.

Ampliar (no rehacer) con: `metric_key` estable, `version`, `grain` (cohort o period), `maturity_window_days`, `min_sample`, `lineage` y confianza de datos y estadística. Cada resultado devuelve value, period, metric_version, data_confidence, statistical_confidence, maturity_status, last_sync y lineage. Una definición sube de versión cuando cambia su semántica; no se reinterpretan snapshots históricos. En maduración o con muestra insuficiente se etiqueta.

Funnels (config por tenant): A: dm_started → dm_qualified → booked → showed → won → cash. B: registered → attended (mínimo de minutos) → applied → booked → showed → won → cash. Cada uno declara `lead_definition` y ventanas de madurez por etapa.

Cuello de botella: por etapa devuelve Actual, Target o Baseline, Delta, volumen elegible, supuestos de conversión aguas abajo, cash esperado por resultado, impacto estimado y confianza. El "€ recuperable" es una estimación de oportunidad, no una afirmación causal; se etiqueta con supuestos y rango. Controla mix shift por funnel, fuente, oferta y responsable antes de atribuir. Sin confianza suficiente devuelve "insufficient evidence". Persiste Claim + Evidence (metric_version, periodos, filtros, volumen, lineage, last_sync). `getCurrentConstraint()` devuelve constraint, estimación, supuestos, confianza, evidencias y reasons_not_conclusive. Speed-to-first-reply es candidata por defecto en el funnel A.

## 7. Atribución

Los hechos no cambian al cambiar el modelo. Extender `contact_attributions` (0 filas) con `model` (platform_meta, first_touch, last_touch, self_reported, content_trigger), `content_ref` (reel, story o keyword que disparó el DM) y `confidence`. En DM orgánico no hay UTM; no se inventan. Si TikTok o IG no permiten captura fiable, se habilita import manual o intermediario con confianza baja y Data Health visible.

## 8. Money, moneda y zona horaria

Distinguir siempre por nombre: Booked Revenue, Billed Revenue, Cash Collected, Recognized Revenue, Refunds, Net Cash. Nunca mostrar "Revenue" si es ambiguo.

`MONEY.md` (a cerrar antes de completar F3) debe fijar: bruto frente a atribuible en el consolidado; importes con moneda y tipo de cambio a la fecha; IVA (cash bruto y neto); fees por pasarela; disputas; comisiones de setter, closer y afiliado; pagos en cuotas; financiación que paga neto; cash manual. `SOURCE_OF_TRUTH.md` ya fija primary y fallbacks (cash: Stripe; booked: Calendly; shows: CRM; revenue closed: ventas internas; formularios: Typeform).

Cada tenant tiene timezone, locale y base_currency; nada se asume EUR ni Europe/Madrid globalmente. Timestamps consistentes, presentados según tenant; Finance conserva la moneda original y las conversiones explícitas. Evitar hardcodear textos críticos en lógica (preparar es/en).

Matriz de fuente de verdad (contrato obligatorio; un dashboard nuevo nunca decide de dónde sacar un dato):

| Concepto       | Primary      | Fallback | Refresh  | Confianza |
| -------------- | ------------ | -------- | -------- | --------- |
| Cash collected | Stripe       | manual   | realtime | alta      |
| Appointment    | GHL/Calendly | manual   | realtime | alta      |
| Show           | CRM          | Fathom   | diario   | media     |
| Ad spend       | Meta         | —        | hora/día | alta      |
| Lead source    | first-party  | CRM      | evento   | media     |

## 9. Migraciones de datos

Patrón obligatorio: EXPAND → BACKFILL (idempotente y reanudable) → VERIFY (conteos, invariantes, muestras) → ENFORCE (constraints y RLS tras verificar) → CUTOVER (flag o shadow) → CLEANUP (tras ventana de verificación). Evitar DROP inmediato, renames destructivos y NOT NULL masivo sin backfill. Cada migración documenta compatibilidad hacia atrás, rollback o forward-fix, RLS, índices, locks y aislamiento de tenant.
