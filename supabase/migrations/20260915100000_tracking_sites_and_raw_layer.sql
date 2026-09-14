-- Fase B del sistema de tracking: entidad `site` con clave pública, capa RAW y los constraints de
-- idempotencia que faltaban. Extiende el modelo canónico que YA existe (canonical_events,
-- analytics_visitors/sessions/touchpoints, identity_matches, delivery_attempts); no crea una segunda
-- tubería en paralelo.
--
-- Contexto verificado antes de escribir esto: las seis tablas del pipeline existen con el trío de RLS
-- correcto y están a 0 filas. Ver docs/TRACKING_ARCHITECTURE_MAP.md.

-- ---------------------------------------------------------------------------------------------
-- 1) P0 — LOS UNIQUE ERAN GLOBALES, NO POR SUBCUENTA.
--
-- `analytics_visitors.anonymous_id` y `analytics_sessions.external_session_id` estaban UNIQUE a
-- secas. Con un único global, un get-or-create por anonymous_id en la subcuenta B encuentra —o
-- choca con— la fila de la subcuenta A: el evento de B acabaría colgado del visitante de A. Eso es
-- una fuga entre subcuentas, no una molestia de integridad.
--
-- Y aunque el id lo genera el navegador y una colisión accidental es improbable, el único global es
-- además un oráculo: intentar insertar un id y ver si falla revela si ese id existe en OTRA
-- subcuenta.
--
-- Se hace ahora porque ambas tablas están a 0 filas: no hay datos que migrar ni duplicados que
-- resolver. Con datos dentro, esto habría exigido expand → backfill → switch → contract.
-- ---------------------------------------------------------------------------------------------

alter table public.analytics_visitors drop constraint if exists analytics_visitors_anonymous_id_key;
alter table public.analytics_visitors
  add constraint analytics_visitors_tenant_anonymous_id_key unique (tenant_id, anonymous_id);

alter table public.analytics_sessions drop constraint if exists analytics_sessions_external_session_id_key;
alter table public.analytics_sessions
  add constraint analytics_sessions_tenant_external_session_id_key unique (tenant_id, external_session_id);

-- ---------------------------------------------------------------------------------------------
-- 2) TRACKING_SITES — de dónde puede entrar tráfico de navegador, y con qué clave.
--
-- POR QUÉ HACE FALTA. El endpoint de ingesta se autenticaba con TRACKING_INGEST_KEY, un SECRETO
-- compartido. Un script servido al navegador no puede sostener un secreto: publicarlo en px.js se lo
-- regala a cualquiera que abra el inspector, y con él se escribe en la subcuenta. La clave de aquí es
-- PÚBLICA por diseño (identifica site y concede ingesta acotada, nunca lectura) y va acompañada de
-- allowlist de dominios, límites y un interruptor por site.
--
-- TRACINKG_INGEST_KEY no desaparece: sigue siendo el camino server-to-server, donde sí hay secreto.
--
-- Un site por propiedad web, no uno por subcuenta: el data-site del snippet distingue landing de
-- webinar de área de alumnas, y cada una tiene su dominio y su interruptor.
-- ---------------------------------------------------------------------------------------------

create table if not exists public.tracking_sites (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  -- El valor de data-site en el snippet. Estable: cambiarlo rompe las instalaciones existentes.
  slug text not null,
  name text not null,
  -- Clave PÚBLICA de escritura. Única global porque es la clave de búsqueda del endpoint: con ella
  -- sola se resuelve site y subcuenta, sin que el navegador tenga que decir a qué subcuenta va
  -- (decirlo sería confiar en el cliente para elegir el destino de la escritura).
  public_key text not null,
  -- Orígenes autorizados, como esquema+host sin barra final: 'https://womendigitalclosers.com'.
  -- Vacío = ninguno autorizado. No se usa '{*}' ni un vacío permisivo: un site recién creado no debe
  -- aceptar tráfico de cualquier parte por descuido.
  allowed_origins text[] not null default '{}',
  -- localhost y los previews de Vercel solo con permiso explícito (§16).
  allow_localhost boolean not null default false,
  -- Interruptor de despliegue progresivo (§100). Arranca APAGADO: instalar el snippet no debe
  -- empezar a ingerir hasta que alguien lo active a propósito.
  tracking_enabled boolean not null default false,
  -- Qué hacer mientras no se conoce el consentimiento. 'strict' = no ingerir nada;
  -- 'analytics_only' = solo lo que no necesita consentimiento de marketing.
  consent_default text not null default 'strict',
  -- Techo de eventos por minuto y clave (§17). En base, no en memoria del serverless.
  rate_limit_per_minute integer not null default 600,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tracking_sites_tenant_slug_key unique (tenant_id, slug),
  constraint tracking_sites_public_key_key unique (public_key),
  constraint tracking_sites_slug_format check (slug ~ '^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$'),
  -- Prefijo reconocible para que nadie confunda esta clave con un secreto al verla en un HTML.
  constraint tracking_sites_public_key_format check (public_key ~ '^gop_pk_[A-Za-z0-9_-]{32,64}$'),
  constraint tracking_sites_consent_default_check check (consent_default in ('strict', 'analytics_only')),
  constraint tracking_sites_rate_limit_check check (rate_limit_per_minute between 1 and 60000)
);

create index if not exists tracking_sites_tenant_idx on public.tracking_sites (tenant_id);

alter table public.tracking_sites enable row level security;

-- Mismo trío que el resto del pipeline: lectura por rol, aislamiento RESTRICTIVE, y escritura solo
-- para service_role (no hay política de INSERT/UPDATE/DELETE a propósito — los sites se gestionan
-- desde rutas server-side que ya autorizan por rol).
create policy tracking_sites_read on public.tracking_sites for select
  using (public.get_my_role() = any (array['admin', 'director', 'manager', 'marketing', 'adscripcion']));

create policy tracking_sites_tenant_isolation on public.tracking_sites as restrictive for all
  using (tenant_id in (select public.auth_tenant_ids()) or public.is_super_admin());

-- ---------------------------------------------------------------------------------------------
-- 3) RAW_EVENTS — lo que llegó, tal como llegó.
--
-- PARA QUÉ (§3, §28): depurar, reproducir (replay) y arreglar un normalizador a futuro SIN volver a
-- pedirle al proveedor todo el histórico. Y para que un payload inválido deje rastro en vez de
-- desaparecer con un 422 (§8).
--
-- POR QUÉ NO HAY TABLA APARTE DE RECHAZOS: un rechazo es un raw event que no llegó a canónico. Su
-- motivo, su fuente y su hora son las mismas columnas. Una segunda tabla obligaría a consultar dos
-- sitios para responder "qué ha entrado hoy".
-- ---------------------------------------------------------------------------------------------

create table if not exists public.raw_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id),
  -- Null para fuentes server-to-server: un webhook de Stripe no pertenece a ninguna web.
  site_id uuid references public.tracking_sites (id) on delete set null,
  source text not null,
  -- Id del evento EN EL PROVEEDOR. Es la base de la idempotencia de ingesta del §6 y por eso tiene
  -- columna propia en vez de vivir dentro del payload: un único sobre jsonb no se puede declarar.
  source_event_id text,
  source_schema_version text,
  -- Versión del normalizador que lo procesó. Sin esto, un replay tras arreglar un parser no se puede
  -- distinguir del procesado original (§29).
  normalizer_version text,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  payload jsonb not null,
  payload_bytes integer not null,
  processing_status text not null default 'received',
  rejection_reason text,
  -- Enlace al evento canónico que salió de aquí. Null mientras no se ha normalizado, y null para
  -- siempre en los rechazados.
  canonical_event_id uuid references public.canonical_events (id) on delete set null,
  -- Contexto de la petición. La IP NO se guarda en claro (§78): se guarda un hash con sal de
  -- servidor, que sirve para rate limit y para detectar abuso sin conservar el dato personal.
  request_origin text,
  user_agent text,
  ip_hash text,
  -- Clasificación de bots del §18: tres estados, nunca un booleano. Un 'unknown' no es un bot.
  bot_classification text not null default 'unknown',
  bot_reason text,
  -- Para reconstruir RECEIVED → NORMALIZED → IDENTITY → DELIVERY de una misma petición (§81).
  correlation_id uuid,
  created_at timestamptz not null default now(),
  constraint raw_events_processing_status_check
    check (processing_status in ('received', 'normalized', 'rejected', 'skipped')),
  constraint raw_events_bot_classification_check
    check (bot_classification in ('likely_human', 'likely_bot', 'unknown')),
  -- Un rechazo sin motivo no es trazabilidad (§8).
  constraint raw_events_rejected_needs_reason
    check (processing_status <> 'rejected' or rejection_reason is not null),
  constraint raw_events_payload_bytes_check check (payload_bytes >= 0)
);

-- IDEMPOTENCIA DE INGESTA (§6). Parcial a propósito: hay fuentes sin id propio (un page_view de
-- navegador no lo trae), y un único total las colapsaría todas en una sola fila por fuente.
create unique index if not exists raw_events_tenant_source_event_key
  on public.raw_events (tenant_id, source, source_event_id)
  where source_event_id is not null;

-- Patrones de consulta reales que esto va a servir: "qué ha entrado hoy en esta subcuenta"
-- (Data Health y la vista Tracking/Events) y "qué queda por normalizar" (el worker).
create index if not exists raw_events_tenant_received_idx on public.raw_events (tenant_id, received_at desc);
create index if not exists raw_events_pendientes_idx on public.raw_events (tenant_id, received_at)
  where processing_status = 'received';

alter table public.raw_events enable row level security;

-- El payload crudo NO se expone al frontend por defecto (§3). La lectura por rol se concede igual
-- que en el resto del pipeline, pero las rutas que sirven la UI seleccionan columnas explícitas y no
-- `payload`; quien necesite el payload entra por una ruta server-side que lo autoriza aparte.
create policy raw_events_read on public.raw_events for select
  using (public.get_my_role() = any (array['admin', 'director', 'manager', 'marketing', 'adscripcion']));

create policy raw_events_tenant_isolation on public.raw_events as restrictive for all
  using (tenant_id in (select public.auth_tenant_ids()) or public.is_super_admin());

-- ---------------------------------------------------------------------------------------------
-- 4) CANONICAL_EVENTS — las cuatro columnas que le faltaban.
--
-- El resto del contrato del §4 ya estaba, y lo que no tiene columna propia (click ids, utm_*,
-- page_url, page_type) vive donde corresponde: los click ids y las utm en `analytics_sessions`, que
-- YA tiene gclid/fbclid/ttclid y utm_* como columnas de primera clase, y el contexto de página en
-- `properties`. No se duplican aquí.
-- ---------------------------------------------------------------------------------------------

alter table public.canonical_events
  add column if not exists site_id uuid references public.tracking_sites (id) on delete set null,
  add column if not exists raw_event_id uuid references public.raw_events (id) on delete set null,
  -- Id del evento en el proveedor, para poder cruzar contra él en la reconciliación del §70.
  add column if not exists source_event_id text,
  -- Cuándo terminó de procesarse, que no es lo mismo que cuándo se recibió. La diferencia entre las
  -- dos ES la latencia de procesado que pide monitorizar el §82.
  add column if not exists processed_at timestamptz;

create unique index if not exists canonical_events_tenant_source_event_key
  on public.canonical_events (tenant_id, source, source_event_id)
  where source_event_id is not null;

-- El funnel y la vista de eventos filtran por nombre de evento dentro de un rango. Sin este índice
-- es un scan de la tabla entera por cada etapa de cada funnel.
create index if not exists canonical_events_tenant_name_occurred_idx
  on public.canonical_events (tenant_id, event_name, occurred_at desc);
create index if not exists canonical_events_tenant_contact_occurred_idx
  on public.canonical_events (tenant_id, contact_id, occurred_at desc)
  where contact_id is not null;

-- ---------------------------------------------------------------------------------------------
-- 5) DELIVERY_ATTEMPTS — idempotencia de entrega (§45).
--
-- Un reintento no puede crear otra conversión lógica en el destino. El único es por (subcuenta,
-- destino, evento): el número de intento vive en su columna, así que la fila se ACTUALIZA en cada
-- reintento en vez de duplicarse.
-- ---------------------------------------------------------------------------------------------

create unique index if not exists delivery_attempts_tenant_destination_event_key
  on public.delivery_attempts (tenant_id, destination, event_id);

-- El worker de reintentos pregunta "qué toca reenviar ya". Sin índice, eso es un scan.
create index if not exists delivery_attempts_retry_idx
  on public.delivery_attempts (tenant_id, next_retry_at)
  where next_retry_at is not null;
