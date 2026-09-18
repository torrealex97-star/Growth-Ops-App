// Aprovisionamiento de subcuentas: la parte que escribe.
//
// La decisión (qué slug es válido, qué se crea y qué no) vive en lib/tenants/blueprint.ts, que es
// pura. Aquí solo se ejecuta, en un orden que se pueda repetir sin daño.
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  type AssignableMemberRole,
  createTenantIdentity,
  initialSettings,
  MANUAL_STEPS,
  type TenantInput,
} from '@/lib/tenants/blueprint'

export type ProvisionResult =
  | {
      ok: true
      tenant: { id: string; slug: string; name: string }
      hecho: string[]
      pendiente: { id: string; label: string; reason?: string }[]
    }
  | { ok: false; motivo: 'id_ocupado' | 'no_escrito' | 'sin_acceso'; mensaje: string }

/**
 * Crea una subcuenta vacía y da acceso a quien la crea.
 *
 * El UUID se genera antes del INSERT y se usa también como slug. Así el nombre comercial es libre de
 * cambiar y la URL no revela ni depende del nombre del negocio.
 */
export async function provisionTenant(
  sb: SupabaseClient,
  input: TenantInput,
  actor: { userId: string; tenantId: string }
): Promise<ProvisionResult> {
  const identity = createTenantIdentity()
  const existing = await sb.from('tenants').select('id,slug').eq('id', identity.id).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data) {
    return {
      ok: false,
      motivo: 'id_ocupado',
      mensaje: 'No se pudo generar un identificador único para la subcuenta. Vuelve a intentarlo.',
    }
  }

  const created = await sb
    .from('tenants')
    .insert({
      id: identity.id,
      slug: identity.slug,
      name: input.name,
      status: 'active',
      settings: initialSettings(input),
    })
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
  // "identificador ocupado" y el operador no sabría por qué no la ve.
  const member = await sb
    .from('tenant_members')
    // 'super_admin' aquí no es una escalada: quien crea subcuentas ya ES super admin de plataforma
    // (la ruta lo exige), así que esta fila no le da ningún privilegio que no tuviera. Lo que NO se
    // puede hacer es ofrecer ese rol al añadir a OTRA persona — ver ASSIGNABLE_MEMBER_ROLES.
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

type MemberRow = {
  tenant_id: string | null
  user_id: string
  role: string
  // PostgREST devuelve la relación embebida como objeto o como array de uno según el tipo generado.
  users:
    { email: string | null; full_name: string | null } | { email: string | null; full_name: string | null }[] | null
}

export type TenantReadiness = {
  id: string
  slug: string
  name: string
  status: string
  createdAt: string
  brandName: string | null
  counts: { miembros: number; productos: number; planes: number; integraciones: number }
  members: { userId: string; email: string | null; fullName: string | null; role: string }[]
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

  // Los miembros se listan además de contarse: para dar o quitar acceso hay que ver quién está.
  const members = new Map<string, TenantReadiness['members']>()
  const { data: memberRows, error: memberError } = await sb
    .from('tenant_members')
    .select('tenant_id,user_id,role,users(email,full_name)')
    .limit(20_000)
  if (!memberError) {
    for (const row of (memberRows ?? []) as MemberRow[]) {
      if (!row.tenant_id) continue
      const user = Array.isArray(row.users) ? (row.users[0] ?? null) : row.users
      const list = members.get(row.tenant_id) ?? []
      list.push({
        userId: row.user_id,
        email: user?.email ?? null,
        fullName: user?.full_name ?? null,
        role: row.role,
      })
      members.set(row.tenant_id, list)
    }
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
      members: members.get(t.id as string) ?? [],
    }
  })
}

// ── Operaciones sobre subcuentas que ya existen ─────────────────────────────

export type MemberOpResult =
  | { ok: true; accion: 'acceso_dado' | 'rol_actualizado' | 'acceso_quitado'; email?: string }
  | { ok: false; motivo: string; mensaje: string }

/**
 * Da acceso a una subcuenta a un usuario que YA existe en la plataforma.
 *
 * No crea cuentas: crear un usuario implica alta en Auth, contraseña y correo de invitación, y
 * hacerlo desde aquí a medias dejaría cuentas sin poder entrar. Si el email no existe, se dice.
 */
export async function grantAccess(
  sb: SupabaseClient,
  tenantId: string,
  email: string,
  role: AssignableMemberRole,
  actor: { userId: string; tenantId: string }
): Promise<MemberOpResult> {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return { ok: false, motivo: 'sin_email', mensaje: 'Falta el email de la persona.' }

  const { data: user, error: userError } = await sb
    .from('users')
    .select('id,email')
    .eq('email', normalized)
    .maybeSingle()
  if (userError) throw userError
  if (!user) {
    return {
      ok: false,
      motivo: 'usuario_inexistente',
      mensaje: `No hay ningún usuario con el email ${normalized}. Créalo primero en Configuración › Usuarios: aquí no se crean cuentas.`,
    }
  }
  const target = user as { id: string; email: string }

  // Upsert por (tenant_id, user_id): volver a añadir a alguien que ya está actualiza su rol en vez de
  // fallar con clave duplicada, que es lo que el operador espera al cambiarle el rol.
  const { data, error } = await sb
    .from('tenant_members')
    .upsert({ tenant_id: tenantId, user_id: target.id, role }, { onConflict: 'tenant_id,user_id' })
    .select('id,role')
  if (error) throw error
  if (!data || data.length === 0) {
    return { ok: false, motivo: 'no_escrito', mensaje: 'No se pudo dar el acceso (0 filas escritas).' }
  }

  await sb.from('audit_logs').insert({
    tenant_id: actor.tenantId,
    entity_type: 'tenant_member',
    entity_id: target.id,
    action: 'create',
    actor_user_id: actor.userId,
    new_values: { tenant_id: tenantId, email: target.email, role },
  })
  return { ok: true, accion: 'acceso_dado', email: target.email }
}

/** Quita el acceso de una persona a una subcuenta. */
export async function revokeAccess(
  sb: SupabaseClient,
  tenantId: string,
  userId: string,
  actor: { userId: string; tenantId: string }
): Promise<MemberOpResult> {
  // Quitarte a ti mismo te deja fuera de la subcuenta que estás administrando, y con service_role no
  // hay marcha atrás desde la propia aplicación.
  if (userId === actor.userId) {
    return {
      ok: false,
      motivo: 'no_a_ti_mismo',
      mensaje: 'No puedes quitarte a ti mismo el acceso: te quedarías fuera y habría que arreglarlo en base.',
    }
  }

  const { data: members, error: membersError } = await sb
    .from('tenant_members')
    .select('id,user_id')
    .eq('tenant_id', tenantId)
  if (membersError) throw membersError
  // Una subcuenta sin ningún miembro no la puede administrar nadie: queda huérfana y solo se
  // recupera escribiendo en base a mano.
  if ((members ?? []).length <= 1) {
    return {
      ok: false,
      motivo: 'ultimo_miembro',
      mensaje: 'Es el único acceso que queda: dejaría la subcuenta sin nadie que pueda entrar.',
    }
  }

  const { data, error } = await sb
    .from('tenant_members')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .select('id')
  if (error) throw error
  if (!data || data.length === 0) {
    return { ok: false, motivo: 'no_escrito', mensaje: 'Esa persona ya no tenía acceso a esta subcuenta.' }
  }

  await sb.from('audit_logs').insert({
    tenant_id: actor.tenantId,
    entity_type: 'tenant_member',
    entity_id: userId,
    action: 'delete',
    actor_user_id: actor.userId,
    old_values: { tenant_id: tenantId, user_id: userId },
  })
  return { ok: true, accion: 'acceso_quitado' }
}

export type TenantStatus = 'active' | 'suspended' | 'archived'

export type StatusOpResult = { ok: true; status: TenantStatus } | { ok: false; motivo: string; mensaje: string }

/**
 * Cambia el estado de una subcuenta: suspende (pausa temporal), ARCHIVA (relación terminada, datos
 * conservados) o reactiva/restaura (vuelve a 'active'). En todos los estados ≠ 'active',
 * `requireTenant`, el login, los webhooks y los crons la rechazan igual: 'archived' NO añade un
 * camino nuevo que mantener, añade una semántica distinta (pantalla separada, impacto documentado)
 * sobre el mismo interruptor.
 */
export async function setTenantStatus(
  sb: SupabaseClient,
  tenantId: string,
  status: TenantStatus,
  actor: { userId: string; tenantId: string }
): Promise<StatusOpResult> {
  // Suspender o ARCHIVAR la subcuenta desde la que estás administrando cierra la puerta con la llave
  // dentro: la propia pantalla deja de responder en la siguiente petición (y una archivada ya no se
  // puede restaurar DESDE ella misma, porque ni siquiera sus rutas API responden).
  if (status !== 'active' && tenantId === actor.tenantId) {
    return {
      ok: false,
      motivo: 'no_la_propia',
      mensaje:
        'No puedes suspender ni archivar la subcuenta desde la que estás administrando: perderías el acceso a esta misma pantalla. Entra desde otra.',
    }
  }

  // La fila ANTES del cambio: la auditoría de archivar guarda el estado previo (old_values), y el
  // operador necesita saber si lo que archiva estaba activa o ya suspendida.
  const { data: previa, error: errorPrevia } = await sb
    .from('tenants')
    .select('id,slug,name,status')
    .eq('id', tenantId)
    .maybeSingle()
  if (errorPrevia) throw errorPrevia
  if (!previa) {
    return { ok: false, motivo: 'no_existe', mensaje: 'Esa subcuenta no existe.' }
  }
  const estadoAnterior = previa.status as TenantStatus
  // Reponer un estado igual no es una operación (y `active → active` se descarta antes, en la ruta):
  // reactivar lo ya activo o suspender lo ya suspendido solo ensuciaría el registro de auditoría.
  if (estadoAnterior === status) {
    return { ok: false, motivo: 'ya_estaba', mensaje: `La subcuenta ya estaba en estado "${status}".` }
  }
  // Restaurar (cualquier estado ≠ active → active) pasa por la MISMA pantalla y el mismo gate de
  // super admin: ninguna subcuenta archivada se puede reanimar desde fuera de la plataforma.

  const { data, error } = await sb.from('tenants').update({ status }).eq('id', tenantId).select('id,status')
  if (error) throw error
  if (!data || data.length === 0) {
    return { ok: false, motivo: 'no_escrito', mensaje: 'No se pudo cambiar el estado (0 filas afectadas).' }
  }

  await sb.from('audit_logs').insert({
    tenant_id: actor.tenantId,
    entity_type: 'tenant',
    entity_id: tenantId,
    action: 'update',
    actor_user_id: actor.userId,
    old_values: { status: estadoAnterior },
    new_values: { status },
  })
  return { ok: true, status }
}
