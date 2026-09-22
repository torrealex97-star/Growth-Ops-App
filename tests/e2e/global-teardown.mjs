// Global teardown de Playwright: limpia la actividad transaccional del tenant QA para que
// las métricas de qa-e2e no crezcan indefinidamente corrida tras corrida (ventas, cobros,
// comisiones, contratos, cuotas, auditoría de negocio…). Los fixtures (contactos, productos,
// planes, usuario) NO se tocan: el setup los reutiliza tal cual.
//
// Corre SIEMPRE (pase o falle la suite — Playwright ejecuta globalTeardown aunque los tests
// fallen) y es idempotente: sobre un tenant ya limpio borra 0 filas sin error.
//
// Es el único sitio del repo (junto al setup) que usa SUPABASE_SERVICE_ROLE_KEY para escribir:
// solo corre en local y en CI, nunca en el runtime de la app.
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import dotenv from 'dotenv'
import { limpiarActividadTenant } from '../../lib/e2e/limpieza.ts'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
// dotenv plano NO lee .env.local (eso lo hace Next): cargar ambos, .env.local con prioridad.
dotenv.config({ path: join(root, '.env.local') })
dotenv.config()

export default async function globalTeardown() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !serviceKey) {
    console.warn('[e2e-teardown] Sin credenciales de Supabase: no se limpia el tenant QA')
    return
  }

  // Tenant del QA: el slug es fijo ('qa-e2e') y las credenciales van por env, nunca en el repo.
  const sb = createClient(url, serviceKey, { auth: { autoRefreshToken: false, persistSession: false } })
  const { data: tenant } = await sb.from('tenants').select('id').eq('slug', 'qa-e2e').single()
  if (!tenant) {
    console.warn('[e2e-teardown] El tenant qa-e2e no existe (fixtures no corrieron): nada que limpiar')
    return
  }

  const { ok, total, resultados } = await limpiarActividadTenant(sb, tenant.id)

  const detalle = resultados
    .filter((r) => (r.filas ?? 0) > 0)
    .map((r) => `${r.tabla}=${r.filas}`)
    .join(', ')
  if (ok) console.log(`[e2e-teardown] Tenant qa-e2e limpio (${total} filas borradas${detalle ? `: ${detalle}` : ''})`)
  else
    console.error(
      `[e2e-teardown] Limpieza con errores: ${resultados
        .filter((r) => r.error)
        .map((r) => r.error)
        .join(' · ')}`
    )
}
