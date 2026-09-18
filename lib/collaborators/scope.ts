import type { SupabaseClient } from '@supabase/supabase-js'

// SCOPE DE COLABORADOR — la capa de datos, no de UI (§16, §55, §56, §57).
//
// Un colaborador es un usuario con el MISMO login y las MISMAS pantallas que
// cualquiera, pero sus queries llevan un filtro extra que NO puede quitar: solo
// ve lo atribuido a SU collaborator_profiles.id. El filtro se aplica aquí, en la
// capa de datos; el RLS es el backstop de base de datos (la policy enmendada de
// la migración 20260918150000), y esto es la primera línea: incluso donde RLS
// aún no cubre, la app no pide lo que el colaborador no debe ver.
//
// CÓMO FILTRA. La relación canónica contacto↔colaborador vive en
// contact_attributions.collaborator_id (FK estructurada, no un string de custom
// field). Para acotar contacts/appointments/sales/commissions por colaborador
// NO se copian queries por pantalla: se restringe el conjunto de contact_ids
// primero y el resto de la query encadena `.in('contact_id', ids)`.
//
//   const scope = await resolverScopeColaborador(sb, userId, tenantId)
//   const q = sb.from('sales').select('*').eq('tenant_id', tenantId)
//   const scoped = aplicarScopeAContactos(q, scope)  // ← no-op para el resto

export type ScopeColaborador = { tipo: 'none' } | { tipo: 'collaborator'; collaboratorId: string; code: string }

/**
 * Resuelve el perfil de colaborador de un usuario EN ESTA subcuenta.
 *
 * `null` cuando no lo es (o su perfil está inactivo): el resto del sistema
 * sigue funcionando igual para admins, closers y setters — esta capa solo
 * añade el estrechamiento cuando existe el perfil.
 */
export async function resolverScopeColaborador(
  sb: SupabaseClient,
  userId: string,
  tenantId: string
): Promise<ScopeColaborador> {
  const { data } = await sb
    .from('collaborator_profiles')
    .select('id, code, status')
    .eq('tenant_id', tenantId)
    .eq('user_id', userId)
    .maybeSingle()

  const row = data as { id: string; code: string; status: string } | null
  if (!row || row.status !== 'active') return { tipo: 'none' }
  return { tipo: 'collaborator', collaboratorId: row.id, code: row.code }
}

/**
 * user_ids con perfil de colaborador ACTIVO en la subcuenta. Lo consume el motor
 * de comisiones para emitir el ledger con participant_type='collaborator' (una
 * sola query por cobro, no una por fila) — los 'affiliate' históricos siguen
 * saliendo igual; solo los beneficiarios con perfil estructurado cambian de lane.
 */
export async function usuariosColaboradoresActivos(sb: SupabaseClient, tenantId: string): Promise<Set<string>> {
  const { data, error } = await sb
    .from('collaborator_profiles')
    .select('user_id')
    .eq('tenant_id', tenantId)
    .eq('status', 'active')
  if (error) {
    // Fail-closed para el scope de lectura; aquí un fallo solo degradaría la
    // etiqueta del ledger a 'affiliate', así que no tumba el cobro: se registra.
    console.error('[collaborators/scope] perfiles activos no legibles:', error.message)
    return new Set()
  }
  return new Set(((data ?? []) as { user_id: string | null }[]).map((r) => r.user_id).filter((x): x is string => !!x))
}

/**
 * Resuelve por código público (?ref=WDC-0472) → UUID del perfil, SIEMPRE dentro
 * del tenant y SOLO si está activo. El código nunca es identidad: se resuelve
 * server-side y la relación se guarda por id (§43).
 */
export async function resolverColaboradorPorCodigo(
  sb: SupabaseClient,
  tenantId: string,
  rawCode: string
): Promise<{ id: string } | null> {
  const code = rawCode.trim()
  if (!code) return null
  const { data } = await sb
    .from('collaborator_profiles')
    .select('id')
    .eq('tenant_id', tenantId)
    .eq('code', code)
    .eq('status', 'active')
    .maybeSingle()
  return (data as { id: string } | null) ?? null
}

/**
 * Los contact_ids atribuidos al colaborador. Devuelve `null` cuando el scope no
 * aplica (equipo) para que el caller NO filtre; devuelve `[]` cuando el
 * colaborador aún no tiene nadie atribuido (verá vacío, no todo).
 *
 * FAIL CLOSED: ante un error de base de datos se devuelve `[]`, nunca `null`.
 * Un fallo transitorio jamás puede dejar a un colaborador viendo el tenant
 * entero — el peor escenario legítimo es una pantalla vacía reintentable.
 */
export async function contactIdsDeScope(
  sb: SupabaseClient,
  tenantId: string,
  scope: ScopeColaborador
): Promise<string[] | null> {
  if (scope.tipo !== 'collaborator') return null
  const { data, error } = await sb
    .from('contact_attributions')
    .select('contact_id')
    .eq('tenant_id', tenantId)
    .eq('collaborator_id', scope.collaboratorId)
    .limit(50_000)
  if (error) {
    console.error('[collaborators/scope] no se pudo leer el scope:', error.message)
    return []
  }
  return ((data ?? []) as { contact_id: string | null }[]).map((r) => r.contact_id).filter((x): x is string => !!x)
}

// USO en cada pantalla (patrón único, sin duplicar queries):
//
//   const scope = await resolverScopeColaborador(sb, sesion.userId, tenantId)
//   const contactIds = await contactIdsDeScope(sb, tenantId, scope)
//   let q = sb.from('sales').select('*').eq('tenant_id', tenantId)
//   if (contactIds) q = q.in('contact_id', contactIds)  // ← solo colaboradores
//
// El patrón es idéntico para appointments y para comisiones (tras join a
// sales.contact_id). En clientes con select embebido, el filtro de contactos
// va en la tabla raíz; PostgREST no permite filtrar el padre por el hijo, así
// que para `contacts` se usa `.in('id', contactIds)`.
