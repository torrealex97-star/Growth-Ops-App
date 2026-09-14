import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const read = (p) => readFileSync(join(root, p), 'utf8')
const sinComentarios = (src) => src.replace(/--[^\n]*/g, '').replace(/\/\/[^\n]*/g, '')
const MIGRACIONES = readdirSync(join(root, 'supabase/migrations')).filter((f) => f.endsWith('.sql'))
const sqlCompleto = MIGRACIONES.map((f) => read(`supabase/migrations/${f}`)).join('\n')

// El razonamiento que falló: "el id es único en el origen, así que dos subcuentas no pueden
// producir la misma clave". Sí pueden — es el caso normal de esta plataforma: la MISMA cuenta
// publicitaria (o de Instagram) conectada en dos subcuentas. Con un unique global, la segunda
// subcuenta no puede guardar la campaña (se queda sin datos de Meta) y los anuncios/publicaciones
// se los lleva quien sincronice último, cambiándoles el tenant_id. Reproducido en Postgres 16.
test('ninguna clave única de objetos de proveedor es global entre subcuentas', () => {
  const GLOBALES_PROHIBIDOS = [
    /CREATE UNIQUE INDEX[^;]*ON public\.campaigns \(provider, external_id\)/i,
    /CREATE UNIQUE INDEX[^;]*ON public\.ig_media \(external_id\)/i,
    /CREATE UNIQUE INDEX[^;]*ON public\.fb_media \(external_id\)/i,
    /CREATE UNIQUE INDEX[^;]*ON public\.ig_comments \(external_id\)/i,
    /CREATE UNIQUE INDEX[^;]*ON public\.ig_competitor_media \(external_id\)/i,
  ]
  // La migración 20260914120000 los sustituye; lo que se comprueba es que las claves nuevas
  // existen y que las viejas quedan explícitamente retiradas.
  const fix = read('supabase/migrations/20260914120000_tenant_scope_provider_uniques.sql')
  for (const regex of GLOBALES_PROHIBIDOS) {
    const creadoAlgunaVez = regex.test(sqlCompleto)
    if (!creadoAlgunaVez) continue
    const tabla = regex.source.match(/public\\?\.(\w+)/)[1]
    assert.match(
      fix,
      new RegExp(`DROP INDEX IF EXISTS public\\.${tabla}_\\w*external\\w*idx`, 'i'),
      `${tabla}: el unique global sigue en pie`
    )
    assert.match(
      fix,
      new RegExp(`CREATE UNIQUE INDEX IF NOT EXISTS ${tabla}_tenant\\w*external\\w*idx[\\s\\S]{0,120}tenant_id`, 'i'),
      `${tabla}: falta la clave por subcuenta`
    )
  }
  assert.match(fix, /ALTER TABLE public\.campaign_ads DROP CONSTRAINT IF EXISTS campaign_ads_external_id_key/)
  assert.match(fix, /CREATE UNIQUE INDEX IF NOT EXISTS campaign_ads_tenant_external_idx/)
})

// Si el upsert sigue apuntando a la clave vieja, PostgREST responde 42P10 y la sync deja de
// escribir: cambiar el índice sin cambiar el onConflict rompe la sincronización entera.
test('los upserts apuntan a la clave por subcuenta, no a la vieja', () => {
  const FUENTES = [
    'lib/meta/sync.ts',
    'lib/instagram/sync.ts',
    'app/api/[tenant]/evergreen/instagram/competitors/route.ts',
  ]
  for (const p of FUENTES) {
    const code = sinComentarios(read(p))
    assert.doesNotMatch(code, /onConflict: 'external_id'/, `${p} sigue apuntando al unique global`)
  }
  assert.match(sinComentarios(read('lib/meta/sync.ts')), /onConflict: 'tenant_id,external_id'/)
})

// Un pago externo = un cobro. El importador de Stripe deduplicaba solo en memoria
// (`knownReferences`), así que dos peticiones simultáneas creaban dos ventas y dos cobros para el
// MISMO pago: el mismo dinero contado dos veces.
test('la referencia de pago es única por subcuenta, y el importador lo entiende', () => {
  const fix = read('supabase/migrations/20260914120000_tenant_scope_provider_uniques.sql')
  assert.match(fix, /CREATE UNIQUE INDEX IF NOT EXISTS collections_tenant_payment_reference_key/)
  assert.match(fix, /ON public\.collections \(tenant_id, payment_reference\)/)
  // Parcial: los cobros sin referencia (efectivo, transferencia) y los revertidos no se ven afectados.
  assert.match(fix, /WHERE payment_reference IS NOT NULL AND status <> 'reversed'/)
  // Y no borra dinero por su cuenta: si hay duplicados históricos, falla y los lista.
  assert.match(fix, /RAISE EXCEPTION/)
  assert.match(fix, /dinero contado dos veces/)

  const registrar = sinComentarios(read('app/api/[tenant]/evergreen/stripe-backfill/registrar/route.ts'))
  assert.match(
    registrar,
    /collection\.error\?\.code === '23505'/,
    'un choque de unique no es un error a mostrar en crudo'
  )
  assert.match(registrar, /No se ha duplicado nada/)
})
