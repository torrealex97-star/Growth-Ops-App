// ─────────────────────────────────────────────────────────────────────────────
// TEST DE CI: COLUMNAS FANTASMA EN QUERIES POSTGREST
// ─────────────────────────────────────────────────────────────────────────────
// Ejecuta scripts/auditar-columnas-fantasma.mjs contra el esquema vivo y FALLA
// si existe alguna referencia tier1 (columna que no existe en NINGUNA tabla →
// PostgREST 400 y sección vacía en silencio; caso original: calendly_event_id,
// PR #86). Los tier2 (columna que existe en otra tabla) se informan pero NO
// fallan: requieren revisión humana porque el parser puede confundir contextos.
//
// Sin credenciales el test SALTA (misma convención que el invariante multitenant):
// el OpenAPI de PostgREST no es consultable sin SUPABASE_URL + service_role.
import test from 'node:test'
import { auditarColumnasFantasma } from '../scripts/auditar-columnas-fantasma.mjs'

test('ninguna query de la app referencia columnas fantasma (tier1)', { timeout: 60_000 }, async (t) => {
  const r = await auditarColumnasFantasma()
  if (!r.disponible) {
    return t.skip('sin SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY en el entorno: la auditoría corre donde sí las hay')
  }

  // Aviso (no fallo) de los tier2: posibles confusiones de tabla que conviene mirar.
  if (r.t2.length) {
    console.warn(`\n[aviso] ${r.t2.length} referencia(s) tier2 (existen en otra tabla — revisar a mano):`)
    for (const f of r.t2) console.warn(`  ${f.file}:${f.line}  ${f.table}.${f.col}  (vía ${f.via})`)
  }

  const detalle = r.t1.map((f) => `${f.file}:${f.line}  ${f.table}.${f.col}  (vía ${f.via})`).join('\n  ')
  if (r.t1.length) {
    throw new Error(
      `${r.t1.length} referencia(s) a columnas que no existen en ninguna tabla ` +
        `(PostgREST 400, sección vacía en silencio):\n  ${detalle}\n` +
        `Corrige la columna (verifica contra el esquema vivo o database-generated.ts).`
    )
  }
})
