import assert from 'node:assert/strict'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

// S0.4 · P0 — LA PUERTA DEL RAG NO PUEDE VOLVER A LA VERSIÓN VIEJA.
//
// Pasó una vez: F-1 (20260920074321) exigió que quien busca en `knowledge_chunks` PERTENEZCA a la
// subcuenta del fragmento, no solo que sea admin. Horas después, 20260920120000 añadió un filtro y
// creó la firma de 6 argumentos copiando el cuerpo ANTERIOR al arreglo. Un admin de un cliente volvía a
// poder leer el conocimiento privado de otro pasando su p_tenant, o NULL.
//
// Nadie lo vio porque cada migración era correcta en sí misma. Lo que falló es el estado FINAL, que es
// lo que este test mira: recorre las migraciones en orden y, para cada firma de la función, se queda
// con su ÚLTIMA definición.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const dir = join(root, 'supabase/migrations')
const migraciones = readdirSync(dir)
  .filter((f) => f.endsWith('.sql'))
  .sort()

const CREA = /CREATE OR REPLACE FUNCTION public\.match_knowledge_chunks\s*\(([\s\S]*?)\)\s*RETURNS/gi

/** Última definición de cada firma (por nº de argumentos), con el fichero que la dejó. */
function estadoFinal() {
  const ultima = new Map()
  for (const f of migraciones) {
    const sql = readFileSync(join(dir, f), 'utf8')
    const defs = [...sql.matchAll(CREA)]
    defs.forEach((m, i) => {
      const firma = m[1].split(',').filter((p) => /\bp_\w+/.test(p)).length
      // El cuerpo va hasta la siguiente definición o el final del fichero.
      const fin = i + 1 < defs.length ? defs[i + 1].index : sql.length
      ultima.set(firma, { fichero: f, cuerpo: sql.slice(m.index, fin) })
    })
  }
  return ultima
}

test('toda firma de match_knowledge_chunks acaba exigiendo pertenencia a la subcuenta', () => {
  const final = estadoFinal()
  assert.ok(final.has(6), 'la firma de 6 argumentos es la que usa la app')
  for (const [firma, { fichero, cuerpo }] of final) {
    // O comprueba la pertenencia, o es un envoltorio que delega en otra firma (que se comprueba a su vez).
    const delega = /SELECT \* FROM public\.match_knowledge_chunks\(/.test(cuerpo)
    const puerta = /auth_tenant_ids\(\)/.test(cuerpo)
    assert.ok(
      delega || puerta,
      `${firma} argumentos (${fichero}): la puerta mira el rol pero no la subcuenta del fragmento`
    )
  }
})

test('la puerta de rol a secas no sobrevive en ninguna definición final', () => {
  // La forma exacta del fallo: `is_admin_or_director()` sin estar atado a auth_tenant_ids().
  for (const [firma, { fichero, cuerpo }] of estadoFinal()) {
    assert.doesNotMatch(
      cuerpo,
      /is_super_admin\(\)\s+OR\s+is_admin_or_director\(\)\s*\)/,
      `${firma} argumentos (${fichero}): puerta de solo-rol`
    )
  }
})

test('anon queda sin EXECUTE sobre la firma que usa la app', () => {
  // `REVOKE ... FROM PUBLIC` no basta en Supabase: anon tiene su propio grant.
  const ultimaQueLaToca = migraciones
    .filter((f) => /match_knowledge_chunks/.test(readFileSync(join(dir, f), 'utf8')))
    .at(-1)
  const sql = readFileSync(join(dir, ultimaQueLaToca), 'utf8')
  assert.match(
    sql,
    /REVOKE EXECUTE ON FUNCTION public\.match_knowledge_chunks\(TEXT, UUID, TEXT\[\], INTEGER, VECTOR\(1536\), TEXT\[\]\) FROM anon/,
    `${ultimaQueLaToca} redefine la función sin quitarle EXECUTE a anon`
  )
})
