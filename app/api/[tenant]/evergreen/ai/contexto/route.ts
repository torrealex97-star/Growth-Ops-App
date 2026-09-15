import { NextRequest, NextResponse } from 'next/server'
import { cargarContextoNegocio, mapearContexto } from '@/lib/ai/agent/contexto'
import { requireTenant } from '@/lib/auth/requireTenant'
import { createClient } from '@/lib/supabase/server'

export const runtime = 'nodejs'

// CONTEXTO DE NEGOCIO DEL GROWTH OPERATOR — leer y editar.
//
// Es la memoria de negocio EDITABLE: precio de la oferta, objetivos y capacidad. El agente no puede
// deducirlos de las tablas sin inventarlos (derivar el precio de los cobros históricos es justo el error
// que hubo que corregir en `sales`), así que los pone una persona y lo que no esté puesto se declara
// ausente en el prompt.
//
// PERMISOS: leer lo puede el equipo; escribir, solo quien dirige. Un objetivo de facturación o el techo
// de capacidad no los cambia un closer, y el RLS de la tabla (`growth_context_write` con
// `is_admin_or_director()`) es la garantía real — esta comprobación es solo el 403 explícito, que da
// mejor mensaje que un update que afecta a 0 filas sin decir por qué.

const ROLES_ESCRITURA = ['admin', 'director']

/** Columna de base ← campo del JSON. Lista blanca: nada que no esté aquí llega al UPDATE. */
const CAMPOS: Record<string, 'texto' | 'numero' | 'entero'> = {
  business_type: 'texto',
  offer_name: 'texto',
  offer_price_eur: 'numero',
  sales_cycle_days: 'entero',
  target_monthly_revenue_eur: 'numero',
  target_ltgp_cac: 'numero',
  target_cash_roas: 'numero',
  capacity_calls_per_week: 'entero',
  capacity_active_clients: 'entero',
  notes: 'texto',
}

const LIMITES: Record<string, [number, number]> = {
  offer_price_eur: [0.01, 1_000_000],
  sales_cycle_days: [0, 3650],
  target_monthly_revenue_eur: [0.01, 100_000_000],
  target_ltgp_cac: [0.01, 1000],
  target_cash_roas: [0.01, 1000],
  capacity_calls_per_week: [1, 10_000],
  capacity_active_clients: [1, 1_000_000],
}

const MAX_TEXTO = 2000

function normalizar(body: Record<string, unknown>): { valores: Record<string, unknown> } | { error: string } {
  const valores: Record<string, unknown> = {}
  for (const [columna, tipo] of Object.entries(CAMPOS)) {
    if (!(columna in body)) continue
    const bruto = body[columna]
    // BORRAR UN VALOR ES LEGÍTIMO: poner null vuelve a "sin configurar", que es un estado válido y
    // honesto. No se confunde con no mandar el campo, que deja el valor anterior intacto.
    if (bruto === null || bruto === '') {
      valores[columna] = null
      continue
    }
    if (tipo === 'texto') {
      if (typeof bruto !== 'string') return { error: `${columna} tiene que ser texto` }
      if (bruto.length > MAX_TEXTO) return { error: `${columna} es demasiado largo (máx. ${MAX_TEXTO})` }
      valores[columna] = bruto.trim()
      continue
    }
    const n = typeof bruto === 'number' ? bruto : Number(bruto)
    if (!Number.isFinite(n)) return { error: `${columna} tiene que ser un número` }
    if (tipo === 'entero' && !Number.isInteger(n)) return { error: `${columna} tiene que ser un número entero` }
    const [min, max] = LIMITES[columna]
    // Un objetivo negativo o absurdo no es un dato raro: entraría en cada cálculo de LTGP:CAC del panel.
    if (n < min || n > max) return { error: `${columna} tiene que estar entre ${min} y ${max}` }
    valores[columna] = n
  }
  return { valores }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  const sb = await createClient()
  try {
    const contexto = await cargarContextoNegocio(sb, auth.tenantId)
    return NextResponse.json({ contexto, puedeEditar: ROLES_ESCRITURA.includes(auth.role || '') })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'Error de contexto' }, { status: 500 })
  }
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ tenant: string }> }) {
  const { tenant } = await params
  const auth = await requireTenant(tenant)
  if ('error' in auth) return auth.error
  if (!auth.isSuperAdmin && !ROLES_ESCRITURA.includes(auth.role || '')) {
    return NextResponse.json({ error: 'Solo dirección puede cambiar los objetivos del negocio' }, { status: 403 })
  }

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
  const normalizado = normalizar(body)
  if ('error' in normalizado) return NextResponse.json({ error: normalizado.error }, { status: 400 })
  if (Object.keys(normalizado.valores).length === 0) {
    return NextResponse.json({ error: 'No hay ningún campo que actualizar' }, { status: 400 })
  }

  const sb = await createClient()
  const { data, error } = await sb
    .from('growth_context')
    .upsert(
      {
        tenant_id: auth.tenantId,
        ...normalizado.valores,
        updated_by: auth.userId,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'tenant_id' }
    )
    .select('*')
    .maybeSingle()

  if (error) {
    if (error.code === '42P01') {
      // La migración 20260915120000_growth_context.sql no está aplicada en este entorno. Se dice con
      // esas palabras en vez de devolver un error de base en crudo.
      return NextResponse.json(
        { error: 'La tabla del contexto de negocio no está creada todavía: falta aplicar la migración.' },
        { status: 503 }
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ contexto: mapearContexto(data as Record<string, unknown> | null) })
}
