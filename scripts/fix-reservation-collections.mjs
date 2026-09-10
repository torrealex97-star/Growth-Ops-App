// Repara reservas cuyo precio personalizado (sales.gross_amount) se editó después de crear la
// venta pero el cobro registrado (collections.gross_amount) se quedó con el importe antiguo
// (normalmente 300€), haciendo que "Total cobrado" no coincidiera con el precio real de la reserva.
// Solo toca ventas con payment_plans.method = 'reserva' que tengan EXACTAMENTE un cobro (el de la
// propia reserva), para no arriesgar ventas ya completadas con varios cobros.
//
// Uso:  node scripts/fix-reservation-collections.mjs           (aplica los cambios)
//       node scripts/fix-reservation-collections.mjs --dry     (solo muestra qué cambiaría)
import { readFileSync } from 'node:fs'
import { createClient } from '@supabase/supabase-js'

const env = {}
for (const line of readFileSync(new URL('../.env.local', import.meta.url), 'utf8').split('\n')) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/)
  if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '')
}

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) { console.error('Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY en .env.local'); process.exit(1) }

const DRY = process.argv.includes('--dry')
const sb = createClient(url, key, { auth: { persistSession: false } })

const { data: plans, error: plansErr } = await sb.from('payment_plans').select('id').eq('method', 'reserva')
if (plansErr) { console.error(plansErr.message); process.exit(1) }
const planIds = (plans ?? []).map((p) => p.id)
if (planIds.length === 0) { console.log('No hay planes de tipo "reserva".'); process.exit(0) }

const { data: sales, error: salesErr } = await sb
  .from('sales')
  .select('id, gross_amount, contacts(full_name)')
  .in('payment_plan_id', planIds)
if (salesErr) { console.error(salesErr.message); process.exit(1) }

let fixed = 0
for (const sale of sales ?? []) {
  const { data: colls, error: collErr } = await sb.from('collections').select('id, gross_amount').eq('sale_id', sale.id)
  if (collErr) { console.error(`Venta ${sale.id}:`, collErr.message); continue }
  if (!colls || colls.length !== 1) continue
  const coll = colls[0]
  if (Number(coll.gross_amount) === Number(sale.gross_amount)) continue

  const nombre = sale.contacts?.full_name ?? sale.id
  console.log(`${DRY ? '[DRY] ' : ''}${nombre}: cobro ${coll.gross_amount}€ → ${sale.gross_amount}€`)
  if (!DRY) {
    const { error } = await sb.from('collections').update({ gross_amount: sale.gross_amount }).eq('id', coll.id)
    if (error) { console.error(`  Error al actualizar: ${error.message}`); continue }
  }
  fixed++
}

console.log(`${DRY ? 'Se corregirían' : 'Corregidos'} ${fixed} cobro(s) de reserva.`)
