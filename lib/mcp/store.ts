import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Cliente service-role exclusivo del módulo MCP. Las tablas OAuth tienen RLS; el servidor
 * gestiona códigos/tokens que el usuario no debe manipular directamente, así que TODA la
 * administración de credenciales pasa por aquí, en servidor. El usuario solo lista/borra
 * sus propios clientes vía RLS (policies en la migración).
 */
export function mcpAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('Faltan credenciales Supabase para el servidor MCP')
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}

export type McpClient = {
  client_id: string
  name: string
  owner_user_id: string | null
  redirect_uris: string[]
  client_secret_hash: string
}

export type McpTokenRow = {
  id: string
  client_id: string
  user_id: string
  scope: string
  token_hash: string
  expires_at: string
  revoked_at: string | null
  refresh_expires_at: string | null
}

const sb = () => mcpAdminClient()

/** Alta de un cliente OAuth (registro dinámico RFC 7591). Devuelve el secreto SOLO esta vez. */
export async function insertClient(input: {
  client_id: string
  client_secret_hash: string
  name: string
  owner_user_id: string | null
  redirect_uris: string[]
}): Promise<void> {
  const { error } = await sb().from('mcp_oauth_clients').insert(input)
  if (error) throw new Error(`No se pudo registrar el cliente MCP: ${error.message}`)
}

export async function getClient(clientId: string): Promise<McpClient | null> {
  const { data, error } = await sb()
    .from('mcp_oauth_clients')
    .select('client_id, name, owner_user_id, redirect_uris, client_secret_hash')
    .eq('client_id', clientId)
    .maybeSingle()
  if (error) throw new Error(`No se pudo leer el cliente MCP: ${error.message}`)
  return (data as McpClient | null) ?? null
}

export async function insertCode(row: {
  code_hash: string
  client_id: string
  user_id: string
  redirect_uri: string
  scope: string
  code_challenge: string
  expires_at: string
}): Promise<void> {
  const { error } = await sb().from('mcp_oauth_codes').insert(row)
  if (error) throw new Error(`No se pudo guardar el código de autorización: ${error.message}`)
}

/** Canje atómico: el UPDATE solo afecta a un código válido, no usado y no caducado. */
export async function consumeCode(codeHash: string): Promise<{
  client_id: string
  user_id: string
  redirect_uri: string
  scope: string
  code_challenge: string
} | null> {
  const sbi = sb()
  const { data: found, error: readError } = await sbi
    .from('mcp_oauth_codes')
    .select('id, client_id, user_id, redirect_uri, scope, code_challenge, expires_at, used_at')
    .eq('code_hash', codeHash)
    .maybeSingle()
  if (readError) throw new Error(`No se pudo leer el código de autorización: ${readError.message}`)
  if (!found || found.used_at || new Date(found.expires_at).getTime() < Date.now()) return null
  const { error: updateError } = await sbi
    .from('mcp_oauth_codes')
    .update({ used_at: new Date().toISOString() })
    .eq('id', found.id)
    .is('used_at', null)
  // Dos canjes en paralelo: solo el primero ve used_at nulo en el UPDATE.
  if (updateError) throw new Error(`No se pudo consumir el código: ${updateError.message}`)
  return {
    client_id: found.client_id,
    user_id: found.user_id,
    redirect_uri: found.redirect_uri,
    scope: found.scope,
    code_challenge: found.code_challenge,
  }
}

export async function insertToken(row: {
  token_hash: string
  refresh_hash: string
  client_id: string
  user_id: string
  scope: string
  expires_at: string
  refresh_expires_at: string
}): Promise<void> {
  const { error } = await sb().from('mcp_oauth_tokens').insert(row)
  if (error) throw new Error(`No se pudo guardar el token MCP: ${error.message}`)
}

/** Rotación de refresh: marca el token antiguo como revocado y devuelve su fila si era válido. */
export async function revokeByRefreshHash(refreshHash: string): Promise<McpTokenRow | null> {
  const sbi = sb()
  const { data: found, error: readError } = await sbi
    .from('mcp_oauth_tokens')
    .select('id, client_id, user_id, scope, token_hash, expires_at, revoked_at, refresh_expires_at')
    .eq('refresh_hash', refreshHash)
    .maybeSingle()
  if (readError) throw new Error(`No se pudo leer el refresh token: ${readError.message}`)
  if (!found || found.revoked_at) return null
  const { error: updateError } = await sbi
    .from('mcp_oauth_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', found.id)
    .is('revoked_at', null)
  if (updateError) throw new Error(`No se pudo rotar el refresh token: ${updateError.message}`)
  return found as McpTokenRow
}

/** Fija el dueño del cliente en el primer consentimiento (idempotente). */
export async function asignarPropietario(clientId: string, userId: string): Promise<void> {
  const { error } = await sb()
    .from('mcp_oauth_clients')
    .update({ owner_user_id: userId })
    .eq('client_id', clientId)
    .is('owner_user_id', null)
  if (error) throw new Error(`No se pudo asignar el dueño del cliente MCP: ${error.message}`)
}

export async function findAccessToken(tokenHash: string): Promise<McpTokenRow | null> {
  const { data, error } = await sb()
    .from('mcp_oauth_tokens')
    .select('id, user_id, scope, token_hash, expires_at, revoked_at, client_id')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (error) throw new Error(`No se pudo validar el token MCP: ${error.message}`)
  if (!data || data.revoked_at) return null
  if (new Date(data.expires_at).getTime() < Date.now()) return null
  return data as McpTokenRow
}

// ---------------------------------------------------------------------------
// Gestión por el usuario: clientes conectados y sesiones activas (pantalla de
// Configuración). Todas las escrituras filtran por dueño/usuario, y la
// autorización se reconfirma aquí por si una ruta olvida hacerlo:
// el token de sesión ajena jamás es revocable desde otra cuenta.
// ---------------------------------------------------------------------------

export type McpClienteVisible = {
  client_id: string
  name: string
  owner_user_id: string | null
  redirect_uris: string[]
  created_at: string
}

export type McpSesionVisible = {
  id: string
  client_id: string
  client_name: string | null
  scope: string
  created_at: string
  expires_at: string
  revoked_at: string | null
  refresh_expires_at: string | null
}

export async function listarClientesDeUsuario(userId: string): Promise<McpClienteVisible[]> {
  const { data, error } = await sb()
    .from('mcp_oauth_clients')
    .select('client_id, name, owner_user_id, redirect_uris, created_at')
    .eq('owner_user_id', userId)
    .order('created_at', { ascending: false })
    .limit(100)
  if (error) throw new Error(`No se pudieron listar los clientes MCP: ${error.message}`)
  return (data ?? []) as McpClienteVisible[]
}

/** Sesiones (tokens emitidos) de los clientes QUE PERTENECEN a este usuario: la join client→owner
 *  es el filtro de propiedad; una sesión de un cliente ajeno no entra aunque user_id coincidiera. */
export async function listarSesionesDeUsuario(userId: string): Promise<McpSesionVisible[]> {
  const clientes = await listarClientesDeUsuario(userId)
  if (clientes.length === 0) return []
  const clientIds = clientes.map((c) => c.client_id)
  const { data, error } = await sb()
    .from('mcp_oauth_tokens')
    .select('id, client_id, scope, created_at, expires_at, revoked_at, refresh_expires_at')
    .in('client_id', clientIds)
    .order('created_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(`No se pudieron listar las sesiones MCP: ${error.message}`)
  const nombre = new Map(clientes.map((c) => [c.client_id, c.name]))
  return ((data ?? []) as Omit<McpSesionVisible, 'client_name'>[]).map((t) => ({
    ...t,
    client_name: nombre.get(t.client_id) ?? null,
  }))
}

/** Revoca UNA sesión. Solo si el token pertenece a un cliente del que el usuario es dueño. */
export async function revocarSesion(userId: string, tokenId: string): Promise<boolean> {
  const clientes = await listarClientesDeUsuario(userId)
  const clientIds = new Set(clientes.map((c) => c.client_id))
  if (clientIds.size === 0) return false
  // UPDATE acotado por client_id y revoked_at nulo: si la fila ya está revocada, el resultado
  // es 0 filas y la función devuelve false (idempotente), no un error.
  const { data, error } = await sb()
    .from('mcp_oauth_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', tokenId)
    .in('client_id', [...clientIds])
    .is('revoked_at', null)
    .select('id')
  if (error) throw new Error(`No se pudo revocar la sesión MCP: ${error.message}`)
  return (data ?? []).length > 0
}

/** Revoca el cliente COMPLETO: sus sesiones primero y luego el cliente. Idempotente. */
export async function revocarCliente(userId: string, clientId: string): Promise<boolean> {
  const clientes = await listarClientesDeUsuario(userId)
  const cliente = clientes.find((c) => c.client_id === clientId)
  if (!cliente) return false
  const { data: sesiones, error: sesionesError } = await sb()
    .from('mcp_oauth_tokens')
    .update({ revoked_at: new Date().toISOString() })
    .eq('client_id', clientId)
    .is('revoked_at', null)
    .select('id')
  if (sesionesError) throw new Error(`No se pudo revocar el acceso MCP: ${sesionesError.message}`)
  const { error: deleteError } = await sb()
    .from('mcp_oauth_clients')
    .delete()
    .eq('client_id', clientId)
    .eq('owner_user_id', userId)
  if (deleteError) throw new Error(`No se pudo revocar el acceso MCP: ${deleteError.message}`)
  // El DELETE con owner_user_id en el filtro es la prueba real de propiedad: si no era dueño queda
  // la fila. Verificación por count:
  const { count: quedan, error: verifyError } = await sb()
    .from('mcp_oauth_clients')
    .select('client_id', { count: 'exact', head: true })
    .eq('client_id', clientId)
  if (verifyError) throw new Error(`No se pudo verificar la revocación MCP: ${verifyError.message}`)
  return quedan === 0
}
