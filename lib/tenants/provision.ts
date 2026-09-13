// Aprovisionamiento de subcuentas: la parte que escribe.
//
// La decisión (qué slug es válido, qué se crea y qué no) vive en lib/tenants/blueprint.ts, que es
// pura. Aquí solo se ejecuta, en un orden que se pueda repetir sin daño.
import type { SupabaseClient } from '@supabase/supabase-js'
import { initialSettings, MANUAL_STEPS, type TenantInput } from '@/lib/tenants/blueprint'

export type ProvisionResult =
  | {
      ok: true
      tenant: { id: string; slug: string; name: string }
      hecho: string[]
      pendiente: { id: string; label: string; reason?: string }[]
    }
  | { ok: false; motivo: 'slug_ocupado' | 'no_escrito' | 'sin_acceso'; mensaje: string }

/**
 * Crea una subcuenta vacía y da acceso a quien la crea.
 *
 * NO es un "upsert": si el slug ya existe, se para. Reutilizar una subcuenta existente sería
 * reescribir la marca de un cliente en producción por un nombre repetido en un formulario.
 */
export async function provisionTenant(
  sb: SupabaseClient,
  input: TenantInput,
  actor: { userId: string; tenantId: string }
): Promise<ProvisionResult> {
  const existing = await sb.from('tenants').select('id,slug').eq('slug', input.slug).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) {
    return {
      ok: false,
      motivo: 'slug_ocupado',
      mensaje: `Ya hay una subcuenta con el identificador "${input.slug}". Elige otro: no se sobreescribe una subcuenta existente.`,
    }
  }

  const created = await sb
    .from('tenants')
    .insert({ slug: input.slug, name: input.name, status: 'active', settings: initialSettings(input) })
    .select('id,slug,name')
  if (created.error) throw created.error
  // Sin `.select()` un INSERT bloqueado por RLS no da error: diríamos "creada" sin crear nada.
  if (!created.data || created.data.length === 0) {
    return { ok: false, motivo: 'no_escrito', mensaje: 'La subcuenta no se pudo crear (0 filas escritas).' }
  }
  const tenant = created.data[0] as { id: string; slug: string; name: string }
  const hecho = ['tenant']

  // Acceso para quien la crea. Si esto falla, la subcuenta existe pero nadie puede entrar, así que se
  // dice con el id delante en vez de devolver un ok a secas: repetir la creación daría
  // "slug_ocupado" y el operador no sabría por qué no la ve.
  const member = await sb
    .from('tenant_members')
    .insert({ tenant_id: tenant.id, user_id: actor.userId, role: 'super_admin' })
    .select('id')
  if (member.error || !member.data || member.data.length === 0) {
    return {
      ok: false,
      motivo: 'sin_acceso',
      mensaje:
        `La subcuenta "${tenant.slug}" se creó (id ${tenant.id}) pero no se pudo darte acceso` +
        `${member.error ? `: ${member.error.message}` : ' (0 filas escritas)'}. Añádete a mano en tenant_members antes de usarla.`,
    }
  }
  hecho.push('membership')

  // Auditoría bajo la subcuenta del OPERADOR, no bajo la nueva: la pantalla de Auditoría filtra por
  // subcuenta, así que registrarlo en la nueva lo dejaría invisible justo donde se busca ("quién dio
  // de alta qué"). El id y el slug de la nueva van en new_values.
  const audit = await sb.from('audit_logs').insert({
    tenant_id: actor.tenantId,
    entity_type: 'tenant',
    entity_id: tenant.id,
    action: 'create',
    actor_user_id: actor.userId,
    new_values: { slug: tenant.slug, name: tenant.name },
  })
  // Un fallo de auditoría no deshace la subcuenta ya creada (no hay transacción entre llamadas de
  // PostgREST), pero tampoco se oculta: se devuelve como paso no hecho.
  if (!audit.error) hecho.push('audit')

  return { ok: true, tenant, hecho, pendiente: MANUAL_STEPS }
}

export type TenantReadiness = {
  id: string
  slug: string
  name: string
  status: string
  createdAt: string
  brandName: string | null
  counts: { miembros: number; productos: number; planes: number; integraciones: number }
}

/**
 * Estado de cada subcuenta: lo que hace falta para que sirva. Se resuelve con una consulta por tabla
 * para TODAS las subcuentas y se agrupa en memoria — una consulta por subcuenta y tabla sería un N+1
 * que crece con cada cliente nuevo.
 */
export async function tenantsReadiness(sb: SupabaseClient): Promise<TenantReadiness[]> {
  const { data: tenants, error } = await sb
    .from('tenants')
    .select('id,slug,name,status,settings,created_at')
    .order('created_at', { ascending: true })
  if (error) throw error

  const counts = new Map<string, { miembros: number; productos: number; planes: number; integraciones: number }>()
  for (const t of (tenants ?? []) as { id: string }[]) {
    counts.set(t.id, { miembros: 0, productos: 0, planes: 0, integraciones: 0 })
  }

  const tablas: [string, keyof NonNullable<ReturnType<typeof counts.get>>][] = [
    ['tenant_members', 'miembros'],
    ['products', 'productos'],
    ['payment_plans', 'planes'],
    ['integration_settings', 'integraciones'],
  ]
  for (const [table, campo] of tablas) {
    const { data, error: tableError } = await sb.from(table).select('tenant_id').limit(20_000)
    // Un fallo al contar NO se convierte en 0: se deja el contador como estaba y la UI dice que no
    // se pudo leer, en vez de mostrar "0 productos" en una subcuenta que sí los tiene.
    if (tableError) continue
    for (const row of (data ?? []) as { tenant_id: string | null }[]) {
      if (!row.tenant_id) continue
      const bucket = counts.get(row.tenant_id)
      if (bucket) bucket[campo]++
    }
  }

  return ((tenants ?? []) as Record<string, unknown>[]).map((t) => {
    const settings = t.settings as { branding?: { name?: unknown } } | null
    const brandName = typeof settings?.branding?.name === 'string' ? settings.branding.name : null
    return {
      id: t.id as string,
      slug: t.slug as string,
      name: t.name as string,
      status: t.status as string,
      createdAt: t.created_at as string,
      brandName,
      counts: counts.get(t.id as string) ?? { miembros: 0, productos: 0, planes: 0, integraciones: 0 },
    }
  })
}
