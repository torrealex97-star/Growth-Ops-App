import assert from 'node:assert/strict'
import test from 'node:test'
import { ORDEN_BORRADO, limpiarActividadTenant } from '../lib/e2e/limpieza.ts'

// ── ORDEN DE BORRADO (FK-safe) ───────────────────────────────────────────────
// Las FK hacia sales bloquean el DELETE de la venta si queda cualquier hijo
// (mismo problema que destapó el reset del setup: contratos colgando).

test('todas las tablas hijas van ANTES que sales', () => {
  const idx = ORDEN_BORRADO.indexOf('sales')
  assert.ok(idx > 0, 'sales debe estar en la lista')
  for (const tabla of ORDEN_BORRADO.slice(0, idx)) assert.notEqual(tabla, 'sales')
  assert.equal(ORDEN_BORRADO[idx + 1], undefined, 'sales debe ser la última tabla')
})

test('cubre TODAS las tablas con FK hacia sales (migraciones)', async () => {
  // Lee las migraciones reales y extrae las tablas que referencian sales,
  // sin depender de que esta prueba tenga acceso a la BD.
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const dir = join(root, 'supabase', 'migrations')

  const conFk = new Set()
  for (const f of readdirSync(dir)) {
    if (!f.endsWith('.sql')) continue
    const sql = readFileSync(join(dir, f), 'utf8')
    let tablaActual = null
    for (const linea of sql.split('\n')) {
      const create = linea.match(/CREATE TABLE (?:IF NOT EXISTS )?public\.([a-z_]+)/)
      if (create) tablaActual = create[1]
      if (tablaActual && /REFERENCES\s+(?:public\.)?sales\b/.test(linea)) conFk.add(tablaActual)
    }
  }
  // La autorreferencia (sales → sales) no se borra: las columnas quedan a NULL al vaciar.
  conFk.delete('sales')

  for (const tabla of conFk) {
    assert.ok(
      ORDEN_BORRADO.includes(tabla),
      `La tabla "${tabla}" tiene FK hacia sales y NO está en ORDEN_BORRADO: el borrado fallaría por FK`
    )
  }
})

test('cada tabla del orden es escopable por tenant_id (CREATE, ALTER o bucle multi-tenant)', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const { join, dirname } = await import('node:path')
  const { fileURLToPath } = await import('node:url')
  const root = join(dirname(fileURLToPath(import.meta.url)), '..')
  const dir = join(root, 'supabase', 'migrations')

  for (const tabla of ORDEN_BORRADO) {
    let tiene = false
    for (const f of readdirSync(dir)) {
      if (!f.endsWith('.sql')) continue
      const sql = readFileSync(join(dir, f), 'utf8')
      // Por CREATE TABLE directa, por ALTER TABLE, o por el bucle DO$$ del multi-tenant
      // (añade tenant_id a una lista literal de tablas que incluye varias de las nuestras).
      const reCreate = new RegExp(`CREATE TABLE (?:IF NOT EXISTS )?public\\.${tabla}\\b[\\s\\S]*?\\n\\);`)
      const reAlter = new RegExp(`ALTER TABLE public\\.${tabla}\\b[\\s\\S]*?ADD COLUMN (?:IF NOT EXISTS )?tenant_id`)
      const enListaMultiTenant =
        sql.includes(`'${tabla}'`) && /ALTER TABLE public\.%I ADD COLUMN IF NOT EXISTS tenant_id/.test(sql)
      const m = sql.match(reCreate)
      if ((m && m[0].includes('tenant_id')) || reAlter.test(sql) || enListaMultiTenant) {
        tiene = true
        break
      }
    }
    assert.ok(tiene, `"${tabla}" no declara tenant_id en CREATE ni ALTER: el .eq('tenant_id') no escoparía`)
  }
})

// ── COMPORTAMIENTO DEL LIMPIADOR (con fake client, sin BD) ───────────────────

/**
 * Fake de SupabaseClient: encadena .delete().eq().select() y devuelve conteo por tabla.
 * La lectura de contratos (purga de Storage) y storage.remove se simulan aparte:
 *   · opciones.pathsContratos → filas devueltas por la lectura de contracts.
 *   · errores.storage         → fallo simulado de storage.remove.
 */
function fakeSb(contenidoPorTabla, errores = {}, opciones = {}) {
  const llamadas = []
  const storageRemoves = []
  const sb = {
    from(tabla) {
      const chain = {
        delete() {
          chain.__delete = true
          return chain
        },
        eq() {
          return chain
        },
        select(_cols, opts) {
          // Síncrono a propósito: el limpiador llama .select(...).eq(...) sobre la lectura
          // (y await al final), así que select no puede devolver una Promise plana.
          if (chain.__delete) {
            if (errores[tabla]) return { count: null, error: { message: errores[tabla] } }
            const count = contenidoPorTabla[tabla] ?? 0
            llamadas.push(tabla, `__borrado_${tabla}`)
            return { count: opts?.count === 'exact' ? count : null, error: null }
          }
          // Lectura (sin .delete() previo): la única que hace el limpiador es la de
          // contratos para la purga de Storage.
          llamadas.push(`__read_${tabla}`)
          if (errores[tabla]) {
            return { eq: () => Promise.resolve({ data: null, error: { message: errores[tabla] } }) }
          }
          const filas = tabla === 'contracts' ? (opciones.pathsContratos ?? []).map((p) => ({ signed_pdf_url: p })) : []
          return { eq: () => Promise.resolve({ data: filas, error: null }) }
        },
        async insert() {
          return { error: null }
        },
      }
      return chain
    },
    storage: {
      from(bucket) {
        return {
          async remove(paths) {
            llamadas.push(`__storage_${bucket}`)
            storageRemoves.push(paths)
            if (errores.storage) return { error: { message: errores.storage } }
            return { data: paths.map((p) => ({ path: p })), error: null }
          },
        }
      },
    },
  }
  return { sb, llamadas, storageRemoves }
}

test('borra en orden FK y suma el total', async () => {
  const { sb, llamadas } = fakeSb({ collections: 3, sales: 2, commissions: 5 })
  const { ok, total, resultados } = await limpiarActividadTenant(sb, 'tenant-1')

  assert.equal(ok, true)
  assert.equal(total, 10)
  // El orden real de DELETE respeta ORDEN_BORRADO (cada tabla exactamente una vez;
  // audit_logs entra aparte, como INSERT de cierre, no como borrado).
  const borrados = llamadas.filter((l) => !l.startsWith('__') && l !== 'audit_logs')
  assert.deepEqual(borrados, [...ORDEN_BORRADO])
  assert.deepEqual(
    resultados.filter((r) => (r.filas ?? 0) > 0).map((r) => `${r.tabla}=${r.filas}`),
    ['commissions=5', 'collections=3', 'sales=2']
  )
})

test('un fallo en una tabla no aborta la limpieza y marca ok=false', async () => {
  const { sb } = fakeSb({ collections: 1, sales: 1 }, { sales: 'violates foreign key constraint' })
  const { ok, total, resultados } = await limpiarActividadTenant(sb, 'tenant-1')

  assert.equal(ok, false)
  assert.equal(total, 1) // solo collections; sales falló
  const falloSales = resultados.find((r) => r.tabla === 'sales')
  assert.equal(falloSales.filas, null)
  assert.match(falloSales.error, /foreign key/)
})

test('tenant ya limpio → 0 filas, ok=true (idempotente)', async () => {
  const { sb } = fakeSb({})
  const { ok, total } = await limpiarActividadTenant(sb, 'tenant-1')
  assert.equal(ok, true)
  assert.equal(total, 0)
})

test('purga los PDF de contratos en Storage ANTES de borrar las filas', async () => {
  const { sb, llamadas, storageRemoves } = fakeSb(
    { contracts: 2, collections: 1, sales: 1 },
    {},
    { pathsContratos: ['id-a.pdf', 'id-b.pdf'] }
  )
  const { ok, total, resultados } = await limpiarActividadTenant(sb, 'tenant-1')

  assert.equal(ok, true)
  // Los dos PDF salen en UNA llamada a remove y la purga precede al primer DELETE
  // (si borrara filas primero, el listado de rutas ya no sería fiable).
  assert.deepEqual(storageRemoves, [['id-a.pdf', 'id-b.pdf']])
  assert.ok(llamadas.indexOf('__storage_contratos') < llamadas.indexOf('__borrado_document_verifications'))
  // La purga se reporta junto al resto y cuenta en el total.
  assert.ok(resultados.some((r) => r.tabla === 'storage/contratos' && r.filas === 2))
  assert.equal(total, 2 + 2 + 1 + 1) // pdfs + contracts + collections + sales
})

test('un fallo de Storage no aborta la limpieza y marca ok=false', async () => {
  const { sb } = fakeSb({ contracts: 1 }, { storage: 'objeto bloqueado' }, { pathsContratos: ['id-a.pdf'] })
  const { ok, resultados } = await limpiarActividadTenant(sb, 'tenant-1')

  assert.equal(ok, false)
  const falloStorage = resultados.find((r) => r.tabla === 'storage/contratos')
  assert.equal(falloStorage.filas, null)
  assert.match(falloStorage.error, /bloqueado/)
})
