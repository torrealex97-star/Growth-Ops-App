import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import { CONECTORES } from '../lib/conectores/registro.ts'

// F2 — TESTS DE ARQUITECTURA.
//
// El plan los pide aquí, con nombre y apellidos: "UI sin SDK externo, provider que no escribe en
// varios dominios, tabla tenant-scoped sin RLS, métrica duplicada". Son reglas que no se ven en una
// revisión de código porque cada infracción, por separado, parece razonable. Juntas son cómo una
// base de código deja de poder cambiarse.

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const leer = (p) => readFileSync(join(root, p), 'utf8')

function ficheros(dir, ext, acc = []) {
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const rel = join(dir, e.name)
    if (e.name === 'node_modules' || e.name.startsWith('.')) continue
    if (e.isDirectory()) ficheros(rel, ext, acc)
    else if (ext.some((x) => e.name.endsWith(x))) acc.push(rel)
  }
  return acc
}

/** Escrituras reales (no lecturas) a una tabla: `from('x')` seguido de insert/update/upsert/delete. */
function tablasEscritas(src) {
  const tablas = new Set()
  // La ventana NO puede cruzar otro `from(`: si lo hiciera, un `.select()` sobre una tabla y un
  // `.insert()` posterior sobre otra parecerían la misma cadena, y el test acusaría a la tabla
  // equivocada (pasó con `sales` en el webhook de onboarding).
  for (const m of src.matchAll(
    /from\(\s*'([a-z_]+)'\s*\)((?:(?!from\().){0,200}?)\.(insert|update|upsert|delete)\s*\(/gs
  )) {
    tablas.add(m[1])
  }
  return tablas
}

// ── 1. LA INTERFAZ NO HABLA CON PROVEEDORES ──────────────────────────────────────────────────

test('ningún componente de interfaz importa el SDK de un proveedor', () => {
  // Un SDK de proveedor en el navegador significa una credencial en el navegador, o una llamada
  // que no pasa por ninguna de las reglas de acceso del servidor. Además ata la pantalla a ese
  // proveedor: cambiarlo obliga a reescribir la interfaz, que es justo lo que F2 viene a evitar.
  const SDKS = ['stripe', '@stripe/', 'googleapis', 'google-auth-library', 'twilio', 'openai', '@anthropic-ai/']
  const infractores = []
  for (const f of [...ficheros('app', ['.tsx']), ...ficheros('components', ['.tsx'])]) {
    const src = leer(f)
    for (const sdk of SDKS) {
      if (new RegExp(`from '${sdk.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}`).test(src)) {
        infractores.push(`${relative('.', f)} → ${sdk}`)
      }
    }
  }
  assert.deepEqual(infractores, [], 'la interfaz tiene que pedirle los datos al servidor, no al proveedor')
})

// ── 2. UN PROVEEDOR NO ESCRIBE FUERA DE SU DOMINIO ───────────────────────────────────────────

// Qué tablas pertenecen a cada objeto de negocio que un conector puede declarar.
const TABLAS_POR_OBJETO = {
  contacts: ['contacts', 'contact_attributions', 'contact_notes', 'qualification_questions'],
  appointments: ['appointments', 'deleted_appointments_log'],
  payments: ['stripe_payments', 'stripe_customers'],
  campaigns: ['campaigns', 'campaign_daily', 'campaign_ads'],
  social: ['ig_media', 'ig_account_daily', 'social_posts', 'social_raw_payloads'],
}

// Tablas que cualquiera puede tocar: son infraestructura, no dominio de negocio.
const TRANSVERSALES = ['raw_events', 'canonical_events', 'audit_logs', 'integration_sync_runs', 'integration_settings']

// EL DINERO ES INTOCABLE desde un conector. Un proveedor que escriba aquí puede cambiar la
// facturación sin pasar por la decisión humana que exige registrar una venta (ver stripeBackfill).
const DOMINIO_DINERO = ['sales', 'collections', 'commissions', 'refunds', 'expenses', 'payment_plans']

test('ningún conector escribe fuera de los objetos que declara', () => {
  for (const c of CONECTORES) {
    const permitidas = new Set([
      ...TRANSVERSALES,
      ...c.manifest.supportedObjects.flatMap((o) => TABLAS_POR_OBJETO[o] ?? []),
    ])
    const carpeta = `lib/conectores/${c.manifest.provider}`
    let fuentes = []
    try {
      fuentes = ficheros(carpeta, ['.ts'])
    } catch {
      continue // la plantilla puede no tener carpeta propia en el futuro
    }
    for (const f of fuentes) {
      for (const tabla of tablasEscritas(leer(f))) {
        assert.ok(
          permitidas.has(tabla),
          `${c.manifest.provider} escribe en "${tabla}", que no está entre sus supportedObjects (${f})`
        )
      }
    }
  }
})

test('ningún webhook CREA facturación', () => {
  // Cobros y ventas nacen de una decisión humana: registrar una venta exige producto y plan, que un
  // mensaje de un tercero no trae (ver lib/finance/stripeBackfill.ts). Que un webhook pudiera
  // insertarlos convertiría un aviso externo en dinero contado.
  for (const f of ficheros('app/api', ['.ts']).filter((p) => p.includes('/webhooks/'))) {
    const src = leer(f)
    for (const m of src.matchAll(/from\(\s*'([a-z_]+)'\s*\)((?:(?!from\().){0,200}?)\.(insert|upsert)\s*\(/gs)) {
      assert.ok(!DOMINIO_DINERO.includes(m[1]), `${relative('.', f)} crea filas en "${m[1]}": eso es facturación`)
    }
  }
})

// Columnas de `sales` que NO son dinero: seguimiento del alumno después de la venta. El webhook de
// onboarding de GHL las marca (cuándo agendó su sesión, cuándo se hizo), y eso es legítimo: no
// cambia ni el importe ni el estado comercial de la venta.
const COLUMNAS_NO_MONETARIAS = /^(onboarding_\w+|course_access_\w+|first_coaching_date|graduation_date|documents_\w+)$/

test('un webhook que actualiza una venta solo toca columnas que no son dinero', () => {
  // La diferencia importa: marcar "hizo su onboarding" es seguimiento; tocar gross_amount o status
  // es facturación. La primera puede automatizarse; la segunda, no.
  for (const f of ficheros('app/api', ['.ts']).filter((p) => p.includes('/webhooks/'))) {
    const src = leer(f)
    for (const m of src.matchAll(/from\(\s*'sales'\s*\)[\s\S]{0,120}?\.update\(\s*([\s\S]{0,160}?)\)/g)) {
      for (const col of m[1].matchAll(/([a-z_]+)\s*:/g)) {
        assert.match(
          col[1],
          COLUMNAS_NO_MONETARIAS,
          `${relative('.', f)} actualiza sales.${col[1]} desde un webhook: si es dinero, tiene que decidirlo una persona`
        )
      }
    }
  }
})

// ── 3. NINGUNA TABLA POR SUBCUENTA SIN CONTROL DE ACCESO ─────────────────────────────────────

test('toda tabla con tenant_id tiene RLS y al menos una política', () => {
  // RLS habilitada sin políticas deniega todo (correcto para una copia de seguridad); tenant_id sin
  // RLS es una fuga: la columna dice a quién pertenece la fila y nada lo hace cumplir.
  const snapshot = JSON.parse(leer('tests/fixtures/esquema-produccion-20260923.json'))
  const infractores = snapshot
    .filter((t) => t.tieneTenantId && (!t.rlsHabilitada || t.politicas === 0))
    .map((t) => t.tabla)
  assert.deepEqual(infractores, [])
})

// ── 4. UNA MÉTRICA SE DEFINE UNA VEZ ─────────────────────────────────────────────────────────

// Deuda DECLARADA, no permiso: estas pantallas recalculan a mano métricas que ya tienen definición
// canónica en `lib/metrics/agregados.ts`. Al hacerlo pierden lo que esa definición protege —
// distinguir "no hay datos de campañas" de "el CAC es 0"— y pueden divergir de la cifra oficial.
// Va a F3 (`MONEY.md` + semántica). La lista es CERRADA: una pantalla nueva que recalcule rompe.
const RECALCULOS_CONOCIDOS = new Set([
  'app/[tenant]/unit-economics/page.tsx',
  'components/os/MarketingEfficiencyCard.tsx',
])

test('nadie recalcula a mano una métrica que ya tiene definición canónica', () => {
  const patron = /\b(cac|roas|ltv)[A-Za-z]*\s*=\s*[^=][^;\n]*[/*]/i
  const infractores = []
  for (const f of [...ficheros('app', ['.tsx']), ...ficheros('components', ['.tsx'])]) {
    if (RECALCULOS_CONOCIDOS.has(f)) continue
    const lineas = leer(f)
      .split('\n')
      .filter((l) => patron.test(l) && !l.trim().startsWith('//'))
    if (lineas.length) infractores.push(`${f}: ${lineas[0].trim()}`)
  }
  assert.deepEqual(infractores, [], 'usa lib/metrics/agregados.ts: ahí la métrica distingue "sin datos" de cero')
})

test('la deuda declarada sigue existiendo: si ya se arregló, hay que sacarla de la lista', () => {
  // Una lista de excepciones que se queda vieja deja de medir lo que falta y pasa a ser decoración.
  for (const f of RECALCULOS_CONOCIDOS) {
    assert.match(leer(f), /\b(cac|roas|ltv)[A-Za-z]*\s*=/i, `"${f}" ya no recalcula: quítalo de RECALCULOS_CONOCIDOS`)
  }
})

test('la definición canónica distingue "sin datos" de cero', () => {
  // Es la propiedad que se pierde al recalcular a mano, y por eso importa que exista aquí.
  const src = leer('lib/metrics/agregados.ts')
  assert.match(src, /m\.cac = hayCampanas/)
  assert.match(src, /sinDato\('Sin datos de campañas no se puede calcular el CAC\.'\)/)
})
