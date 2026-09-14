import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const MIGRATION = 'supabase/migrations/20260915100000_tracking_sites_and_raw_layer.sql'
const sql = readFileSync(join(root, MIGRATION), 'utf8')

// ---------------------------------------------------------------------------------------------
// Fase B del sistema de tracking. Los invariantes de aquí se probaron además con un dry-run de
// COMPORTAMIENTO (BEGIN … RAISE) contra la base real antes de aplicar: seis pruebas, entre ellas que
// el mismo anonymous_id convive en dos subcuentas y sigue rechazándose dentro de una, y que una clave
// sin el prefijo gop_pk_ es rechazada. Estos tests fijan el contrato para que no se pierda.
// ---------------------------------------------------------------------------------------------

// EL P0 QUE ARREGLA LA MIGRACIÓN. `analytics_visitors.anonymous_id` estaba UNIQUE a secas. Con un
// único global, el get-or-create por anonymous_id en la subcuenta B choca con —o encuentra— la fila
// de la subcuenta A, y el evento de B acaba colgado del visitante de A: una fuga entre subcuentas.
test('los identificadores de visitante y sesión son únicos POR subcuenta, nunca globales', () => {
  for (const tabla of ['analytics_visitors', 'analytics_sessions']) {
    assert.match(
      sql,
      new RegExp(`alter table public\\.${tabla} drop constraint if exists ${tabla}_\\w+_key`),
      `${tabla}: falta retirar el único global`
    )
  }
  assert.match(sql, /add constraint analytics_visitors_tenant_anonymous_id_key unique \(tenant_id, anonymous_id\)/)
  assert.match(
    sql,
    /add constraint analytics_sessions_tenant_external_session_id_key unique \(tenant_id, external_session_id\)/
  )
})

// La clave del snippet es PÚBLICA por diseño. El prefijo obligatorio existe para que nadie la
// confunda con un secreto al verla en el HTML de una página, y para que una `sk_...` pegada por error
// no entre en la tabla.
test('la clave pública lleva prefijo obligatorio y es única global', () => {
  assert.match(sql, /public_key ~ '\^gop_pk_\[A-Za-z0-9_-\]\{32,64\}\$'/)
  assert.match(sql, /constraint tracking_sites_public_key_key unique \(public_key\)/)
})

// Un site recién creado NO debe aceptar tráfico. Ni de cualquier dominio (allowlist vacía), ni en
// absoluto (interruptor apagado). Instalar el snippet no puede ser lo que active la ingesta.
test('un site nuevo arranca cerrado: sin orígenes y con el tracking apagado', () => {
  assert.match(sql, /allowed_origins text\[\] not null default '\{\}'/)
  assert.match(sql, /tracking_enabled boolean not null default false/)
  assert.match(sql, /allow_localhost boolean not null default false/)
  // Y mientras no se sepa el consentimiento, no se ingiere nada.
  assert.match(sql, /consent_default text not null default 'strict'/)
})

// El slug es lo que va en data-site. Dos clientes distintos pueden llamar 'main' a su web principal,
// así que el único es por subcuenta — el mismo error que el del anonymous_id, evitado aquí.
test('el slug del site es único por subcuenta, no global', () => {
  assert.match(sql, /constraint tracking_sites_tenant_slug_key unique \(tenant_id, slug\)/)
})

// Idempotencia de ingesta. Parcial a propósito: un page_view de navegador no trae id de proveedor, y
// un único total colapsaría todos los eventos sin id en una sola fila por fuente.
test('la idempotencia por id de proveedor es parcial, para no colapsar las fuentes sin id', () => {
  for (const tabla of ['raw_events', 'canonical_events']) {
    const re = new RegExp(
      `unique index if not exists ${tabla}_tenant_source_event_key[\\s\\S]{0,120}?\\(tenant_id, source, source_event_id\\)[\\s\\S]{0,80}?where source_event_id is not null`
    )
    assert.match(sql, re, `${tabla}: falta el único parcial por id de proveedor`)
  }
})

// Un reintento de entrega no puede crear otra conversión lógica en el destino: el número de intento
// vive en su columna, así que la fila se actualiza en vez de duplicarse.
test('la entrega a un destino es idempotente por evento', () => {
  assert.match(
    sql,
    /unique index if not exists delivery_attempts_tenant_destination_event_key[\s\S]{0,120}?\(tenant_id, destination, event_id\)/
  )
})

// Un payload inválido no se descarta en silencio: queda como raw event rechazado. Y un rechazo sin
// motivo no es trazabilidad, así que la base lo exige.
test('un rechazo sin motivo es imposible', () => {
  assert.match(sql, /processing_status <> 'rejected' or rejection_reason is not null/)
})

// Tres estados, nunca un booleano: un 'unknown' no es un bot, y tratarlo como tal borraría usuarios
// reales del funnel.
test('la clasificación de bots tiene tres estados y por defecto no acusa a nadie', () => {
  assert.match(sql, /bot_classification text not null default 'unknown'/)
  assert.match(sql, /bot_classification in \('likely_human', 'likely_bot', 'unknown'\)/)
})

// La IP en claro no se conserva: se guarda un hash, que sirve para rate limit y abuso sin retener el
// dato personal.
test('no se guarda la IP en claro', () => {
  assert.match(sql, /ip_hash text/)
  assert.doesNotMatch(sql, /^\s*ip\s+(inet|text)/m)
})

// Las dos tablas nuevas entran con el trío de RLS del resto del pipeline, y SIN política de escritura:
// solo service_role escribe, que es lo correcto para una tubería de ingesta.
test('las tablas nuevas llevan RLS con aislamiento RESTRICTIVE y sin política de escritura', () => {
  for (const tabla of ['tracking_sites', 'raw_events']) {
    assert.match(sql, new RegExp(`alter table public\\.${tabla} enable row level security`))
    assert.match(
      sql,
      new RegExp(
        `create policy ${tabla}_tenant_isolation on public\\.${tabla} as restrictive for all[\\s\\S]{0,160}?tenant_id in \\(select public\\.auth_tenant_ids\\(\\)\\) or public\\.is_super_admin\\(\\)`
      ),
      `${tabla}: falta el aislamiento RESTRICTIVE`
    )
    // Ninguna política de INSERT/UPDATE/DELETE para usuarios.
    assert.doesNotMatch(
      sql,
      new RegExp(`create policy \\w+ on public\\.${tabla} for (insert|update|delete)`),
      `${tabla}: no debe haber política de escritura para usuarios`
    )
  }
})

// `auth_tenant_ids()` es SETOF uuid: se usa como IN (SELECT …). Envolverla en unnest() falla con
// "unnest(uuid) does not exist", y tratarla como array es el error que ya costó una migración.
test('auth_tenant_ids se usa como conjunto, nunca como array', () => {
  assert.doesNotMatch(sql, /unnest\(\s*(public\.)?auth_tenant_ids/)
})
